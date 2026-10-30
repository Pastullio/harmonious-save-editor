# Harmonious LiveLink - a Blender add-on for Harmonious Save Editor (GPL-3.0, same as the editor).
#
# Every time you save your .blend (Ctrl+S), this sends the corvette build in the scene to Harmonious Save Editor,
# which puts it on the corvette you chose (Shipwright > LiveLink) and writes your save, backing it up first.
# The build is read with Charon Forge when it's installed, otherwise with the NMS Base Builder add-on.
#
# Install: Blender > Edit > Preferences > Add-ons > Install from Disk, pick this file, tick it.
# Then: 3D view sidebar (N) > Harmonious.

bl_info = {
    "name": "Harmonious LiveLink",
    "author": "Pastullio the Harmonious",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > Harmonious",
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

def build_objects(scene):
    """The build's parts as NMS objects (a list of dicts), or raise with a reason."""
    # Charon Forge (installed as an extension, so its module name has a prefix like bl_ext.user_default.)
    for name, mod in list(sys.modules.items()):
        if name.endswith("charon_forge.builder") and hasattr(mod, "get_builder"):
            data = mod.get_builder().serialise()
            objects = data.get("Objects") if isinstance(data, dict) else None
            if objects:
                return objects, "Charon Forge"
    # the NMS Base Builder add-on
    tool = getattr(scene, "nms_base_tool", None)
    if tool is not None:
        data = tool.serialise(objects_only=True)
        objects = data if isinstance(data, list) else (data or {}).get("Objects")
        if objects:
            return objects, "Base Builder"
    raise RuntimeError("No build found in this scene. Charon Forge or the NMS Base Builder add-on needs to be installed, with parts in the scene.")


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
    bl_category = "Harmonious"

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
