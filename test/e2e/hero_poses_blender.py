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


def build(arms=1.0, legs=1.0, leg_parent="ROOT"):
    """A stand-in laid out like the real traveller (seen in the owner's own model, 2026-11-25): Trajectory > ROOT, the
    spine and both hips hanging from ROOT, facing -Y with the "l_" side at -X. Arms and legs can be longer or shorter."""
    hip = 0.95 * legs + 0.0
    up0 = hip + 0.05
    J = {"Trajectory": (None, (0, 0, 0)), "ROOT": ("Trajectory", (0, 0, 0.02)), "spine_01": ("ROOT", (0, 0, up0)), "spine_02": ("spine_01", (0, 0, up0 + 0.15)), "spine_Top": ("spine_02", (0, 0, up0 + 0.32)),
         "neck_01_01": ("spine_Top", (0, 0, up0 + 0.5)), "neck_01_02": ("neck_01_01", (0, 0, up0 + 0.56)), "head_Top": ("neck_01_02", (0, 0, up0 + 0.8))}
    sh = up0 + 0.45
    for s, x in (("l", -1), ("r", 1)):
        J.update({s + "_arm_Clavicle": ("spine_Top", (0.04 * x, 0, sh)), s + "_arm_Shoulder": (s + "_arm_Clavicle", (0.2 * x, 0, sh)),
                  s + "_arm_Elbow": (s + "_arm_Shoulder", ((0.2 + 0.28 * arms) * x, 0, sh)), s + "_arm_Wrist": (s + "_arm_Elbow", ((0.2 + 0.54 * arms) * x, 0, sh)),
                  s + "_hand_03_01": (s + "_arm_Wrist", ((0.29 + 0.54 * arms) * x, 0, sh)),
                  s + "_leg_Hip": (leg_parent, (0.1 * x, 0, hip)), s + "_leg_Knee": (s + "_leg_Hip", (0.1 * x, -0.01, 0.09 + 0.43 * legs)),
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
    return arm, J


arm, J = build()

fwd, left, up = live.body_frame(arm)
ok("the stand-in faces -Y with its l_ side at -X, like the real traveller", fwd.y < -0.99 and left.x < -0.99)


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

# Ground strike is the owner's own pose, kept as bone turns for the real skeleton: here only that it goes on
ok("Ground strike (the owner's, as bone turns) applies", pose("Ground strike") and "bones" in live.POSES[names.index("Ground strike")][2]
   and len(live.POSE_BONES["Ground strike"]) > 30 and live.POSE_BONES["Ground strike"]["ROOT"]["location"][1] == 0)

# Hovering and Fists on hips are the owner's too (his Pose_8.blend): bone turns made for the real skeleton
for n, lift in (("Hovering", 0.6), ("Fists on hips", 0)):
    spec = live.POSES[names.index(n)]
    B = live.POSE_BONES.get(n, {})
    ok(n + " (the owner's, as bone turns) applies", pose(n) and "bones" in spec[2] and len(B) >= 30)
    ok("…only ROOT moves, and only up or down", [k for k, v in B.items() if "location" in v] == ["ROOT"] and B["ROOT"]["location"][1:] == (0, 0)
       and abs(B["ROOT"]["location"][0] - lift) < 0.02)
    ok("…it carries its own fingers on both hands", any(k.startswith("l_hand_") for k in B) and any(k.startswith("r_hand_") for k in B))
ok("Ready crouch applies", pose("Ready crouch"))
low = min(at(n).z for n in J if n not in ("ROOT", "Trajectory"))
ok("…nothing under the floor; the right knee and fist are down", low > -0.03 and at("r_leg_Knee").z < 0.2 and abs(at("r_arm_Wrist").z - 0.12) < 0.03)
ok("…the left knee is up in front, shin upright", (at("l_leg_Knee") - at("spine_01")).dot(fwd) > 0.3 and along("l_leg_Knee", "l_leg_Ankle").z < -0.9)
ok("…the head stays up and the hips' own bone near upright", along("neck_01_02", "head_Top").z > 0.95 and along("spine_01", "spine_02").z > 0.88)

ok("Flying applies", pose("Flying"))
body = along("spine_01", "spine_Top")
ok("…the whole body leans forward as one piece (about 65°)", 0.85 < body.x < 0.95 and 0.35 < body.z < 0.5)
ok("…the right arm reaches ahead, the legs trail behind", along("r_arm_Shoulder", "r_arm_Wrist").x > 0.85 and along("l_leg_Hip", "l_leg_Ankle").x < -0.8 and along("r_leg_Hip", "r_leg_Ankle").x < -0.7)
ok("…the left arm is back at the side, the head looks ahead", along("l_arm_Shoulder", "l_arm_Wrist").x < -0.4 and along("neck_01_02", "head_Top").z > 0.8)
ok("…well clear of the floor", min(at(n).z for n in J if n not in ("ROOT", "Trajectory")) > 0.5 and abs(at("spine_01").z - 1.3) < 0.02)

ok("Standing puts the body upright on the floor again", pose("Standing") and along("spine_01", "spine_Top").z > 0.99 and abs(at("l_leg_Ball").z - 0.02) < 0.02)

pics = len(sys.argv) > 1 and not sys.argv[1].startswith("-")
if pics:   # of the standard stand-in, before the others are built
    pass
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
                    if p and p not in ("ROOT", "Trajectory"):
                        a, b = at(p), at(j)
                        d.line([(ox + a.dot(ax) * 200, 470 - a.z * 200), (ox + b.dot(ax) * 200, 470 - b.z * 200)],
                               fill=(255, 120, 150) if j.startswith("r_") else (120, 200, 255) if j.startswith("l_") else (240, 240, 240), width=5)
                hd = at("head_Top")
                d.ellipse([ox + hd.dot(ax) * 200 - 16, 470 - hd.z * 200 - 6, ox + hd.dot(ax) * 200 + 16, 470 - hd.z * 200 + 26], outline=(240, 240, 240), width=3)
            d.text((20, 14), n + "   (left: from its right side, facing right; right: from behind; pink = right limbs)", fill=(220, 230, 235))
            im.save(os.path.join(out, n + ".png"))
    except ImportError:
        print("no PIL: pictures skipped")

# other bodies: the fist still finds the floor (or the lean stops at its limit), the feet stay down, the head up
for label, kw in (("short arms", {"arms": 0.8}), ("long arms", {"arms": 1.15}), ("long legs", {"legs": 1.15}), ("short legs", {"legs": 0.85}),
                  ("legs hung from the lowest spine bone", {"leg_parent": "spine_01"})):
    arm, J = build(**kw)
    for name in ("Ready crouch",):
        pose(name)
        k = arm.get("harmonious_plant", -1)
        fist = at("r_arm_Wrist").z
        feet = min(at("l_leg_Ball").z, at("r_leg_Ball").z, at("r_leg_Knee").z)
        print("   %s, %s: lean %.2f, fist %.2f m, lowest foot or knee %.2f m" % (label, name, k, fist, feet))
        ok("%s on a body with %s: fist down or the lean at its limit, feet down, head up, nothing under the floor" % (name, label),
           (abs(fist - 0.12) < 0.03 or k >= 0.99 or (k == 0 and fist <= 0.15)) and feet < 0.12 and along("neck_01_02", "head_Top").z > 0.9
           and min(at(n).z for n in J if n not in ("ROOT", "Trajectory")) > -0.04)

print("ALL PASS" if not fails else "FAILED: " + "; ".join(fails))
sys.exit(1 if fails else 0)
