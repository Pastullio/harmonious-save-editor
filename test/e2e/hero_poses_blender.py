# The hero poses added 2026-11-25 (Ground strike, Hovering, Fists on hips, Ready crouch, Flying) on a stand-in
# skeleton with the traveller's joint names and a person's proportions; no game files needed. Checks where the body
# ends up, not how the real traveller's joint limits take it (that needs the game's model).
# Usage: <python with bpy> test/e2e/hero_poses_blender.py [folder for pictures of each pose]
import os, sys
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "desktop", "addon"))
import harmonious_live_link as live

fails = []


def ok(name, cond):
    print(("PASS " if cond else "FAIL ") + name, flush=True)
    if not cond:
        fails.append(name)


# joint: (parent, head) with the traveller facing -Y, left at +X
J = {"ROOT": (None, (0, 0, 0)), "spine_01": ("ROOT", (0, 0, 1.0)), "spine_02": ("spine_01", (0, 0, 1.15)), "spine_Top": ("spine_02", (0, 0, 1.32)),
     "neck_01_01": ("spine_Top", (0, 0, 1.5)), "neck_01_02": ("neck_01_01", (0, 0, 1.56)), "head_Top": ("neck_01_02", (0, 0, 1.8))}
for s, x in (("l", 1), ("r", -1)):
    J.update({s + "_arm_Clavicle": ("spine_Top", (0.04 * x, 0, 1.45)), s + "_arm_Shoulder": (s + "_arm_Clavicle", (0.2 * x, 0, 1.45)),
              s + "_arm_Elbow": (s + "_arm_Shoulder", (0.48 * x, 0, 1.45)), s + "_arm_Wrist": (s + "_arm_Elbow", (0.74 * x, 0, 1.45)),
              s + "_hand_03_01": (s + "_arm_Wrist", (0.83 * x, 0, 1.45)),
              s + "_leg_Hip": ("spine_01", (0.1 * x, 0, 0.95)), s + "_leg_Knee": (s + "_leg_Hip", (0.1 * x, -0.01, 0.52)),
              s + "_leg_Ankle": (s + "_leg_Knee", (0.1 * x, 0, 0.09)), s + "_leg_Ball": (s + "_leg_Ankle", (0.1 * x, -0.13, 0.02)),
              s + "_leg_Toe": (s + "_leg_Ball", (0.1 * x, -0.2, 0.02))})
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
data = bpy.data.armatures.new("Stand-in")
arm = bpy.data.objects.new("Stand-in", data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
kids = {}
for n, (p, h) in J.items():
    kids.setdefault(p, []).append(n)
for n, (p, h) in J.items():
    b = data.edit_bones.new(n)
    b.head = h
    first = kids.get(n, [None])[0]
    b.tail = J[first][1] if first and (Vector(J[first][1]) - Vector(h)).length > 1e-4 else (h[0], h[1] - 0.05, h[2])
for n, (p, h) in J.items():
    if p:
        data.edit_bones[n].parent = data.edit_bones[p]
bpy.ops.object.mode_set(mode="OBJECT")
arm["harmonious_traveller"] = "Stand-in"
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"

fwd, left, up = live.body_frame(arm)
ok("the stand-in faces -Y with its left at +X", fwd.y < -0.99 and left.x > 0.99)


def at(n):
    return arm.matrix_world @ arm.pose.bones[n].head


def along(a, b):
    v = (at(b) - at(a)).normalized()
    return Vector((v.dot(fwd), v.dot(left), v.dot(up)))   # forward, to its left, up


def pose(name):
    done = live.apply_ready_pose(arm, name)
    bpy.context.view_layer.update()
    return done


names = [p[0] for p in live.POSES]
new = ["Ground strike", "Hovering", "Fists on hips", "Ready crouch", "Flying"]
ok("the five poses are in the list, each with a description", all(n in names for n in new) and all(p[1] for p in live.POSES))
ok("the older poses are still there", all(n in names for n in ("Standing", "Hero", "Kneeling", "T-pose")))

ok("Ground strike applies", pose("Ground strike"))
low = min(at(n).z for n in J if n != "ROOT")
print("   lowest", min((at(n).z, n) for n in J if n != "ROOT"), "feet", round(at("l_leg_Ball").z, 3), round(at("r_leg_Ball").z, 3), "fist", round(at("r_arm_Wrist").z, 3))
ok("…nothing goes under the floor and something touches it", -0.03 < low < 0.12)
ok("…the right fist is down by the floor, ahead of the hips", at("r_arm_Wrist").z < 0.3 and (at("r_arm_Wrist") - at("spine_01")).dot(fwd) > 0.15)
ok("…both feet are on or near the floor", at("l_leg_Ball").z < 0.12 and at("r_leg_Ball").z < 0.12)
ok("…the left arm is thrown back and up", along("l_arm_Shoulder", "l_arm_Wrist").x < -0.3 and along("l_arm_Shoulder", "l_arm_Wrist").z > 0.3)
ok("…the left foot is ahead of the right and the hips are low", (at("l_leg_Ball") - at("r_leg_Ball")).dot(fwd) > 0.6 and at("spine_01").z < 0.6)
ok("…the body leans forward with the head up", along("spine_01", "spine_Top").x > 0.35 and along("neck_01_02", "head_Top").z > 0.9)

ok("Hovering applies", pose("Hovering"))
ok("…the feet are off the floor, toes pointing down", 0.45 < min(at("l_leg_Toe").z, at("r_leg_Toe").z) < 0.6 and along("l_leg_Ankle", "l_leg_Ball").z < -0.8)
ok("…upright, arms down and away from the body", along("spine_01", "spine_Top").z > 0.98 and along("r_arm_Shoulder", "r_arm_Wrist").z < -0.8 and along("r_arm_Shoulder", "r_arm_Wrist").y < -0.2)
ok("…the right knee is bent a little", along("r_leg_Hip", "r_leg_Knee").x > 0.2 and along("r_leg_Knee", "r_leg_Ankle").x < -0.15)

ok("Fists on hips applies", pose("Fists on hips"))
gap = (at("l_leg_Ball") - at("r_leg_Ball")).dot(left)
ok("…feet wide apart and on the floor", gap > 0.6 and abs(min(at("l_leg_Ball").z, at("r_leg_Ball").z) - 0.02) < 0.03)
ok("…both elbows out, hands in by the hips", all(abs((at(s + "_arm_Elbow") - at("spine_02")).dot(left)) > 0.3 for s in "lr")
   and all((at(s + "_arm_Wrist") - at(s + "_leg_Hip")).length < 0.4 for s in "lr"))
ok("…its hands are fists", live.POSES[names.index("Fists on hips")][4] == {"X": "fist"})

ok("Ready crouch applies", pose("Ready crouch"))
low = min(at(n).z for n in J if n != "ROOT")
print("   lowest", min((at(n).z, n) for n in J if n != "ROOT"), "knee", round(at("r_leg_Knee").z, 3), "fist", round(at("r_arm_Wrist").z, 3), "l foot", round(at("l_leg_Ball").z, 3))
ok("…nothing under the floor; the right knee and fist are down", -0.03 < low < 0.12 and at("r_leg_Knee").z < 0.2 and at("r_arm_Wrist").z < 0.3)
ok("…the left knee is up in front, shin upright", (at("l_leg_Knee") - at("spine_01")).dot(fwd) > 0.3 and along("l_leg_Knee", "l_leg_Ankle").z < -0.9)
ok("…the head stays up", along("neck_01_02", "head_Top").z > 0.95)

ok("Flying applies", pose("Flying"))
body = along("spine_01", "spine_Top")
ok("…the whole body leans forward as one piece (about 65°)", 0.85 < body.x < 0.95 and 0.35 < body.z < 0.5)
ok("…the right arm reaches ahead, the legs trail behind", along("r_arm_Shoulder", "r_arm_Wrist").x > 0.85 and along("l_leg_Hip", "l_leg_Ankle").x < -0.8 and along("r_leg_Hip", "r_leg_Ankle").x < -0.7)
ok("…the left arm is back at the side, the head looks ahead", along("l_arm_Shoulder", "l_arm_Wrist").x < -0.4 and along("neck_01_02", "head_Top").z > 0.8)
ok("…well clear of the floor", min(at(n).z for n in J if n != "ROOT") > 0.5 and abs(at("spine_01").z - 1.3) < 0.02)

ok("Standing puts the body upright on the floor again", pose("Standing") and along("spine_01", "spine_Top").z > 0.99 and abs(at("l_leg_Ball").z - 0.02) < 0.02)

if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):   # stick-figure pictures, side and front, for a look
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    try:
        from PIL import Image, ImageDraw
        for n in new:
            pose(n)
            im = Image.new("RGB", (900, 520), (14, 26, 34))
            d = ImageDraw.Draw(im)
            for col, (ax, flip) in enumerate(((fwd, 1), (left, 1))):
                ox = 230 + col * 450
                d.line([(ox - 200, 470), (ox + 200, 470)], fill=(60, 90, 100), width=2)
                for j, (p, h) in J.items():
                    if p and p != "ROOT":
                        a, b = at(p), at(j)
                        d.line([(ox + a.dot(ax) * 200, 470 - a.z * 200), (ox + b.dot(ax) * 200, 470 - b.z * 200)],
                               fill=(255, 120, 150) if j.startswith("r_") else (120, 200, 255) if j.startswith("l_") else (240, 240, 240), width=5)
                hd = at("head_Top")
                d.ellipse([ox + hd.dot(ax) * 200 - 16, 470 - hd.z * 200 - 6, ox + hd.dot(ax) * 200 + 16, 470 - hd.z * 200 + 26], outline=(240, 240, 240), width=3)
            d.text((20, 14), n + "   (left: from its right side, facing right; right: from behind; pink = right limbs)", fill=(220, 230, 235))
            im.save(os.path.join(out, n + ".png"))
    except ImportError:
        print("no PIL: pictures skipped")

print("ALL PASS" if not fails else "FAILED: " + "; ".join(fails))
sys.exit(1 if fails else 0)
