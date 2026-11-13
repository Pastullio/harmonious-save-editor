// Your traveller (owner, 2026-11-10): the Exosuit page builds the player from the save's descriptor groups and the
// game files, exports a rigged .glb, and the LiveLink add-on imports it ready to pose and renders the pose.
// Usage: node test/e2e/test_traveller.js <scratch dir with dbroot/NMS and bpyenv> <PCBANKS with the player character
//   and metadata/gamestate/playerdata (tools/extract-nms-player-files.bat + extract-nms-player-tables.bat, repacked)>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const [SP, BANKS] = process.argv.slice(2);
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  if (!BANKS) { console.log('SKIP (no player banks)'); return; }
  const T = path.join(SP, 'travtest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), cfg = path.join(T, 'cfg');
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48151'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_GAME: BANKS, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForFunction(() => S.lib && S.lib.game, null, { timeout: 120000 }).catch(() => {});
  const groups = await p.evaluate(() => travellerGroups());
  ok('the save names the traveller\'s look', groups.includes('^HEAD_ASTBOT2') && groups.length > 5);
  await p.click('nav button[data-s="exosuit"]'); await p.waitForSelector('.trav-top');
  ok('Exosuit shows your traveller, named', /Pastullio/.test(await p.textContent('.trav-top')));
  const t = await p.evaluate(async (gs) => (await api('/api/model/traveller?groups=' + encodeURIComponent(gs.join(',')))).json(), groups);
  ok('the look turns into the scene\'s parts', t.scene && t.names.includes('_Torso_Vykeen') && t.names.includes('_Chest_Builders3') && !t.missing.length);
  await p.waitForFunction(() => document.querySelector('.trav-top canvas'), null, { timeout: 30000 }).catch(() => {});
  await p.click('#travGlb');
  const glb = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports', 'Pastullio.glb');
  for (let k = 0; k < 40 && !fs.existsSync(glb); k++) await new Promise((r) => setTimeout(r, 250));
  ok('Export for Blender writes a .glb to Exports', fs.existsSync(glb) && fs.readFileSync(glb).subarray(0, 4).toString() === 'glTF');
  const gj = (() => { try { const b = fs.readFileSync(glb); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); } catch { return {}; } })();
  const texd = (gj.materials || []).filter((m) => m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture);
  ok('…with the game\'s textures (colour, normal, roughness and metal) when the game has them', (gj.images || []).length > 20 && texd.length > 20 && texd.some((m) => m.normalTexture) && texd.some((m) => m.pbrMetallicRoughness.metallicRoughnessTexture) && gj.images.every((im) => im.mimeType === 'image/jpeg'));
  const lk = await p.evaluate(() => travellerLook());
  ok('the save\'s colours and texture choices are read', lk && lk.c.length >= 10 && lk.c.some((x) => x.p === 'Custom_Torso' && x.a === 'Primary') && lk.t.some(([g2, o]) => g2 === 'TORSO_VYK' && o));
  const differ = await p.evaluate(async ([gs, l]) => {
    const get = async (q) => new Uint8Array(await (await api('/api/model/traveller/glb?groups=' + encodeURIComponent(gs.join(',')) + '&name=T' + q)).arrayBuffer());
    const a = await get(''), b = await get('&look=' + encodeURIComponent(JSON.stringify(l)));
    return a.length !== b.length || a.some((x, i) => x !== b[i]);
  }, [groups, lk]);
  ok('the save\'s own colours paint the textures', differ);
  // the files for working on textures: materials (and their textures, when the game has them) and the save's look
  await p.click('#travSample');
  const exp = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports');
  let zipf = '';
  for (let k = 0; k < 120 && !zipf; k++) { await new Promise((r) => setTimeout(r, 250)); zipf = (fs.readdirSync(exp).find((f) => /^Traveller files.*\.zip$/.test(f)) || ''); }
  const inZip = zipf ? execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(exp, zipf)]).toString() : '';
  ok('Save traveller files for the developer zips the materials and the save\'s look', /\.material\.mbin/.test(inZip) && /save-look\.json/.test(inZip) && /about\.txt/.test(inZip));
  await new Promise((r) => setTimeout(r, 1000));
  const live = await p.evaluate(async () => { const r = await api('/api/live/traveller'); return r.ok ? (await r.arrayBuffer()).byteLength : 0; });
  ok('the open save\'s traveller is ready for the add-on', live > 1e6);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  // the add-on in Blender's Python: Import my traveller, pose a bone, Save the pose as a picture
  const py = process.env.HSE_BPY || path.join(SP, 'bpyenv/bin/python');
  if (fs.existsSync(py)) {
    const script = path.join(T, 'addon.py');
    fs.writeFileSync(script, `import sys, os, math, bpy
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '../../desktop/addon'))})
bpy.ops.wm.read_factory_settings(use_empty=True)
import harmonious_live_link as h
h.register(); h.check_link_now()
print('TRAVELLER', h.LINK['traveller'])
print('IMPORT', bpy.ops.harmonious.import_traveller())
arm = h.find_traveller(); print('BONES', len(arm.data.bones))
mesh = max([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
pb = next(b for b in arm.pose.bones if b.name.endswith('r_arm_Shoulder'))
dg = bpy.context.evaluated_depsgraph_get(); before = [v.co.copy() for v in mesh.evaluated_get(dg).to_mesh().vertices]
pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, math.radians(-60)); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); after = mesh.evaluated_get(dg).to_mesh().vertices
print('MOVED', sum(1 for a, b in zip(before, after) if (a - b.co).length > 0.01))
s = bpy.context.scene; s.render.resolution_percentage = 20
w = arm.pose.bones['r_arm_Wrist']; r = arm.pose.bones['ROOT']
k1 = all(w.lock_location) and all(w.lock_scale) and not any(r.lock_location)
arm.harmonious_keep_shape = False
k2 = not any(w.lock_location) and not any(w.lock_scale)
arm.harmonious_keep_shape = True
print('KEEP', k1, k2, all(w.lock_location))
print('TEXTURED', sum(1 for m in bpy.data.materials if m.node_tree and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes)))
print('SHOWN', sum(1 for b in h.body_bones(arm) if not h.is_hidden(arm, b)))
# every bone sits where it joins the body: its head is close to the vertices it moves most
import mathutils, statistics
mw = mesh.matrix_world; aw = arm.matrix_world
gi = {g.index: g.name for g in mesh.vertex_groups}
own = {}
for v in mesh.data.vertices:
    for gg in v.groups:
        pass
    if v.groups:
        top = max(v.groups, key=lambda gg: gg.weight)
        if top.weight > 0.3: own.setdefault(gi[top.group], []).append(mw @ v.co)
for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
bpy.context.view_layer.update()
gaps = {}
for b in h.body_bones(arm):
    pts = own.get(b.name)
    if pts and len(pts) > 5: gaps[b.name] = min((p - aw @ b.head_local).length for p in pts)
pairs = [(b, arm.data.bones.get('r_' + b.name[2:])) for b in arm.data.bones if b.name.startswith('l_')]
mirror = max(((aw @ a.head_local) - (aw @ c.head_local) * mathutils.Vector((-1, 1, 1))).length for a, c in pairs if c)
print('GAP', round(statistics.median(gaps.values()), 4), round(mirror, 4))
print('WORST', sorted(gaps.items(), key=lambda x: -x[1])[:5])
# turning a finger turns it at the hand, not around a point in the air
fb = arm.pose.bones[max((n for n in own if n.startswith('r_hand_0')), key=lambda n: len(own[n]))]
print('FINGER', fb.name)
idx = mesh.vertex_groups[fb.name].index
vs = [v.index for v in mesh.data.vertices if v.groups and max(v.groups, key=lambda gg: gg.weight).group == idx]
dg = bpy.context.evaluated_depsgraph_get(); m0 = mesh.evaluated_get(dg).to_mesh(); p0 = [mw @ m0.vertices[i].co for i in vs]
fb.rotation_mode = 'XYZ'; fb.rotation_euler = (math.radians(45), 0, 0); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); m1 = mesh.evaluated_get(dg).to_mesh(); p1 = [mw @ m1.vertices[i].co for i in vs]
print('FINGERMOVE', round(max([(a - b).length for a, b in zip(p0, p1)] or [0]), 4), len(vs))
fb.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
# clicking the right hand shows only the bone that moves it
hb = arm.data.bones['r_arm_Wrist']
target = statistics.mean([p.x for p in own[hb.name]]), statistics.mean([p.y for p in own[hb.name]]), statistics.mean([p.z for p in own[hb.name]])
target = mathutils.Vector(target)
got = h.pick_ray(bpy.context, arm, target + mathutils.Vector((0, -3, 0)), mathutils.Vector((0, 1, 0)))
print('PICK', hb.name, got)
if got: h.show_bone(arm, got)
hp = [mw @ v.co for v in mesh.data.vertices if (mw @ v.co).z > 1.8 and abs((mw @ v.co).x) < 0.1]
hc = mathutils.Vector((statistics.mean(p.x for p in hp), statistics.mean(p.y for p in hp), statistics.mean(p.z for p in hp)))
hit = h.pick_ray(bpy.context, arm, hc + mathutils.Vector((0, -3, 0)), mathutils.Vector((0, 1, 0)))
h.show_bone(arm, hit)
print('HEADPICK', hit, arm.data.bones.active.name, round((aw @ arm.data.bones.active.head_local).z, 3))
h.show_bone(arm, got)
print('SHOWNAFTER', sum(1 for b in h.body_bones(arm) if not h.is_hidden(arm, b)), arm.data.bones.active.name if arm.data.bones.active else '')
# ready-made poses: each one moves the body, feet stay on the floor, and a saved pose comes back the same
names = [k for k, _n, _d in h.pose_items(None, bpy.context) if k.startswith('ready:')]
moved, floored = 0, 0
rest_ball = (aw @ arm.data.bones['l_leg_Ball'].head_local).z
for k in names:
    bpy.context.scene.harmonious_pose = k
    assert bpy.ops.harmonious.pose() == {'FINISHED'}
    if any(abs(pb.matrix_basis.to_quaternion().w - 1) > 1e-3 for pb in arm.pose.bones): moved += 1
    spec = next(x for x in h.POSES if 'ready:' + x[0] == k)
    if spec[3] == 'feet':
        lo = min((aw @ arm.pose.bones[n].head).z - (aw @ arm.data.bones[n].head_local).z for n in h.FEET)
        if abs(lo) < 0.005: floored += 1
    else: floored += 1
wrist = (aw @ arm.pose.bones['r_arm_Wrist'].head).copy()
bpy.ops.harmonious.pose_save('EXEC_DEFAULT', name='Test pose')
bpy.ops.harmonious.pose_reset()
back = h.pose_traveller(bpy.context, 'saved:Test pose')
print('POSES', len(names), moved, floored, back == '' and (aw @ arm.pose.bones['r_arm_Wrist'].head - wrist).length < 1e-3, os.path.exists(os.path.join(h.poses_dir(), 'Test pose.json')))
# picking a pose in the list puts it on at once (owner 2026-11-13: no Pose button)
h.clear_pose(arm); bpy.context.view_layer.update()
w0 = (aw @ arm.pose.bones['r_arm_Wrist'].head).copy()
bpy.context.scene.harmonious_pose = 'ready:Waving'; bpy.context.view_layer.update()
w1 = (aw @ arm.pose.bones['r_arm_Wrist'].head).copy()
thumbs = sorted(pb.name for pb in arm.pose.bones if '_hand_05_' in pb.name and 'harmonious_hinge' in pb)
print('INSTANT', (w1 - w0).length > 0.2, (w1.z - w0.z) > 0.3, len(thumbs))
print('SENDPOSE', bpy.ops.harmonious.send_pose(), bpy.context.mode)
print('PICTURE', bpy.ops.harmonious.pose_picture())
print('STATUS', h.STATE['status'])
# Best quality (Cycles) with a ready-made light setup and glowing lenses, at a tiny size
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = 40, 50
sc.harmonious_quality = 'BEST'; sc.harmonious_lighting = 'HERO'; sc.harmonious_glow = True
before = set(os.listdir(h.LINK.get('exports') or '.'))
r = bpy.ops.harmonious.pose_picture()
coll = bpy.data.collections.get('Harmonious lights')
newpng = [f for f in set(os.listdir(h.LINK.get('exports') or '.')) - before if f.endswith('.png')]
glowing = sum(1 for o in h.traveller_meshes(arm) for m in o.data.materials if m and m.use_nodes and any(x.type == 'BSDF_PRINCIPLED' and (x.inputs.get('Emission Strength') is not None and x.inputs['Emission Strength'].default_value > 0) for x in m.node_tree.nodes))
sc.harmonious_lighting = 'STUDIO'; n2 = len(bpy.data.collections['Harmonious lights'].objects)   # picking it places them
sc.harmonious_glow = False
glow_off = sum(1 for o in h.traveller_meshes(arm) for m in o.data.materials if m and m.use_nodes and any(x.type == 'BSDF_PRINCIPLED' and (x.inputs.get('Emission Strength') is not None and x.inputs['Emission Strength'].default_value > 0) for x in m.node_tree.nodes))
print('LIGHTS', 'FINISHED' in r, sc.render.engine, len(coll.objects) if coll else 0, len(newpng), glowing, n2, glow_off, sc.get('harmonious_lit'))
lname = bpy.data.collections['Harmonious lights'].objects[0].name
bpy.ops.harmonious.pose_mode() if bpy.context.mode != 'POSE' else None
pm = bpy.context.mode
bpy.ops.harmonious.select_light(name=lname)
print('SELLIGHT', pm, bpy.context.mode, bpy.context.view_layer.objects.active.name == lname, len(h.scene_lights(sc)))
sc.harmonious_quality = 'QUICK'; sc.harmonious_glow = True
# every panel draws (a stand-in layout records the calls), each one its own panel in the LiveLink tab
class FakeLayout:
    def __init__(self): self.calls = []
    def __getattr__(self, name):
        def f(*a, **k):
            self.calls.append((name, a, k))
            return FakeLayout() if name in ('row', 'column', 'box', 'grid_flow', 'split') else _Props()
        return f
class _Props:
    def __setattr__(self, k, v): pass
import types
def stand_in(c, lay):
    class P:
        def __getattr__(self, n):
            v = getattr(c, n)
            return types.MethodType(v, self) if isinstance(v, types.FunctionType) else v
    o = P(); o.layout = lay; return o
panels = [c for c in h.CLASSES if issubclass(c, bpy.types.Panel)]
drawn = []
for c in panels:
    if hasattr(c, 'poll') and not c.poll(bpy.context): continue
    lay = FakeLayout()
    try:
        inst = stand_in(c, lay)
        c.draw(inst, bpy.context)
        if hasattr(c, 'draw_header'): c.draw_header(inst, bpy.context)
        if hasattr(c, 'draw_header_preset'): c.draw_header_preset(inst, bpy.context)
        drawn.append(c.bl_label)
    except Exception as e:
        drawn.append('ERR ' + c.bl_label + ': ' + repr(e))
m0 = bpy.context.mode; bpy.ops.harmonious.pose_mode(); m1 = bpy.context.mode; bpy.ops.harmonious.pose_mode(); m2 = bpy.context.mode
bpy.ops.harmonious.pose_mode(mode='POSE'); m3 = bpy.context.mode; bpy.ops.harmonious.pose_mode(mode='POSE'); m4 = bpy.context.mode
bpy.ops.harmonious.pose_mode(mode='OBJECT'); m5 = bpy.context.mode
print('MODES', m0, m1, m2, m3, m4, m5)
cams = [o for o in bpy.data.objects if o.type == 'CAMERA']
rc = bpy.ops.harmonious.camera()
print('CAMERA', 'FINISHED' in rc, bpy.context.view_layer.objects.active is not None and bpy.context.view_layer.objects.active.type == 'CAMERA', len([o for o in bpy.data.objects if o.type == 'CAMERA']) == max(1, len(cams)), bpy.context.scene.camera.data.show_passepartout)
print('ICONS', len(h.ICONS), 'icon_value' in h.ic('build'), 'icon_value' in h.ic('pose'), 'icon_value' in h.ic('logo'))
print('PANELS', '|'.join(drawn), '|parents:' + ','.join(c.bl_label for c in panels if getattr(c, 'bl_parent_id', None)))
# the hand's two fingers have joints of their own, and fingers, elbows and knees bend like real ones
import math
split = sorted(b.name for b in arm.data.bones if '_03b_' in b.name)
hinges = {pb.name: pb['harmonious_hinge'] for pb in arm.pose.bones if 'harmonious_hinge' in pb}
locked_ok = all(sum(arm.pose.bones[n].lock_rotation) == 2 and arm.pose.bones[n].rotation_mode == 'XYZ' for n in hinges)
mesh = h.traveller_meshes(arm)[0]
def tips(group):
    g = mesh.vertex_groups[group]; ids = [v.index for v in mesh.data.vertices if any(e.group == g.index and e.weight > .5 for e in v.groups)]
    dg = bpy.context.evaluated_depsgraph_get(); em = mesh.evaluated_get(dg).to_mesh()
    c = sum((em.vertices[i].co for i in ids), mathutils.Vector()) / max(1, len(ids)); mesh.evaluated_get(dg).to_mesh_clear(); return mesh.matrix_world @ c
bpy.context.scene.harmonious_pose = 'ready:Standing'; bpy.ops.harmonious.pose(); bpy.context.view_layer.update()
a0, b0 = tips('r_hand_03_03'), tips('r_hand_03b_03')
pb = arm.pose.bones['r_hand_03b_01']; e = list(pb.rotation_euler); e[pb['harmonious_hinge']] += h.curl_sign(arm, pb) * math.radians(60); pb.rotation_euler = e; bpy.context.view_layer.update()
a1, b1 = tips('r_hand_03_03'), tips('r_hand_03b_03')
one = (a1 - a0).length < 1e-4 and (b1 - b0).length > 0.01
pb.rotation_euler = (0, 0, 0)
bpy.context.scene.harmonious_curl_r = 1.0; bpy.context.view_layer.update()
wrist = arm.matrix_world @ arm.pose.bones['r_arm_Wrist'].head
f0 = (b0 - wrist).length; c1 = tips('r_hand_03b_03'); f1 = (c1 - wrist).length
bpy.context.scene.harmonious_curl_r = 0.0
arm.harmonious_natural = False; unlocked = all(sum(arm.pose.bones[n].lock_rotation) == 0 for n in hinges); arm.harmonious_natural = True
# the other joints turn as far as a person's: elbows bend forwards (not back) and the forearm twists; knees bend back
h.clear_pose(arm); bpy.context.view_layer.update()
def wpos(n): return arm.matrix_world @ arm.pose.bones[n].head
fwd = h.body_frame(arm)[0]
limited = [pb.name for pb in arm.pose.bones if pb.constraints.get(h.NATURAL)]
def bend(joint, end, deg):
    pb = arm.pose.bones[joint]; c = pb.constraints[h.NATURAL]
    fi = next(i for i, k in enumerate('xyz') if getattr(c, 'use_limit_' + k) and min(abs(getattr(c, 'min_' + k)), abs(getattr(c, 'max_' + k))) < 1e-4)
    allowed = 1 if getattr(c, 'max_' + 'xyz'[fi]) > 1e-3 else -1
    p0 = wpos(end); e = [0, 0, 0]; e[fi] = allowed * math.radians(deg); pb.rotation_euler = e; bpy.context.view_layer.update(); p1 = wpos(end)
    e[fi] = -allowed * math.radians(deg); pb.rotation_euler = e; bpy.context.view_layer.update(); p2 = wpos(end)
    pb.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
    return (p1 - p0).dot(fwd), (p2 - p0).length
el_fwd, el_back = bend('r_arm_Elbow', 'r_arm_Wrist', 80); el2 = bend('l_arm_Elbow', 'l_arm_Wrist', 80); el_fwd, el_back = min(el_fwd, el2[0]), max(el_back, el2[1])
kn_fwd, kn_back = bend('l_leg_Knee', 'l_leg_Ankle', 80); kn2 = bend('r_leg_Knee', 'r_leg_Ankle', 80); kn_fwd, kn_back = max(kn_fwd, kn2[0]), max(kn_back, kn2[1])
pb = arm.pose.bones['r_arm_Elbow']; t0 = wpos('r_hand_05_01'); pb.rotation_euler = (math.radians(60), 0, 0); bpy.context.view_layer.update(); twist = (wpos('r_hand_05_01') - t0).length; pb.rotation_euler = (0, 0, 0)
arm.harmonious_natural = False; freed = not any(pb.constraints.get(h.NATURAL) for pb in arm.pose.bones); arm.harmonious_natural = True
print('LIMITS', len(limited), round(el_fwd, 3), round(el_back, 3), round(kn_fwd, 3), round(kn_back, 3), round(twist, 3), freed)
# no piece of a finger is shared by both fingers (it would stretch when one finger moves)
import collections
mixed = 0
for m in h.traveller_meshes(arm):
    gn = {g.index: g.name for g in m.vertex_groups}
    fing = {}
    for v in m.data.vertices:
        for e in v.groups:
            n = gn.get(e.group, '')
            if e.weight > .001 and ('_hand_03_' in n or '_hand_03b_' in n): fing.setdefault(v.index, set()).add(n[:2] + ('b' if '_03b_' in n else 'a'))
    adj = collections.defaultdict(list)
    for ed in m.data.edges:
        a, b = ed.vertices
        if a in fing and b in fing: adj[a].append(b); adj[b].append(a)
    seen = set()
    for i in fing:
        if i in seen: continue
        st = [i]; seen.add(i); kinds = set()
        while st:
            x = st.pop(); kinds |= fing[x]
            for y in adj[x]:
                if y not in seen: seen.add(y); st.append(y)
        if any(k[:2] + 'a' in kinds and k[:2] + 'b' in kinds for k in kinds): mixed += 1
print('FINGERS', len(split), len(hinges), locked_ok, one, round(f0, 3), round(f1, 3), unlocked, mixed)
# a corvette in 3D: every visible mesh of the file (not the traveller), instances made real, goes to the editor
cube = bpy.data.objects.new('hull', bpy.data.meshes.new('hull')); bpy.context.scene.collection.objects.link(cube)
import bmesh; bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2.0); bm.to_mesh(cube.data); bm.free(); cube.location = (5, 0, 0)
part = bpy.data.collections.new('wing'); w = bpy.data.objects.new('wingpart', cube.data); part.objects.link(w)
inst = bpy.data.objects.new('wing instance', None); inst.instance_type = 'COLLECTION'; inst.instance_collection = part; inst.location = (8, 0, 0); bpy.context.scene.collection.objects.link(inst)
bpy.context.scene.harmonious_target_slot = 2; bpy.context.scene.harmonious_target_name = 'Test Corvette'
before_ship = set(os.listdir(h.LINK.get('exports') or '.'))
rs = bpy.ops.harmonious.send_ship()
shipf = [f for f in set(os.listdir(h.LINK.get('exports') or '.')) - before_ship if ' 3D ship ' in f]
left = [o.name for o in bpy.data.objects if o.name.startswith('part')]
print('SHIP', 'FINISHED' in rs, shipf[0] if shipf else '-', len(left))
bpy.data.objects.remove(cube); bpy.data.objects.remove(inst); bpy.data.objects.remove(w)
bpy.context.scene.harmonious_target_slot = -1; bpy.context.scene.harmonious_target_name = ''
# a corvette .blend behind the traveller (owner 2026-11-13): its scene comes in, minus lights and cameras, what was
# left out of the view stays out, an empty moves it, and it can be taken out again
src = bpy.data.scenes.new('ship scene')
hull = bpy.data.objects.new('ship hull', bpy.data.meshes.new('ship hull')); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=20.0); bm.to_mesh(hull.data); bm.free()
kept = bpy.data.collections.new('ship parts'); src.collection.children.link(kept); kept.objects.link(hull)
lib = bpy.data.collections.new('part library'); src.collection.children.link(lib)
spare = bpy.data.objects.new('spare part', bpy.data.meshes.new('spare part')); lib.objects.link(spare)
src.view_layers[0].layer_collection.children['part library'].exclude = True
lamp = bpy.data.objects.new('ship lamp', bpy.data.lights.new('ship lamp', 'POINT')); kept.objects.link(lamp)
shipblend = os.path.join(h.LINK.get('exports') or '.', 'backdrop test.blend')
bpy.data.libraries.write(shipblend, {src}, fake_user=False)
bpy.data.scenes.remove(src); bpy.data.objects.remove(hull); bpy.data.objects.remove(spare); bpy.data.objects.remove(lamp)
bpy.data.collections.remove(kept); bpy.data.collections.remove(lib)
rb = bpy.ops.harmonious.add_blend(filepath=shipblend)
bd = h.backdrops()
got = bd[0] if bd else None
hulls = [o for o in got.all_objects if o.name.startswith('ship hull')] if got else []
lamps = [o for o in got.all_objects if o.type == 'LIGHT'] if got else []
inst = next((o for o in got.objects if o.instance_type == 'COLLECTION'), None) if got else None
shown = [o.name.split('.')[0] for o in inst.instance_collection.all_objects] if inst else []
# the build shows through one instancing empty (no dotted line from each part), the left-out library isn't in it
left_out = 'ship hull' in shown and 'spare part' not in shown and not any(o.parent is not None for o in got.all_objects if o.name.startswith('ship hull'))
lcs = {'part library': left_out}
fwd = h.body_frame(arm)[0]
behind = inst is not None and (inst.matrix_world.translation - aw.translation).dot(fwd) < -5
mover = bpy.context.view_layer.objects.active; mover = mover is not None and mover.name.endswith('(move me)')
rr = bpy.ops.harmonious.backdrop(name=got.name, action='REMOVE') if got else None
gone = not h.backdrops() and not any(o.name.startswith(('ship hull', 'spare part')) for o in bpy.data.objects)
print('BACKDROP', 'FINISHED' in rb, len(hulls), len(lamps), lcs.get('part library'), bool(behind), mover, gone)
os.remove(shipblend)
# a miniature for 3D printing (owner 2026-11-13): one closed solid on a round base, the asked height, an STL in mm
import struct
sc = bpy.context.scene
sc.harmonious_print_size = 'CUSTOM'; sc.harmonious_print_detail = 'QUICK'; sc.harmonious_print_keep = True; sc.harmonious_print_height = 30.0
before_stl = set(os.listdir(h.LINK.get('exports') or '.'))
rp = bpy.ops.harmonious.print()
stl = [f for f in set(os.listdir(h.LINK.get('exports') or '.')) - before_stl if f.endswith('.stl')]
tri, zmax, open_edges = 0, 0, -1
if stl:
    data = open(os.path.join(h.LINK['exports'], stl[0]), 'rb').read(); tri = struct.unpack('<I', data[80:84])[0]
    import numpy as np
    rec = np.frombuffer(data[84:84 + tri * 50], dtype=[('n', '<f4', 3), ('v', '<f4', 9), ('x', '<u2')])
    zs = rec['v'][:, 2::3]; zmax = float(zs.max() - zs.min())
    os.remove(os.path.join(h.LINK['exports'], stl[0]))
chk = bpy.data.objects.get('Miniature to check')
if chk is not None:
    bmc = bmesh.new(); bmc.from_mesh(chk.data); open_edges = sum(1 for e in bmc.edges if len(e.link_faces) != 2); bmc.free()
    bpy.data.objects.remove(chk)
print('PRINT', 'FINISHED' in rp, len(stl), tri, round(zmax, 1), open_edges, not any(o.name.startswith('Miniature') and o.name != 'Miniature to check' for o in bpy.data.objects))
sc.harmonious_print_keep = False
# an action figure with the game's own triangles: the preset's height, the base fitted to it, Auto detail by size
sc.harmonious_print_size = 'FIGURE'; sc.harmonious_print_detail = 'ORIGINAL'
before_stl = set(os.listdir(h.LINK.get('exports') or '.'))
rp2 = bpy.ops.harmonious.print()
stl2 = [f for f in set(os.listdir(h.LINK.get('exports') or '.')) - before_stl if f.endswith('.stl')]
z2 = 0
if stl2:
    data = open(os.path.join(h.LINK['exports'], stl2[0]), 'rb').read(); t2 = struct.unpack('<I', data[80:84])[0]
    rec = np.frombuffer(data[84:84 + t2 * 50], dtype=[('n', '<f4', 3), ('v', '<f4', 9), ('x', '<u2')]); zs = rec['v'][:, 2::3]; z2 = float(zs.max() - zs.min())
    os.remove(os.path.join(h.LINK['exports'], stl2[0]))
sc.harmonious_print_detail = 'AUTO'
print('PRINTSIZES', 'FINISHED' in rp2, round(z2), h.print_base_mm(sc), h.print_detail(sc), h.print_detail(sc, 32), h.print_detail(sc, 60))
sc.harmonious_print_size = 'TABLETOP'
# Body parts: pick several, each turns at its own joint; picking one again lets go of it
have = [q[0] for q in h.BODY_PARTS if h.part_bones(arm, q)[0]]
bpy.ops.harmonious.body_parts_clear(); bpy.ops.harmonious.body_part(part='front'); bpy.ops.harmonious.body_part(part='backpack')
both = h.part_on(arm, h.BODY_PARTS[[q[0] for q in h.BODY_PARTS].index('front')]) and h.part_on(arm, h.BODY_PARTS[[q[0] for q in h.BODY_PARTS].index('backpack')])
nsel = sum(1 for b in arm.data.bones if h.is_selected(arm, b))
pivot = bpy.context.scene.tool_settings.transform_pivot_point
bpy.ops.harmonious.body_part(part='front')
after = [h.part_on(arm, q) for q in h.BODY_PARTS if q[0] in ('front', 'backpack')]
bpy.ops.harmonious.body_parts_clear()
left = sum(1 for b in arm.data.bones if h.is_selected(arm, b))
print('PARTS', ','.join(have), both, nsel, pivot, after, left)
# a multi-tool in the right hand, following the hand from pose to pose
hold = 'none'
if h.LINK.get('tools'):
    bpy.context.scene.harmonious_tool = '0'
    r = bpy.ops.harmonious.hold_tool()
    held = h.held_tools(arm)
    def centre():
        pts = [o.matrix_world @ v.co for o in held for v in o.data.vertices]
        return sum(pts, mathutils.Vector()) / len(pts)
    hand = lambda: aw @ arm.pose.bones['r_arm_Wrist'].head
    d1 = (centre() - hand()).length
    bpy.context.scene.harmonious_pose = 'ready:Standing'; bpy.ops.harmonious.pose(); bpy.context.view_layer.update()
    d2 = (centre() - hand()).length
    bpy.ops.harmonious.drop_tool()
    hold = '%s %d %.3f %.3f %d' % ('FINISHED' in r, len(held), d1, d2, len(h.held_tools(arm)))
print('HOLD', hold)
h.unregister(); sys.stdout.flush(); os._exit(0)
`);
    let out = '';
    try { out = execFileSync(py, [script], { env: { ...process.env, HSE_LIVE_FILE: path.join(cfg, 'HarmoniousSaveEditor', 'live.json') }, timeout: 600000 }).toString(); } catch (e) { out = String(e.stdout || '') + e.message; }
    console.log(out.split('\n').filter((l) => /^(GAP|WORST|LIMITS|INSTANT|BACKDROP|PRINT|PRINTSIZES|CAMERA|FINGER|KEEP|HEADPICK|POSES|SENDPOSE|PICK|SHOWN|HOLD|PARTS|PANELS|MODES|LIGHTS|SELLIGHT|ICONS|FINGERS|SHIP|Traceback|  File|\w+Error)/.test(l)).join('\n'));
    const line = (k) => (out.match(new RegExp('^' + k + ' (.*)$', 'm')) || [])[1] || '';
    ok('the add-on sees the traveller in the editor', line('TRAVELLER') === 'Pastullio');
    ok('Import my traveller brings in the skeleton', line('IMPORT').includes('FINISHED') && +line('BONES') > 200);
    ok('turning a bone moves the body', +line('MOVED') > 100);
    ok('bones keep the body\'s proportions (only the root moves), and that can be turned off', line('KEEP') === 'True True True');
    const [np, nm, nf, same, file] = line('POSES').split(' ');
    ok('ready-made poses: every one moves the body and keeps the feet on the floor', +np >= 15 && nm === np && nf === np);
    const ins = line('INSTANT').split(' ');
    ok('picking a pose in the list puts it on at once (Waving raises the right hand)', ins[0] === 'True' && ins[1] === 'True');
    ok('…and the thumbs bend like hinges too (' + ins[2] + ')', +ins[2] === 6);
    ok('…and a saved pose goes to the Poses folder and comes back the same', same === 'True' && file === 'True');
    const g3 = fs.readdirSync(path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports')).find((f) => / 3D pose .*\.glb$/.test(f));
    const gj3 = (() => { try { const bb = fs.readFileSync(path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports', g3)); return JSON.parse(bb.subarray(20, 20 + bb.readUInt32LE(12)).toString()); } catch { return {}; } })();
    ok('Send the pose to the editor puts a textured 3D pose in Exports, the pose baked in', /FINISHED/.test(line('SENDPOSE')) && /POSE/.test(line('SENDPOSE')) && g3 && (gj3.images || []).length > 10 && !(gj3.skins || []).length);
    ok('…with the lenses and screens glowing (emissive)', (gj3.materials || []).some((m) => m.emissiveFactor && m.emissiveFactor.some((v) => v > 0)));
    ok('Blender shows the game\'s textures', +line('TEXTURED') > 20);
    ok('the sticks are hidden until a part is clicked', line('SHOWN') === '0');
    const [gap, mirror] = line('GAP').split(' ').map(Number);
    ok('every bone starts where it joins the body', gap < 0.05 && mirror < 0.01);
    const [fmove] = line('FINGERMOVE').split(' ').map(Number);
    ok('turning a finger bends it at the hand', fmove > 0.002 && fmove < 0.06);
    const [want, got] = line('PICK').split(' ');
    ok('clicking the hand picks the bone that moves it', got && got !== 'None' && /r_(arm|hand)/.test(got));
    const [hpick, hact, hz] = line('HEADPICK').split(' ');
    ok('clicking the head turns it at the neck', hpick === 'head_Top' && hact === 'neck_01_02' && +hz < 1.75);
    ok('…and shows just that stick', /^1 /.test(line('SHOWNAFTER')) && line('SHOWNAFTER').endsWith(got));
    const lt = line('LIGHTS').split(' ');
    ok('Best quality renders with Cycles, the Hero lights placed round the traveller and the lenses glowing (' + lt.join(' ') + ')', lt[0] === 'True' && lt[1] === 'CYCLES' && lt[2] === '3' && lt[3] === '1' && +lt[4] > 3);
    ok('…picking Studio puts its lights there at once, and the glow turns off', lt[5] === '3' && lt[6] === '0' && lt[7] === 'STUDIO');
    const sl = line('SELLIGHT').split(' ');
    ok('a light picked in the panel leaves Pose mode and is selected, ready for G and R (' + sl.join(' ') + ')', sl[0] === 'POSE' && sl[1] === 'OBJECT' && sl[2] === 'True' && +sl[3] >= 3);
    const ics = line('ICONS').split(' ');
    ok('the round logo and the coloured icons load as Blender previews (' + ics.join(' ') + ')', +ics[0] >= 14 && ics.slice(1).every((x) => x === 'True'));
    const sh = line('SHIP').split(' ');
    const shipFile = sh.slice(1, -1).join(' ');
    let shipMeshes = 0;
    if (shipFile !== '-') { const g = fs.readFileSync(path.join(exp, shipFile)), jl = g.readUInt32LE(12), j = JSON.parse(g.slice(20, 20 + jl).toString()); shipMeshes = (j.meshes || []).length; fs.rmSync(path.join(exp, shipFile)); }
    ok('Send the corvette in 3D sends the file\'s meshes (instances too, not the traveller) and tidies up after (' + sh.join(' ') + ', ' + shipMeshes + ' meshes)', sh[0] === 'True' && /^Test Corvette 3D ship .*\.glb$/.test(shipFile) && shipMeshes === 2 && sh[sh.length - 1] === '0');
    const pn = line('PANELS').replace(' |parents:', '|parents:');
    ok('the add-on\'s sections are panels of their own that draw: ' + pn, ['LiveLink', 'Builds: corvettes and bases', 'Your traveller', 'Poses', 'Body parts', 'Multi-tool', 'Lighting & Rendering', 'Export', 'Support the creator'].every((l) => pn.split('|').includes(l)) && !/ERR/.test(pn) && /\|parents:$/.test(pn));
    const md = line('MODES').split(' ');
    ok('Pose Mode / Object Mode switch between Pose and Object mode (' + md.join(' ') + ')', md[1] !== md[0] && md[2] === md[0] && md[3] === 'POSE' && md[4] === 'POSE' && md[5] === 'OBJECT');
    const cm = line('CAMERA').split(' ');
    ok('Traveller camera selects the camera (one only), its outside darkened in the camera view (' + cm.join(' ') + ')', cm.every((x) => x === 'True'));
    const fg = line('FINGERS').split(' ');
    ok('each hand\'s second finger has joints of its own (' + fg.join(' ') + ')', fg[0] === '6');
    ok('…fingers bend one way only, like real ones', +fg[1] >= 12 && fg[2] === 'True');
    const lm = line('LIMITS').split(' ');
    ok('the other joints turn as far as a person\'s (' + lm.join(' ') + ')', +lm[0] >= 20);
    ok('…an elbow bends forwards but not backwards', +lm[1] > .05 && +lm[2] < .02);
    ok('…a knee bends backwards but not forwards', +lm[3] < -.05 && +lm[4] < .02);
    ok('…the forearm twists', +lm[5] > .005);
    ok('…and Natural joints off frees them', lm[6] === 'True');
    ok('…turning one finger leaves the other where it was', fg[3] === 'True');
    ok('…the hand slider curls the fingers in towards the palm (a fist)', +fg[5] < +fg[4] - .01);
    ok('…and Natural joints off frees them again', fg[6] === 'True');
    ok('…and no piece of a finger is shared by both fingers, so they don\'t stretch (' + fg[7] + ' shared)', fg[7] === '0');
    const bk = line('BACKDROP').split(' ');
    ok('Add a corvette .blend brings its scene in behind the traveller, without its lights, the left-out collection still left out, and it comes out again (' + bk.join(' ') + ')', bk.every((x) => x === 'True' || x === '1' || x === '0') && bk[0] === 'True' && bk[1] === '1' && bk[2] === '0' && bk[3] === 'True' && bk[4] === 'True' && bk[5] === 'True' && bk[6] === 'True');
    const pr = line('PRINT').split(' ');
    ok('Export for 3D printing writes one closed solid STL at the height asked for, on its base (' + pr.join(' ') + ')', pr[0] === 'True' && pr[1] === '1' && +pr[2] > 20000 && Math.abs(+pr[3] - 33) < 1.5 && pr[4] === '0' && pr[5] === 'True');
    const ps = line('PRINTSIZES').split(' ');
    ok('…sizes: an action figure is 152 mm on a fitted base, the game mesh as is, and Auto gives bigger prints more detail (' + ps.join(' ') + ')', ps[0] === 'True' && Math.abs(+ps[1] - 155) <= 2 && ps[2] === '90' && ps[3] === 'ULTRA' && ps[4] === 'NORMAL' && ps[5] === 'HIGH');
    const parts = line('PARTS');
    ok('Body parts lists the traveller\'s parts (' + parts.split(' ')[0] + ')', ['head', 'torso', 'r_arm', 'l_leg', 'backpack', 'front', 'whole'].every((k) => parts.split(' ')[0].split(',').includes(k)));
    ok('…several can be picked at once, each turning at its own joint, and picking one again lets go of it only', / True 4 INDIVIDUAL_ORIGINS \[True, False\] 0$/.test(parts) || / True 4 INDIVIDUAL_ORIGINS \[False, True\] 0$/.test(parts), parts);
    const hold = line('HOLD').split(' ');
    if (hold[0] === 'none') console.log('(no multi-tools in the test save)');
    else ok('Hold it puts the multi-tool in the right hand, it follows the hand, and Put it away removes it', hold[0] === 'True' && +hold[1] > 0 && +hold[2] < 0.6 && Math.abs(+hold[3] - +hold[2]) < 0.05 && hold[4] === '0');
    const png = (line('STATUS').match(/Saved (.*\.png)/) || [])[1];
    ok('Save the pose as a picture writes a transparent PNG to Exports', png && fs.existsSync(png) && png.includes('Exports') && fs.readFileSync(png)[25] === 6);
  } else console.log('SKIP the add-on part (no bpy)');
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
