# Harmonious Save Editor: read a base or corvette build out of a .blend, run by the app as
#   blender -b --factory-startup --python blend_read.py -- <file.blend> <out.json> <folder with harmonious_live_link.py>
# Opens the file, reads every object with an ObjectID the way the LiveLink add-on does (Z-up turned into the game's
# Y-up), and the base details the NMS Base Builder add-on keeps in the scene. No add-ons are needed or loaded.
import json
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-3:]
src, out, addon_dir = args[0], args[1], args[2]
result = {"ok": False}
try:
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
    sys.path.insert(0, addon_dir)
    import harmonious_live_link as live

    scene = bpy.context.scene
    result["objects"] = live.scene_parts(scene)
    result["base"] = live.base_info(scene)
    result["ok"] = True
except Exception as error:  # noqa: BLE001 - the app shows the reason
    result["error"] = "%s: %s" % (type(error).__name__, error)
with open(out, "w", encoding="utf-8") as f:
    json.dump(result, f)
sys.stdout.flush()
os._exit(0)   # Blender (and bpy as a module) can take long to shut down; the answer is written
