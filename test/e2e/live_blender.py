# Runs the Harmonious Live Link add-on inside Blender (bpy as a module) against a running editor.
# A stand-in for Charon Forge's builder hands it the parts from a JSON file.
# Usage: python live_blender.py <addon folder> <build.json> <scratch .blend path>   (HSE_LIVE_FILE set)
import json, sys, time, types
import bpy

addon_dir, build_file, blend = sys.argv[1:4]
sys.path.insert(0, addon_dir)
import harmonious_live_link as h

objs = json.load(open(build_file, encoding="utf-8"))

# the NMS Base Builder add-on on its own: its serialise() takes no arguments
class OldStyleTool:
    def serialise(self):
        return {"Objects": objs, "BaseVersion": 8}
got, src = h.build_objects(types.SimpleNamespace(nms_base_tool=OldStyleTool()))
print("BASEBUILDER", src, len(got) == len(objs))
# no builder add-on: the parts are read straight from the scene (Blender Z-up -> game Y-up)
ob = bpy.data.objects.new("B_COK_D", None); bpy.context.scene.collection.objects.link(ob)
ob["ObjectID"] = "B_COK_D"; ob["order"] = 1; ob["UserData"] = "0"; ob.location = (1, 2, 3)
bpy.context.view_layer.update()
got, src = h.build_objects(bpy.context.scene)
p = got[0]["Position"]
print("SCENE", src, got[0]["ObjectID"], [round(v, 3) + 0.0 for v in p], [round(v, 3) + 0.0 for v in got[0]["Up"]])
bpy.data.objects.remove(ob)
try:
    h.build_objects(types.SimpleNamespace())
except RuntimeError as error:
    print("NOBUILDER", error)
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

print("CORVETTES", len(h.LINK["corvettes"]), h.LINK["slot"])
# a .blend that isn't set to a corvette yet sends with no target; the test answers the editor's question
h.STATE["status"] = ""
bpy.ops.harmonious.live_send()
print("ASK", last_message())
# pick the armed corvette in the panel's list: saved in the .blend from now on
armed = next(c for c in h.LINK["corvettes"] if c["slot"] == h.LINK["slot"])
bpy.ops.harmonious.live_target(target="%d|%s" % (armed["slot"], armed["name"]))
print("TARGET", bpy.context.scene.harmonious_target_slot, bpy.context.scene.harmonious_target_name)
# 1. the panel's Send now
bpy.ops.harmonious.live_send()
print("SEND", last_message())
# 2. saving the .blend sends it too (save_post handler)
h.STATE["status"] = ""
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("SAVE", last_message())
# the editor confirmed the corvette: the answer is kept in the scene (a timer does this inside Blender)
h.STATE["target"] = {"slot": -1, "name": ""}; h.apply_answer()   # reset, then the real answer comes from the next send
bpy.context.scene.harmonious_target_slot, bpy.context.scene.harmonious_target_name = armed["slot"], armed["name"]
# 3. picking another corvette: the add-on warns, and the editor asks before writing (the test says "Don't write")
other = next(c for c in h.LINK["corvettes"] if c["slot"] != h.LINK["slot"])
try:
    bpy.ops.harmonious.live_target(target="%d|%s" % (other["slot"], other["name"]))
except Exception as error:   # popups need a window; in the background the warning can't show
    print("POPUPERR", error)
print("WARNED", " ".join(h.STATE.get("warning") or []))
h.STATE["status"] = ""
bpy.ops.harmonious.live_send()
print("MISMATCH", last_message())
h.unregister()
sys.stdout.flush()
import os
os._exit(0)   # bpy as a module can hang while shutting down; everything needed is printed
