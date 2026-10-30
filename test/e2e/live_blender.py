# Runs the Harmonious Live Link add-on inside Blender (bpy as a module) against a running editor.
# A stand-in for Charon Forge's builder hands it the parts from a JSON file.
# Usage: python live_blender.py <addon folder> <build.json> <scratch .blend path>   (HSE_LIVE_FILE set)
import json, sys, time, types
import bpy

addon_dir, build_file, blend = sys.argv[1:4]
sys.path.insert(0, addon_dir)
import harmonious_live_link as h

objs = json.load(open(build_file, encoding="utf-8"))
fake = types.ModuleType("bl_ext.user_default.charon_forge.builder")
fake.get_builder = lambda: types.SimpleNamespace(serialise=lambda: {"Objects": objs, "BaseVersion": 8})
sys.modules[fake.__name__] = fake

h.register()
print("PANEL", hasattr(bpy.types, "HARMONIOUS_PT_live"))
h.check_link_now()
print("LINK", h.LINK["state"], h.LINK["target"])

def wait():
    for _ in range(600):
        if not h.STATE["busy"]:
            break
        time.sleep(0.1)
    time.sleep(0.2)
    # timers don't run without Blender's event loop here, so read the message the worker left
    return h.STATE["status"]

def last_message():
    return wait()

# 1. the panel's Send now
bpy.ops.harmonious.live_send()
print("SEND", last_message())
# 2. saving the .blend sends it too (save_post handler)
h.STATE["status"] = ""
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("SAVE", last_message())
h.unregister()
sys.stdout.flush()
import os
os._exit(0)   # bpy as a module can hang while shutting down; everything needed is printed
