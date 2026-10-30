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
LINK = {"state": "none", "target": ""}   # none: editor not running; off: running, LiveLink off; on: linked


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
        LINK.update(state="on" if info.get("armed") else "off", target=info.get("target") or "")
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
        try:
            stamp = int(float(o.get("Timestamp", 0) or 0))
        except (TypeError, ValueError):
            stamp = 0
        try:
            user = int(float(o.get("UserData", 0) or 0))
        except (TypeError, ValueError):
            user = 0
        out.append({"ObjectID": "^" + oid, "Position": list(m.translation), "Up": list(m.col[1].to_3d()),
                    "At": list(m.col[2].to_3d().normalized()), "Timestamp": stamp, "UserData": user})
    return out


def build_objects(scene):
    """The build's parts as NMS objects (a list of dicts), or raise with a reason."""
    problems = []
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
    body = json.dumps({"objects": objects, "name": os.path.splitext(os.path.basename(bpy.data.filepath))[0],
                       "file": bpy.data.filepath, "source": source}).encode("utf-8")
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
        except (urllib.error.URLError, OSError, ValueError) as error:
            text = "Couldn't reach Harmonious Save Editor: %s" % error
        STATE["status"] = text
        STATE["busy"] = False
        # redraw the panel from Blender's main thread
        bpy.app.timers.register(lambda: (set_status(text), None)[1], first_interval=0.01)

    threading.Thread(target=worker, daemon=True).start()


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
            link.label(text="Turn it on in Shipwright")
        else:
            link.label(text="Harmonious Save Editor isn't running", icon="ERROR")
        layout.prop(context.scene, "harmonious_live_on", text="Send on save (Ctrl+S)")
        row = layout.row()
        row.enabled = LINK["state"] == "on"
        row.operator(HARMONIOUS_OT_send.bl_idname, icon="EXPORT")
        box = layout.box()
        box.label(text="Last send", icon="INFO")
        for line in wrap(STATE["status"], 34):
            box.label(text=line)


def wrap(text, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + ([cur] if cur else [])


CLASSES = (HARMONIOUS_OT_send, HARMONIOUS_PT_live)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.harmonious_live_on = bpy.props.BoolProperty(
        name="Send on save", default=True,
        description="Send the build to Harmonious Save Editor every time this file is saved")
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
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
