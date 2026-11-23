# Several travellers in one file (owner 2026-11-23): the LiveLink add-on's tools work on the selected traveller.
# Two stand-in travellers (an armature with a skinned body each) are made here; no game files needed.
# Usage: <python with bpy> test/e2e/multi_traveller_blender.py     (prints PASS/FAIL lines, exits 1 on a failure)
import os, sys
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "desktop", "addon"))
import harmonious_live_link as live

fails = []


def ok(name, cond):
    print(("PASS " if cond else "FAIL ") + name, flush=True)
    if not cond:
        fails.append(name)


def make(name, x):
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    b = arm_data.edit_bones.new("spine_01")
    b.head, b.tail = (0, 0, 0), (0, 0, 1)
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh = bpy.data.meshes.new(name + " body")
    mesh.from_pydata([(-.3, -.1, 0), (.3, -.1, 0), (.3, -.1, 1.8), (-.3, -.1, 1.8)], [], [(0, 1, 2, 3)])
    body = bpy.data.objects.new(name + " body", mesh)
    bpy.context.scene.collection.objects.link(body)
    body.parent = arm
    body.vertex_groups.new(name="spine_01").add([0, 1, 2, 3], 1.0, "REPLACE")
    body.modifiers.new("Armature", "ARMATURE").object = arm
    arm["harmonious_traveller"] = name
    arm.location.x = x
    return arm, body


live.register()
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
a, a_body = make("Pastullio", 0.0)
b, b_body = make("Dre", 1.4)
lamp = bpy.data.objects.new("Lamp", bpy.data.lights.new("Lamp", "SUN"))
bpy.context.scene.collection.objects.link(lamp)
view = bpy.context.view_layer

ok("both travellers are listed", [t.name for t in live.travellers()] == ["Pastullio", "Dre"] or {t.name for t in live.travellers()} == {"Pastullio", "Dre"})
view.objects.active = a
ok("the selected traveller is the one the tools work on", live.find_traveller() == a)
view.objects.active = b
ok("selecting the other one switches", live.find_traveller() == b)
view.objects.active = lamp
ok("it stays the same while a light is selected", live.find_traveller() == b)
view.objects.active = a_body
ok("selecting a traveller's body counts as selecting them", live.find_traveller() == a)
ok("a traveller's body belongs to them, a light to nobody", live.traveller_of(b_body) == b and live.traveller_of(lamp) is None)

# the panel's button
ok("Work on this traveller makes them active", bpy.ops.harmonious.choose_traveller(name="Dre") == {"FINISHED"} and view.objects.active == b and live.find_traveller() == b and b.select_get() and not a.select_get())
bpy.ops.harmonious.pose_mode(mode="POSE")
ok("Pose Mode poses that traveller", bpy.context.mode == "POSE" and bpy.context.active_object == b)
bpy.ops.harmonious.choose_traveller(name="Pastullio")
ok("switching while posing keeps Pose Mode, on the new traveller", bpy.context.mode == "POSE" and bpy.context.active_object == a and live.find_traveller() == a)
bpy.ops.harmonious.pose_mode(mode="OBJECT")

# a click on the other traveller's body (the ray from in front of Dre)
import mathutils
view.update()
hit = live.pick_ray(bpy.context, b, mathutils.Vector((1.4, -5, 0.9)), mathutils.Vector((0, 1, 0)))
miss = live.pick_ray(bpy.context, a, mathutils.Vector((1.4, -5, 0.9)), mathutils.Vector((0, 1, 0)))
ok("a ray at Dre's body finds Dre's bone, and not Pastullio's", hit == "spine_01" and miss is None)

# names: two travellers of the same name show their object names
c, _ = make("Dre", 2.8)
ok("two of the same name are told apart", live.traveller_label(b) != live.traveller_label(c) and live.traveller_label(a) == "Pastullio")

# the panel draws with several travellers (a stand-in layout that records text)
class Lay:
    def __init__(self, out): self.out = out; self.scale_y = 1; self.enabled = True; self.alignment = ""; self.active = True
    def _sub(self, *a, **k): return Lay(self.out)
    box = column = row = split = grid_flow = column_flow = _sub
    def label(self, text="", **k): self.out.append(text)
    def operator(self, idname, text=None, **k):
        self.out.append("[" + (text if text is not None else idname) + "]")
        return type("Props", (), {})()
    def prop(self, obj, name, **k): self.out.append("<" + name + ">")
    def separator(self, **k): pass
    def template_icon(self, **k): pass
    def prop_search(self, *a, **k): pass
    def template_list(self, *a, **k): pass
    def menu(self, *a, **k): pass
    def operator_menu_enum(self, idname, prop, text="", **k): self.out.append("{" + text + "}")

out = []
view.objects.active = a
panel = type("P", (), {"layout": Lay(out)})()
try:
    live.HARMONIOUS_PT_traveller.draw(panel, bpy.context)
    drawn = True
except Exception as error:  # noqa: BLE001
    drawn = False
    print("draw failed:", type(error).__name__, error)
ok("the panel says who is being worked on and lists everyone", drawn and "Working on: Pastullio" in out and "[Pastullio]" in out and sum(1 for x in out if x.startswith("[Dre")) == 2)

# each traveller shows its own pose and its own hand sliders (owner 2026-11-23: clicking another traveller still showed
# the first one's pose, as if the click hadn't taken)
live.remember_pose(a, "ready:Arms crossed")
def poses_panel(active):
    view.objects.active = active
    rows = []
    live.HARMONIOUS_PT_poses.draw(type("P", (), {"layout": Lay(rows)})(), bpy.context)
    return rows
pa, pb = poses_panel(a), poses_panel(b)
ok("the Poses list shows the posed traveller's pose", "Posing: Pastullio" in pa and "{Arms crossed}" in pa)
ok("…and that the other one has none yet", "{No pose yet}" in pb and "{Arms crossed}" not in pb)
live.remember_pose(b, "saved:My wave")
ok("a saved pose is named as saved", "{My wave (saved)}" in poses_panel(b) and "{Arms crossed}" in poses_panel(a))
live.remember_pose(a, None)
ok("after Reset pose it has none again", "{No pose yet}" in poses_panel(a))
b.harmonious_curl_r = 0.6
ok("each traveller keeps its own hand sliders", abs(b.harmonious_curl_r - 0.6) < 1e-6 and a.harmonious_curl_r == 0.0)

print("\n%d FAILED" % len(fails) if fails else "\nall passed", flush=True)
os._exit(1 if fails else 0)
