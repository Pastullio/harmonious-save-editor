# Harmonious LiveLink - a Blender add-on for Harmonious Save Editor (GPL-3.0, same as the editor).
#
# Every time you save your .blend (Ctrl+S), this sends the corvette build in the scene to Harmonious Save Editor,
# which puts it on the corvette you chose (Shipwright > LiveLink) and writes your save, backing it up first.
# The build is read with Charon Forge when it's installed, otherwise with the NMS Base Builder add-on.
#
# Install: Blender > Edit > Preferences > Add-ons > Install from Disk, pick this file, tick it.
# Then: 3D view sidebar (N) > LiveLink.

bl_info = {
    "name": "Harmonious LiveLink",
    "author": "Pastullio the Harmonious",
    "version": (1, 15, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > LiveLink",
    "description": "Send your corvette build to Harmonious Save Editor every time you save",
    "category": "Import-Export",
}

import base64
import json
import math
import os
import tempfile
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

import bpy
from bpy.app.handlers import persistent


# ---------------------------------------------------------------- finding the editor

def live_file():
    if os.environ.get("HSE_LIVE_FILE"):
        return os.environ["HSE_LIVE_FILE"]
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "HarmoniousSaveEditor", "live.json")


def editor_address():
    """(url, token) of the running editor, or None."""
    try:
        with open(live_file(), "r", encoding="utf-8") as f:
            info = json.load(f)
        return "http://127.0.0.1:%d/api/live/build" % int(info["port"]), info["token"]
    except (OSError, ValueError, KeyError):
        return None


# ---------------------------------------------------------------- is the editor linked?
# Every few seconds the add-on asks the editor whether LiveLink is on and for which corvette; the panel shows it,
# and the editor sees Blender check in.
LINK = {"state": "none", "target": "", "slot": -1, "corvettes": [], "kind": "corvette", "base": None, "traveller": "", "exports": "", "addon": "", "tools": []}


def newer_addon():
    """The add-on version the running editor carries, when it's newer than this one."""
    try:
        theirs = tuple(int(x) for x in LINK.get("addon", "").split("."))
    except ValueError:
        return ""
    return LINK["addon"] if theirs > tuple(bl_info["version"]) else ""   # none: editor not running; off: running, LiveLink off; on: linked


def check_link_now():
    addr = editor_address()
    if addr is None:
        LINK.update(state="none", target="")
        return
    url, token = addr
    try:
        q = urllib.parse.urlencode({"file": os.path.basename(bpy.data.filepath) if bpy.data.filepath else ""})
        req = urllib.request.Request(url + "?" + q, headers={"X-Live-Token": token})
        with urllib.request.urlopen(req, timeout=3) as res:
            info = json.loads(res.read().decode("utf-8"))
        LINK.update(state="on" if info.get("armed") else "off", target=info.get("target") or "",
                    slot=int(info.get("slot", -1)), corvettes=info.get("corvettes") or LINK["corvettes"],
                    kind=info.get("kind") or "corvette", base=info.get("base"),
                    traveller=info.get("traveller") or "", exports=info.get("exports") or "", addon=info.get("addon") or "",
                    tools=list(info.get("tools") or []))
    except (urllib.error.URLError, OSError, ValueError):
        LINK.update(state="none", target="")


def link_timer():
    threading.Thread(target=check_link_now, daemon=True).start()
    redraw()   # shows what the last check found
    return 3.0


def redraw():
    for window in getattr(bpy.context.window_manager, "windows", []):
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


# ---------------------------------------------------------------- reading the build from the scene

def _objects_of(data):
    """Objects from whatever a builder returns: a dict with Objects, a bare list, or that as JSON text."""
    if isinstance(data, (str, bytes)):
        data = json.loads(data)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("Objects") or data.get("Prefab")
    return None


def whole(v):
    """A part's whole-number property, kept exact: UserData can pass 32 bits, so builders may keep it as text."""
    try:
        return int(str(v).strip() or 0)
    except (TypeError, ValueError):
        try:
            return int(float(v or 0))
        except (TypeError, ValueError):
            return 0


def scene_parts(scene):
    """The build read straight from the scene, the way the builders write each part: every object carrying an
    ObjectID, in build order, with its matrix turned from Blender's Z-up into the game's Y-up."""
    import math
    import mathutils
    z_up = mathutils.Matrix.Rotation(math.radians(-90.0), 4, "X")
    parts = [o for o in scene.objects if "ObjectID" in o]
    parts.sort(key=lambda o: int(o.get("order", 0) or 0))
    out = []
    for o in parts:
        m = z_up @ o.matrix_world
        oid = str(o.get("ObjectID", "")).lstrip("^")
        if not oid:
            continue
        stamp, user = whole(o.get("Timestamp", 0)), whole(o.get("UserData", 0))
        out.append({"ObjectID": "^" + oid, "Position": list(m.translation), "Up": list(m.col[1].to_3d()),
                    "At": list(m.col[2].to_3d().normalized()), "Timestamp": stamp, "UserData": user})
    return out


def base_info(scene):
    """The base a NMS Base Builder scene holds ({name, address}), or None for anything else (a corvette build).
    The Base Builder keeps them in the scene's nms_base_tool properties, readable without the add-on."""
    tool = scene.get("nms_base_tool") if hasattr(scene, "get") else None
    if tool is None:
        return None
    try:
        name = str(tool.get("string_base", "") or "")
        address = str(tool.get("string_address", "") or "")
    except Exception:  # noqa: BLE001
        return None
    if not name and not address:
        return None
    return {"name": name, "address": address}


def same_base(a, b):
    """Two {name, address} refer to the same base: the same address (hex or decimal), or the same name when one has none."""
    if not a or not b:
        return False
    def num(v):
        try:
            return int(str(v), 0)
        except (TypeError, ValueError):
            return None
    na, nb = num(a.get("address")), num(b.get("address"))
    if na is not None and nb is not None:
        return na == nb and (not a.get("name") or not b.get("name") or a.get("name") == b.get("name"))
    return bool(a.get("name")) and a.get("name") == b.get("name")


def base_objects(scene):
    problems = []
    tool = getattr(scene, "nms_base_tool", None)
    if tool is not None and hasattr(tool, "serialise"):
        try:
            try:
                data = tool.serialise()
            except TypeError:
                data = tool.serialise(objects_only=True)
            objects = _objects_of(data)
            if objects:
                return objects, "Base Builder"
        except Exception as error:  # noqa: BLE001
            problems.append("Base Builder: %s" % error)
    try:
        objects = scene_parts(scene)
    except Exception as error:  # noqa: BLE001
        objects = None
        problems.append("reading the scene: %s" % error)
    if objects:
        return objects, "the scene"
    problems.append("there are no base parts (objects with an ObjectID) in this scene")
    raise RuntimeError("No base to send: " + "; ".join(problems) + ".")


def build_objects(scene):
    """The build's parts as NMS objects (a list of dicts), or raise with a reason."""
    problems = []
    if base_info(scene) is not None:
        # a base: the Base Builder's own serialiser, else the parts as they sit in the scene (corvette builders
        # such as Charon Forge don't apply to it)
        return base_objects(scene)
    # a builder add-on's own serialiser (Charon Forge first; its package name has an install prefix such as
    # bl_ext.user_default., so look for any loaded module that offers get_builder)
    mods = [(n, m) for n, m in list(sys.modules.items()) if m is not None and callable(getattr(m, "get_builder", None)) and n != __name__]
    mods.sort(key=lambda nm: 0 if "charon" in nm[0].lower() else 1)
    for name, mod in mods:
        label = "Charon Forge" if "charon" in name.lower() else name.split(".")[-2] if "." in name else name
        try:
            objects = _objects_of(mod.get_builder().serialise())
        except Exception as error:  # noqa: BLE001 - show what the builder said
            problems.append("%s: %s" % (label, error))
            continue
        if objects:
            return objects, label
    # the NMS Base Builder add-on (its serialise() takes no arguments in current versions)
    tool = getattr(scene, "nms_base_tool", None)
    if tool is not None:
        try:
            try:
                data = tool.serialise()
            except TypeError:
                data = tool.serialise(objects_only=True)
            objects = _objects_of(data)
            if objects:
                return objects, "Base Builder"
        except Exception as error:  # noqa: BLE001
            problems.append("Base Builder: %s" % error)
    # last: the parts as they sit in the scene
    try:
        objects = scene_parts(scene)
    except Exception as error:  # noqa: BLE001
        objects = None
        problems.append("reading the scene: %s" % error)
    if objects:
        return objects, "the scene"
    problems.append("there are no build parts (objects with an ObjectID) in this scene")
    raise RuntimeError("No build to send: " + "; ".join(problems) + ".")


# ---------------------------------------------------------------- sending

STATE = {"status": "Not sent yet", "busy": False}


def set_status(text):
    STATE["status"] = text
    redraw()


def send(scene):
    if STATE["busy"]:
        return
    addr = editor_address()
    if addr is None:
        set_status("Harmonious Save Editor isn't running")
        return
    try:
        objects, source = build_objects(scene)
    except Exception as error:  # noqa: BLE001 - whatever the builder raises, show it
        set_status(str(error))
        return
    payload = {"objects": objects, "name": os.path.splitext(os.path.basename(bpy.data.filepath))[0],
               "file": bpy.data.filepath, "source": source}
    base = base_info(scene)
    if base is not None:   # a base names itself; the editor checks it against the base LiveLink is on for
        payload["base"] = base
    elif scene.harmonious_target_slot >= 0:   # the corvette this .blend is for; the editor won't write anywhere else unasked
        payload["target"] = {"slot": scene.harmonious_target_slot, "name": scene.harmonious_target_name}
    body = json.dumps(payload).encode("utf-8")
    url, token = addr
    STATE["busy"] = True
    set_status("Sending %d parts..." % len(objects))

    def worker():
        try:
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": "application/json", "X-Live-Token": token})
            with urllib.request.urlopen(req, timeout=120) as res:
                answer = json.loads(res.read().decode("utf-8"))
            text = answer.get("message") or ("Sent" if answer.get("ok") else "The editor didn't take the build")
            if answer.get("ok") and isinstance(answer.get("target"), dict):
                STATE["target"] = answer["target"]   # the editor confirmed the corvette: this .blend remembers it
        except (urllib.error.URLError, OSError, ValueError) as error:
            text = "Couldn't reach Harmonious Save Editor: %s" % error
        STATE["status"] = text
        STATE["busy"] = False
        # back on Blender's main thread: remember the corvette in the scene (saved with the .blend) and redraw
        bpy.app.timers.register(lambda: (apply_answer(), set_status(text), None)[2], first_interval=0.01)

    threading.Thread(target=worker, daemon=True).start()


def apply_answer():
    t = STATE.pop("target", None)
    scene = bpy.context.scene
    if t and scene is not None:
        scene.harmonious_target_slot = int(t.get("slot", -1))
        scene.harmonious_target_name = t.get("name", "")


@persistent
def on_save(_):
    scene = bpy.context.scene
    if scene is not None and getattr(scene, "harmonious_live_on", False):
        send(scene)


# ---------------------------------------------------------------- UI

class HARMONIOUS_OT_send(bpy.types.Operator):
    bl_idname = "harmonious.live_send"
    bl_label = "Send now"
    bl_description = "Send the build to Harmonious Save Editor now"

    def execute(self, context):
        send(context.scene)
        return {"FINISHED"}


def switch_warning(armed, name):
    return ["LiveLink in the editor is on for %s." % armed,
            "Turn it on for %s in Shipwright," % name,
            "or the editor will ask before writing to it."]


_TARGET_ITEMS = []   # kept alive: Blender needs the enum items to outlive the callback


def target_items(self, context):
    _TARGET_ITEMS.clear()
    _TARGET_ITEMS.append(("-1|", "Not set", "This file isn't set to a corvette yet"))
    for c in LINK["corvettes"]:
        _TARGET_ITEMS.append(("%d|%s" % (c["slot"], c["name"]), "%s (slot %d)" % (c["name"], c["slot"] + 1), ""))
    return _TARGET_ITEMS


class HARMONIOUS_OT_target(bpy.types.Operator):
    bl_idname = "harmonious.live_target"
    bl_label = "Corvette"
    bl_description = "The corvette in your save that this .blend updates"
    bl_property = "target"

    target: bpy.props.EnumProperty(items=target_items)

    def execute(self, context):
        slot, _, name = self.target.partition("|")
        scene = context.scene
        scene.harmonious_target_slot, scene.harmonious_target_name = int(slot), name
        if int(slot) >= 0 and LINK["state"] == "on" and LINK["slot"] != int(slot):
            lines = switch_warning(LINK["target"], name)
            STATE["warning"] = lines
            if context.window is not None and not bpy.app.background:   # no popups when Blender runs in the background

                def draw(menu, _context):
                    for line in lines:
                        menu.layout.label(text=line)
                context.window_manager.popup_menu(draw, title="You switched corvettes", icon="ERROR")
        set_status("This file now goes to %s" % name if int(slot) >= 0 else "This file isn't set to a corvette")
        return {"FINISHED"}


# ---------------------------------------------------------------- the logo and supporting the creator

SUPPORT = (
    ("Patreon", "https://www.patreon.com/pastullio", "FUND"),
    ("Buy me a coffee", "https://buymeacoffee.com/pastullio", "HEART"),
    ("Discord", "https://discord.gg/3PfZfPYDn", "COMMUNITY"),
    ("YouTube", "https://www.youtube.com/@PastullioTheHarmonious", "PLAY"),
    ("Harmonious Save Editor", "https://github.com/Pastullio/harmonious-save-editor", "URL"),
)

# the creator's other free tools
TOOLS = (
    ("Portal Glyph Banner", "https://portalglyphbanner.netlify.app/", "IMAGE_DATA"),
    ("Traveller credentials", "https://harmonious-credentials.netlify.app/", "USER"),
)

_PREVIEWS = None


def previews():
    """The round logo and the coloured icons (neon pink for builds, neon blue for posing) as Blender previews,
    written once to a temp folder."""
    global _PREVIEWS
    if _PREVIEWS is None:
        from bpy.utils import previews as bpy_previews
        folder = os.path.join(tempfile.gettempdir(), "harmonious_livelink_%s" % ".".join(map(str, bl_info["version"])))
        os.makedirs(folder, exist_ok=True)
        pv = bpy_previews.new()
        for name, data in [("logo", LOGO_IMAGE)] + list(ICONS.items()):
            path = os.path.join(folder, name + ".png")
            if not os.path.exists(path):
                with open(path, "wb") as f:
                    f.write(base64.b64decode(data))
            pv.load(name, path, "IMAGE")
        _PREVIEWS = pv
    return _PREVIEWS


def ic(name, fallback="NONE"):
    """Keyword arguments for one of our coloured icons, or Blender's own icon when previews can't be made."""
    try:
        return {"icon_value": previews()[name].icon_id}
    except Exception:
        return {"icon": fallback}


def draw_logo(context, layout):
    try:
        logo = previews()["logo"].icon_id
    except Exception:   # no logo is no reason to lose the panel
        return
    region = getattr(context, "region", None)
    width = region.width if region is not None else 300
    unit = 20 * (context.preferences.system.ui_scale or 1.0)
    scale = max(3.0, min(8.0, (width - 24) / unit * 0.55))
    row = layout.row()
    row.alignment = "CENTER"
    row.template_icon(icon_value=logo, scale=scale)
    row = layout.row()
    row.alignment = "CENTER"
    row.label(text="Blender  ·  No Man's Sky")


class HARMONIOUS_PT_live(bpy.types.Panel):
    bl_label = "LiveLink"
    bl_idname = "HARMONIOUS_PT_live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"
    bl_order = 0

    def draw_header(self, context):
        self.layout.label(text="", **ic("link", "LINKED"))

    def draw(self, context):
        layout = self.layout
        draw_logo(context, layout)
        if newer_addon():
            up = layout.box()
            up.alert = True
            up.label(text="A newer add-on (%s) is ready" % newer_addon(), icon="ERROR")
            up.label(text="Get it on Shipwright and install it over this one")
        # the link, first and clearest
        link = layout.box()
        if LINK["state"] == "on":
            link.label(text="Linked to " + LINK["target"], **ic("link", "LINKED"))
            link.label(text="Each save sends the build there")
        elif LINK["state"] == "off":
            link.label(text="Editor open, LiveLink off", icon="UNLINKED")
            link.label(text="Turn it on in Shipwright or on Bases")
        else:
            link.label(text="Harmonious Save Editor isn't running", icon="ERROR")


# Each part of LiveLink is a panel of its own in the sidebar's LiveLink tab, opened and closed on its own header
# (owner, 2026-11-11, like Base Builder Extended's panels).
class LiveLinkPanel:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"
    header_icon = "NONE"

    def draw_header(self, context):
        name, fallback = self.header_icon if isinstance(self.header_icon, tuple) else (None, self.header_icon)
        self.layout.label(text="", **(ic(name, fallback) if name else {"icon": fallback}))


