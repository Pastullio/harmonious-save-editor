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
    "version": (1, 4, 1),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > LiveLink",
    "description": "Send your corvette build to Harmonious Save Editor every time you save",
    "category": "Import-Export",
}

import base64
import json
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
LINK = {"state": "none", "target": "", "slot": -1, "corvettes": [], "kind": "corvette", "base": None, "traveller": "", "exports": "", "addon": ""}


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
                    traveller=info.get("traveller") or "", exports=info.get("exports") or "", addon=info.get("addon") or "")
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


def logo_icons():
    """The banner as three square previews (Blender draws previews square), written once to a temp folder."""
    global _PREVIEWS
    if _PREVIEWS is None:
        from bpy.utils import previews as bpy_previews
        folder = os.path.join(tempfile.gettempdir(), "harmonious_livelink")
        os.makedirs(folder, exist_ok=True)
        previews = bpy_previews.new()
        for i, data in enumerate(LOGO_TILES):
            path = os.path.join(folder, "logo%d_v%d.png" % (i, bl_info["version"][1]))
            if not os.path.exists(path):
                with open(path, "wb") as f:
                    f.write(base64.b64decode(data))
            previews.load("logo%d" % i, path, "IMAGE")
        _PREVIEWS = previews
    return [_PREVIEWS["logo%d" % i].icon_id for i in range(len(LOGO_TILES))]


def draw_logo(context, layout):
    try:
        icons = logo_icons()
    except Exception:   # no logo is no reason to lose the panel
        return
    region = getattr(context, "region", None)
    width = region.width if region is not None else 300
    unit = 20 * context.preferences.system.ui_scale
    scale = max(1.5, (width - 24) / len(icons) / unit)
    row = layout.row(align=True)
    row.alignment = "CENTER"
    for icon in icons:
        row.template_icon(icon_value=icon, scale=scale)


class HARMONIOUS_PT_live(bpy.types.Panel):
    bl_label = "LiveLink"
    bl_idname = "HARMONIOUS_PT_live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"

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
            link.label(text="Linked to " + LINK["target"], icon="LINKED")
            link.label(text="Each save sends the build there")
        elif LINK["state"] == "off":
            link.label(text="Editor open, LiveLink off", icon="UNLINKED")
            link.label(text="Turn it on in Shipwright or on Bases")
        else:
            link.label(text="Harmonious Save Editor isn't running", icon="ERROR")
        scene = context.scene
        base = base_info(scene)
        if base is not None:
            # a base file says which base it is; warn when the editor is on for something else
            col = layout.column(align=True)
            col.label(text="This file is the base:")
            col.label(text=base["name"] or base["address"], icon="HOME")
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
        col.operator_menu_enum(HARMONIOUS_OT_target.bl_idname, "target", text=current, icon="MOD_BUILD")
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
        row.operator(HARMONIOUS_OT_send.bl_idname, icon="EXPORT")
        box = layout.box()
        box.label(text="Last send", icon="INFO")
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
                apply_keep_shape(o)
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
        r = scene.render
        for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                r.engine = engine
                break
            except TypeError:
                continue
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


class HARMONIOUS_PT_traveller(bpy.types.Panel):
    bl_label = "Your traveller"
    bl_idname = "HARMONIOUS_PT_traveller"
    bl_parent_id = "HARMONIOUS_PT_live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"

    def draw(self, context):
        layout = self.layout
        col = layout.column(align=True)
        col.scale_y = 0.8
        if LINK["state"] == "none":
            col.label(text="Open Harmonious Save Editor and a save")
        elif LINK.get("traveller"):
            col.label(text="In the editor: " + LINK["traveller"], icon="ARMATURE_DATA")
        else:
            col.label(text="Open a save in the editor")
        row = layout.row()
        row.enabled = bool(LINK.get("traveller"))
        row.operator(HARMONIOUS_OT_traveller.bl_idname, icon="IMPORT")
        arm = find_traveller()
        if arm is not None and arm.get("harmonious_traveller"):
            tip = layout.column(align=True)
            tip.scale_y = 0.8
            for line in wrap("In Pose mode, click a part of the body: its bone shows. R turns it, Shift+click adds another part, a click on empty space hides them.", 40):
                tip.label(text=line)
            layout.prop(arm, "harmonious_keep_shape")
            shown = not any(is_hidden(arm, b) for b in body_bones(arm))
            layout.operator(HARMONIOUS_OT_show_bones.bl_idname, text="Hide the sticks" if shown else "Show every stick", icon="HIDE_OFF" if not shown else "HIDE_ON")
        layout.operator(HARMONIOUS_OT_picture.bl_idname, icon="RENDER_STILL")


class HARMONIOUS_PT_support(bpy.types.Panel):
    bl_label = "Support the creator"
    bl_idname = "HARMONIOUS_PT_support"
    bl_parent_id = "HARMONIOUS_PT_live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"
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

CLASSES = (HARMONIOUS_OT_send, HARMONIOUS_OT_target, HARMONIOUS_OT_traveller, HARMONIOUS_OT_pick_part, HARMONIOUS_OT_show_bones, HARMONIOUS_OT_picture,
           HARMONIOUS_PT_live, HARMONIOUS_PT_traveller, HARMONIOUS_PT_support)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.harmonious_live_on = bpy.props.BoolProperty(
        name="Send on save", default=True,
        description="Send the build to Harmonious Save Editor every time this file is saved")
    bpy.types.Scene.harmonious_target_slot = bpy.props.IntProperty(name="Corvette slot", default=-1)
    bpy.types.Object.harmonious_keep_shape = bpy.props.BoolProperty(
        name="Keep the body's proportions", default=True, update=keep_shape_changed,
        description="Bones only turn, so arms and legs never stretch. Turn off to move and scale bones freely")
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
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


# ---- LOGO (generated by tools/addon-logo.py from src/assets/livelink) ----
LOGO_TILES = (
    "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",
)
# ---- /LOGO ----
