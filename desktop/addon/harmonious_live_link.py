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
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > LiveLink",
    "description": "Send your corvette build to Harmonious Save Editor every time you save",
    "category": "Import-Export",
}

import json
import os
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
LINK = {"state": "none", "target": "", "slot": -1, "corvettes": [], "kind": "corvette", "base": None}   # none: editor not running; off: running, LiveLink off; on: linked


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
                    kind=info.get("kind") or "corvette", base=info.get("base"))
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


class HARMONIOUS_PT_live(bpy.types.Panel):
    bl_label = "LiveLink"
    bl_idname = "HARMONIOUS_PT_live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LiveLink"

    def draw(self, context):
        layout = self.layout
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


def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + ([cur] if cur else [])


CLASSES = (HARMONIOUS_OT_send, HARMONIOUS_OT_target, HARMONIOUS_PT_live)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.harmonious_live_on = bpy.props.BoolProperty(
        name="Send on save", default=True,
        description="Send the build to Harmonious Save Editor every time this file is saved")
    bpy.types.Scene.harmonious_target_slot = bpy.props.IntProperty(name="Corvette slot", default=-1)
    bpy.types.Scene.harmonious_target_name = bpy.props.StringProperty(name="Corvette")
    if on_save not in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.append(on_save)
    if not bpy.app.timers.is_registered(link_timer):
        bpy.app.timers.register(link_timer, first_interval=1.0, persistent=True)


def unregister():
    if bpy.app.timers.is_registered(link_timer):
        bpy.app.timers.unregister(link_timer)
    if on_save in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.remove(on_save)
    del bpy.types.Scene.harmonious_live_on
    del bpy.types.Scene.harmonious_target_slot
    del bpy.types.Scene.harmonious_target_name
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