class HARMONIOUS_PT_build(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Builds: corvettes and bases"
    bl_idname = "HARMONIOUS_PT_build"
    bl_order = 1
    header_icon = ("build", "MOD_BUILD")

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        base = base_info(scene)
        if base is not None:
            # a base file says which base it is; warn when the editor is on for something else
            col = layout.column(align=True)
            col.label(text="This file is the base:")
            col.label(text=base["name"] or base["address"], **ic("base", "HOME"))
            if LINK["state"] == "on" and not (LINK.get("kind") == "base" and same_base(base, LINK.get("base"))):
                warn = layout.box()
                warn.alert = True
                warn.label(text="The editor is on for " + ("a corvette" if LINK.get("kind") != "base" else "another base"), icon="ERROR")
                warn.label(text="It will ask before writing")
            self.draw_send(context, layout)
            return
        # which corvette this .blend updates (saved in the file, so each version keeps its corvette)
        col = layout.column(align=True)
        col.label(text="This file updates:")
        current = "%s (slot %d)" % (scene.harmonious_target_name, scene.harmonious_target_slot + 1) if scene.harmonious_target_slot >= 0 else "Choose a corvette"
        pick = col.row(align=True)
        pick.label(text="", **ic("corvette", "MOD_BUILD"))
        pick.operator_menu_enum(HARMONIOUS_OT_target.bl_idname, "target", text=current)
        if scene.harmonious_target_slot >= 0 and LINK["state"] == "on" and LINK["slot"] != scene.harmonious_target_slot:
            warn = layout.box()
            warn.alert = True
            warn.label(text="The editor is on for a different corvette", icon="ERROR")
            warn.label(text="It will ask before writing")
        self.draw_send(context, layout)

    def draw_send(self, context, layout):
        layout.prop(context.scene, "harmonious_live_on", text="Send on save (Ctrl+S)")
        row = layout.row()
        row.enabled = LINK["state"] == "on"
        row.operator(HARMONIOUS_OT_send.bl_idname, **ic("send", "EXPORT"))
        if context.scene.harmonious_target_slot >= 0 and not base_info(context.scene):
            row = layout.row()
            row.enabled = LINK["state"] != "none"
            row.operator(HARMONIOUS_OT_send_ship.bl_idname, **ic("corvette", "EXPORT"))
        box = layout.box()
        box.label(text="Last send", **ic("info", "INFO"))
        lines = box.column(align=True)   # tight lines, not one widely spaced row each
        lines.scale_y = 0.8
        for line in wrap(STATE["status"], 40):
            lines.label(text=line)


# ---------------------------------------------------------------- your traveller (owner, 2026-11-10)
# The editor builds the open save's traveller from the game files, skeleton included (a .glb); this brings it in,
# ready to pose, and renders the pose as a picture with a transparent background.

def find_traveller():
    """The traveller's armature in this file: the one we imported, else the selected or only armature."""
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    for o in arms:
        if o.get("harmonious_traveller"):
            return o
    act = bpy.context.view_layer.objects.active
    if act is not None and act.type == "ARMATURE":
        return act
    return arms[0] if len(arms) == 1 else None


def tidy_skeleton(arm, meshes):
    """Plain stick bones, and the game's helper joints (cameras, effects, attach points: bones that move no part of
    the body) in a hidden bone collection, so only the bones that pose the traveller show."""
    for pb in arm.pose.bones:
        pb.custom_shape = None
    arm.data.display_type = "STICK"
    used = set()
    for m in meshes:
        names = {g.index: g.name for g in m.vertex_groups}
        for v in m.data.vertices:
            for g in v.groups:
                if g.weight > 0.001:
                    used.add(names.get(g.group))
    if not used or not hasattr(arm.data, "collections"):
        return
    body = arm.data.collections.new("Body")
    helpers = arm.data.collections.new("Helpers")
    for b in arm.data.bones:
        # a bone that moves nothing itself but has bones under it that do (the hips, the spine) is part of the body too
        moves = b.name in used or any(c.name in used for c in b.children_recursive)
        (body if moves else helpers).assign(b)
    helpers.is_visible = False
    for b in arm.data.bones:   # every stick hidden: click a part of the body to show the one that moves it
        set_hidden(arm, b, True)


# Blender 5 keeps a bone's selection and visibility in Pose mode on the pose bone; Blender 4 on the bone.
def set_hidden(arm, b, hide):
    pb = arm.pose.bones.get(b.name)
    if pb is not None and hasattr(pb, "hide"):
        pb.hide = hide
    b.hide = hide


def is_hidden(arm, b):
    pb = arm.pose.bones.get(b.name)
    return pb.hide if pb is not None and hasattr(pb, "hide") else b.hide


def set_selected(arm, b, on):
    pb = arm.pose.bones.get(b.name)
    if pb is not None and hasattr(pb, "select"):
        pb.select = on
    else:
        b.select = b.select_head = b.select_tail = on


def is_selected(arm, b):
    pb = arm.pose.bones.get(b.name)
    return pb.select if pb is not None and hasattr(pb, "select") else b.select


def free_bone(pb):
    """The bone that carries the whole traveller (ROOT, or the top of the skeleton): the only one that moves."""
    return pb.parent is None or pb.name == "ROOT" or (pb.parent is not None and pb.parent.parent is None and pb.parent.name == "Trajectory")


def apply_keep_shape(arm):
    """Keep the body's proportions (owner, 2026-11-10: moving an arm stretched it): every bone only turns, its
    length and size stay; the root still moves the whole traveller. Off: bones move and scale freely."""
    on = bool(getattr(arm, "harmonious_keep_shape", True))
    for pb in arm.pose.bones:
        lock = on and not free_bone(pb)
        pb.lock_location = (lock, lock, lock)
        pb.lock_scale = (on, on, on)
        if lock:
            pb.location = (0.0, 0.0, 0.0)
        if on:
            pb.scale = (1.0, 1.0, 1.0)


# ---------------------------------------------------------------- fingers and natural joints (owner, 2026-11-12)
# The traveller's hand has two fingers on one chain of joints (hand_03, the game moves them together) and a thumb
# (hand_05). split_fingers gives the second finger its own joints (hand_03b), so each can be posed. Natural joints:
# fingers, elbows and knees only bend the way a real one does (Euler rotation with the other two axes locked), and
# every bone turns at its own joint.
SEGMENTS = ("01", "02", "03")


def _world_verts(arm, meshes, group):
    out = []
    for m in meshes:
        g = m.vertex_groups.get(group)
        if g is None:
            continue
        mw = m.matrix_world
        for v in m.data.vertices:
            for e in v.groups:
                if e.group == g.index and e.weight > 0.001:
                    out.append((m, v.index, e.weight, mw @ v.co))
    return out


def finger_axis(arm, meshes, side):
    """The line across the hand from one finger to the other (the fingers bend round it), in world space, from the
    spread of the first finger joint's vertices across the finger."""
    import mathutils
    b = arm.data.bones.get("%s_hand_03_01" % side)
    if b is None:
        return None
    W = arm.matrix_world
    head, tail = W @ b.head_local, W @ b.tail_local
    d = (tail - head).normalized()
    pts = [p for _, _, w, p in _world_verts(arm, meshes, b.name) if w > 0.5]
    if len(pts) < 20:
        return None
    flat = [(p - head) - d * (p - head).dot(d) for p in pts]
    c = sum(flat, mathutils.Vector()) / len(flat)
    cov = mathutils.Matrix(((0.0,) * 3,) * 3)
    for q in flat:
        q = q - c
        for i in range(3):
            for j in range(3):
                cov[i][j] += q[i] * q[j]
    v = mathutils.Vector((1, 0.3, 0.2))   # the strongest direction, by power iteration
    for _ in range(40):
        v = (cov @ v)
        if v.length < 1e-12:
            return None
        v.normalize()
    return v


def _finger_sides(meshes, names, head, L):
    """Which finger each vertex of the 03 chain belongs to (True: the + side of L). Decided per piece of mesh, so a
    finger segment is never cut in two (owner 2026-11-12: fingers stretched where a piece was split down the middle);
    only a big piece that really spans both fingers (one joined glove) is split vertex by vertex."""
    side = {}
    for m in meshes:
        idx = {m.vertex_groups[n].index for n in names if m.vertex_groups.get(n) is not None}
        if not idx:
            continue
        mw = m.matrix_world
        S = {}
        for v in m.data.vertices:
            w = sum(e.weight for e in v.groups if e.group in idx)
            if w > 0.001:
                S[v.index] = ((mw @ v.co) - head).dot(L)
        if not S:
            continue
        adj = {i: [] for i in S}
        for e in m.data.edges:
            a, b = e.vertices
            if a in S and b in S:
                adj[a].append(b)
                adj[b].append(a)
        seen = set()
        for i in S:
            if i in seen:
                continue
            stack, comp = [i], []
            seen.add(i)
            while stack:
                x = stack.pop()
                comp.append(x)
                for y in adj[x]:
                    if y not in seen:
                        seen.add(y)
                        stack.append(y)
            pos = sum(1 for x in comp if S[x] > 0)
            # a small piece across both fingers is the knuckle's pin, on the hinge line: whole, it stays put either way
            if len(comp) > 300 and min(pos, len(comp) - pos) > 0.35 * len(comp):
                for x in comp:
                    side[(m.name, x)] = S[x] > 0
            else:
                plus = sum(S[x] for x in comp) > 0
                for x in comp:
                    side[(m.name, x)] = plus
    return side


def split_fingers(context, arm, meshes):
    """Give each hand's second finger its own joints; returns how many hands were split."""
    import mathutils
    done = 0
    W = arm.matrix_world
    Wi3 = W.inverted().to_3x3()
    plans = []
    for side in ("l", "r"):
        names = ["%s_hand_03_%s" % (side, k) for k in SEGMENTS]
        if not all(n in arm.data.bones for n in names) or ("%s_hand_03b_01" % side) in arm.data.bones:
            continue
        L = finger_axis(arm, meshes, side)
        if L is None:
            continue
        thumb = arm.data.bones.get("%s_hand_05_01" % side)
        moves = []
        ok = True
        sides = _finger_sides(meshes, names, W @ arm.data.bones[names[0]].head_local, L)
        for n in names:
            b = arm.data.bones[n]
            head = W @ b.head_local
            vs = _world_verts(arm, meshes, n)
            plus = [x for x in vs if sides.get((x[0].name, x[1]), (x[3] - head).dot(L) > 0)]
            minus = [x for x in vs if not sides.get((x[0].name, x[1]), (x[3] - head).dot(L) > 0)]
            if len(plus) < 0.2 * len(vs) or len(minus) < 0.2 * len(vs):
                ok = False
                break
            off = lambda xs: sum((x[3] - head).dot(L) for x in xs) / len(xs)
            moves.append((n, plus, minus, off(plus), off(minus)))
        if not ok:
            continue
        # the finger nearer the thumb keeps the game's joints; the other gets the new ones
        if thumb is not None:
            t = W @ thumb.head_local
            h0 = W @ arm.data.bones[names[0]].head_local
            if (t - h0).dot(L) > 0:
                L = -L
                moves = [(n, mi, pl, -om, -op) for n, pl, mi, op, om in moves]
        plans.append((side, L, moves))
    if not plans:
        return 0
    # the weights: the second finger's vertices move to the new joints
    for side, L, moves in plans:
        for n, plus, minus, op, om in moves:
            nb = n.replace("_03_", "_03b_")
            for m in {x[0] for x in plus}:
                if m.vertex_groups.get(nb) is None:
                    m.vertex_groups.new(name=nb)
            for m, vi, w, _ in plus:
                m.vertex_groups[nb].add([vi], w, "REPLACE")
                m.vertex_groups[n].remove([vi])
    # the joints: a copy of the chain beside the second finger, the game's one moved into the first
    prev_active = context.view_layer.objects.active
    context.view_layer.objects.active = arm
    mode = context.mode
    if mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for side, L, moves in plans:
        La = Wi3 @ L
        prev = None
        for n, plus, minus, op, om in moves:
            src = eb[n]
            nb = eb.new(n.replace("_03_", "_03b_"))
            nb.head, nb.tail, nb.roll = src.head.copy(), src.tail.copy(), src.roll
            nb.parent = prev if prev is not None else src.parent
            nb.use_connect = False
            nb.head += La * op
            nb.tail += La * op
            src.head += La * om
            src.tail += La * om
            nb.use_deform = True
            prev = nb
        arm[("harmonious_finger_axis_%s" % side)] = tuple(L)
        done += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    if hasattr(arm.data, "collections") and arm.data.collections.get("Body") is not None:
        for side, L, moves in plans:
            for n, *_ in moves:
                b = arm.data.bones.get(n.replace("_03_", "_03b_"))
                if b is not None:
                    arm.data.collections["Body"].assign(b)
                    set_hidden(arm, b, True)
    context.view_layer.objects.active = prev_active or arm
    return done


def hinge_axes(arm):
    """World hinge axis for each bone that bends one way only: fingers (across the hand), elbows and knees."""
    import mathutils
    W = arm.matrix_world
    b = arm.data.bones
    out = {}
    try:
        fwd, left, up = body_frame(arm)
    except Exception:
        return out
    for side in ("l", "r"):
        L = arm.get("harmonious_finger_axis_%s" % side)
        L = mathutils.Vector(L) if L else finger_axis(arm, [o for o in arm.children if o.type == "MESH"], side)
        if L is not None:
            for chain in ("03", "03b"):
                for k in SEGMENTS:
                    n = "%s_hand_%s_%s" % (side, chain, k)
                    if n in b:
                        out[n] = L
        for joint, end in (("%s_arm_Elbow" % side, "%s_arm_Wrist" % side), ("%s_leg_Knee" % side, "%s_leg_Ankle" % side)):
            if joint in b and end in b:
                d = (W @ b[end].head_local) - (W @ b[joint].head_local)
                a = d.cross(fwd)
                if a.length > 1e-6:
                    out[joint] = a.normalized()
    return out


# Every other joint turns as far as a real one does (owner 2026-11-12: with elbows and knees locked to one axis the
# limbs were too stiff): a Limit Rotation constraint per bone, in the bone's own space. The traveller's bones lie
# along their local X, so X is the twist; the bend ("flex") axis is the one nearest the line across the body (or across
# the hand for the wrist), the last one is side to side. Degrees: (flex, side, twist); a flex range is turned round
# when the bone bends the other way, so it always bends forwards (back for knees). None leaves an axis free.
NATURAL = "Harmonious natural"
JOINT_LIMITS = (
    (r"spine_0[12]|spine_Top", (-15, 30), (-15, 15), (-20, 20), "fwd"),
    (r"neck_01_0[12]", (-30, 40), (-25, 25), (-45, 45), "fwd"),
    (r"head_Top", (-15, 15), (-10, 10), (-15, 15), None),
    (r"[lr]_arm_Clavicle", (-20, 20), (-25, 25), (-10, 10), None),
    (r"[lr]_arm_Shoulder", None, None, (-90, 90), None),
    (r"[lr]_arm_Elbow", (0, 150), (-5, 5), (-85, 85), "fwd"),
    (r"[lr]_arm_Wrist", (-75, 75), (-30, 30), (-15, 15), None),
    (r"[lr]_leg_Hip", (-30, 120), (-45, 45), (-45, 45), "fwd"),
    (r"[lr]_leg_Knee", (0, 150), (-5, 5), (-25, 25), "back"),
    (r"[lr]_leg_Ankle", (-45, 45), (-30, 30), (-20, 20), None),
    (r"[lr]_leg_Ball", (-40, 40), (-5, 5), (-5, 5), None),
    (r"[lr]_hand_05_0[123]", (-60, 60), (-30, 30), (-20, 20), None),
)


def joint_limits(arm):
    """{bone: ((lo, hi) per local axis X, Y, Z in radians or None)} for the joints in JOINT_LIMITS."""
    import math
    import re
    import mathutils
    try:
        fwd, left, up = body_frame(arm)
    except Exception:
        return {}
    W3 = arm.matrix_world.to_3x3()
    out = {}
    for b in arm.data.bones:
        name = b.name.rsplit(":", 1)[-1]
        spec = next((j for j in JOINT_LIMITS if re.fullmatch(j[0], name)), None)
        if spec is None:
            continue
        _, flex, side, twist, toward = spec
        R = W3 @ b.matrix_local.to_3x3()
        axes = [R.col[i].normalized() for i in range(3)]
        along = axes[0]
        if name.endswith("Wrist"):
            L = arm.get("harmonious_finger_axis_%s" % name[0])
            across = mathutils.Vector(L) if L else left
        else:
            across = along.cross(fwd)
            if across.length < 0.3:   # a bone along the forward line (the foot): its bend is across the body
                across = left.copy()
        across.normalize()
        fi = max((1, 2), key=lambda i: abs(axes[i].dot(across)))
        si = 3 - fi
        if flex is not None and toward is not None:
            # the limb's line, from this joint to the next one (on the right side the bones' X points back up the
            # limb, and a Blender bone's tail lies along its Y, not the limb)
            kid = next((c for c in b.children if (c.head_local - b.head_local).length > 1e-4), None)
            line = ((arm.matrix_world @ kid.head_local) - (arm.matrix_world @ b.head_local)) if kid else along
            want = fwd if toward == "fwd" else -fwd
            turned = mathutils.Matrix.Rotation(0.5, 3, axes[fi]) @ line
            if (turned - line).dot(want) < 0:
                flex = (-flex[1], -flex[0])
        lim = [None, None, None]
        for i, r in ((0, twist), (fi, flex), (si, side)):
            if r is not None:
                lim[i] = (math.radians(r[0]), math.radians(r[1]))
        out[b.name] = lim
    return out


def natural_mute(arm, mute):
    """Poses are worked out with the limits off; apply_natural puts them back."""
    for pb in arm.pose.bones:
        c = pb.constraints.get(NATURAL)
        if c is not None:
            c.mute = mute


def apply_natural(arm):
    """Natural joints on: fingers bend round one axis only (Euler, the other two locked), every other joint turns
    within a person's range (JOINT_LIMITS). Off: free again."""
    on = bool(getattr(arm, "harmonious_natural", True))
    W3i = arm.matrix_world.inverted().to_3x3()
    hinges = {n: a for n, a in hinge_axes(arm).items() if "_hand_03" in n} if on else {}
    limits = joint_limits(arm) if on else {}
    for pb in arm.pose.bones:
        c = pb.constraints.get(NATURAL)
        lim = limits.get(pb.name)
        if lim is None:
            if c is not None:
                pb.constraints.remove(c)
        else:
            if c is None:
                c = pb.constraints.new("LIMIT_ROTATION")
                c.name = NATURAL
            c.owner_space = "LOCAL"
            c.mute = False
            if hasattr(c, "euler_order"):
                c.euler_order = "XYZ"
            if hasattr(c, "use_legacy_behavior"):
                c.use_legacy_behavior = False
            c.use_transform_limit = True
            for k, r in zip("xyz", lim):
                setattr(c, "use_limit_" + k, r is not None)
                if r is not None:
                    setattr(c, "min_" + k, r[0])
                    setattr(c, "max_" + k, r[1])
            if pb.rotation_mode != "XYZ":
                pb.rotation_mode = "XYZ"   # converts the rotation; R then stops at the limits too
        a = hinges.get(pb.name)
        if a is None:
            if "harmonious_hinge" in pb:
                pb.lock_rotation = (False, False, False)
                del pb["harmonious_hinge"]
            if lim is None and pb.rotation_mode != "QUATERNION" and (not on or "harmonious_limited" in pb):
                pb.rotation_mode = "QUATERNION"
            if lim is None and "harmonious_limited" in pb:
                del pb["harmonious_limited"]
            elif lim is not None:
                pb["harmonious_limited"] = 1
            continue
        local = pb.bone.matrix_local.to_3x3().transposed() @ (W3i @ a)
        local.normalize()
        idx = max(range(3), key=lambda i: abs(local[i]))
        if abs(local[idx]) < 0.7:
            continue
        if pb.rotation_mode != "XYZ":
            pb.rotation_mode = "XYZ"
        pb.lock_rotation = tuple(i != idx for i in range(3))
        pb["harmonious_hinge"] = idx


def natural_changed(self, context):
    if self.type == "ARMATURE":
        apply_natural(self)


def curl_sign(arm, pb):
    """Which way round the hinge curls the finger in (towards the thumb's side of the hand)."""
    import mathutils
    idx = pb.get("harmonious_hinge")
    if idx is None:
        return 0
    W = arm.matrix_world
    side = pb.name[0]
    thumb = arm.data.bones.get("%s_hand_05_02" % side) or arm.data.bones.get("%s_hand_05_01" % side)
    if thumb is None:
        return 1
    P = W @ thumb.head_local
    rest = W @ pb.bone.matrix_local
    axis = rest.to_3x3().col[idx].normalized()
    head, tail = W @ pb.bone.head_local, W @ pb.bone.tail_local
    best = []
    for s in (1, -1):
        R = mathutils.Matrix.Rotation(0.6 * s, 3, axis)
        best.append(((head + R @ (tail - head)) - P).length)
    return 1 if best[0] <= best[1] else -1


CURL = {"01": 70, "02": 85, "03": 60}   # degrees for a closed fist


def set_curl(arm, side, amount):
    """Curl both fingers of one hand: 0 open, 1 a fist."""
    import math
    n = 0
    for chain in ("03", "03b"):
        for k in SEGMENTS:
            pb = arm.pose.bones.get("%s_hand_%s_%s" % (side, chain, k))
            if pb is None or "harmonious_hinge" not in pb:
                continue
            e = list(pb.rotation_euler)
            e[pb["harmonious_hinge"]] = curl_sign(arm, pb) * math.radians(CURL[k]) * amount
            pb.rotation_euler = e
            n += 1
    return n


def curl_changed(side):
    def update(self, context):
        arm = find_traveller()
        if arm is not None:
            if not any("harmonious_hinge" in pb for pb in arm.pose.bones):
                apply_natural(arm)
            set_curl(arm, side, getattr(self, "harmonious_curl_" + side))
    return update


def follow_fingers(arm, keep=()):
    """The second finger takes the first one's pose (ready-made and older saved poses only know the game's joints)."""
    for pb in arm.pose.bones:
        if "_hand_03b_" in pb.name and pb.name not in keep:
            src = arm.pose.bones.get(pb.name.replace("_03b_", "_03_"))
            if src is not None:
                pb.matrix_basis = src.matrix_basis.copy()


def keep_shape_changed(self, context):
    if self.type == "ARMATURE":
        apply_keep_shape(self)


def body_bones(arm):
    coll = arm.data.collections.get("Body") if hasattr(arm.data, "collections") else None
    return [b for b in arm.data.bones if coll is None or coll in b.collections.values()] if coll else list(arm.data.bones)


def traveller_meshes(arm):
    return [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == arm]


def bone_at(arm, obj, face, location):
    """The bone that moves the part of the body under a click: the face's vertices, nearest ones counting most,
    voting with their weights."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        if face < 0 or face >= len(me.polygons):
            return None
        local = obj.matrix_world.inverted() @ location
        verts = list(me.polygons[face].vertices)
        names = {g.index: g.name for g in obj.vertex_groups}
        bones = {b.name for b in body_bones(arm)}
        votes = {}
        for v in verts:
            near = 1.0 / (0.002 + (me.vertices[v].co - local).length)
            for g in obj.data.vertices[v].groups:
                n = names.get(g.group)
                if n in bones and g.weight > 0.001:
                    votes[n] = votes.get(n, 0.0) + g.weight * near
        return max(votes, key=votes.get) if votes else None
    finally:
        ev.to_mesh_clear()


# Joints the game skins a part to but that sit at the part's far end: the head's joint is at the top of the head, so
# turning it swings the head round its crown (owner, 2026-11-10). Clicking such a part picks the joint it hangs from.
PIVOT_FROM_PARENT = ("head_Top",)


def pivot_bone(arm, name):
    b = arm.data.bones.get(name) if name else None
    if b is not None and b.parent is not None and any(name == n or name.endswith("_" + n) for n in PIVOT_FROM_PARENT):
        return b.parent.name
    return name


def show_bone(arm, name, extend=False):
    """Show and select one bone (keeping the others shown with extend); None hides every stick."""
    name = pivot_bone(arm, name)
    body = {x.name for x in body_bones(arm)}
    for b in arm.data.bones:
        keep = extend and not is_hidden(arm, b) and is_selected(arm, b)
        if b.name == name:
            set_hidden(arm, b, False)
            set_selected(arm, b, True)
        elif not keep:
            set_selected(arm, b, False)
            if b.name in body:
                set_hidden(arm, b, True)
    if name:
        arm.data.bones.active = arm.data.bones[name]


class HARMONIOUS_OT_traveller(bpy.types.Operator):
    bl_idname = "harmonious.import_traveller"
    bl_label = "Import my traveller"
    bl_description = "Bring in the traveller from the save open in Harmonious Save Editor, with its skeleton, ready to pose"

    def execute(self, context):
        addr = editor_address()
        if addr is None:
            self.report({"ERROR"}, "Harmonious Save Editor isn't running")
            return {"CANCELLED"}
        url, token = addr
        try:
            req = urllib.request.Request(url.replace("/api/live/build", "/api/live/traveller"), headers={"X-Live-Token": token})
            with urllib.request.urlopen(req, timeout=120) as res:
                data, name = res.read(), res.headers.get("X-Traveller") or "Traveller"
        except urllib.error.HTTPError as error:
            self.report({"ERROR"}, error.read().decode("utf-8", "replace").strip() or str(error))
            return {"CANCELLED"}
        except (urllib.error.URLError, OSError) as error:
            self.report({"ERROR"}, "Couldn't reach Harmonious Save Editor: %s" % error)
            return {"CANCELLED"}
        path = os.path.join(tempfile.gettempdir(), "harmonious_livelink", name + ".glb")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        before = set(bpy.data.objects)
        arm = None
        try:   # bones that point at their children pose most naturally in Blender
            bpy.ops.import_scene.gltf(filepath=path, bone_heuristic="BLENDER")
        except TypeError:
            bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        for o in new:
            if o.type == "ARMATURE":
                o["harmonious_traveller"] = name
                o.show_in_front = True
                tidy_skeleton(o, [m for m in new if m.type == "MESH" and m.parent == o])
                try:
                    split_fingers(context, o, [m for m in new if m.type == "MESH" and m.parent == o])
                except Exception as error:   # the fingers stay together; nothing else is lost
                    print("LiveLink: couldn't split the fingers:", error)
                apply_keep_shape(o)
                apply_natural(o)
                context.view_layer.objects.active = o
                arm = o
        # the importer draws each bone as a sphere (an Icosphere in a glTF_not_exported collection); plain bones instead
        for o in new:
            if o.type == "MESH" and o.name.startswith("Icosphere") and not o.users_collection[0].name.startswith(name):
                coll = o.users_collection[0]
                bpy.data.objects.remove(o)
                if coll.name.startswith("glTF_not_exported") and not coll.objects:
                    bpy.data.collections.remove(coll)
        if arm is not None:   # straight into Pose mode: click a bone and press R to turn it
            try:
                if context.mode != "OBJECT":
                    bpy.ops.object.mode_set(mode="OBJECT")
                for o in context.view_layer.objects:
                    o.select_set(False)
                arm.select_set(True)
                bpy.ops.object.mode_set(mode="POSE")
                context.scene.tool_settings.transform_pivot_point = "INDIVIDUAL_ORIGINS"
            except RuntimeError:
                pass
        set_status("%s is in the scene, in Pose mode: click a part of the body to show its bone, then press R to turn it. Ctrl+Tab goes back to Object mode." % name)
        return {"FINISHED"}


def frame_camera(scene, mesh):
    """A camera looking at the traveller from the front, a little to the side, when the scene has none."""
    import mathutils
    pts = [mesh.matrix_world @ mathutils.Vector(c) for c in mesh.bound_box]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    centre, height = (lo + hi) / 2, max(hi.z - lo.z, 0.5)
    cam = bpy.data.objects.new("Traveller camera", bpy.data.cameras.new("Traveller camera"))
    scene.collection.objects.link(cam)
    cam.data.lens = 70
    cam.location = centre + mathutils.Vector((height * 0.75, -height * 2.6, height * 0.12))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    if not any(o.type == "LIGHT" for o in scene.objects):
        sun = bpy.data.objects.new("Traveller light", bpy.data.lights.new("Traveller light", "SUN"))
        sun.data.energy = 3.0
        sun.rotation_euler = (0.9, 0.2, 0.6)
        scene.collection.objects.link(sun)


class HARMONIOUS_OT_pick_part(bpy.types.Operator):
    """Click on the traveller in Pose mode: the stick that moves that part appears, selected, ready to turn (R)."""
    bl_idname = "harmonious.pick_part"
    bl_label = "Pick a part to pose"
    bl_options = {"REGISTER", "UNDO"}
    extend: bpy.props.BoolProperty(name="Add to the selection", default=False)

    @classmethod
    def poll(cls, context):
        o = context.active_object
        return o is not None and o.type == "ARMATURE" and context.mode == "POSE" and bool(o.get("harmonious_traveller"))

    def invoke(self, context, event):
        from bpy_extras import view3d_utils
        arm, region, rv3d = context.active_object, context.region, context.region_data
        if region is None or rv3d is None:
            return {"PASS_THROUGH"}
        mouse = (event.mouse_region_x, event.mouse_region_y)
        # a stick already showing is picked as usual
        for b in arm.data.bones:
            if is_hidden(arm, b):
                continue
            a = view3d_utils.location_3d_to_region_2d(region, rv3d, arm.matrix_world @ b.head_local)
            c = view3d_utils.location_3d_to_region_2d(region, rv3d, arm.matrix_world @ b.tail_local)
            if a is None or c is None:
                continue
            pb = arm.pose.bones[b.name]
            a = view3d_utils.location_3d_to_region_2d(region, rv3d, arm.matrix_world @ pb.head) or a
            c = view3d_utils.location_3d_to_region_2d(region, rv3d, arm.matrix_world @ pb.tail) or c
            seg = c - a
            t = 0.0 if seg.length_squared == 0 else max(0.0, min(1.0, (mouse[0] - a.x) * seg.x / seg.length_squared + (mouse[1] - a.y) * seg.y / seg.length_squared))
            if ((a + seg * t).x - mouse[0]) ** 2 + ((a + seg * t).y - mouse[1]) ** 2 < 64:
                return {"PASS_THROUGH"}
        origin = view3d_utils.region_2d_to_origin_3d(region, rv3d, mouse)
        direction = view3d_utils.region_2d_to_vector_3d(region, rv3d, mouse)
        name = pick_ray(context, arm, origin, direction)
        if name is None:
            if not self.extend:
                show_bone(arm, None)
            return {"PASS_THROUGH"}
        show_bone(arm, name, self.extend)
        return {"FINISHED"}


def pick_ray(context, arm, origin, direction):
    """The bone for the traveller's body where a ray first hits it, or None."""
    meshes = traveller_meshes(arm)
    dg = context.evaluated_depsgraph_get()
    for _ in range(8):   # look through anything else in the way (a camera, a prop)
        hit, loc, _n, face, obj, _m = context.scene.ray_cast(dg, origin, direction)
        if not hit:
            return None
        obj = obj.original if obj is not None else None
        if obj in meshes:
            return bone_at(arm, obj, face, loc)
        origin = loc + direction * 0.0005
    return None


# Body parts to pose (owner, 2026-11-11): each is the joint(s) it turns at and every stick that belongs to it, by the
# game's joint names. A part shows only when the traveller has it (its joints move part of the body).
BODY_PARTS = (
    ("head", "Head", ("neck_01_01",), r"neck_.*|head_.*"),
    ("torso", "Torso", ("spine_01",), r"spine_.*"),
    ("r_arm", "Right arm", ("r_arm_Clavicle",), r"r_arm_(Clavicle|Shoulder|Elbow)"),
    ("l_arm", "Left arm", ("l_arm_Clavicle",), r"l_arm_(Clavicle|Shoulder|Elbow)"),
    ("r_hand", "Right hand", ("r_arm_Wrist",), r"r_arm_Wrist|r_hand_.*"),
    ("l_hand", "Left hand", ("l_arm_Wrist",), r"l_arm_Wrist|l_hand_.*"),
    ("r_finger1", "Right first finger", ("r_hand_03_01",), r"r_hand_03_\d+"),
    ("l_finger1", "Left first finger", ("l_hand_03_01",), r"l_hand_03_\d+"),
    ("r_finger2", "Right second finger", ("r_hand_03b_01",), r"r_hand_03b_\d+"),
    ("l_finger2", "Left second finger", ("l_hand_03b_01",), r"l_hand_03b_\d+"),
    ("r_thumb", "Right thumb", ("r_hand_05_01",), r"r_hand_05_\d+"),
    ("l_thumb", "Left thumb", ("l_hand_05_01",), r"l_hand_05_\d+"),
    ("r_leg", "Right leg", ("r_leg_Hip",), r"r_leg_.*"),
    ("l_leg", "Left leg", ("l_leg_Hip",), r"l_leg_.*"),
    ("backpack", "Backpack", ("backpack_root_Aux",), r"backpack_root_Aux|RetroWing.*"),
    ("drone", "Backpack's camera arm", ("cam_arm1_Aux",), r"cam_arm\d_Aux"),
    ("collar", "Collar", ("Fourth_NeckJNT",), r"Fourth_.*"),
    ("front", "Chest piece and cape front", ("Bp_CF_0_jnt", "Bp_LF_0_jnt", "Bp_RF_0_jnt"), r"Bp_[CLR]F_\d_jnt"),
    ("back", "Cape back", ("Bp_CB_0_jnt", "Bp_LB_0_jnt", "Bp_RB_0_jnt"), r"Bp_[CLR]B_\d_jnt"),
    ("whole", "Whole traveller", ("ROOT",), r"ROOT"),
)


def part_bones(arm, part):
    """(the joints a part turns at, every stick of it) on this traveller; empty when it doesn't have the part."""
    import re
    _, _, roots, pattern = part
    body = {b.name: b for b in body_bones(arm)}
    tail = lambda n: n.rsplit(":", 1)[-1]
    have = [b for n, b in body.items() if tail(n) in roots]
    if part[0] == "whole":
        have = [arm.data.bones[n] for n in body if tail(n) == "ROOT"] or [b for b in arm.data.bones if b.parent is None]
        return have, have
    return have, [b for n, b in body.items() if re.fullmatch(pattern, tail(n))]


def part_on(arm, part):
    roots, _ = part_bones(arm, part)
    return bool(roots) and all(is_selected(arm, b) and not is_hidden(arm, b) for b in roots)


class HARMONIOUS_OT_body_part(bpy.types.Operator):
    bl_idname = "harmonious.body_part"
    bl_label = "Body part"
    bl_description = "Select this part to turn it (R). Pick as many parts as you like; click again to let go of it"
    bl_options = {"REGISTER", "UNDO"}
    part: bpy.props.StringProperty()

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        arm = find_traveller()
        part = next((p for p in BODY_PARTS if p[0] == self.part), None)
        if part is None:
            return {"CANCELLED"}
        if context.mode != "POSE":
            if context.mode != "OBJECT":
                bpy.ops.object.mode_set(mode="OBJECT")
            for o in context.selected_objects:
                o.select_set(False)
            arm.select_set(True)
            context.view_layer.objects.active = arm
            bpy.ops.object.mode_set(mode="POSE")
        roots, sticks = part_bones(arm, part)
        if part_on(arm, part):
            keep = set()
            for other in BODY_PARTS:
                if other is not part and part_on(arm, other):
                    keep.update(b.name for b in part_bones(arm, other)[1])
            for b in roots:
                set_selected(arm, b, False)
            for b in sticks:
                if b.name not in keep and not is_selected(arm, b):
                    set_hidden(arm, b, True)
        else:
            for b in sticks:
                set_hidden(arm, b, False)
            for b in roots:
                set_selected(arm, b, True)
            if roots:
                arm.data.bones.active = roots[0]
            # each part turns round its own joint, also when several are picked
            context.scene.tool_settings.transform_pivot_point = "INDIVIDUAL_ORIGINS"
        redraw()
        return {"FINISHED"}


class HARMONIOUS_OT_body_parts_clear(bpy.types.Operator):
    bl_idname = "harmonious.body_parts_clear"
    bl_label = "Let go of all"
    bl_description = "Deselect every part and hide the sticks"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        show_bone(find_traveller(), None)
        redraw()
        return {"FINISHED"}


class HARMONIOUS_OT_show_bones(bpy.types.Operator):
    bl_idname = "harmonious.show_bones"
    bl_label = "Show every stick"
    bl_description = "Show all the bones of the traveller, or hide them again so only the part you click shows"

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        arm = find_traveller()
        bones = body_bones(arm)
        hide = not any(is_hidden(arm, b) for b in bones)
        for b in bones:
            if not (hide and is_selected(arm, b)):
                set_hidden(arm, b, hide)
        return {"FINISHED"}


# ---------------------------------------------------------------- poses (owner, 2026-11-10: "select sitting pose 1
# and the character sits"). A ready-made pose says where each limb points, in the traveller's own frame (forward,
# outward from the body's middle on that side, up), so one pose fits every traveller and both sides mirror. Each
# bone is turned, parents first, so the line to its next joint points that way; then the body is lowered so the
# joints that touch the ground do. Saved poses are the bones' own turns, in small JSON files anyone can share.

# the joint each bone points at (X is l or r)
POSE_AIM = {
    "spine_01": "spine_02", "spine_02": "spine_Top", "spine_Top": "neck_01_01", "neck_01_01": "neck_01_02", "neck_01_02": "head_Top",
    "X_arm_Clavicle": "X_arm_Shoulder", "X_arm_Shoulder": "X_arm_Elbow", "X_arm_Elbow": "X_arm_Wrist", "X_arm_Wrist": "X_hand_03_01",
    "X_leg_Hip": "X_leg_Knee", "X_leg_Knee": "X_leg_Ankle", "X_leg_Ankle": "X_leg_Ball",
}
POSE_ORDER = ["spine_01", "spine_02", "spine_Top", "neck_01_01", "neck_01_02", "X_arm_Clavicle", "X_arm_Shoulder", "X_arm_Elbow",
              "X_arm_Wrist", "X_leg_Hip", "X_leg_Knee", "X_leg_Ankle"]
FEET = ("l_leg_Ball", "r_leg_Ball", "l_leg_Toe", "r_leg_Toe", "l_leg_Ankle", "r_leg_Ankle")

# name: (description, {bone: (forward, outward, up)}, ground contacts {joint: height above the floor} or None)
# "X_" applies to both sides, "l_"/"r_" to one; directions needn't be unit length.
POSES = [
    ("Standing", "Relaxed, arms by the sides", {
        "X_arm_Shoulder": (0.05, 0.18, -1), "X_arm_Elbow": (0.2, 0.06, -1), "X_arm_Wrist": (0.1, 0, -1),
        "X_leg_Hip": (0, 0.06, -1), "X_leg_Knee": (-0.02, 0.02, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
    ("Hands on hips", "Legs apart, elbows out", {
        "spine_01": (-0.03, 0, 1), "X_arm_Shoulder": (-0.25, 1, -1.1), "X_arm_Elbow": (0.45, -1, -0.55), "X_arm_Wrist": (0.4, -1, -0.4),
        "X_leg_Hip": (0, 0.3, -1), "X_leg_Knee": (0, 0.05, -1), "X_leg_Ankle": (1, 0.1, -0.6)}, "feet"),
    ("Waving", "Right hand up in a wave", {
        "X_arm_Shoulder": (0.05, 0.18, -1), "X_arm_Elbow": (0.2, 0.06, -1),
        "r_arm_Shoulder": (0.15, 1, 0.25), "r_arm_Elbow": (0.15, 0.25, 1), "r_arm_Wrist": (0, 0.35, 1),
        "X_leg_Hip": (0, 0.08, -1), "X_leg_Knee": (0, 0.02, -1), "X_leg_Ankle": (1, 0, -0.6), "neck_01_02": (0.1, 0.15, 1)}, "feet"),
    ("Pointing", "Right arm pointing ahead", {
        "spine_02": (0.05, 0, 1), "X_arm_Shoulder": (0.05, 0.18, -1), "X_arm_Elbow": (0.2, 0.06, -1),
        "r_arm_Shoulder": (1, 0.25, 0.2), "r_arm_Elbow": (1, 0.1, 0.18), "r_arm_Wrist": (1, 0, 0.1),
        "l_leg_Hip": (0.25, 0.08, -1), "r_leg_Hip": (-0.15, 0.08, -1), "X_leg_Knee": (0, 0.02, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
    ("Salute", "Right hand to the brow", {
        "X_arm_Shoulder": (0.05, 0.18, -1), "X_arm_Elbow": (0.2, 0.06, -1),
        "r_arm_Shoulder": (0.45, 1, 0.1), "r_arm_Elbow": (0.35, -0.75, 0.9), "r_arm_Wrist": (0.2, -1, 0.4),
        "X_leg_Hip": (0, 0.04, -1), "X_leg_Knee": (0, 0, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
    ("Arms raised", "Both arms up, celebrating", {
        "spine_02": (-0.08, 0, 1), "neck_01_02": (-0.25, 0, 1),
        "X_arm_Shoulder": (0.1, 0.55, 1), "X_arm_Elbow": (0.05, 0.25, 1), "X_arm_Wrist": (0, 0.1, 1),
        "X_leg_Hip": (0, 0.15, -1), "X_leg_Knee": (0, 0.05, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
    ("Thinking", "Hand to the chin", {
        "X_arm_Shoulder": (0.25, 0.12, -1), "X_arm_Elbow": (0.6, -1, 0.05), "X_arm_Wrist": (0.3, -1, 0),
        "r_arm_Shoulder": (0.5, 0.12, -1), "r_arm_Elbow": (0.4, -0.45, 1), "r_arm_Wrist": (0.4, -0.3, 1),
        "neck_01_02": (0.25, 0.1, 1), "X_leg_Hip": (0, 0.06, -1), "X_leg_Knee": (0, 0.02, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
    ("Sitting on a seat", "Knees bent, hands on the knees (add a seat)", {
        "spine_01": (0.05, 0, 1), "X_arm_Shoulder": (0.45, 0.2, -1), "X_arm_Elbow": (1, 0.05, -0.45), "X_arm_Wrist": (1, 0, -0.5),
        "X_leg_Hip": (1, 0.12, 0), "X_leg_Knee": (0.05, 0, -1), "X_leg_Ankle": (1, 0, -0.5)}, "feet"),
    ("Sitting on the ground", "Knees up, arms resting on them", {
        "spine_01": (0.2, 0, 1), "spine_02": (0.15, 0, 1), "neck_01_02": (0.05, 0, 1),
        "X_arm_Shoulder": (0.45, 0.35, -1), "X_arm_Elbow": (1, 0.05, 0.05), "X_arm_Wrist": (1, -0.2, -0.3),
        "X_leg_Hip": (1, 0.35, 0.65), "X_leg_Knee": (0.6, 0, -1), "X_leg_Ankle": (1, 0, -0.4)}, {"l_leg_Hip": 0.12, "r_leg_Hip": 0.12}),
    ("Kneeling", "On one knee", {
        "spine_01": (0.08, 0, 1), "X_arm_Shoulder": (0.05, 0.18, -1), "X_arm_Elbow": (0.2, 0.06, -1),
        "l_arm_Shoulder": (0.55, 0.15, -1), "l_arm_Elbow": (1, -0.15, -0.1),
        "l_leg_Hip": (1, 0.12, -0.05), "l_leg_Knee": (0.05, 0, -1), "l_leg_Ankle": (1, 0, -0.5),
        "r_leg_Hip": (0.15, 0.08, -1), "r_leg_Knee": (-1, 0, -0.08), "r_leg_Ankle": (-0.35, 0, -1)}, {"r_leg_Knee": 0.06, "l_leg_Ball": 0.026}),
    ("T-pose", "Arms straight out to the sides", {
        "X_arm_Shoulder": (0, 1, 0), "X_arm_Elbow": (0, 1, 0), "X_arm_Wrist": (0, 1, 0),
        "X_leg_Hip": (0, 0.05, -1), "X_leg_Knee": (0, 0, -1), "X_leg_Ankle": (1, 0, -0.6)}, "feet"),
]


def poses_dir():
    exp = LINK.get("exports")
    base = os.path.dirname(exp) if exp else os.path.join(os.path.expanduser("~"), "Documents", "Harmonious Save Editor")
    return os.path.join(base, "Poses")


def saved_poses():
    d = poses_dir()
    try:
        return sorted(f[:-5] for f in os.listdir(d) if f.lower().endswith(".json"))
    except OSError:
        return []


_POSE_ITEMS = []


def pose_items(self, context):
    """Ready-made poses, then the ones saved in the Poses folder (Blender needs the list kept alive)."""
    global _POSE_ITEMS
    items = [("ready:" + n, n, d) for n, d, _t, _c in POSES]
    for n in saved_poses():
        items.append(("saved:" + n, n + " (saved)", "Your saved pose " + n))
    _POSE_ITEMS = items
    return items


def body_frame(arm):
    """The traveller's forward, left and up directions in world space, from the rest skeleton."""
    import mathutils
    W = arm.matrix_world
    b = arm.data.bones
    left = (W @ b["l_leg_Hip"].head_local) - (W @ b["r_leg_Hip"].head_local)
    up = mathutils.Vector((0, 0, 1))
    left = (left - up * left.dot(up)).normalized()
    fwd = up.cross(left).normalized()   # left-handed check below
    toe = (W @ b["l_leg_Toe"].head_local) - (W @ b["l_leg_Ankle"].head_local)
    if toe.dot(fwd) < 0:
        fwd = -fwd
    return fwd, left, up


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def apply_ready_pose(arm, name):
    import mathutils
    spec = next((p for p in POSES if p[0] == name), None)
    if spec is None:
        return False
    _n, _d, aims, contacts = spec
    clear_pose(arm)
    fwd, left, up = body_frame(arm)
    W, Wi = arm.matrix_world, arm.matrix_world.inverted()
    bones = arm.pose.bones

    def target(bone):
        side = bone[0] if bone[:2] in ("l_", "r_") else ""
        generic = "X_" + bone[2:] if side else bone
        t = aims.get(bone) or aims.get(generic)
        if t is None:
            return None
        out = left if side != "r" else -left
        return (fwd * t[0] + out * t[1] + up * t[2]).normalized()

    for key in POSE_ORDER:
        for bone in ([key.replace("X_", s + "_", 1) for s in ("l", "r")] if key.startswith("X_") else [key]):
            pb, aim = bones.get(bone), POSE_AIM.get(key, "").replace("X_", bone[:2], 1)
            t = target(bone)
            if pb is None or t is None or bones.get(aim) is None:
                continue
            m = W @ pb.matrix
            head = m.to_translation()
            v = (W @ bones[aim].head) - head
            if v.length < 1e-6:
                continue
            rot = v.normalized().rotation_difference(t).to_matrix().to_4x4()
            new = mathutils.Matrix.Translation(head) @ rot @ mathutils.Matrix.Translation(-head) @ m
            pb.matrix = Wi @ new
            bpy.context.view_layer.update()
    if contacts:
        touch_down(arm, contacts)
    for pb in bones:   # bones only turn (the body keeps its proportions)
        if not free_bone(pb):
            pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    return True


def touch_down(arm, contacts):
    """Lower (or raise) the whole traveller so the pose's ground contacts touch the floor."""
    import mathutils
    W, Wi, bones = arm.matrix_world, arm.matrix_world.inverted(), arm.pose.bones
    rest = {n: (W @ arm.data.bones[n].head_local).z for n in FEET if arm.data.bones.get(n)}
    want = {n: rest[n] for n in rest} if contacts == "feet" else contacts
    drop = min(((W @ bones[n].head).z - h for n, h in want.items() if bones.get(n) is not None), default=0)
    root = bones.get("ROOT")
    if root is not None and abs(drop) > 1e-4:
        m = W @ root.matrix
        root.matrix = Wi @ (mathutils.Matrix.Translation((0, 0, -drop)) @ m)
        bpy.context.view_layer.update()


def pose_data(arm):
    out = {"harmonious_pose": 1, "bones": {}}
    for pb in arm.pose.bones:
        q = pb.matrix_basis.to_quaternion()
        if abs(q.w - 1) > 1e-6 or (free_bone(pb) and pb.location.length > 1e-6):
            e = {"rotation": [round(x, 6) for x in q]}
            if free_bone(pb):
                e["location"] = [round(x, 6) for x in pb.location]
            out["bones"][pb.name] = e
    return out


def apply_pose_data(arm, data):
    clear_pose(arm)
    n = 0
    for name, e in (data.get("bones") or {}).items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = e.get("rotation", (1, 0, 0, 0))
        if "location" in e and free_bone(pb):
            pb.location = e["location"]
        n += 1
    bpy.context.view_layer.update()
    return n


def pose_traveller(context, key):
    """Puts the pose on with the joint limits off, then turns them on again (also when the pose can't be read)."""
    arm = find_traveller()
    try:
        return _pose_traveller(context, key)
    finally:
        if arm is not None:
            apply_natural(arm)
            bpy.context.view_layer.update()
            # the limits can move a leg a little: the feet touch the floor again
            spec = next((p for p in POSES if "ready:" + p[0] == key), None)
            if spec is not None and spec[3]:
                touch_down(arm, spec[3])


def _pose_traveller(context, key):
    arm = find_traveller()
    if arm is None:
        return "Import your traveller first"
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    natural_mute(arm, True)
    kind, _, name = key.partition(":")
    if kind == "ready":
        if not apply_ready_pose(arm, name):
            return "There's no pose called " + name
    else:
        try:
            with open(os.path.join(poses_dir(), name + ".json"), encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError) as error:
            return "Couldn't read the pose %s: %s" % (name, error)
        if not apply_pose_data(arm, data):
            return "The pose %s has no bones this traveller has" % name
        follow_fingers(arm, keep=set((data.get("bones") or {}).keys()))
        apply_natural(arm)
        return ""
    follow_fingers(arm)
    apply_natural(arm)
    return ""


class HARMONIOUS_OT_pose(bpy.types.Operator):
    bl_idname = "harmonious.pose"
    bl_label = "Pose"
    bl_description = "Put the traveller in the pose picked above (you can change any bone after)"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        key = context.scene.harmonious_pose
        err = pose_traveller(context, key)
        if err:
            self.report({"ERROR"}, err)
            return {"CANCELLED"}
        set_status("Posed: " + key.partition(":")[2])
        return {"FINISHED"}


class HARMONIOUS_OT_pose_reset(bpy.types.Operator):
    bl_idname = "harmonious.pose_reset"
    bl_label = "Start pose"
    bl_description = "Put every bone back where the traveller was imported"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        clear_pose(find_traveller())
        return {"FINISHED"}


class HARMONIOUS_OT_pose_save(bpy.types.Operator):
    bl_idname = "harmonious.pose_save"
    bl_label = "Save my pose"
    bl_description = "Keep this pose in the Poses folder to use again or share; it fits any traveller"
    name: bpy.props.StringProperty(name="Name", default="My pose")

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        name = "".join(c for c in self.name.strip() if c not in '<>:"/\\|?*').strip() or "My pose"
        d = poses_dir()
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(pose_data(find_traveller()), f, indent=1)
        context.scene.harmonious_pose = "saved:" + name
        set_status("Saved the pose to " + p)
        self.report({"INFO"}, "Saved " + p)
        return {"FINISHED"}


class HARMONIOUS_OT_poses_folder(bpy.types.Operator):
    bl_idname = "harmonious.poses_folder"
    bl_label = "Open the poses folder"
    bl_description = "Your saved poses; put pose files others share here to use them"

    def execute(self, context):
        d = poses_dir()
        os.makedirs(d, exist_ok=True)
        bpy.ops.wm.path_open(filepath=d)
        return {"FINISHED"}


def posed_glb(context, arm):
    """The traveller as posed now, as a .glb: the pose baked into the mesh, the textures packed in (JPEG), with the
    multi-tool in their hand if they hold one."""
    meshes = traveller_meshes(arm) + [o for o in held_tools(arm) if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("The traveller has no mesh")
    set_glow(arm, context.scene.harmonious_glow)   # glowing lenses and screens go along (as emissive)
    view = context.view_layer
    mode, active = context.mode, view.objects.active
    picked = [o for o in view.objects if o.select_get()]
    path = os.path.join(tempfile.gettempdir(), "harmonious_livelink", "pose.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        if mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for o in view.objects:
            o.select_set(False)
        for m in meshes:
            m.select_set(True)
        view.objects.active = meshes[0]
        opts = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_skins=False,
                    export_animations=False, export_yup=True, export_image_format="JPEG", export_jpeg_quality=88)
        try:
            bpy.ops.export_scene.gltf(**opts)
        except TypeError:   # an older exporter without some of these
            for k in ("export_jpeg_quality", "export_image_format", "export_animations"):
                opts.pop(k, None)
            bpy.ops.export_scene.gltf(**opts)
    finally:
        for o in view.objects:
            o.select_set(o in picked)
        view.objects.active = active
        if mode == "POSE" and active is not None and active.type == "ARMATURE":
            try:
                bpy.ops.object.mode_set(mode="POSE")
            except RuntimeError:
                pass
    with open(path, "rb") as f:
        return f.read()


# ---------------------------------------------------------------- a corvette in 3D (owner, 2026-11-12)
# The editor can't draw a corvette's hull from the game files, but this .blend has it: every visible mesh (Charon
# Forge's parts, instances made real for the export) goes to the editor as one .glb, which the Traveller page turns.
def build_glb(context):
    dg = context.evaluated_depsgraph_get()
    skip = set()
    arm = find_traveller()
    if arm is not None:
        skip.update(traveller_meshes(arm))
        skip.update(held_tools(arm))
    coll = bpy.data.collections.new("_harmonious_ship_export")
    context.scene.collection.children.link(coll)
    made = []
    try:
        for inst in dg.object_instances:
            ob = inst.object
            if ob.type != "MESH" or ob.original in skip:
                continue
            src = inst.instance_object if inst.is_instance else ob
            if src is not None and getattr(src.original, "hide_render", False):
                continue
            try:
                me = bpy.data.meshes.new_from_object(ob, preserve_all_data_layers=False, depsgraph=dg)
            except Exception:
                continue
            if not me.polygons:
                bpy.data.meshes.remove(me)
                continue
            o = bpy.data.objects.new("part", me)
            o.matrix_world = inst.matrix_world.copy()
            coll.objects.link(o)
            made.append(o)
        if not made:
            raise RuntimeError("There's nothing to send in this file")
        view = context.view_layer
        mode, active = context.mode, view.objects.active
        picked = [o for o in view.objects if o.select_get()]
        path = os.path.join(tempfile.gettempdir(), "harmonious_livelink", "ship.glb")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            if mode != "OBJECT":
                bpy.ops.object.mode_set(mode="OBJECT")
            for o in view.objects:
                o.select_set(False)
            for o in made:
                o.select_set(True)
            view.objects.active = made[0]
            opts = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                        export_animations=False, export_yup=True, export_image_format="JPEG", export_jpeg_quality=85)
            try:
                bpy.ops.export_scene.gltf(**opts)
            except TypeError:
                for k in ("export_jpeg_quality", "export_image_format", "export_animations"):
                    opts.pop(k, None)
                bpy.ops.export_scene.gltf(**opts)
        finally:
            for o in view.objects:
                o.select_set(o in picked)
            view.objects.active = active
        with open(path, "rb") as f:
            return f.read(), len(made)
    finally:
        for o in made:
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(coll)


class HARMONIOUS_OT_send_ship(bpy.types.Operator):
    bl_idname = "harmonious.send_ship"
    bl_label = "Send the corvette in 3D"
    bl_description = "Send this corvette's model to the editor's Traveller page, to turn and place on your picture"

    def execute(self, context):
        addr = editor_address()
        if addr is None:
            self.report({"ERROR"}, "Harmonious Save Editor isn't running")
            return {"CANCELLED"}
        scene = context.scene
        name = scene.harmonious_target_name if scene.harmonious_target_slot >= 0 else ""
        if not name:
            self.report({"ERROR"}, "Choose which corvette this file is (This file updates) first")
            return {"CANCELLED"}
        try:
            data, n = build_glb(context)
        except (RuntimeError, OSError) as error:
            self.report({"ERROR"}, "Couldn't export the corvette: %s" % error)
            return {"CANCELLED"}
        url, token = addr
        try:
            req = urllib.request.Request(url.replace("/api/live/build", "/api/live/ship") + "?name=" + urllib.parse.quote(name),
                                         data=data, method="POST", headers={"X-Live-Token": token, "Content-Type": "model/gltf-binary"})
            with urllib.request.urlopen(req, timeout=300) as res:
                json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            self.report({"ERROR"}, error.read().decode("utf-8", "replace").strip() or str(error))
            return {"CANCELLED"}
        except (urllib.error.URLError, OSError, ValueError) as error:
            self.report({"ERROR"}, "Couldn't reach Harmonious Save Editor: %s" % error)
            return {"CANCELLED"}
        set_status("%s sent in 3D (%d parts, %d MB): pick it on the Traveller page" % (name, n, max(1, len(data) // 1048576)))
        self.report({"INFO"}, "Sent %s in 3D" % name)
        return {"FINISHED"}


# ---------------------------------------------------------------- a multi-tool in the hand (owner, 2026-11-10)
# The editor sends the save's multi-tools; one comes in as a textured model and rides on the right hand's weapon
# socket (r_hand_socket_Aux), so it follows every pose.
HAND_SOCKETS = ("r_hand_socket_Aux", "r_arm_Wrist")
# the turn from the socket to the multi-tool's own axes (checked on the owner's traveller and multi-tools)


_TOOL_ITEMS = []


def tool_items(self, context):
    global _TOOL_ITEMS
    _TOOL_ITEMS = [(str(i), n or "Multi-tool %d" % (i + 1), "Put %s in your traveller's hand" % (n or "this multi-tool")) for i, n in enumerate(LINK.get("tools") or [])] or [("-1", "No multi-tools (open a save in the editor)", "")]
    return _TOOL_ITEMS


def held_tools(arm):
    return [o for o in bpy.data.objects if o.get("harmonious_tool") and o.parent == arm]


def hold_tool(context, arm, data, name):
    """Bring in a multi-tool .glb and put it in the traveller's right hand; replaces one held before."""
    import mathutils
    for o in held_tools(arm):
        bpy.data.objects.remove(o, do_unlink=True)
    path = os.path.join(tempfile.gettempdir(), "harmonious_livelink", "tool.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    before = set(bpy.data.objects)
    mode = context.mode
    if mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    socket = next((n for n in HAND_SOCKETS if arm.pose.bones.get(n)), None)
    if socket is None:
        raise RuntimeError("This traveller has no hand to hold it")
    pb = arm.pose.bones[socket]
    # the editor already placed the tool where the hand's socket is at rest; move it on with the hand's pose
    # the socket bone's frame: the arm runs along -X, the fingers curl towards +Y, the thumb is at +Z; the tool's
    # barrel comes in along +Z and its handle along -Y, so turn it barrel forward with the handle out of the fist
    grip = mathutils.Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    # the game puts a tool's grip at its origin, so the socket's place is where the hand holds it
    follow = arm.matrix_world @ pb.matrix @ grip @ pb.bone.matrix_local.inverted() @ arm.matrix_world.inverted()
    for o in new:
        if o.type != "MESH":
            continue
        rest = o.matrix_world.copy()
        o.parent = arm
        o.parent_type = "BONE"
        o.parent_bone = socket
        o["harmonious_tool"] = name
        o.matrix_world = follow @ rest
    for o in new:   # the importer's empty parents aren't needed
        if o.type != "MESH" and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    view = context.view_layer
    for o in view.objects:
        o.select_set(False)
    arm.select_set(True)
    view.objects.active = arm
    if mode == "POSE":
        bpy.ops.object.mode_set(mode="POSE")
    return len([o for o in held_tools(arm)])


class HARMONIOUS_OT_hold_tool(bpy.types.Operator):
    bl_idname = "harmonious.hold_tool"
    bl_label = "Hold it"
    bl_description = "Put the multi-tool picked above in your traveller's right hand; it follows every pose"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None and bool(LINK.get("tools"))

    def execute(self, context):
        addr = editor_address()
        if addr is None:
            self.report({"ERROR"}, "Harmonious Save Editor isn't running")
            return {"CANCELLED"}
        i = int(context.scene.harmonious_tool or -1)
        if i < 0:
            return {"CANCELLED"}
        url, token = addr
        try:
            req = urllib.request.Request(url.replace("/api/live/build", "/api/live/tool") + "?i=%d" % i, headers={"X-Live-Token": token})
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
        except urllib.error.HTTPError as error:
            self.report({"ERROR"}, error.read().decode("utf-8", "replace").strip() or str(error))
            return {"CANCELLED"}
        except (urllib.error.URLError, OSError) as error:
            self.report({"ERROR"}, "Couldn't reach Harmonious Save Editor: %s" % error)
            return {"CANCELLED"}
        name = (LINK.get("tools") or [""])[i] if i < len(LINK.get("tools") or []) else "Multi-tool"
        try:
            hold_tool(context, find_traveller(), data, name)
        except RuntimeError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        set_status("%s is in your traveller's hand" % name)
        return {"FINISHED"}


class HARMONIOUS_OT_drop_tool(bpy.types.Operator):
    bl_idname = "harmonious.drop_tool"
    bl_label = "Put it away"
    bl_description = "Take the multi-tool out of your traveller's hand"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        arm = find_traveller()
        return arm is not None and bool(held_tools(arm))

    def execute(self, context):
        for o in held_tools(find_traveller()):
            bpy.data.objects.remove(o, do_unlink=True)
        return {"FINISHED"}


class HARMONIOUS_OT_send_pose(bpy.types.Operator):
    bl_idname = "harmonious.send_pose"
    bl_label = "Send the pose to the editor"
    bl_description = "Send your posed traveller to Harmonious Save Editor in 3D, to turn and place on the Traveller page"

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        addr = editor_address()
        if addr is None:
            self.report({"ERROR"}, "Harmonious Save Editor isn't running")
            return {"CANCELLED"}
        arm = find_traveller()
        try:
            data = posed_glb(context, arm)
        except (RuntimeError, OSError) as error:
            self.report({"ERROR"}, "Couldn't export the pose: %s" % error)
            return {"CANCELLED"}
        url, token = addr
        name = str(arm.get("harmonious_traveller") or LINK.get("traveller") or "Traveller")
        try:
            req = urllib.request.Request(url.replace("/api/live/build", "/api/live/pose") + "?name=" + urllib.parse.quote(name),
                                         data=data, method="POST", headers={"X-Live-Token": token, "Content-Type": "model/gltf-binary"})
            with urllib.request.urlopen(req, timeout=120) as res:
                out = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            self.report({"ERROR"}, error.read().decode("utf-8", "replace").strip() or str(error))
            return {"CANCELLED"}
        except (urllib.error.URLError, OSError, ValueError) as error:
            self.report({"ERROR"}, "Couldn't reach Harmonious Save Editor: %s" % error)
            return {"CANCELLED"}
        set_status("Sent to the editor in 3D (%d MB): open the Traveller page" % max(1, len(data) // 1048576))
        self.report({"INFO"}, "Sent " + out.get("name", "the pose"))
        return {"FINISHED"}


# ---------------------------------------------------------------- lighting and render quality (owner, 2026-11-11)
# Ready-made lights round the traveller, placed from where the camera looks (key from the camera's left, rim behind),
# so they fit whichever way the shot is framed. They live in their own collection and are replaced each time.
LIGHTINGS = (
    ("STUDIO", "Studio", "A key light, a soft fill and a cool rim light behind for a glowing edge"),
    ("HERO", "Hero", "Low and dramatic: strong rim lights on both sides, a dark front"),
    ("SUNSET", "Sunset", "Warm low sun from the side, cool blue shadows"),
    ("SPACE", "Space", "One hard light like a distant star, with a coloured rim"),
    ("KEEP", "Keep my lights", "Use the lights already in the scene"),
)
# (kind, where: camera-relative right, front, up; size, power at 3 m, colour); "world": ambient colour and strength
LIGHT_RIGS = {
    "STUDIO": {"world": ((0.05, 0.06, 0.08), 0.5), "lights": (
        ("AREA", (-0.8, 1.0, 0.7), 1.6, 900, (1.0, 0.96, 0.9)),
        ("AREA", (1.0, 0.7, 0.2), 2.4, 280, (0.8, 0.88, 1.0)),
        ("AREA", (0.3, -1.2, 0.9), 1.0, 1300, (0.65, 0.9, 1.0)))},
    "HERO": {"world": ((0.02, 0.02, 0.03), 0.3), "lights": (
        ("AREA", (-0.6, 0.6, -0.15), 1.0, 500, (1.0, 0.92, 0.85)),
        ("AREA", (-1.1, -1.0, 0.6), 0.6, 1600, (0.55, 0.85, 1.0)),
        ("AREA", (1.1, -1.0, 0.6), 0.6, 1600, (0.55, 0.85, 1.0)))},
    "SUNSET": {"world": ((0.18, 0.24, 0.42), 0.7), "lights": (
        ("SUN", (-1.0, 0.45, 0.2), 3.0, 7.0, (1.0, 0.55, 0.28)),
        ("AREA", (0.9, -0.9, 0.7), 1.0, 700, (1.0, 0.62, 0.4)))},
    "SPACE": {"world": ((0.01, 0.015, 0.03), 0.4), "lights": (
        ("SUN", (-1.0, 0.35, 0.35), 0.5, 7.0, (1.0, 0.98, 0.95)),
        ("AREA", (1.0, -1.0, 0.4), 0.8, 1800, (0.2, 0.85, 0.8)))},
}
GLOW_RE = r"lens|screen|scanline|display|visor|glow|light|panning|refiner_on|statbar|ui(dull|misc)|fx"


def traveller_box(arm):
    """Centre and height of the traveller (its meshes as posed)."""
    import mathutils
    pts = [o.matrix_world @ mathutils.Vector(c) for o in traveller_meshes(arm) for c in o.bound_box]
    if not pts:
        return arm.matrix_world.translation.copy(), 1.8
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    return (lo + hi) / 2, max(hi.z - lo.z, 0.5)


def light_traveller(scene, arm, rig):
    """Put the ready-made lights round the traveller (and the world's ambient colour); KEEP leaves the scene alone."""
    import mathutils
    if rig not in LIGHT_RIGS:
        return 0
    coll = bpy.data.collections.get("Harmonious lights")
    if coll is None:
        coll = bpy.data.collections.new("Harmonious lights")
        scene.collection.children.link(coll)
    for o in list(coll.objects):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            bpy.data.lights.remove(data)
    # the lights that frame_camera adds when there's no light at all would add to these
    for o in list(scene.objects):
        if o.type == "LIGHT" and o.name.startswith("Traveller light"):
            bpy.data.objects.remove(o, do_unlink=True)
    centre, height = traveller_box(arm)
    up = mathutils.Vector((0, 0, 1))
    cam = scene.camera
    front = (cam.matrix_world.translation - centre) if cam is not None else mathutils.Vector((0, -1, 0))
    front.z = 0
    front = front.normalized() if front.length > 1e-6 else mathutils.Vector((0, -1, 0))
    right = front.cross(up).normalized()
    dist = height * 1.7
    k = (dist / 3.0) ** 2   # light power was set for 3 m away
    spec = LIGHT_RIGS[rig]
    for i, (kind, (r, f, u), size, power, colour) in enumerate(spec["lights"]):
        data = bpy.data.lights.new("Harmonious %s %d" % (rig.lower(), i + 1), kind)
        data.color = colour
        if kind == "SUN":
            data.energy = power
            data.angle = math.radians(size)
        else:
            data.energy = power * k
            data.size = size * height / 1.8
        o = bpy.data.objects.new(data.name, data)
        coll.objects.link(o)
        o.location = centre + (right * r + front * f + up * u) * dist
        o.rotation_euler = (centre - o.location).to_track_quat("-Z", "Y").to_euler()
    world = scene.world or bpy.data.worlds.new("Harmonious world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = (*spec["world"][0], 1.0)
        bg.inputs[1].default_value = spec["world"][1]
    scene["harmonious_lit"] = rig
    return len(spec["lights"])


def set_glow(arm, on, strength=4.0):
    """The game's lenses, screens and visor light up (they glow in Cycles and light what's near them)."""
    import re
    n = 0
    for o in traveller_meshes(arm):
        for m in o.data.materials:
            if m is None or not m.use_nodes or not re.search(GLOW_RE, m.name, re.I):
                continue
            bsdf = next((x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            ec = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            es = bsdf.inputs.get("Emission Strength")
            if ec is None:
                continue
            for l in list(ec.links):
                m.node_tree.links.remove(l)
            if on:
                src = bsdf.inputs["Base Color"].links[0].from_socket if bsdf.inputs["Base Color"].links else None
                if src is not None:
                    m.node_tree.links.new(src, ec)
                else:
                    ec.default_value = bsdf.inputs["Base Color"].default_value
                if es is not None:
                    es.default_value = strength
                n += 1
            else:
                ec.default_value = (0, 0, 0, 1)
                if es is not None:
                    es.default_value = 0.0
    return n


def set_quality(scene, best):
    """Best: Cycles with a denoiser, on the graphics card when Blender has one set up. Quick: EEVEE."""
    r = scene.render
    if best:
        r.engine = "CYCLES"
        scene.cycles.samples = 96
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else prefs.get_devices()
            if prefs.compute_device_type != "NONE" and any(d.use and d.type != "CPU" for d in prefs.devices):
                scene.cycles.device = "GPU"
            else:
                scene.cycles.device = "CPU"
        except Exception:
            scene.cycles.device = "CPU"
        return
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            r.engine = engine
            return
        except TypeError:
            continue


class HARMONIOUS_OT_light(bpy.types.Operator):
    bl_idname = "harmonious.light"
    bl_label = "Light it"
    bl_description = "Put the chosen lights round your traveller now (look in Rendered view: Z, Rendered)"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        scene = context.scene
        arm = find_traveller()
        if scene.camera is None:
            meshes = traveller_meshes(arm)
            if meshes:
                frame_camera(scene, max(meshes, key=lambda o: len(o.data.vertices)))
        n = light_traveller(scene, arm, scene.harmonious_lighting)
        set_glow(arm, scene.harmonious_glow)
        self.report({"INFO"}, "%d lights placed" % n if n else "Your own lights are kept")
        return {"FINISHED"}


class HARMONIOUS_OT_select_light(bpy.types.Operator):
    bl_idname = "harmonious.select_light"
    bl_label = "Select this light"
    bl_description = "Leave Pose mode and select this light, so G moves it and R turns it"
    bl_options = {"REGISTER", "UNDO"}
    name: bpy.props.StringProperty()

    def execute(self, context):
        o = bpy.data.objects.get(self.name)
        if o is None:
            return {"CANCELLED"}
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for x in context.selected_objects:
            x.select_set(False)
        o.hide_set(False)
        o.select_set(True)
        context.view_layer.objects.active = o
        self.report({"INFO"}, "%s selected: G moves it, R turns it (over the 3D view)" % o.name)
        return {"FINISHED"}


def scene_lights(scene):
    """The Harmonious lights first, then any others in the scene."""
    coll = bpy.data.collections.get("Harmonious lights")
    ours = [o for o in coll.objects if o.type == "LIGHT"] if coll is not None else []
    return ours + [o for o in scene.objects if o.type == "LIGHT" and o not in ours]


def glow_changed(self, context):
    arm = find_traveller()
    if arm is not None:
        set_glow(arm, self.harmonious_glow)


class HARMONIOUS_OT_picture(bpy.types.Operator):
    bl_idname = "harmonious.pose_picture"
    bl_label = "Save the pose as a picture"
    bl_description = "Render the scene's camera (one is added looking at your traveller if there's none) to a PNG with a transparent background"

    def execute(self, context):
        import datetime
        scene = context.scene
        arm = find_traveller()
        name = (arm.get("harmonious_traveller") if arm is not None else None) or "Traveller"
        if scene.camera is None:
            meshes = [o for o in scene.objects if o.type == "MESH" and (arm is None or o.parent == arm or any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers))]
            if not meshes:
                self.report({"ERROR"}, "Import your traveller first, or add a camera")
                return {"CANCELLED"}
            frame_camera(scene, max(meshes, key=lambda o: len(o.data.vertices)))
        if arm is not None:
            if scene.harmonious_lighting != "KEEP" and scene.get("harmonious_lit") != scene.harmonious_lighting:
                light_traveller(scene, arm, scene.harmonious_lighting)
            set_glow(arm, scene.harmonious_glow)
        set_quality(scene, scene.harmonious_quality == "BEST")
        r = scene.render
        r.film_transparent = True
        r.image_settings.file_format = "PNG"
        r.image_settings.color_mode = "RGBA"
        if r.resolution_x == 1920 and r.resolution_y == 1080:   # Blender's default: make it a portrait picture
            r.resolution_x, r.resolution_y = 1080, 1350
        folder = LINK.get("exports") or (os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.expanduser("~"))
        os.makedirs(folder, exist_ok=True)
        out = os.path.join(folder, "%s pose %s.png" % (name, datetime.datetime.now().strftime("%Y-%m-%d %H%M%S")))
        r.filepath = out
        bpy.ops.render.render(write_still=True)
        set_status("Saved " + out)
        self.report({"INFO"}, "Saved " + out)
        return {"FINISHED"}


class HARMONIOUS_OT_pose_mode(bpy.types.Operator):
    bl_idname = "harmonious.pose_mode"
    bl_label = "Pose the traveller"
    bl_description = "Pose mode on the traveller, or back to Object mode, where other add-ons (Base Builder, Charon Forge) show their tools again"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return find_traveller() is not None

    def execute(self, context):
        arm = find_traveller()
        if context.mode == "POSE":
            bpy.ops.object.mode_set(mode="OBJECT")
            return {"FINISHED"}
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for o in context.selected_objects:
            o.select_set(False)
        arm.hide_set(False)
        arm.select_set(True)
        context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="POSE")
        # every part turns at its own joint, the way a real one does
        context.scene.tool_settings.transform_pivot_point = "INDIVIDUAL_ORIGINS"
        return {"FINISHED"}


def has_traveller():
    arm = find_traveller()
    return arm is not None and bool(arm.get("harmonious_traveller"))


class HARMONIOUS_PT_traveller(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Your traveller"
    bl_idname = "HARMONIOUS_PT_traveller"
    bl_order = 2
    header_icon = ("traveller", "ARMATURE_DATA")

    def draw(self, context):
        layout = self.layout
        col = layout.column(align=True)
        col.scale_y = 0.8
        if LINK["state"] == "none":
            col.label(text="Open Harmonious Save Editor and a save")
        elif LINK.get("traveller"):
            col.label(text="In the editor: " + LINK["traveller"], icon="USER")
        else:
            col.label(text="Open a save in the editor")
        row = layout.row()
        row.enabled = bool(LINK.get("traveller"))
        row.operator(HARMONIOUS_OT_traveller.bl_idname, **ic("import", "IMPORT"))
        if not has_traveller():
            return
        arm = find_traveller()
        posing = context.mode == "POSE"
        box = layout.box()
        box.operator(HARMONIOUS_OT_pose_mode.bl_idname, text="Done posing" if posing else "Pose the traveller", **(ic("traveller", "OBJECT_DATAMODE") if posing else ic("pose", "POSE_HLT")), depress=posing)
        tip = box.column(align=True)
        tip.scale_y = 0.8
        text = ("Click a part of the body: its bone shows. R turns it, Shift+click adds another part, a click on empty space hides them. "
                "Done posing goes back to Object mode, where other add-ons show their tools again.") if posing else \
               "Other add-ons, like Base Builder, hide their tools while you pose; they come back when you're done."
        for line in wrap(text, 40):
            tip.label(text=line)
        layout.prop(arm, "harmonious_keep_shape")
        layout.prop(arm, "harmonious_natural")
        shown = not any(is_hidden(arm, b) for b in body_bones(arm))
        layout.operator(HARMONIOUS_OT_show_bones.bl_idname, text="Hide the sticks" if shown else "Show every stick", icon="HIDE_OFF" if not shown else "HIDE_ON")


class HARMONIOUS_PT_poses(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Poses"
    bl_idname = "HARMONIOUS_PT_poses"
    bl_order = 3
    header_icon = ("pose", "POSE_HLT")

    @classmethod
    def poll(cls, context):
        return has_traveller()

    def draw(self, context):
        layout = self.layout
        layout.prop(context.scene, "harmonious_pose", text="")
        row = layout.row(align=True)
        row.operator(HARMONIOUS_OT_pose.bl_idname, **ic("pose", "POSE_HLT"))
        row.operator(HARMONIOUS_OT_pose_reset.bl_idname, text="Start pose", icon="LOOP_BACK")
        row = layout.row(align=True)
        row.operator(HARMONIOUS_OT_pose_save.bl_idname, icon="FILE_TICK")
        row.operator(HARMONIOUS_OT_poses_folder.bl_idname, text="", icon="FILE_FOLDER")


class HARMONIOUS_PT_parts(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Body parts"
    bl_idname = "HARMONIOUS_PT_parts"
    bl_order = 4
    bl_options = {"DEFAULT_CLOSED"}
    header_icon = ("bone", "BONE_DATA")

    @classmethod
    def poll(cls, context):
        return has_traveller()

    def draw(self, context):
        layout = self.layout
        arm = find_traveller()
        tip = layout.column(align=True)
        tip.scale_y = 0.8
        for line in wrap("Pick one part or several, then R turns them, each at its own joint.", 40):
            tip.label(text=line)
        grid = layout.grid_flow(row_major=True, columns=2, even_columns=True, align=True)
        for part in BODY_PARTS:
            if not part_bones(arm, part)[0]:
                continue
            grid.operator(HARMONIOUS_OT_body_part.bl_idname, text=part[1], depress=part_on(arm, part)).part = part[0]
        layout.operator(HARMONIOUS_OT_body_parts_clear.bl_idname, icon="X")
        hands = layout.box()
        hands.label(text="Hands: open to fist", **ic("bone", "HAND"))
        col = hands.column(align=True)
        col.prop(context.scene, "harmonious_curl_r", slider=True)
        col.prop(context.scene, "harmonious_curl_l", slider=True)


class HARMONIOUS_PT_tool(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Multi-tool"
    bl_idname = "HARMONIOUS_PT_tool"
    bl_order = 5
    header_icon = ("tool", "TOOL_SETTINGS")

    @classmethod
    def poll(cls, context):
        return has_traveller()

    def draw(self, context):
        layout = self.layout
        layout.prop(context.scene, "harmonious_tool", text="")
        row = layout.row(align=True)
        row.operator(HARMONIOUS_OT_hold_tool.bl_idname, **ic("tool", "HAND"))
        row.operator(HARMONIOUS_OT_drop_tool.bl_idname, icon="X")


class HARMONIOUS_PT_share(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Picture and 3D"
    bl_idname = "HARMONIOUS_PT_share"
    bl_order = 6
    header_icon = ("picture", "RENDER_STILL")

    @classmethod
    def poll(cls, context):
        return has_traveller()

    def draw(self, context):
        layout = self.layout
        tip = layout.column(align=True)
        tip.scale_y = 0.8
        for line in wrap("Both go to the editor's Traveller page: the 3D pose turns there, the picture stays as you framed it.", 40):
            tip.label(text=line)
        send = layout.row()
        send.enabled = LINK["state"] != "none"
        send.operator(HARMONIOUS_OT_send_pose.bl_idname, **ic("send3d", "EXPORT"))
        box = layout.box()
        box.label(text="Picture", icon="IMAGE_DATA")
        box.prop(context.scene, "harmonious_quality", expand=True)
        row = box.row(align=True)
        row.prop(context.scene, "harmonious_lighting", text="")
        row.operator(HARMONIOUS_OT_light.bl_idname, text="", **ic("light", "LIGHT_AREA"))
        box.prop(context.scene, "harmonious_glow")
        lights = scene_lights(context.scene)
        if lights:
            lb = box.box()
            lb.label(text="Lights (click one to move it with G, turn it with R)", icon="LIGHT")
            for o in lights:
                col = lb.column(align=True)
                row = col.row(align=True)
                row.operator(HARMONIOUS_OT_select_light.bl_idname, text=o.name, icon="RESTRICT_SELECT_OFF", depress=o.select_get() and context.mode == "OBJECT").name = o.name
                row = col.row(align=True)
                row.prop(o.data, "energy", text="Power")
                row.prop(o.data, "color", text="")
            if context.scene.harmonious_lighting != "KEEP":
                tip = lb.column(align=True)
                tip.scale_y = 0.8
                for line in wrap("After changing them, set Lighting to Keep my lights so they stay as you left them.", 40):
                    tip.label(text=line)
        if context.scene.harmonious_quality == "BEST":
            tip = box.column(align=True)
            tip.scale_y = 0.8
            for line in wrap("Best uses Cycles: real light and shadows, slower (up to a few minutes on a weaker PC).", 40):
                tip.label(text=line)
        box.operator(HARMONIOUS_OT_picture.bl_idname, **ic("picture", "RENDER_STILL"))


class HARMONIOUS_PT_support(LiveLinkPanel, bpy.types.Panel):
    bl_label = "Support the creator"
    bl_idname = "HARMONIOUS_PT_support"
    bl_order = 7
    header_icon = "FUND"
    bl_options = {"DEFAULT_CLOSED"}  # one line until opened (owner, 2026-11-06: open was too in-your-face)

    def draw(self, context):
        layout = self.layout
        text = layout.column(align=True)
        text.scale_y = 0.8
        for line in wrap("LiveLink and Harmonious Save Editor are free, made by Pastullio the Harmonious. If they help you, you can support the work or come and say hello:", 40):
            text.label(text=line)
        col = layout.column(align=True)
        for label, url, icon in SUPPORT:
            col.operator("wm.url_open", text=label, icon=icon).url = url
        layout.label(text="More free tools")
        col = layout.column(align=True)
        for label, url, icon in TOOLS:
            col.operator("wm.url_open", text=label, icon=icon).url = url


def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + ([cur] if cur else [])


_KEYMAPS = []

CLASSES = (HARMONIOUS_OT_send, HARMONIOUS_OT_target, HARMONIOUS_OT_traveller, HARMONIOUS_OT_pick_part, HARMONIOUS_OT_show_bones, HARMONIOUS_OT_pose, HARMONIOUS_OT_pose_reset,
           HARMONIOUS_OT_pose_save, HARMONIOUS_OT_poses_folder, HARMONIOUS_OT_hold_tool, HARMONIOUS_OT_drop_tool, HARMONIOUS_OT_send_pose, HARMONIOUS_OT_picture,
           HARMONIOUS_OT_body_part, HARMONIOUS_OT_body_parts_clear, HARMONIOUS_OT_pose_mode, HARMONIOUS_OT_light, HARMONIOUS_OT_select_light, HARMONIOUS_OT_send_ship,
           HARMONIOUS_PT_live, HARMONIOUS_PT_build, HARMONIOUS_PT_traveller, HARMONIOUS_PT_poses, HARMONIOUS_PT_parts,
           HARMONIOUS_PT_tool, HARMONIOUS_PT_share, HARMONIOUS_PT_support)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.harmonious_live_on = bpy.props.BoolProperty(
        name="Send on save", default=True,
        description="Send the build to Harmonious Save Editor every time this file is saved")
    bpy.types.Scene.harmonious_target_slot = bpy.props.IntProperty(name="Corvette slot", default=-1)
    bpy.types.Scene.harmonious_tool = bpy.props.EnumProperty(name="Multi-tool", items=tool_items,
        description="One of the multi-tools in the save open in the editor")
    bpy.types.Scene.harmonious_quality = bpy.props.EnumProperty(name="Quality", default="QUICK", items=(
        ("QUICK", "Quick", "EEVEE: a picture in seconds"),
        ("BEST", "Best (Cycles)", "Cycles: real bouncing light, soft shadows and reflections; slower")),
        description="How the picture is rendered")
    bpy.types.Scene.harmonious_lighting = bpy.props.EnumProperty(name="Lighting", items=LIGHTINGS, default="STUDIO",
        description="Lights placed round your traveller when the picture is saved (or now, with the light button)")
    bpy.types.Scene.harmonious_glow = bpy.props.BoolProperty(name="Lenses and screens glow", default=True, update=glow_changed,
        description="The game's lenses, screens and visor give off light (in Cycles they light what's near them)")
    bpy.types.Scene.harmonious_pose = bpy.props.EnumProperty(name="Pose", items=pose_items,
        description="A ready-made pose, or one saved in your Poses folder")
    bpy.types.Object.harmonious_keep_shape = bpy.props.BoolProperty(
        name="Keep the body's proportions", default=True, update=keep_shape_changed,
        description="Bones only turn, so arms and legs never stretch. Turn off to move and scale bones freely")
    bpy.types.Object.harmonious_natural = bpy.props.BoolProperty(
        name="Natural joints", default=True, update=natural_changed,
        description="Every joint turns as far as a person's can: elbows and knees bend one way and twist a little, fingers bend like hinges, the neck, back, wrists and ankles stay in reach. Turn off to turn them any way")
    bpy.types.Scene.harmonious_curl_r = bpy.props.FloatProperty(name="Right hand", min=0.0, max=1.0, default=0.0, subtype="FACTOR",
        update=curl_changed("r"), description="Open hand to fist")
    bpy.types.Scene.harmonious_curl_l = bpy.props.FloatProperty(name="Left hand", min=0.0, max=1.0, default=0.0, subtype="FACTOR",
        update=curl_changed("l"), description="Open hand to fist")
    bpy.types.Scene.harmonious_target_name = bpy.props.StringProperty(name="Corvette")
    if on_save not in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.append(on_save)
    if not bpy.app.timers.is_registered(link_timer):
        bpy.app.timers.register(link_timer, first_interval=1.0, persistent=True)
    kc = bpy.context.window_manager.keyconfigs.addon
    if kc is not None:   # a click on the traveller in Pose mode picks the part under it
        km = kc.keymaps.new(name="Pose", space_type="EMPTY")
        for shift in (False, True):
            kmi = km.keymap_items.new(HARMONIOUS_OT_pick_part.bl_idname, "LEFTMOUSE", "CLICK", shift=shift)
            kmi.properties.extend = shift
            _KEYMAPS.append((km, kmi))


def unregister():
    global _PREVIEWS
    for km, kmi in _KEYMAPS:
        try:
            km.keymap_items.remove(kmi)
        except (ReferenceError, RuntimeError):
            pass
    _KEYMAPS.clear()
    if _PREVIEWS is not None:
        from bpy.utils import previews
        previews.remove(_PREVIEWS)
        _PREVIEWS = None
    if bpy.app.timers.is_registered(link_timer):
        bpy.app.timers.unregister(link_timer)
    if on_save in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.remove(on_save)
    del bpy.types.Scene.harmonious_live_on
    del bpy.types.Scene.harmonious_target_slot
    del bpy.types.Scene.harmonious_target_name
    del bpy.types.Object.harmonious_keep_shape
    del bpy.types.Object.harmonious_natural
    del bpy.types.Scene.harmonious_curl_r
    del bpy.types.Scene.harmonious_curl_l
    del bpy.types.Scene.harmonious_pose
    del bpy.types.Scene.harmonious_quality
    del bpy.types.Scene.harmonious_lighting
    del bpy.types.Scene.harmonious_glow
    del bpy.types.Scene.harmonious_tool
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


# ---- LOGO (generated by tools/addon-logo.py from src/assets/livelink) ----
LOGO_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAC/VBMVEXgoGBaWlydYCXbmCTXZycyIhobn+Hh2t1YLBygYR9dn9SYnKltUSMXXJ1eLBmablPycQXdqJM3Hw5wz/dQJBBYJxGZVB3tpxgwEARniZmfVBol6fzz0KwiMlyWIAm1iBwYm9kvSFr89wTaMAAnhbeyNQTUdkqmVlMhoNFZaI+si1+txdX88xk0FAT3rFMVdM0en9P37WraYwfSaxGUOQdzUi+RpdDolCXpnhIAAP8wrbVqZmp7SiyOdJYHe/d6TjahLAFIO02xpyP2c3P///8Mf3/60GP0yV/noFLCu8UkSBNjVFTcNQBthndNprGqqlWsw7752G4/P38LLo0/f78pkLpEEURcWm9mZplrhni//z/APgD4tEfzwAXw4IQAAAAHBw0DFy0EJkz4lwn0hwf4+/grCAFPGAL6pgvwdwWuRwPRZgfLWAMEN20yFAj6tgpuJgMNERrvZwL8+I6QNwK3VQX8+q77xy8DSIz79nGMKAHPSAH7xwpRJQuuOAL851FrGgH4uCr81jH8+8/86W3pWAEKIjr72EzVdQpLCQAADSOVRAj71gsKVZTP6PdyNQgCWKrLOQD85jH89lEDHEcNM1gIZrLR+fz3qSoLRHcGd836yEwKhtHmSgAJpu+Q+/385g5QhrUCLGWy1/WxZwgsJi6qKQFNeaj855AJl+lyRwrThwr72G1v+P0JtfMqRmxtmckCacf62IyQVgiv+P2y5fr2uE389S1MaJAsNk2Nt+WQx/LK2u0ux/ZQ5/yKGQBVAABxpdOUZgn/AAB/AACpVQEvuPJPl8yLSSkLldVP1/nzmSwCPISzdgeryOsHieUGxvouh831yW0yd7Arp+ssWYsxY5QOdLVoibFSdZlLyPdt5/w7AABwtuqNtdNzRjB/fwCyZi8u1vtMNypMuPNT9fyIqtJVNQqUVCywussJ2Pttd4/NdTH7589NWHCP1vmtWCv856xrCwB5PASQ6PwzVHbtp03zuIhOqurRiDEA//80l9JxlbpVVQD4xYznl5IxAAAA/3RSTlP7/O739PLw/Ood/Pz4+x78CPwe/F6iWw+k/J77+fz2/Jz8Bvz8C/wGIPz8/P1iC/paC6JemxT8o10BDANW/AKfU/wGAgECpNxa/A5uHvwMA/xmBP0ESg+rBRMEQaGCfQD8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pv8/Pz8/Pz9/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pr8/Pz8/Pz8/Pz8+vz8/Pz7/Pz8/fz8/Pz8/Pz8/Pz8/PwD/PwBAgT8/Pv8/Pz8/Pz8+vz8/Pz8/Pz8/Pz8BPz8+wL8/Pz8/Pz8+vz7/Pz8/Pz8/PsI/Pz7/fz8Afz8A/zlPI8jAABVEElEQVR42u29B3xTV7L4LzcwBlNCSAPChiTspuxmN9nN9vd23+7r7/8r/94l+0q690qydC1dSba6ZMuSLHfjbozBBWObajAdhxJ670kWEkogBQiQQGCTzec/c869slzYmLbsPv4nwQhZljXfMzNnZk5TKB/xpnjIv3/row3gB8p/+Rflf32EAfz+LYVC+ftHF8CLyt8oFL9Rvv3IAtiqfObLL3/86AL4k3KMbto0z0+UWx5RAG8rnzFcGq17Qvn5o2oCv0s0aC7pnnmoY6HiYSrAGDFZo7GKbz9MG3iIAD5XPuNRaDTJ4hMP0w0+RABbxiSKAEAhPvNoAvhAOSYqTgIAjsQxj6QP+Fz5RFScptF86Yg+TBt4eABgEBQ9AGCaI/oMxISPoA8AF6C7pNFcFR+qE3hoACaCC3CcztNobDoxOubhDYSKh+kCHLNseRrbFQEAfPDIAUAXIChseXm2CUL0IUbDD88H/CARAFjy8iwKX/QhRsMPC8AHyolRQfiSAhATH140/LAATFS+ERUcy3MJgFLdw3MCDwvAGOUboiB2AIDcbkGAlPjFRwzAW+gDd3RUAoB8QRCfeYQAbPngg7ff/vzzmYkCeyW30gYARFZM/OWLb//pgy3/uQFs+eV3x/8y9q+ZVoGdlesFAJUfsaJuovT01u9+95d/URCKv5Tw46VH3/3umDFP/OpXj4MFsIrKCluetzIx4hCn/OpXP/nJmB8oY6/64D8RgA/GE2nG/ORXf//3fz/u/dRno1GdVRTcrKKCAHg5IgiCNRoVxdRxf//3v3piDE2Px393y38GAB98l/Tor1B0aDs+On1LcaO2d7dPYNleAsCr0AqgDbW7dyfdOn0lumPH+++Pe4ZSePtPf+MAtnwXI7wxTzxDhP8oUXGjt7eW4fXJosPHsr5DAQRQodCyAuvwGAxmxt/beyPpdOIOoJAIEBDdlr9dAB+MJ9InfvQRCDRBoQDZzYZgsmLSpB3Y56zQ7UIAgV4j62MFbeKkSbOSg3qeqe29oTidCKqw4xnUg7ff/tsE8LuJpO9B+ugVxY1DvbvNBsMsxbTRGs2l5IjWDQBKQwigItDAQhO0bDIkx5emKS4agvxu0ISLV8QdOxKJGrz9twcANXfMM4mJH+24cqv3UK/a4ExWgOzYphlErcrtNkZ2hExFAMDV4CYAjB7zJfqK0ZOSAQIowkUr6MEzTzxIBA8EwJbfoe4/c/rKDuvF3pBdDV3/JZE+z2azXTLoBJXWzRq1VwIUQKBUa2QFo1YsV+dBkxgoDE5koNdFQQ3efmAIHgSAHxDdP336yukkux3MXjGJCm+xWGx5GoVHx6pYAQQ+DQAseRUmV6cWNACe1HkUiMhmoxCmKdAt+rt00Y+IJbz9twEAxJ/4RvLp09awP2Dig7OI9Jc6OkB6lOySTgcWQAAkujiXJS9gco2jAIw6jx4BWCwUFbRJswzmWjuj1wGCiQ8Ewf0GMHGLcswbyReT9Wp7gDMHFWjVl5bn51OhqAI4tFoC4JYJARRxps0IhNVqRZ3nG6Ioubm5lZW5FhvagiIYZFwcQfCk8u0tf90AJk5U/vJnSbdA/FAFZ07+kkjfnZ8PAuVKAJJFdAEgsFabxAEAGwDYq2J9EgBFnoUC8GKrzEUGk5JjCO6/EtxPADNB+5/8aRJvZgIVHK+YBp/9aneISOIlBGx5eZd0HgrAp9UqJADcXhU4QVarcug8yXlU/nyvNxQKBQIV3o48RGBGBNaeZ8ZANvnXCoCKr+ZBfBOPY96l5SEQwBuSAYB5a6Z5dOADMfTTamsZBgC4GKYLbMIHAASdx2Aj8lMAATu0QCAf1GBacpBzcQbdfVeC+wZg4g9A/N27eaahwqQm4h8KyA0R5KMG2DRfEgCkw1mOYUwxAKzbiACcV2UDgO630+YKeC15qAUml1qnu89KoLh/3f+zpFq12l5ZxKD4VxvskgDxAIgPdMoAatUUgJoAYAkAz3KbhfY//rTf7zfBf357INSRl/dlstpl0uus91UJ7g+AiT+C7q/dzfgrK7jdIP40EN9uN5lMdhdhEAoNAeDTujmeMeXaTAzfZdT6CAAnDAM2ogAhIr7Jz2EzcSaTK5Rrsyl4pogzWEEJ3v6rAgDd/y83ahnOW+mqnUbEJ9JDAxEogRgAp9MgaYCb4dWmfJtJzauNkgY4dc5vUAPQAQAAEBzEZxiGUCjy5tquKniTiTeAEtwvM7gfAH6k/MH/3VvLBXKLuG+o8lPxOQqhX37wAQqnwSwQAKoLAwGgDzA4ncst1AMgAD9KTwhg40wBQPBNMhkPnpl5n5Tg3gH8bqbyXxQNJldupathtOZSdwDF52gjSkAAeGkcoPkyGJQBlDJmNYcAzGo3BSCaDearkgsgDkCWvR9BRa5NoTa5eAOYwcS/CgCg/v/UYHd5LRWuqxrNchSfyM5wVHH9dgkAUYG8aWYzL6qwAKDqHAgATCDKm/mrIH++7ANI76uh0S+AwB5YZVmexLkYffJE5Zi/AgA/UP7on7oDRZbc5nyNxgZDl4t2P0O1l7oAOgrkog/IA73vURmNAwAwFygAq5r3QyCUmx8KUQCEgFrN8zEE1A5uMC6TWf+GcsyWhw3gSeWP/jm/ucKWu8qmycv1VtiJ/NhVDPVdkg8MoQIsn/Ty6WiXidurpQCg67lcogEUgDbMmG7tmPCyohu8gAyA6ACPCNT4B97T7q20LOcgJgACW2Y+VAAQ+/737vzmXOg16P5cb8DlkvRfEp/zUw2ozM1XTCgV2IjP19dV1EUBjGPMPGehAFQAQKtlXK0+XyTCCjtmKEAH/LWDCKgpAX/Im3vVb2pm+Nf/z3t2BPcC4Je/V/73fO8qiwaLGCi/XQIgyw8hDBAIeUMzxrlBLsiABIfj2bDdqJUAyBpQSgAIdqtP8EFjI5GI0JrUADpQS98NzYAyIIYVys+1NbiKTOrXIQB5aAB+pPyHf8r3VpK8Pc+SW1lBRz8JgDQMgPrPGMei9NB8gsPjcZYb3BSAOuYEO1VoAaWGdo/HIfjIayPaiDsxyW6vpTjVaqoF9K1NgXyLLd/V7GJ++uQ96oDiHuT/0T/lV1TSKp4N5ScaILtASfykRHdMetED8mHSo8LQV9WjBhPoB6DF51mfo7293eEjEEAPSmcAgn4CMgC/Hwl0FK2qYJKevDcdUNyD+wP5c6n8qADeAI1+uVgD8TtZSXroehEzXqkhgM39TpAA6P+eo93T7qAMtO7N/n4E0liIgwvkiHm2iop7JqC4+/7/5375QQG8oAE4BsYQ2BtmlNLOF0Sd0yMYVfFNBkA0gMea2IBvR3wyg4iWlRBI4QB1LmBauTDwVK7y3iOBuwTwDyB/d7Mkfz8Au5QEYO/PECKsW2B9w0g/GIB6nIod8gpgUN5O1AARxAeFHHWt+ZAja3JXebnkeyGguEv9/0FDqNkiya/BIoaXECAI8OMllcJoJvgEnUEnsqqhbZAGDAMAX9Re7hHAfsCONvv9/bYFv6ABAWC9LLfZywCBMX9RACC/oqEoVyrhIwBMYMAgJQRehUjEd1j1TkE1bBsIoHN4AOAPHOXgN8Enat1JDf5aaH4ytNpDISy04gfwNlcw96ADdwPgByB/r4sWbaWKv1zFRATehis+H4xmop63+lSqewIACASnkzqDqD9AhSexFYQCmFsAAm9RAAlM/IsBgOxXUWuC9I5O9eBkDi1leytJIVcBXS86PHq1dTjdV2UU4lf38CaQkTGcFiACQYj4ZmCKEIDAOkQVQJpEgQBU/frMLRP/QgAg9lLUciAosX0yhUFnM0gt07L8Sp9DbG83qPXD9n6hqoDIKNzGB2QMqwWeICLwXYsegjwJNS0fmkWeQrEFID9+/UcTt/xFAExUPpm0G+RfhYM/rffbKAIy9aVohxG/3cDwDu2w8mcUFpJeRgB8DECPBKCQ/D8MCNZp9vQ5HD6HAnLFfHmeBf7AY6/FAsMv//rdGcGdApj4o3/46W4mUFmRl5dbCU2u9xNDyLs0qx1CXaea8WiHt+gM2mQAfD8AVv5uocxgkCswm9vBsvpm0W6PyY/Vc0s+jLzmN+6KwB0C2PKk8qdJaru32WarrIzNeJDhAL5Mc3qczjk8Z/b9GfEzM5EAAEgcDCCjMCtTBjQUQsTJOzFXMEyjE6hE5VD+Brs938uZGMMbd7PYUHGnBvCzpDDnbbbYIPaHca/CS+bw6Hj4ZXBOMGg2cXHdb8SWTZpKlU2Em58zPwZgoAlkxLVCqggZAzwBw5c7gfE0DVU4GygArR36kYDacDdVMsUdDoBv3AozgeZcSyUZ8wPE7UsAbgR5EKlI7RsovjEOAipAzsmczAEawJvNBEBhxoA2zIjgUzNBp8Hp/BL1zUYBYMpcy9XmBxgTn/zknRdI7gjAd5VjLl7k7UVeC6S+OOOBM1+k1AUEas2Qr5lczkisx4xGt8Oj00UhC5IQYCdn5WRlZGTHaQAfNG9GAJLgmfPnZ1JfMNQOIgYOXh0M9krLDcACSM2AYWrz/YzJ/MzMtx8kgA8mjkm+GK4NFEEq7nJRAl6JwCU1D0F6wNQep/6sw8A0dNhsHaEkHUsJEAnxC2QHMQ2gACQFyMzMuUlcQaFkCQN9odPF8TwfVGiwdkgB1JKSgT8fvhrufNH1nQB4UfnMRT0TcFlyMetzkWkvWu60TQsG1YzLu7svTn63h+nAnupYvtxSyYlIoF/BBa1qLx/kmYEAChBAVhkBkCmbQmF8iKTVQdSj5uco8uh4GGqgeZJa7Q+pOfWdr7tX3IkBPHFaz9td+RYXh7MedokAjMrfOIO82pWfLJl/Nul/0Y8jI/zJt9cqKousQCAOgFG110wAcOADAABLn5+dmZk5nwwUBdIrC6gaFMbiQlMRozaXX7Tl4hCAPlAqFfjtas6QOOYOp4xGDuAD5ZjTp81+VwDkp5MeJCwFFbAc8jjNZq5CH1HF+T8fl3fVQqsllUWm3aFmUWuMyZ8tGLUxAMF+AJnoAUgbOCQUki/0rR1ckdps8Fy0eGnxvFYuF4U4njPc6Ra8EQPY8rsxiaf1u+0uS4iTJutcNDDPVXg8QTNX5IyTP9vIhi3L86V6oTdg4tQBk9CvAuAEEYAZAZipCZDezsyqPp6VlUUZZM5GjZA0g3DIkAi4zEFn+8X8ABkCwQRozZSxqxm17g63oSpGbgDPnLbydlN+t1TzJbN+aAO9EP3NYVy6+OAv2+jwLrfnknzVlustMjFqvlnfrwKSBpjV+RZcPSprADiAxm05SCCLakEmSo7/z54tjY1kOGRMQaen7yKNAWpp2RxarR1U4A7dwEgB/A4cwEdgAKEOnKsh83QEgN3b0A7Zmto0MPjN1oZza+1YucRcucLFMXzQxLHgBqlyUwCGOABuFB9aFsqPLbNKUoPZ8D+26QBB0gEfw80pBwIBnDkAAmpez/NhcFBgBLo7M4IRAtjywZjEjwy7XSaLX6pMSvNegQaPw1POD5Y/O2KCyMQe8GKeXBlwcWC1YZOYnSEDELXavUGnDKBVy7pnS3qPwtflEDUAhwBf5xMA0/+n1/bMjsVGPkZd7hH7dtvRFmvRBYTDer1ebeeZsOeOjEAxYgO4QgwgpI4DgLVJj0MH8g/K/bJVAsiMZXEIFHMrwAJ4g87AWVWyE0hxsBSAVwaQSqSvogByissIgqw9OTl7AMD8+dPnp7e8Nn92RkahHBTy5R6HY7eJoYMgrycNvANnfXbM1i33GQCMgB/tMNSaQh1MbIaGTPwErD5Pudk0OPnLVpW6IMRnTC5MGIpMHK836HSMMwagTSQAggMAVFVR5a/LKa6uXwYIcnJeOzIqJ4towPw96XviAIAOmD2i4AD1x//URAGg+Rle7XlG+af7DOCDtxI/sqpdJlstP2CKyh7uEz1zuCHJL2iAKWzQ86AELpwuAwPQiR5GFwcAfEDQIGmAYS8AyJIbyF9W33SgvrqsuLj+3SMIADxB5vzpkidUyaNh0OHw6Tg6ey4BMKhdZkYv3oEfVIxUAaJmP5d/SHK3PAXg7wL5nZxOOzjrzVaxjF5n1ZtJFZ8h8ou6eAAOAkDWAASAHV5cXIx/yqoBwP5l1dVl1cuq92BggAhmSwDkeMDDlQMBA42CQH4DaRxnZu5EBUYCYMuWn3z0kRM84HIGXS0lQLxAHzhARi/LnyEFrBkQ9Bv5MORBoAQ82ifKLxoYBwUAMV4KRMZdaALECToBwNlGaPVy27+waX99fTU0cAXzUQfoSDCbBESUgNaqbncIPh46JdxFFAAB6F08r3eMfBWVYmQeEBTAznX0oqvheSIVEDB5+jzlanUs/skkw3QGWkC21trlgU7XWfFDofiih+d9EoCCjLMQFnYFIRAiGuAMG9nUd3dt3Pjeext3bdiweHFT02L4QhCgM6zCmAgYTCcqUCibgTbMtzt8DtRKYgHwm6xWg9pkZnQ/nrn1/gGAGPijqHO3qWE5Tw0tTAGY9OgAGd+Qqg8CUAlqK4oNDHT0bwPj1Kqo/AUZnQ4CAEJhABAEAFqhfmHTgU+mfrho0dy5cxdtnDp16ieLF49qrK8uzqGBIbWCjNkEANUBlnGiG1Drw+EwsQErNL0JDEJ8YqRGMAIAvwQF0PEm7upuIj5oAfGCHAMOIBgbALKJ7stVjWxI21AFpObBWFHdhwpQgC2jR9C61UFMhy2c2ezk3Vph3sKdjfuh64HCorkrampWAIZPDoAalOXUZckxkRQQFkohocjAUOjDj6RHAFarDlSgC1Xg2Se33C8AoAA7ojAEdh+SxlpJAzjRAQ4wzgEQzYzFuipfmBDQ6ZxOgwGCXlM5UYCCApCkoNWn7ZQB8ACgVCskVFc3Nu5fuHBh07YNn2zc+OHcGo2mZsXGM4tBCzAmgHBg+nyZQAatLWsNajQC+sEMVhhqQQUMJgiLRnw6k2IkHmBHlHdxHYxeBhAGAFwrOgDumqT3hRlyDaNOAqByhMMgu9lMhgy/K4hlz4wC0pPj9Kx2sxqpEAAGc4+WjdbllB1v3AkAoG3bcODMVMpg7q4NTfVlxRAQQYsBkMbDCBN0CKyVErBKjajAj0c4En4rgK2oAE7OdCimAKABWP7xOSACIhFgLMcrjCXxlICeQVdRVFQEOSN4QBUVHwDMsLLaGTxGSrkWkxqSIvCC0YSsnByMAcqW1Y869+7kd89MXbRo0QrC4Mzi/RAY7cGgcPaAuiExAp8Pul/yANgMHKiAY4SxgGIEMQAogMnUrwDEBBgwgDkmgzau2D+oAQGfgbOH8IyEXDtWyrNJulNVlVmV5PC5GVAAxoULJHhzUA1OIHE+iYJJIFC2rPHIkW0bdm0k/gAYvLe4cdmydBoTZMTK62AEeh79IA0CrGACYAS6MFWBt++PCfwkkQwBDbw+zgSYMIwAPHONTPbAhykYDgG4aVHPhPK9LrWHleWHWD9zXJeP3czAGMAVkdXifJDfrGX3JtBEgKYCZRAENe4/suHMxkUfoh7UvLdhIWgBuAIkAO+TczwLZ9lwJBB8NAaQVYAMBM/+w30xAVQA0TxQAcJhogBBk4POdqFMgxDMlpVA6/M4PZD5YD0wcz72b3V1uskjsEmoRqYi3DGCKpDk9oldFFBdFupA8XFIBsqW7V+44b1FGzfC4FhTMxcQ5ODvInWzxl3pRAd06Ac9YUl8HfpBiAV4ZoRJoWIECqBjXKHucDwARg8ekAmjARSCXVdvqEYCsTqWlNgCE4gJtVotFsUzMnOqG3fubDxenDVD7fB9xIH8nKvZYmvGYolZvZn16RNBMkyIoJ+zig8fRA7L6vc3bYDg6MwiZDD3zP4yEhZg6aQ4i/pBtawC1ljTu9SM4ccjOprmWwC8jS7QbDd11IbJUCsPAg5He5DzUQcAAN49niUV8iTZM+fnzJcre1gFyaqrrm9srC6uy6qaPa63XHQoGJS/6FVb3qsuJMBzgs/BjaNuEnu5ru7wsTo0hrLqRjIu7Hpv48YVNV9sayyTw4JMOhJEiQro40wA3CDkSJ4RuUHFt4+BOqbI3g1BIIm2gEJYzxh8YjtDciDS4Vk58kfKjFU19uxBawa/VlecfrzxeLoUzVRljuuGLG6WH2tKRc2rbHmrmjFd5NVdPofOdJbECVVLrl8/VldXfDg9C1OksnrQg/37z7377q735q744siynKxY3RSDAR5UQDDEOwFr2M9zzhG5wW8zgZ9AEOQvyu+FcFuNkTAGnTwDCuAkOUCcwsf6nvryMui6+p1Hth3Z2Vjdz6egbVx3kseR3IDJtKv51cq8vMpXiwgBLrHPYbCfLQQCVdOXvLQkC7jWwZvtycqpvnkSxoDXzn02atS7gGDywrI9WZmS28F4EFVAp48zAasBC4UjcoN/HsB4cIE6PlBE6iCYc1P59aAAvCc2AEqdPp9YLxZx0sF0F247s3HXu0fqZeELMiEEbkt5v2N3uSe5AcUvAvlz8zS5q5pRBxh17ek+h75hXCGJFauwIph19GgdVsXKTn721cGD9QvPndu/f9suUIN36dtKWRGqgM+BkSCNhUhdwA652kjcoOJbwuBndhhqm73dUtGByI9DgMPJR/rnuzPnzyfS70F9ReE3bNy4cRdYKxm15L4qaGtjJ3TsdpYnHzLJ8ls0GkvlKqIDnNp/2tFu6H45hU4QAYS69CVLYFAAW3hh+8mvysoaz00+sn/hNrCEL44QJZAIiDy4QQyFIBo0IACrPmznXOYfj2Ci7M8C2AJ5oI7vfjXXj9EsAQDuign3OdrNYpwBzKfVO5B9GfjsjR9+uHHDTozcSIEfs19SA0kxvj+pQz0H5HeZXJL8uMqaEEAEjP9ie7uh99A4I/5MAakKA4Hi4hzwBwfTblbn1KfdrN9/BEKkXXMnEyWgeWGEh3DQY8ZqAGgBBsV6vtfv2u0ZwTF9im+rBBlqLZX5dMU2pt1hyAJ0DocHkyB5JouaPA5YB2DA/vAMhO7pkvRxEzzG919e3mueM2dWtwu7v3mVtDkYV1muWtVMCSg87Z7kQ4qENlI3wZE1s+ooLZTXHUvfk1N8EChAwrRt267JoAQyAZ3BJzjMeoO+f6ze3eAKGZ7Y8uI9AJj5D2NmPmPlQxaLlwDg5cW6DocjeQcdAEnshjb/2sLFZyCX34jhWjpN3uKCI1V2yjjF8l4eul8RMqH8q2T56So7UIJmF4yHXG2yp92Z9M03E86S1Iq4g0wsjUsF8xxQrLLGesybd4EnmE9iIRWrh3FA3x+rAgD1oeZK7nXlxDFPPjlz5l0BID+V6GRsmrwKXP0qL4F3hR2ieDq1kMzjYN+DzS/Grl90ZjEGq7SCQyy/gJQuMtrOTlAoFLuD5SB+g4uTuj/Xlte/zhAQvEqUgPMrklELbigULyekxAdWVZlSmLxnT051Ndha04Z3R6WTiWSV1qoTBFofpftKoDXk2roN4+WFHXcMYMuTyolP/uynai4AHzA/1NDQi9sYSTOIpTt2SOKj9Acgb537IU3YsmITe1LxMyVhwssgfbKz/HkU3+6C5FDqfln+mBI0SwhqL+ra+9oNs+DnXp6QsKaNzIwRFZAK53vKqqurwRKaNmxbtqcKFC1b0AmlYldSV1ISQ8q1tX57yKaxcUk//dnPfvbkROXMOwbwpHLmtPwGfy0H78SZnVjWKhWgud3uC2fPJqzBOSzS92eI9E2NtO/lKc2CgpTnEhImTJiguJis87S3t+vCu2vtLvR9za9S8ePkJyteAAEwIN7QZNodbtU5+to9uuRZiYmJExISnnsOB8b58twRRIjVy7B0um1/GfzWlLbSC243yxqNZHE+fEhB9Ohra9VdTG1vb8j2/yp/tOXOADypfLJ5ebJH9HjKncHydgdZ5GJU0TUeBWumw0eofq3pwCeL5s5dhH1PnB58RNCLNSkJ4xITT59OliKTVugWe6BiVUVFBSq+ZbDsQyhUVpAWKHIlJe1tlfKbK6cTE8eNG5fwHMkVSMNIa//CA0311cVZmVUFcVMGZH0Oy0KezPpKn302UWH5f26rA4rbyD/R1PCsUFoqfHT69EXoSOgD2i5fvn70WHp1dePCxVMhS5079ZPFC+uXVWOgW5CZ0Qaiz5jR1dV169atJMWN3kOHDnUv717e3zqw0RWugzXAZrPA96TXHZJaA7Te2iRoXV3hVmibe95vo/lCTvHxg1+dI7XkyefS0jZt2rT066+/PnHi6U+hkc+Kn3vC+6mp7wsT7D+93WpqxfCL4SaqTaLgLnV3vjxp0qSxk8aOHZs2D9rhw4frjx+vf21/0ydT59as+HDqgab9r2Hxurj4aDqYQAZoCV0bxvY33Ablg5HD4fF4nM6gmaSB4AjiRgHUfRNJi53lnnaHo0/eOiU18j74tlpagYFoOasOgoPq41hFPHJkMaSL0DZg2wbt3LlzN2+mvXn+zTffHOs+m5rKJnK3W0iqGDYFnJjMdYIlqS68/OvLzy0hrY42nLYB8T9csWIRdP5+6PwynM6pAxWAVjV78KImbRwLHwzWDgKBlAJeXUUGgjxLZQUYPoPSo/CEF9lFR9rQ5ZYFWUuuP1d89Gh6+uHjL+zcuXMUlpI3bDiA8wmj4N8vHK+uTn8OPiukVNcXvDTBaDzrZhOZN5T/MUIAE5VvS/K7Qf7YIt8MKfEr2/nJohVzPySqn0793uxYCShWrRzMAffMOQTSRI/OAGrAuWAwJKFwMxHf6fQ4SBN8rFZ7u2X2KmmlVQHJGquqQM7noFdIqyNuqGCAN6ha8FKCyggOci8//ELSoQA+mDkmmRkHP6NKefnXq/srfvgbUfwzi+aC6i98jbr9QeEeTgtl3G7lv5EVRJEgEHVOM4/1kFWQDTaT1QM6FJ9sKru98AM4DPhgmfFhV3a2vDZVlaGqemnsBCDAGlvNvxmOwBAAWyYqX1f3GFm31vjy2IS4iicWa8oWbvhw0YcHoO/L0ocTnyhBNp0lGR4CW0oYlIqgBWq5IsSD+KLg8Ig+9jZqH5O6/2H2cMVYInb8O2SDDpy4rEI7bA2+OAwBxRD5//F19WbQf60x8dcD5Ifeb4SYZ2pT/WuS9PP7I55COmUprWC5PQBcP1YaFd1EC/Q848q1uFB+oCJ6+iKRa+DxhgOgHc4jZMcvPKTiw292Q+T18oSXJ0wYN8AKgIDe8OJQT6gY4gBeZ1B+oyrx1y/1l/zfHD16/fqSmhrNF6NouCcv4aHfXjOWtoRvEV5GACMMEjDwXGUuh/IjkMizk6T2/mCK2gnSdyYMAtDfMqQF2ewNMqpC2yG/7rl3nu4n8PafBQAB8BvcXir/p6uzZQUoXC2P1+uL95BIjApfIJvdv9LvXmpTjay5o9QM9OqAV03kdzi01yZJv2T5kK02Ig0UbHlXVEMIDDQNlTAtz5KL21cU/eqy5J2nxwEBozucPEQHFIMCoJ+ZunwCyv/06uxYyWf2ehnA6oy4wmfM7hPoAXCaBNVIm5HqgNVsD+gl+SPtl6SNAKeHGIAijxyuVamIDFiGQiXPHgDgikY6iCv+XZasHpuC+7Pd/OvjB2XIikHyF9XCYOVG+TNik16qT2X5RxeQZexY3oqbBctYrxldUlKiGasaeTOWYryuM5jsBnSKDq02MktDd90sH7LdQriUS6LjysEKQP+Plx9YAShvZWX+gP16Cb+mBErVr//bzC23AzBT+bNVDe0OUdAmjn2poH/Sr0A6CbFEc7kwY+hMmGqshCdlyEqhmMOm/TWAwAUk4ORMTlHAM2WMvkl5ZOOVRTHECU6wrVq16tXmVRXsgFG1v8VtKZhmqcQtjJW9A97FCJ4xBU9piKpf//mA3VVxAP6rcmblcidkfeByft3WL38hKkAJdvErA2bAZfnXfPzKfwMH+N/+hz+7TWiwu1alkJSNYTyC4POBg0+UN2FFB7tAo6IXWu2N3ovauFGhP+KOY6CN5pFcKlA5wI7ghW4c2Fg328MMDIoV8dvhpuWZ8bS/CQ2Ks3GTvqAANSUEwGXVcAqQEQs7pB+KU4HsjIzbTZ1mnz1bWgoAINP0sSpthOgutEORIeZCswJtRBsbEansPl9fe3tfHx7CZKRstLNs0lYWoV9TtBiIwuiKG7EF317TG/GJUQzAzN8/OU2TZDAYIhMqudL4HV6/luSveYUsyxgUd2QUDtkVF0OQPWDeQNoPUJWFqcWaNWsgXfvoCqNGAFqIkKblkkS4MnHIGBgfBICviGB61dfnaC8vx9TKHJxT3u7TUgLsN7lFRS6Xq9mv7d+2kZh4JTk5+cqVK4k7wPX27ba/ETcYxgCMUb6hTmLMBt+EXFdPf8wNbTTo//r161vAyQ8CQAKPhI9JG52gGjuaPHpljfTxSaCS+TH8LAQRo5dgjfPY2FdKRuOAoZG/TJslkMRnh20VcXRS1w0IAqZBBDBt2jR0DgL8PVpuly5dwgH/0qVpkxJp/CRercCFiabmi3L3RzyTYim3RgHuxsPsTvzjzKEAXlT+2FlaGhYS8k3RAYsePiXyt+xbv4/27CBTLpQ9ZIHqY+lRzAbwTd6Ufv3TqozM1aOHq4NMYo0qY0RhAd2tKFrlH+IC2eUWYhu5t+AfibbK3Nzc2AGNZOcuGTsmkZMpTlvIEQZcUamkPJHk0TZ4Lf5v6Ui+ptIKXZ2eZ3+iHBaAoZQ1sgpTj6y7sgdYv290y76PS1arBgIggRfEANQ+nlbBaEA8RUlBf96GDrSmpoYMkZkEUA21p7iG39MKV1cVYVvVOsSLRi3N5FvNDhzlKulj2l59FYaHVfCgqJkEPlqFl5zfYDJJ9gJDS2VzRcWqiuZVuQpPBJ65cIGNip/3zxco+osAP9YBAGNPqjE+yAYJoPdf2Xdq376M7BiAbDr5j9nWWA2aR0sJjIFPI4D1JSVtMfdf+BwZP9bXvJKtaluvkWWXIbRAW99Sst6o0n5kQdN1uQLC0Cgol2h1EQoldDTjP1xyKyIWT7YwVbhVWt9yF9nNYApT+Z+dRuDBy1blz7qGUMAjsqLjtgDAuY5DALTvSY65vmTfvlMfr13bsoAqAGUTC76mg35Aa/kYHq/WoKm0lKyJDYCZ6zVESMCDrqQFvl9S8sqpU6deIV9W4o+u3VdylnYdtKKkIRYQ+aaC9GoRCnUllxzSxpn61cAlnVyEnuuKhZbGTcQCIhOuVtJDPVyrej1kcMGCFVsq3B6A1pjwW7LgrQBnfIqr53+qadm3Nu38prX7MqkCZGP/y1FNNvT6Kx+fOrV2PUbB1/G1a9eVJMQ2yn8Mz6zbt6/kObSPFoDTUvJ0SmyypOD8PsBwfi0AYJfTE4iKhlqA0GEiq/NdIlFxekaPS+906kgzmKSDhsB04dv0rBkOMbKTpN1NnKsimXS/qi0BY4LS1M+H8QEAIAoaoEqYXkD27uzJqW9qrMsEBTi1adP5pWvT5FRXSrqlcW/0+lPn4fstaPfTS0B+0JXL8srBTzX71q09db4Ffm2CpmUdtJVPx/n47FfWbYK29hWjakI+PYDLNfTIgdP59BgxFIpdbiIbpBgmEhscPSa6Y4jrVEUaTPjIrEZlSV0eomgYl1/azpDy29TbA/hcOUUUAMCaLFL5WLbwzCfHMwsTNPvOn9+09Oula5dIALIHxN4JmrWbli79+vwmsla4ZS28eNO+1XIaqgF458+fAqGz169cCyBPTh5Q3CtJ27R96ddrwQkqAmTrlylpaCVAYSerszkUKpqP8/RmM2eN85EBfAaec6tKvWp8ZGaiMHZ2mMjRS7zaFZZDq7bftlEAPxkeQCloQPaSOhC/vmnjh4tzIHQZ3XLqTRDwxNKlsgLQxdByG9vy9YkTX89bSzo9Y99aQLV07dPSC9d/tmnT1yc2nYKXf1pzctPS7dsnP/3bhMuXL5P6esJLH3+2fen2EyfWJajc+QxRXRyBhgyCjNkcBPlwcFaEJGHjXGWiPYjNrIaHAfIwqNYav+xmeArDFI25lZQ13wogI+N6etmypo2LpjZmZRYUXtasXXoC2ry1R+WN3NnxFtBWcv7Egnnz0k4Rx1+4lrz6/NfkdYUfr9x+Yt68E2ngAFQt67bP2759+83JK1esxHXAK+CvFV9snwff3/5KimocCgYETEMt4KNukB/k4+Bb2gZOErbfVWr9zJw5c4JzePAeSbVz5jjnzDEb3j9US34qGGRie7nBhRVMhxjtzwG40FZQUF2//8DcRYurcaql8OP1b55YAG3e2syM+CpMzAW24LffWfo1/eamtSDxgqXnyXc/rdl+YsE7qzehS7y88mmcVpi3/auvtmP7ivxNnkubDEmUopb0MtM1NJdS1AaDTpAPv1Xqhbh3TjDIx1kAGzCD1E4nnkYV4PGRM7j7BjyHLchYtf0xWUbVUQSQUpr6vw8DYLzy8dSzbVVlCw9sXLGxMQdrrDCKnz8x7x2UcEFGxqAyFImW9p3/9J0F77xzUvL7J9bOAx4nTuFr15RsOgHfm0fsYWzaO/MWHF5AIMxLm/cCNPg77YW07Wmfjc1Wubt57FczM9QCIod4lMmp7iHaTgSco3b3v6AHnyuH54yqKDwshzbHPKccX1ceDMdMJbO4ujhrD66sa2tLnaIcFsC/JyTUVS/8ZMWKT+rpSQ6Fb7ac+HQ1tqVZUs4TX4PLUF0uIXgWrJVivwXrUB9OnIJ/Zoxe+w60eU+jNrS1bAf5Dx/+Ku3c5MmTP6P/k7Zy5ViIoBIbgmRZNTPUAqLdVGbGTbSdCBaMt4AkeA6EDupVqhnc8yh/eTAIXzweeMDEShQZmcUHtx2pL87Kmp4KALYOA+CP/55wuL5pas3cA8uo/NCJS98h8n+6IDYEDKyErHsHAWyXLEB1dN08Yi9r0DuCZryzYNNzxBpaiPwH095JeOfpAS2BfELF7jkGp4Gq+WALaMD+dRKrZwMgGfzTrI+zgBBPhDaD4/eThx6nLmyGv8iz/pT+tCSzetvGDY1lOQnvT/m7Pw0F8Avlvx9eeOBDzaLFkvwZKASR//KJrMLhShuZ6zdB9y9ADymV3lrSEMC66+AA0lD+tE/J8x+fPPwC/Efc4XAl0m5+Dto5Yx06CB5iiAagi1Nttj9PzIEX4zQkFCQAwCrcgTkEQFA0MvjIA6rB9xr7CzOZOY27Fm1YWL/6f1P+3RAA/6j8L99pIvJX19FqnyqzZBNRgJdWLyhUDZwhgzebnVn46cql0ONp29dlyobWsnQeuMF1x9pKToI3PHyTDogZLWnzDoLZpxUMP9GR2EB8m5mJL4WQUwdVQrcZAMyZw5Situ8eYgGqGX6i9nN4rarHVE6VQVCJu+fQx061Ip5AVlnTokWLG1/7hfJ7gwD8UfmL7zR9Qvr/unySy9iV84j4q+ctWbMmZc1z2JYsuX75+vWXVh+btz0n45V1xKed3CTzyWhZu/3r7UvXzfu4ZenX27enraOG81zJpu1p89IOnlwz3HwZhDq1eCxGkFennn2ftB3YProyIVF7OhSkbLRE21Eb5pjDcT/eu5uMAWYcBJly6gLhtRd3g7KA/HOCXKzESDYu5zRunHtm4ajvxXRAIcv/w1EHpmrmHqhenSABKCg5uYAC+Hof5KyjB+XyafOX1JzcPu/rpZtajsUY7wPBl25aV9KyaemmTWkrr9Onr9ekLU0Dh3+yZWzCp59+Sq1fnkoxggUwJGTh/fkdlvhmS9Qq/MHY+Bglg+CcOepoXKIAUPBJdalKa+fnoD9Ed6iK3GAIGGBn7y+y4hROeuPUmqlNQOAfBwD4xQ+/s3hqTc3UxroJEgDVpyu3L1iw+tjq1e8sWLp00/m0tE0Q56+jraUkbXbh2JJNIOfJdS2yBWQXpq188/ymN9fVrDuZlnZSivvBNUA4Be380pMtkAnHN40mQav6CDMYel5m/3nUmBlyWmM3h2R4UqNJstOQKH6ssIZ4EhkxRlVpiOCZwxM+vgaexkxmPhAjADFcW8K8po01nzR953vQ6zEAf1R+DwxgrubDxWVViQlSwX/9ZAjUFiw4dhi/0hH8xFLS0iDjy1FllLSc2vTmyXU1p2IWoPq6BvF8BnnP5MlfnJKD58yS9WsxKYA8IS1t7dqTJyfji9bhKHjKaNQqAoNO0JaOTYTMcFwlTYRMJAz0S1s2ByUKgEgNGpIYMlMWJEjQJoZ4wg64Vii0UvalMqaeffmrxSvmHhj1nf/553EaAAoABoAKUDAjVZoNAwUHM54X374m8m+CBPbUbNVlyO/27VvXUnNMPv4rQ/WOpmUltC9WrmxZWRJTDNVSzUqSC64ljTD6rOUzeAkogNvXUeRymeTWf2qiq8KnguyXPMRMsDTfRIsdcRmzr9tEjtmE57S9NGmiqTAYwSxvTK8qKQHoEGPb+xMWNE3VECP4OxkAVYBF4AGO12WkdLYRFRhdM/nkyZugybj6Bk0a0jr4HwXYt6+mLkMFuT6IUFJTkhnLk1XXNZJul9RojsUqw6rMVzSaEgBTgl9Ig0c41VqSzQpXLFjWKIprtNbzaq1We6iCPG5GmS/mSpYRlwjpLLSM4CpV+fKlYpAcTFxTeOUj2V25SAAit+y2toSEY02fgLMf9UNqAzEAU1fAs4efK8i4MK4NFOAlTY38aVtoW4lFrJW0igdanyl7w1P9kyWFdf1O8uvCbDl2ACMYO/y6sLGqUnFSHnV5Uq0zt1JquVdUpTbpMcis/SZ3FWkBbf8xFQrbKrL6zA6exEIoupp7YsfNdJAqk8tktxdZJmhxzG1rG5eQ0AgAwAZ++L04E0AXuAKerb8MOcBZXKj7cfznJIMAtFgdc4kKtJ0Uy9eXHI6rlVetJM/Bs6fiC6jw95JPx76CtUOp7dv3yisff/xxgtZqUHwJ7Ru5fSk1hULBqq58qZg0CR6hF/MppDYrNu9WyN4gr1d8o1CpZk3D1WXd+f1zgpFkGznkE8/6XGWbBTqQgQCONS2eqvkQnMD3lD+PA4AmUDN14eElmRnZQCDzuSpoWXVZVeSB1KQN/lVZmYWq4jq617+sOrM/RswsxoVUOfhlwBQCXVgsHY6RU5yDS6rWTE9pc0fU4Wefx0aztznPS+1ZaCpVO/n72WsYIDmefbYPHl4j/5DeOdXT19dHn2PxIVlf1W8g15JtFvngOZvmZS0M7eMSju5s+mSFZiqYwC9iGvBzMAGIAmo0iw40HqvKzGhbM13eBpoRtxCHrsUh88IFqkKySYqs4c2Ii5EzaS0VXyMtJsf1bFUZ8TMNclUdZ/Ta7YxPnt3rb/3TQH92upGcTSm/Zpg1JNpnMRxOJu3ixVvujIKUhPT6xdDVHx5o+s4gHzAK40D4RuPRrMyCNVmZGd8yvR0/Ixa3ayYjuz/9ysJlfI0vpBdnFWTcZtWUz1wZKh/puqi431cgT7YV/tkXRga0jMyq60frUdUXfdI0Sg4EJA344Xdw5ScQ+GRhdU5dVV1V5rDL3Yaf8iXr1cgWKXoMFO6TeuGrI4tH7TxenJWZcZulczhrF3TZLJxzJEvDyBtIyai0R4HsSPjzH3PAB4YewZXdNQPkjwVCP/zOqMWffFijWTH1wE6yYb1q0FbIwsLCQQf+FcQ2iNGVu2Vl0ONfjXp31653z416IT0nJnv/oQ9xaZDR7SgPmio1eau4YDkgwLPWbrM0LLvfDgsy6Rr99LJl2MpyZAgDKGQPfEY6oimnGrLdFShhnPySEyQ6MKrpwNRFNZqaRWcWN1aXleXETrSKLQUim/8HbQ6rXlbfuLNp8bYzuL1z0Xu7NoDsuEOu3yyq1gxqbW1nUwUHZHAuPJs7r9IEQXx7n49NaaOtoKBgoILFfl+WtCmpcWHT4sUHDuBazTJptZ78I0Mn5HF9456yZY2Lz4B0c0H8hXHyy9kgIfCdUQtBC+YCg7kbNyzeWV9djUfZ7JFPd5lPP0PWnj10pXbjzp1HNuza+B4e+TB37nu7to1qrC7Gbf5DVwOAVCnQUqHheiAP5myMK186mdnmdTHAoLy9HdeSprrdqalnz45LuHw9Pf34Cy/sHDXqyLZtGza8++4uUK5du/CcDWQ9d8WKuR9uPLOtaWF9PS7WzopfsVjQv4lvT05Z/c7FZ97D12/8ZPFCEP+H/fLH6gHwxPd+CFqwcGHTAXwxOcHhPTzQo2nnzp2NctsJH2fbBvgUVGoi+Lvbmhrrq+lWkQx50lA6UTPFfeFCZ2dnT09r694ZXbjq29/b29AQ6u6InUstXcXZ0d0damho8Mda7a2LZKcAtnSsIr5Afjv8+g1nzkzd+CGu1F/04caNU88cWLx4YWPj8er04uLrS5YskboJx9vq+p1NG3a9Rz7oxjOLmxobR30Hxe+XP26FCDz3X74HerAgHX5s1OINuybDD67ANndQQ03ftWHbqFE7G+slyeUz8HA5nuDAMzN0TtzEZZbOW8EUz+Uixw9W9h9GHL9RgK7t8uItBX4/vaVBjcvHDWQOTNzx/riE59YsQcFQ+17bD0ZwYHHTwv31y5a9VkZaOnFD1VQ1aS+BnlCzhE8K3zmW/p3/5Rcw/P/jz4ddI/RHiuW7HyUsWYLxCvi0etLnO0c1HTlypKmJ6kI9Cg2N7loggZG0UhflLxWj1ta94XAXNOkyCHLmHDl5vcjFkR0tuG0Kt81RLcizyDtFUGaI5l0uclhpRUC6siapq2vv3r2bccdEwpoqul+kjOymXbiQHDixePFiXCh/5gw4IqmBJ96wbRt84sZl1egm6qZPT5gw7v+Ik3PYdYJ//Lu/+0flE9aP2lLW4L5FiGEk+99DdmmQLySWKz527Pp1/AM691xCwtlxZ8FqCwauSzIacX9NaeqzO65cSb44axbuAeptsDP0HCayc7gSCOThfikkg3MjjKvIn3Tr1kVoyVd0UdwI42Zjp9JSn1iVVXz8+PEXdn6FbZTcdja+8MJxXCiPq/dzYr1TRzuoak3bWatujPJ//Ls/futq8fHKJwyd4LX6nXDB4JYRf1RGdrbx9k3eL0AWOeHyHuF0kgkUm+6aaF6Vm6ex4GYJ3EFvDqpdSZsF8rrINd+12AIwYwp40QL6f0FmVaYclldVZcZOl8GDhmYPPF8jfjBpS03tAfnHj2i/wIvKZ/hOt1suKLcVDAgGSF00u20E0Ue2tJiTAMJFcaUC7oOI9HB4OrC0YyBPU4ny41KnIGPqxAVgLNmbxcYOI86Oob7dQJchL9qVlmwXSi+Jrdw1prp79E+McL+AcsuWX76uLnW7jXQS0Lh3M2k9PT3joHWOuwBCpbCqO29Gd6ko4HURXYzTiSfrcK5XbXmrqPzOIDeD3EWEpxAPE8kNPKK+cFAHtKXAE2fPXhjXKTX4sJ2bL8jG6Bait9kvMeyWmQ+ULyZ3YS/Q1XetYmlpqSCUYhNFMdpjhPcUVHfVUnp0DoGN7GWwvM0zXLMl71XcLwH/5DbjXbQe0TjMDETBoNhI0sc4tMZsVYo1Sj4jbu9z476MnhQiPm6ii97RniE8N4K7YQW53UatUTVOL0oA6JaXaClOMbtHmLfEyiXSpHKnAQhoZ/BOnRNUoCg3rxn3izjL1XtBfofOreoPY+LS8KqYvQ86clYqDrvhc3aK9PNR6YVSsYckHPDBRas/6X99cusdbJubqJz4z7t5vRWXTGgvdIliqRjXrODYBF1c/jJctlN1myWihRf0uAuxy+BxBs14jE4R7hfyBLu0rM+jTynEDWHkKB08SKWsONaIW5cGpao4CGR+DA+uNraKotT/+LVUsI7DZWKizqBX1/70xdudLaa43SnyL/7Hb37z+BTQAOgueixaVGpia6nWLegFiUDstGxpnejAnImqLlYT5NEkY5wBOqxUjVun1KZcm4soAOOO+ByG7NkwxEFqgSP7NtLwVDlsC2kIAtF5GdZT6igF8muNWp0VnGunHj4h+aCl5I8jDGqhnfL447/5zf/1H8rbHieiuO05+tgew82o2s1hURffDHvBq1jVEVaaLJuduWfQzqEhITk5L7OK/MmcPc6JpwqjCqg5cpKU02Nu1fp8hufSR707+QsIP2sGNRqNvkcC0CYIe6X4k8ZfrI+JCm7jDIPOCiEj6SLoLVG3V8VqjdLA9/utd7x7fOvbn3/++Z9SWdxowejoEU30wD6DgelkRY8pykr+KrNsVNn8zNtKT3f/0/ipuBgzLKvo1l7gPU4DHqZm4oNOjxoUQDfu+KhPMM95D9rk976AL5M/+0JqK1Zguf0LGpa/hwnIkcbj5EgddyRc6xHZTg4/nNRFUSARHgcAUsdvBTE+n3iXByj8Qfm428i6VTN4lJ+c00JP1EsSdB7GD99BBcjc07hy1EAdkGWvksqAKDfE1V8d2fbuu5M/WzlWB/l/GNygDAAPFXW05qQ3NjUd2XbkyLnJ70I7h/s/4R/QjtzEhQWTP/ts8rlz287hcTL4gne3jTpYvYQVQ+BRhSQ1PUhHRzoLGpOiZY1TvvVYwW85RWY8BCSCtrMW3trQfz4Db7J6nGZvq8+NGjA7M6c+PeaV4o/SwQJpMdnnffAInvyxAifDsMp8Gmyg1QzvwQAAiAHMnVpWl5BTfbwRYns8IuMIRLkHoTU2kr++GnXzq7SbaSfP3Tx58uTNmwv3N+7fD3lK42uHD7/vS+o2GzxXyFFf5CAdHR6rp9ODVzWyjyvfusdjdFJBBYRIbexwBmn2ReExmP3dgkAWFWdmkuOt4qSvokqPHV/fOOoIGPaKGinzqwFd/mysCE6LpwA40ACzOyLo0P99RTJvjOmPJbz88ssJCceqjx8+fvjg9ptpadsPHjx+/PBrB9OAyOHXXjuOm3ZzEkS9zQ9eREEWxcknqxqsHqZT6zPGLwi8KwBvgQ2wrCPSysWkp4sWQ8lzwIEl+UpjZ+LLvZ4pH/SAZ8M2jtqGwstpL7qzlZ99djJtqdXHunknBQAaoDeyjtTMnGKUnLSjL/9zBybJ+fYZl4uPpc9birPNaQsOH8ZjZ3Ny0o+SDcvwe6KebgtEkrO8JHuWz/syWPVJWhYt4C3lPWrAYxCVCz6fnR6nGrvwz34IPHjAohPb5OUS8Q4vB883aFx4ZMPGuTWafunBu68EI163dunSCQ50AhIAg6FVy3racEc8aenplxU2ejXDVVul6f26Y+8crTs6b+mJY0ePFUNKevTYsaN1dTgxkfm+Jymv2cTxywMmkk/KAAwQVwqse/w9A9iqnAIqIERumczyvaf0tjuLQm0qsh1yiPGGL0sPXd+0bdcXNbLkaPY1Gviv5eTNyetOpm1/LcGDA6HBTM4UDQZhEBTJj+NYUVeXQK9m0Ngs3t7efNeOJdevH33nnWO4XOXY0aMgvbxz8azOcDW3yMUpcl12E9NPwGC2Q78Zp9z7YWp/AhtAFXDYY4eTkKt0Q/nT1CZXRV6r4I4BkA6FRuk3vCd1fc1KXBeJ4mtKWk6OGnXy5ORRB+sPp6/WgRcMygDMPVqhdDZ5A5Ct7re1tg6LdJNngNvtdT1bNR0LXUePph9d/dI7x2LyF+jKFXl48sBVvO+UqIB0vmrtjIiDdT+ufOzej9N7LJV4gVt26cJPvPEOb/uzfcMVuXI7HEKbNOjRGnH9QpB+BfV2X6xYueuLz0pGr8edAZNPHtx/5ObNxvqD1dXbl74ThfjKLMcBfKfW4c6QLWjNRdtyb//VDIy6iEmtml4lhVJY9JNr1Z06Pq+yyGVabpEA0GXT4bA6BH1mdI+/D+cJUhVw+Bxk6TVHbvxDBci3aGpNLpcF/KAsfnHZMuj7jVT6mi8glFmJKyFKStbvO7l9e/2y+lE3ST1t3vml6XVRQdsDkmMkCH+VakUCgAT5qaHlfulqBovXzjG8ukiXISdD8Vvlz1oNVy1FRa6GvFxvIOAnBPAg67DZr4iIrHvKSM4W/vYjNdENsuK1WyHsfnLhXwO97PASYzK5LK1CKhUfOn/xLkn6FZN3TV7ZcnP/zXUrR5fsW7v9YPWyg43bv4JQvv7g0qXp4L92CNpxEgB1kL8QQW8qZXqt3t1AGKc1LbkhkitzDEvnI2jesWYNPbvRWt6bh4srLtlyvV5y5znWFHFRRLfoE1EB7geAP4EbdLOi4Ggwofur9Tc0NNC77jSHwB8E8kXht1k5eOrhBvR6ONJ9MXnbkc8+g3AlbbRmPUh/sL764MntpJha/Vo6Hp9elzVOhEAgyJsoAHdEjIWPKZyd5+whvK4+Fy2ANzjDnCDNuca3aDmfVwHyd+NuYQqAU5NV9yFQAME95X6cKCl7AUG8luxlGNL9oYZuC+kgzW6GY0J+Vjha3biYGP7cye+tWHlu1KjJ687V149aO3r90qVrt29/DSKXtLKy6rK0pa+cTy8uw+JqAgBQYzaIyRAPhGVXWuA2MXo15wpUeCu9eDWFXufRcaIqI7NqYLpRaiAjgMtOb/wM2e0mclE3DFPdDkFkR6YAIzEB6gUcfQ120IAG0P/ubnrfn+USDoveGZH3z0HnQ89veHdlyWdHFt68mTZq2bJlS9eP/nj0+rWbth8+XIZHLhQv2Df64wXVxTl7jh5LBwAXYgDCbp9YKE2uZ+DNBGFc10Ku8aWnKzA6FZkY7FcBVYrVeciGBpCHK0wAAF45w5FLl7yzfB5QgJ+P6Hz1kZwuTwYC0afLNwGAUHc+bTi98Q1EB4y3JzIB9f7dbZPXrzuysB7M/OCytLUtGs3o0acOk+k1PCe3+JRm9IJj8Pjo2LGfAoBIHACjTyiUz6IVOD3WMMgtLtCfejxdQu0khaLp/XvWjVbPbuIArpI7b8m1gyF6XX1geTtkhzAG/uk+AYCBAI3AcU3hNQGAkAwg3+u13Ajy5t0NIjth17Zt51rWpY1qXLbs4Nq0srRXPh49+sThef01+pzzH584hsfFHh39r2OXZD0XlQG4AACEAbEyipvRizqrnoy6ap7I71B75DLhdKm8FvXobRUuEzoAeu+iNxCiV/6aLMkOJyjAn0Z2wP6IbpgAFSBDYXeAakBIavaAJSloNtf6Bd/T22627Lt5cFlZNbj5srIFX4++NPrrYzl0QUxO1p6sE6fgQVbm0SVjx760esn8NVbWLWsAv1cruAupF4S+VbeKYlRnpSEdyi/o6MH0cXMRUZ2zwwvy28EB4qQafCYvvXjLlf9NebmHLR2hAowIwFbiBXyOa9ZcvO8WW4PdTq55CuSbDfqgv5YVnj63vREn5rYvrc7JWTr60qWxX6cXF68++lIOPV322NGs1cU5q/8V5F8yHXxdDwVgoQAcAKBgzRrcsaYydJECHM3rUX5HKzmYPG7HaqmuvLsD580gVILezydXvoVCXvhcFTb++aAgTNk6wltGRqQBdCh0OHw38jEKamiw+/F6abS4QDckn0F/V0RYjXeCHE47DNZ+4utJY58+nL5nAeoAmVDPWvCvY1+CMP7TT1+6PH1JFQXQxTMuAqAV4qDCjOlSjc/BRB14qApp+MihnqPtLy2j/Nb2BhuOelctFV7awDBDxBHYeueYPULpeOXW+wjgLWoEos9xKOSnhgbC1+JFf5y9ATd72PdGSldXH64+XAbD/OEFC0afAMGPLTiGfT8fVxacHz32Uwj0M6+vvjwdb8wo2OxjYwA2YyAoz8WpjPq99Mwp+XYGvdoh79bKJv1v8NRacNnoclvAjhf+gUp68xFBqMJ2lefNvtIpI75lZWTX7GBdwG2EwVWXT+fuOWl5L3iqwA0PpHX2VtABLNiCzR87MQ/kx9ui5tOFQ1lHT4z99PoSiBgvv5QwnZ452CMAADUBoAYAcRfRqQS91VEq0jl2nEDhnFrpJA7a/yC/DeU/ZCN3HsIACLkJ+CYwBUueSc14hNTxW7beVwDKD1AFjA5H5GKAwyvAd0thN8adDQpCwBoRLqO/qyteMG9BDh4pTY7bnT8/MwsHviV1mDGAAUzPJJcEQDIAAKgP6AEAhfKp7LgmkG+VDp7jMVqkl9jihl0qf/tulF/dmxdAOwSFBMcE4SmqgSbEcAaH+Kv7e80O8YPjSUrgu1brpz0flpo+LBFoaI2ICXuysoqPpR89mjV/yVF5jdH8rCWXcd1G5uzMhJcy5XJ+j6DdSwHwfGfEk10YN9mj9ajx/g0G94X7i4gBxA6N6dSD/H4iv4urlZeTgGcCQ/Da8hmT2hP98R1cNjbS2+beQj9o9DlYwY8btMPy1VZ42jbfcIsQ2Ms6EtAE0PAXvHR0vlwleek6TeCrgANZPYUBT6eobZUAqDsjIt2MQ6/RwXW+ZkwH8FidUOwSY+IAo/ry3TY7yF+bhxet0dAHM1TQgUBuh1rNOcXEMSM2gDu4bxAJsEZBiIh+esAw3umhb6W1QiDgdJobwqyQQNYl1NWtXoLLpfBkZFxZS8x++pI1oP8gI1nhOAwArCjKc56sE/IsSIcZTyROfKPV7Lwhy0+LE5ikQ5YGdtDgtamDjEGMjnkAt82hETyG08UOIWLlpMobOTGUnGZMCQR7b/mE9+uyspYskY+Sp/cDwZ/pS5a8BACqZsemCAGAmqcASlmRVJcPfjU/MzbLyDqceoMnoo3Jb8xmw/ycXuh5lN+P5ZlayRdzxAwsSeW82SHe2c2zI79zlI4ErIONhBnDgFtd4F9miUCt4NuxJmsJNf+sKrwiixrCkk8TLk+Pu0WzMCWq3SwDgFyIAMjJmR0/zxq39JcssyhV8+ZvbKD5TG+en1QnGems51qwAiZ0o91pdpRO+f3bWx4IABIOsegGImG1dI67lVzsAwQMevCEMGTd6BVZMUFeNEbvi0QUSxIur6Heb7Z0f2iKTtvDxwCU0oO6B8/7x68sNfZAtn81rwgypIY8eu2jtD+eXoFp9/d5gg4h9fM7u3b2Tu4d3gpjodEoOLRsWO59HSWADHoVHp3Bubuh1Se+HzeZL52/Dd5vjTR1RCbOAUCkkwDgAIAgxG1JzBhO/Gxjq4mx5+Xh8aPdeRwRXU2uPZNO/PbbHQ6DA0PAPykfGABwA0Z0A1oWsvTYTKSkBPraBisQSA4lORw9Z/tVIHaDbOb0uIpGYbY10qmmALpYwS0BKBxe/myVu4vjujWa3FVFro6rtOvxrgs9IKA3zgYEnw7GqJEUgu8aAHEDQEAUtELYKs3CygQge6s9pPcYYDCw6/p0O6SALzZbNmgBbWG2jgLoQAAOCqCwMKNw6IXj2P09jJrrIEfxV9g6OFL8jd14AgMSry6KRnTiyArh9wBAIgDxkLY0jPJDiyEAHVA33MLFT73ernaP4X25hLtmTebQ5QOF2VEWnBpnyef4MCu6pbulC4coAI5+pV0M78/T4A22lrx8Ir88BURvfuGLeiKiB+vAbykfKADlH5RPEQKstlRP5I/G7ABnj/mGG6AC5t35Ib3T3Hq2QJZ/gOiSn4tCPsxzubkAICLGtrkP2luB2m9sZXh1t8ZWmQvia0Im+YpVQ0x+s2szlX/8VuUDBgCEnzIOIKDr9wS4Nrj2ULIBgtiQpcEc5FvBFayZjmduD1xpSHYPRH0EAHQoADCqhj2LEMWPwuBXm6fJr6iozNXAIIB1IrN8vSSJxgwgv0PHsqkjzoHvAQD8CiCgHUAgGgMABNTdClwGGrDY/LyZ17/f1r+qtHDAxomoIAPYGxFvd4qusbNLbVYv19gCRYGKXI2F3MaC8uONIgYaihhMeyMODzuiqdD7AECpfCwFCEA4oBX0HpHaAUVAF1HwvctvqBmTqzKPIGhNTRl+dO/EfJgAaB0WAIpfGlabzQ15ed6igCtgywu56OyPWe5+gyy/jjXenfx3AeAtSgB1QDCg/PJYIHlCs5npXu7nXEUVlryrtWaDvrWzDQw/e/COmFIHRLYAgFFbI55hF5Z2hnnwqHkaC561n5/X4TKZ/NIkOJGfHN9vcLUS+dnHwUH9RQDIOiB4WK0brECHK7Li3AAuI/B3dLvwzmWLraPW6XG29lwYuvr1gogALACgZzgNcPeEzc45u6/mWbx4RqgtL2Ay1WLZX1IA2v8GM7X/u5b/rgD8QfkYLgR3e3xa1mCVblaNHwsgKQ1ZOkBri4pCufm1eo/Hao26BzFwixFJA6KsOKTzW8OGckNthy23ubnCW2nL63aRtJcaAEnAyIo1c9E9yn93GiARYJGAFfJPMTqAALlk09Rty7fjyW/2/NzQLYPHo7NGLxjjzCBFjOyVAPgGAEjp7GmF1+t7LRYv7qIGU8oH8eVLxs3SdTqobupAzz3Kf3cAYn7AI2iNQECn69cByQggVbN3X+024efmGvLzG25ZkYE1WiprglGMtFIApb7S2KJnEL5V5/EYavMtubhjxFWUb+twmajwWIIzmw0GaSlUsDaku+aB8e8e5L9LAPEEtFG9bgABaTURbmUPdXTXklQNGYSS9FjjhESypxMgZEcjVhkArj0nsutxKlTvl6Q3mQIdtuUmWoOjix/M0hog1LOGQ54+3T3Kf7cAZAJGEYbDKD9wJa20WYpUKho6OnoZurLK7s3N776RlARePIoAdBGrmkEAgoMAIHHErRvdHZb8ANk1BfyuHpJyfp6Xwl8DDYHwxt5D7e0GkN99L/LfNQAkgBGRFkJQSAwMnkEEyNloRHJ/d0d3L1leYjLhwoe8vDwFKXRE2R4A4OUAAK461orTLuGaCK8kPVhQR4PU82qMqeLE12MxTfG8Jxi9V/nvHgD6QoyKYTgEVxg294tPN8zJy+pI33d3LG/wk9NRXIFKm6LdSAFE1RwCcCMArdGXfDUX032c8vLjT8iLfszy2je6BpLEmwFL0vNOs0jiv3uR/54AKJWUgM4RYVvVBumQSxqjUATUEnCqGxh0LA/ZITiwJHnoSnvR16nm8gEAi6mAFhyKvqOyuchl717esfxQbZz0VHLy1hj6GMyMt4OfYzYLrDv17uK/+wVA+X0yHOpEXyTK8NjzeM92rBEEsY2ToP94xZDCE6UAwPlTE5AAGEVPMuS7Vzu6Yyu+cMiTfT5dCU3k53IVeGogyD/l83uU/14BSAREjy8iJDHBYFD6rM4YArpLkKH6bw/kHvKIIt0tLwgUQBfrIOdmaR06j8ISsNPdklLvy7LrpAoUDH7qUEfy83PMOp8b8v97lf9eAfyBDgbaUqfHx+410SM9KQKnRCAsDwgQydvtXoWvVGBJudctCGrG6+XCGAhiBVgQHVe8rn75ifjW/tobyTfNXL7C+XwQzF8A96fcony4AJAAcQRug7PvWtTkIh1nJhar60cgmQHn93tPs4JgpAAcbgJAH5EA+ESHh6g/ifgk+a1xtUcQH7p/1vPlqP5C6j26v/sDIM4RBMv72nd76SZQVAEcEEhYFOZjW6i5wA4AQAv+RgcLAEJMq08CAN8Re6n8/f0fP7qa+doOxZxy7H63MGX8Hdf/HhCArWAGuM1V5M3lzyd342EAkg5YpfwwTJUALcGPV1gNBuCIARBqOeL9wkT8gfGVM8jlL08un8Oj90P1f0v51wGAmAG5S0zP8EG+weJFX0BUAAFYDfKd9TihzpWyblZLzn7ROtguAMBZMRKWAPhq1XTeUT+g84n68yHsfjOv892H0e++AsDP8jgh4GTAAphDlgo8CxgJEB0g9+EaKAQAwBIAQMDBhhFATwyAj/UlyRFfv+17SPeb/cT58VbS/Z/fL/nvDwBEMH4KfDBfO+8CC+B78+1qc9DplMpE0pCIDJjOfgAiAcBE+zWAFbow0sOfseriVMBp5kIKXbvHbAAFcoP130X188ECIEqQivflgBJw5uedioBJHZSsQGaAX9UDALSiBog4LRIDoKMzjvHq7zRw9iTxmsOpx9DX/fjM++H97zcAsohkCgzteCs5x5c/69hrcjF4Wq7BKs8fklvRe+IA+BAAAwklPQdKEFgy3zKgeaD3TTOEiENnIOLf1+6/rwBQCQgCwaEz84b2a77oDBPHY0Qk2TP+pW/tByDIAIwxAJ36QdIb1KakzWzE59GJrJEl4r+lVP51AsDhQPk4IMBFlTq9wXEt4t6cRNa7x8kURm8pA+hhQgFGaO8H0GMQY1V2j8fJc9yM0khE0OkEFD8Vx74tyr9eAMqtW4kWuHFEEK1OyJG0FxKTuHgG4VKWhMIYCkoAHEQjtEZQnrCO7NIG4T0GnuFm9LDaiOAR8SYqNvXxP91f7X8AAKh+woBAzsqAjvM4Ilqte/MMYKB3enBA08OwL12ryPqiAEAt0EBQxToEMewh6wOdZjWTtLcT3sMnekQ3nqsx5fGt91v7HwgASQseT2VZvM9EgM+Px6IYOzfP6FLzevAIYQeNhUHiPgLAJwMQHVgRxHJP0oyeC1qUXidC4gCRNtr+gxD/QQAABPhJH3+KniIDDEAPfAjhwrjWri41p3dQtw+xsAgAuuRIGIZQju/q2rt5HMbKEYFKD+KnfP+Bif9gAEif9rHvP0VSZS0engLCIAR4fKFV76HpkNFRygTsYQBAXIDDqe7EQztI14tRIr0WpH/sc3i/ByT+AwMgfeTHHnuKVE5VBAI0PEQmEjW3EwBahwAA9BAIkmQ4GBbwoCEHyI5eD2tET33/sQ8eXOc/WACxz00UgZSAtCxQgCHOE2aoDSCAQLiPAtAz6CSjpTDgkQJRCkhPxtatSuXfKAApNFAqtzwGFJ5K0dKrqCGc63Rr8YgeAQG09hEaxh48uoiASnkKZKe7Ph+w9H8BAHEK/BhgAA5ym5ICGpAUCFjBJfY/+30QfXycESn/EwCgXTk0f/m+1uHrIgBShlcc5X8mAEM4/EE5Xiv4woEiAPDUzP6n3/rLfqC/NID49nmK0AcAdA7j9/+CPf5XBED5FACoQACPP5IA/qB8iu1rJQDGK7c+ggDeUn6f7bNWuDx9KRMfoho+PABbleMpAMdTykcSAHpBh44C+MMjCeAt5VM+ANAufF/51iMJ4A/K7/s8FaZ24bGH6AMfrgZ839dOATyaPmCr8jGfI8A9m6p8RAEolT9J7QvU9k15mC7goQLYqpzSF2D6HmYc+HAB/EH5eJ99t++h+sCHCuAt5fg+/61r//bo+gDlv12rvThFueWRBQBOgAlPeagW8LABPB7WP/4IA3hL+bje+tgjrQF/0CcqH257uE5wpjL5dfjy6AIYo3zmCeWTjzCAt5VPjFFOfIQBKJXjP3+kfcBfQfv/ATzqAP4/7K7kc6ipUJ0AAAAASUVORK5CYII="
ICONS = {
    "link": "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",
    "build": "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",
    "corvette": "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",
    "send": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFI0lEQVR42u2bTWhcVRTHf+fe92YmzVdb2uJWUBddCaGVCmnSgqCCy0kXRdqEmmIFRRA/QH0dt3WhrppGE5XYxcxC3CnSJJN24yIuChbUQnGrKCZtmmTmvXtcvEmb1CSdfPRN2rwDbzPzePf+f/ecc8+58wZSSy211FJLLXHTIDCaL1oN1Gi+aLeXeALz/89Utof4rsAD0M7Bg3pk5FvtHrmk3V8di78b85KejyQrfsyT8pFQD58/hG0bxfg5NALjQ2X6DZno/Uw7BnyZPF195ADcFT9wANvyPaq70WoVVQNW8bIe0Wy/lHsHF+59ZADcI/4HYBdRxSFSywWqYBSbM0S3E4VgGiN+fpF4ABFwQjQXYXdc0K7hV6R8JEwiJ5jGiDfLjCsCziQNwWwN8Y2DYLaOeDS+koVgGiDeLb/4RuKkrIl6gklcvMmYeyAoYsC5qRiE1XhXSAaCSVB8lUy7IZr7BLiEbQLVCFWHzYHoBOqOY3MCxiUFwSQiXjXEb/WpTH8hE31vopglJYgqIG0y0XeRysyr2JxNCoJJRHymzSO8OSjlE6fipke9ONaXPMlpoEYu954nut1fF4SOAb+hADRftHWLHz/Zrx0DviCKLJ8IpSBOn/80K+XewbogTJ6ubrSVXjcADdRIqSfSw4PPYdvuLz5ftLQ8pfd98DOvV7VjwL8PBIdtuqCdQ29JqSfSQE2iABQVCqh2DT+GyVysiY9WFV/KO7q7XV0NyuTpahxaK0IQovmITPM57fz6qBTErdcT1kcuXzKCKPA0NreHcDZErF1NfO3++ru0WqK7B8LiLdIhXoSNXgDgz72SHIDSL7EYE93AVUKMteCq8VbXumHxK0PImponVFEUEYtyFYB9f2liAISC03zRytipX3HV9/CaBK/Fx2/zqc4UZfxkvwZqNiJ+CYQ7OeHW23hNFq/FJ9OeoTJVZF/zRQ0CI6WeaD3PX/deGiefwEih72PtHPqZTPthqjPXpXxiRAkMBXSj4pfkhHzRSqnnnHYOTcZjTV+Xcu9IrYlY97nGhooJKRScEhi53DcKjC72EChs7slNqSdabizuNhDJA1gcDnESGkfKhQd2ivMgxvI2a3USO8Tc5LEM29xSACmAFEAKIAWQAkgBpABSACmARpuq20YAFp0TCAZXBZEn9dnPW6UgLsn3hRoEQD0QF18o6iKQPZiK92h7wLVSbWXdeYw1GOuDGLI7LTDMlTP/ar5oN+skqb4zhqTXnsAIBaedw6/hZd5FdQeiI7jwHcon5+NJJQegMQFQi3HtGNihXcM7H45J54tW80WrqGzKtejHTe0KPCUwm/LcO/PcRO9+WN/irGfeXn2JQlSPfnOQcLYZ37/K/IyDdmBqC8mtzcfknsDLtDD63YQgkaKyWk6R1emdFfbjsffxIWzuOBpBVJ1CcCiCoFtoueP5iNmFzYGr/AQck7GX/9DgQyOFglsbgLxaKUmkXcMfkN39EXP/hCAGY7d2+ayRohqS3elTmfoRbrxI91knBXFrC4H9d1b3JcLZMI4EDBpu8S1KBMGjMh2h0om/p10K8vdKobAygGsL3iFXsdkDhLfnUfRhSH1AhJfLEs7+Ttgyo6oisnweWBlAiVpN/uX7VG8eIrtrPxo2onZaa1MFYjyiyjRwRsq9c9rTbIFozZXggttox0A77a29uLAd50C26LYoojhRrO+o3irKlf7fFirPbVcDLJTdm9ILKCp0jT9c/+spj7sNrXxqqaWW2naw/wCvF590MSAFFAAAAABJRU5ErkJggg==",
    "info": "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",
    "base": "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",
    "traveller": "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",
    "pose": "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",
    "bone": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFjklEQVR42u2aTWwUZRjHf887M0votk0hQQ8aD3rDk4BEMLTdIFSTepBkK/GmUQk3D0aO2z148uCBRCOCJiYm2r0QP0KhSrvhQ0ngYkLjwRAxGk39ALqWdndm3sfD7tYWut2PFjoD+2w22WQym/n/3+f7P9C2trWtbfexSSyeUlXSOczUpv+fNz+BJSv2nj+h9Ig6ta5lVA2o3LsekFFDVuzO49q1roOUGp4AULjqwNjpZ+S3qocgovcUAWlVJycS9p3SV43HsBgeMl4lIkKwPgUNOVa4wluXDojfKgkSzYNXkxWxvSf0vUQ3B4NZsAEhShWgiMHxusCf4VzCMjC2l5uVK02RYKIY81kR2zuqryS6OVgqEKiPFXBEcCtfB4uWruMnuni6GHKYYSTTwoFGywO0nND6Jkgyx1VJ0KMlQGoflCqBl8QNZ3lq014uTk0g+ZQEsfSAdA6DiMocu50ONtgSuhz4eXNQVfblRMJ8SoJmqoMbJQLm67yw1XhIOeHXdWEnnAVx2Z86pT9aj7GsyK+NVgcTxSSIbSI0BVEfQXnErOcjo0z2j+m7Wz9QDxGthlW8CICfNWwiRwlogPr/ElifLjfJG52PMr7npCYX5pbIE5DvJwRQy9fBLEVxkAWlr64niOA2Wx2i5QEimh5RJz8of2jI+143RoXm+n1BxOAVrxF4nby8awfbsiK2VksduRDIpbGZjJq/ChzybzDuJDBAa0OPQUXZvyjBRj4HiOhXz+NMDkkpLPK2OIQtNvmiFhFhC0B//9IkRo6AvnF1L20Tf9eXut1L8pkt4YiuoGGrc68bNfD5lAS9X+iTTgejCBusj4ppiQAVg1XhKsAkEQ+BReCTnETYEM5hbwWvEKo2kBMsiMEY5fNyconwLLAMeHNL32/dJEYDCIuEIiyZ2dUSuJ244QwXigVSA5cpZrMo3N4VmhiBDxI9mHCWI2GJiXUbcSreECiE87+1DN4G/B2GvPT9kMwyDEuBX3MCmgTvBtMczQ/IgXXCYDDDUbcDx+vCdTtw3PU4XiduohtXS5wLrrPz7KBcIVPeLURuHG4B/IcTA/J69T6A3WO6I4R9qmwxBlX4RYTj0z9xorIlMsjyi1OJE/j0iDq59IIEuNykV9knRm4hsmLwC0CnR9SZ2oRUm5zJXBlPbghbK+bXlIDVBL9aZu5n8HeNgKiCvysERBn8HScg6uDvKAFxAN98FWhQpY0L+KYISI+okxuScOmeQ01WysNGnMA3TkCDKu3Wi+pd2iZ+XMA3RECjKu3UNQ5NDklp16hud73yMiPq4OsS0LBK2w2lG0xgeMfAp+LSEwfwyxJQjfneUX0l0cWxUoFAFHObVlfWXqyTwEFBLSy1xooi+NoEtKDSAnZ+ASnxAF+zD2hRpTVI5RMT8DUJaEWlXdqRsNVNThTBQ721uG19XFYI3SSOP82R/IAcSKs6OaIFvpFWuDmVdjEDogGK4bE9JzW5uUUvWhMC8itRaefrIyYsYhPd7C5aDmeHIRPBl7JMjadfrNJ2YlQJmv1zEZziPwResr5KG7kQqKq0DxZ405/mu8RGPNXy7r1Zb2hEpY1eDhDR7DC6+TK63vJsOMNRN1new4uHNExBgyptNKuAiGZVQWQaeC31rX5sLS8AL4rLwxrc3vQslxSjmATdBgJ5/kWjcZHzwPm+E/qD28UnfoFQoF5MN6TSRpeAKgmVRQeAneObYIaiOHiE6LJe0KBKG9U+YHF5TEnwwJ/omefkd7X1q0NVpfVvcGGuwOlMRk1ZtIiOtdDgqGSGkcnHkaluzng97ChdI6xEuVQnRAA3WVZpg5tsPzsoV6rjdWw9oF51WIlKGx8PWDgyV3LDaqi08TRVqfcqKhk1UYawKiVpNVTatrWtbW1r2xrYfw1+QaIvJVPOAAAAAElFTkSuQmCC",
    "tool": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEIUlEQVR42u2azWucVRTGf+fed2Yc0mnMQkEUC4IUCy5E0IUfmUKtojthstdlcePCpcT5D9z6D7jILESwYkQxQ221VfGj0IWpogtBqtI2Teh8vO99XCRT+5X3TSaRvpneH8xqmI/z3HPOc86dgUgkEolEIpFIJBKJRCKRSCQSuYuw3Gcl2zuRmO7uo5yXG+fALO/0j3zG/l4f56dQtkYps8FPoX0Jdvw5uwjQWpDvzFk2vgCSYabZD3Sv6nzvPNNKC4vljiEhX8WAxdXLvPHNq/bP7BdKuoct3ZEAz36kGZ/wu6vSKLMA698Z/BSEHsvq8drSK3aytSDfaRGKekO+AJ7z5plRhkouARKZv4cEkYaMt7pH7d2tlERRBvxinhmlCKP0jiARzHCVBqRXWVhb4VhRSbiJ8nTDITRYIfV15vZN81XzuJ7J6wcTJcBGTpsZyXCFFONR6nw+u6i3X1jUFPNycKNVTp4A18WWDciSOjUcT18RtVHDvJ5kEiNXIB01xOEV3hw1RJDRvtEVJisDhCTSyjQJYlk9mt2j9m5rQX59SrzVEicmA0YOUG2Q3OwAnZwmmBS9KSIIhPJt0Gx72SQRdjN+X8Mj0uHaTTNAwUS4qQBpgtWgkdRxW5kEs/6tDSb3g+u7VH4CSyAM+Vkpr3df/G8K7FjxTpBstlbWaqyox5Fhn4RNNFwfmZDBFOJ98zSUFQxNQlYhpH2OIZZdwAW3g2xIwc9gaz2+PfOyrRSl/PbuA7bI85/qMe/5MQzxuY1VyKqYhvzRfcke2v2NWK5tti0xc3tAa0G+aBsFsj/FA5ZQ0YBgOZLKCEkVnw45zbxcq0XCObLdCL7TImw3+EIBivbq1oLozFk2+4kOmAOsoAsImQcT39G2cKGp0N3G7v6/TEs7efGF+zZKSBywZD3Aos8LA0Lm+Brg/r+449dYOxJgFIDgYWXrc3je6TuPy3qsuj4/jdJ2TwtwqHXtBB9RKHQrWRUklmlwSRtr954WAODJ91QxqBOgYFgKvgIOTnQPW9pcwlMCxhdAsrZZqD/IPsHBMATLt1VTgAAnylL/u5IBPuALu//GqJz1GJhx7qbyuaOMvQy1OrgOZKHGoUqV6bS3voxslv6uisv6/Pb3FX6VZDaGZ5cyA2RY0X2hRHA1QJw6N2eDuRKt4WN/kdEM4ANPWHK7u5ZbSgBn/ABwYak8F6w7P4mMGfOFAvjsKqk5vgRoNgl7XoBrQXgeD2nOECTkKlg24NJaxjJAGzQxGSBoSGRApts9jKFVyQzOnjnN6rzkyvRL7nguINk7oMVTqttlDvoa3gL+dnIqw1f3Q3+Vk7QtLDWVQHlKYGwbNDM99bEqOM4OL3OeTX4+E4TBRZzEh6PS6RIpDTu2o3lpS32kDYr/4ohEIpFIJFIm/gWCTuwCIngjBwAAAABJRU5ErkJggg==",
    "picture": "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",
    "light": "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",
    "import": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFLklEQVR42u2bT2xURRzHP79573W3LbQUxINnL9ST0RIhQP/EBIJA9LA1hhMHOfTg1Zior2u8ePTgBRNjTDTaTQyJCDQQ2CUYQ0g0IZEY9aInDthi47b7Z978POwWSmHbpbt9u8j7XTbZy8z3M7/5zcx35kESSSSRRBLxR6hqMjPqLf8+WepVpan/Ygi/I+JFdP93utvv4x1VBrCcyot8Q6iGrLg4u2PiTnsEDpzVEb+PgknxqgmY8Af5+sBZnSIrLu7pECuAmzkEREXImjTp6r+Uo0WqdhEnhum9p3VrLoOLczrECmA4gwIo9KhF61PQJ8KoErg0ASL6v82AfL7WnlF+NAGC1oAgIAbnWzTukmToTNgHiyMdWQU6AkClM2K7KQNIACQAEgAJgARAAiABkABIADz+AFQyusLa2tSjbPvbaoMjJJoTovv7WXN92g+g/W1tHECd/mgeT6q87fUy4cr84UqEBZFboarJSpvsLVUJp5H8GOZhbbUCYcNTIARhGqHE5z3b+dBZJrytnJQ0l/ad0aGsiAtVTTvEZ3KYbFacVPgiGKq15W/lpARceum8btcVAxILgMyMelkRt38PL3q9HC/fphqViSpzVEwPu/w0s22BUBefm5RobFZPeVt4Y7mt8hzlYJBdaTghIjqax4u/CEZsEQPOIQKeCD22iPXSjLQMYZV4f4A3qwtYEQIBD8WoAo5tsa8CuQwuDNWkfa7ZJX5KbcNXV3N5RPCrCy1DeEB85Q5WpFaz1OG8FIFdpKiGL1GVQh4XXwaIaBa4cFCKtsxr0RLXg4EVEMzDIfQuNZemo/l1xKcxwLxb4mjhkPwaTiMbvU/Y+BTIiiNU88Mx+at6i4NRaX0I5w9Lea1iVa5gUJXCuNg1xSvzUZGDV47I5cyMetkWLlNaqwH1i4yrx2XeltaHMPKt7qgvV/6DUx6T6sEhomOz+um64o/J9dHL6ucmJWppZ9GOZXp5zd93Rof8NLNempHqAlbM3c7bYAA/KvGzeuzVEm/1DPFRZR4r4EmAaJV50jxNlY+DAaYq8+uLL4yL7YqzwHKRu3pk7Uzw+3meMqdFeEYtsMIdVqhQ5iu/j6lmRr4d4tuWAU1nguK8FMZVa4pX98RLgV3CidQGZrPFtx1AMxAA1yjzVOMVvykAmoSw9h4oJvGb5gesVxO6RfymGiIbgRC3+E13hB4FQifEx2KJNYSgVFcUv6gT4jetCDZTGP1+Rir/EKGo34+v1fjFx2qKrsyE0hyH7CLnvBSe34fvIn7phPjORHjvWDxxUXcfuKjjo6H6y0bLk+FFq8rqU2EYakcs+o6+1Fge8VymdgrsagD3dbaLI5Or1bXcJA7aBbVDz1jj6Hdz9wIiOnFRd1tLf+Bxo1zu3iwwhmf9PrZc+oQriETr3RnImvSmkeHn8HcO8pnXy3GNICrxjwhOFRFBu2ewa/0Rw5DXB67MNeD1yy/Ln+H7ahrZZg0BZFS9nEg0ek7fSz3FB6XbWMAYv7svVDVC1WFTOwgqc1wgzeGxMVyjW6qGU2CYu684j9olLIIIGLXdM+oNclpE8Ct3iBT2B5bBrMjfjaZCQwA372XHDS/FiC1SVrpcPHedpsjvJWWL/G59iqoq0qAONASQo/5q+3verS6wJ7Wd4bqP1+WFv+ZBRiUWEKYK41KarC3h0aPvA+pp88KMDg7u5ISLGHQWRLsTgwjqDOoFuOoiM1dfkd9a/wjjcd0DrDp3tLYTVJWN3r52Kgp5XNyf3ySRRBJJPHbxH9VbkSuXXYRsAAAAAElFTkSuQmCC",
    "send3d": "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFLElEQVR42u2by29bRRTGf2fm2m7cR5rSIv4AYFE2SGlBICVOK6ANgaXbRVdIUAQsEBLiIQHGbGGBkJCACthUXdgLEJA2FW1TBzZILYtKVOIhIba81LQUkvje+Vg4CekjIU3Sa7e5n2RZsi3PfL9z5sy542vIlClTpkyZUldFcuWa/MzzanPvrnhNslXhvTSqCKDvc92z47g+GTim4wMj2jv3vTRlaZtv7LC4/zPd59dywhVYowRcHqbO8ezYoL3Te0q509usedMBmGN+u1/HiAKb1KQpcDgUrSFK/mJ/Y8gOzHz2pgFwifm1HMXoSSYJZrRqgRAO+S5cciFdCK4t5ifmmG+FwQhYMkHi1/NBaVhPNHZYnEZNcG0x764yrmEkuLQhuI4w30YIrmPMCwFKG4Jrg/lw1eB7DDCUbia4tM27Au4yCDIHIWF8GoRQepngUjTfzPfgkgnexjjuiyBIBMEXwWBMsM8XMTwhLQguDfMSca6b3NQ4H44N2nMSbm4HogAYG8Z226GpcZ7ya/BpQXBpmM9vJIrPc6DxkD2OZIgIXVEEQ0VyXw3Ze8kF9i8GQu8p5doKoFyTX6z5k7tsf+/7ymEmm6cQVs3C7sMqNIbswP9CGNETp7dZc7mX0ksGUJFcfY8l/cN60K/nKCxsvlyTX3fnFXG/QvcO0ux9X7kFIfxD8F180HdYz9f3WFKRXLoAJKuCSl/oNhdxCOhJpkgWMl8vEwYGrh75y3X6SWuWRhXNCyFgySRJfj1v9h3VzqpZWGomLAlAuY7DTETc7Ytsjv8mNodfyDxmupYxZgrdJRDcJVtksIjEBwYBft2ytAu7JQGof9dKZSd+DhPELsKT0EQ0893LN78ABDedCU0ZMsMLzgDc+htKbwlUWyk3OmjfhyYvR0Us6iaX6yHXvEDt5C7bX5HccszPhdB7arYmvBB14aMN5PIbyU+do3brBQ5VKq16tJTvX/JeWt9jSaUiV33Y3uob1rf5TfQ3x/mpscsOUpGrgpZrfrYmTFf7+iP2Zt+wTs+OtdsOzjSTnXXAucDOAVA6ohM7x6T+EcX9I4p3jkmlIzox9zPLHeu6Z8Dly2GmCF3XU5zrMNaKtJNLXX+dMJZjlSsDkAHIAGQAMgAZgAxABiADkAFos8TijstuDgD23+mNCReaYHDH/Z9qfdUspHm/UNSmcEcYAREAUyBgbHZR+vNJNQPO1mcPLt9zEc7lyOFwhU144OOvhzhXrsmv1EnS4pIxbVXkqFroO6JnojwvSRQNDgbPi40BJluzSg9Amypea433fqZiaVQbb4g5l2vy5Zp867e95T/m/rhZGlVERW4lvnd2nit6UHqj3sW5iHkvruqaaecx3RPHrM15zkxOtmfPXlRVd9weFVl34l3GMEuQbKGaYgvSex3behfRlm4+8l3sUwLJBONmBAkzQ50T7NZ8zNHjixAm+QbYO/qA/VJ5Ta5atXBNAMqSr5slpSN6tbCZNyZ+Jwacizq7fVaCFIgLt5Cb+pMvWcPDAwOEql0dwLxLYCvT0TUejf8hxjADp5jO3qIMMyOaOkci6MvFdFfN/phvKcwL4Ox/2XHGF9geX2RS0Pn7c2uGSdRFIb7Ij3HERUlm89SBeQHUodWTD/NK8zz3FTaxVXFbWqdrrQWYI0omOI/xdGOHTexp3TuQXHsnOJ02vTV1d2/hsZDQHWIwdSYGMxQc8jlC829qXw/ZDzOd5+rrAWba7hW5FpCsdJIb6n89jZOE5UU+U6ZMmVaB/gVCF6UB9mfGSAAAAABJRU5ErkJggg==",
}
# ---- /LOGO ----
