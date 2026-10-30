# Makes a corvette .blend from a build (plain JSON list of parts), the way builders keep parts: one object per part with
# an ObjectID, its order, and its matrix in Blender's Z-up. Sets the LiveLink add-on's target corvette in the scene.
# Usage: python make_corvette_blend.py <build.json> <out.blend> <target slot> <target name>
import json, math, os, sys
import bpy, mathutils

build, out, slot, name = sys.argv[-4:]
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
z_up_inv = mathutils.Matrix.Rotation(math.radians(-90.0), 4, "X").inverted()
for k, p in enumerate(json.load(open(build, encoding="utf-8"))):
    pos, up, at = (mathutils.Vector(p[f]) for f in ("Position", "Up", "At"))
    right = up.cross(at).normalized() * up.length
    m = mathutils.Matrix.Identity(4)
    for r in range(3):
        m[r][0], m[r][1], m[r][2], m[r][3] = right[r], up[r], (at.normalized() * up.length)[r], pos[r]
    ob = bpy.data.objects.new(p["ObjectID"].lstrip("^"), None)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = z_up_inv @ m
    ob["ObjectID"], ob["order"], ob["Timestamp"], ob["UserData"] = p["ObjectID"].lstrip("^"), k, str(p.get("Timestamp", 0)), str(p.get("UserData", 0))   # text: UserData can pass 32 bits
bpy.context.scene["harmonious_target_slot"] = int(slot)
bpy.context.scene["harmonious_target_name"] = name
bpy.ops.wm.save_as_mainfile(filepath=out)
print("MADE", out, flush=True)
os._exit(0)
