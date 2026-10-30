# Harmonious Save Editor: read a base or corvette build out of a .blend, run by the app as
#   blender -b --factory-startup --python blend_read.py -- <file.blend> <out.json> <folder with harmonious_live_link.py> [charon dir]
# Opens the file and reads its build the way the LiveLink add-on does. A base (NMS Base Builder scene) is read from
# its objects with an ObjectID (Z-up turned into the game's Y-up) plus the base details the Base Builder keeps in the
# scene; no add-on is needed. A corvette is read with Charon Forge's own serialiser when its folder is given (so
# groups and forged parts come out as the game expects), else from the scene's objects the same way.
import json
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-3:]
src, out, addon_dir = args[0], args[1], args[2]
charon_dir = args[3] if len(args) > 3 else ""
result = {"ok": False}
try:
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
    sys.path.insert(0, addon_dir)
    import harmonious_live_link as live

    scene = bpy.context.scene
    result["base"] = live.base_info(scene)
    result["source"] = "the scene"
    if result["base"] is None and charon_dir:
        try:   # Charon Forge's serialiser, found by build_objects through its get_builder
            sys.path.insert(0, charon_dir)
            import charon_forge
            charon_forge.register()
            objects, result["source"] = live.build_objects(bpy.context.scene)
            result["objects"] = objects
        except Exception as error:  # noqa: BLE001 - fall back to the scene's parts
            result["charon_error"] = "%s: %s" % (type(error).__name__, error)
    if "objects" not in result:
        result["objects"] = live.scene_parts(scene)
        result["source"] = "the scene"
    # the corvette this .blend is set to in the LiveLink add-on, if any
    slot = scene.get("harmonious_target_slot", -1)
    if isinstance(slot, int) and slot >= 0:
        result["target"] = {"slot": slot, "name": str(scene.get("harmonious_target_name", ""))}
    result["ok"] = True
except Exception as error:  # noqa: BLE001 - the app shows the reason
    result["error"] = "%s: %s" % (type(error).__name__, error)
with open(out, "w", encoding="utf-8") as f:
    json.dump(result, f)
sys.stdout.flush()
os._exit(0)   # Blender (and bpy as a module) can take long to shut down; the answer is written
