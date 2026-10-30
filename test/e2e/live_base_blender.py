# LiveLink for bases, run in bpy 4.5 against a running editor: a Base Builder .blend names its base, and the editor
# checks it against the base LiveLink is on for. Usage: python live_base_blender.py <addon folder> <right.blend> <wrong.blend>
import os, sys, time
import bpy

addon_dir, right, wrong = sys.argv[-3:]
sys.path.insert(0, addon_dir)
import harmonious_live_link as h

def wait():
    for _ in range(1800):
        if not h.STATE["busy"]:
            break
        time.sleep(0.1)
    time.sleep(0.2)
    return h.STATE["status"]

bpy.ops.wm.open_mainfile(filepath=right, load_ui=False)
h.register()
info = h.base_info(bpy.context.scene)
print("BASEINFO", info["name"], info["address"], flush=True)
print("SAME", h.same_base(info, {"name": info["name"], "address": str(int(info["address"], 0))}), h.same_base(info, {"name": "Other", "address": "12"}), flush=True)
h.check_link_now()
print("LINK", h.LINK["state"], h.LINK["kind"], (h.LINK["base"] or {}).get("name"), flush=True)
objs, src = h.build_objects(bpy.context.scene)
print("READ", len(objs), src, flush=True)
h.STATE["status"] = ""
bpy.ops.harmonious.live_send()
print("RIGHT", wait(), flush=True)
# the wrong base: the editor asks, and the test answers "Don't write"
bpy.ops.wm.open_mainfile(filepath=wrong, load_ui=False)
h.STATE["status"] = ""
bpy.ops.harmonious.live_send()
print("WRONG", wait(), flush=True)
sys.stdout.flush()
os._exit(0)
