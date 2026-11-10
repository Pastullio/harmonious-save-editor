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
print('SHOWNAFTER', sum(1 for b in h.body_bones(arm) if not h.is_hidden(arm, b)), arm.data.bones.active.name if arm.data.bones.active else '')
print('PICTURE', bpy.ops.harmonious.pose_picture())
print('STATUS', h.STATE['status'])
h.unregister(); sys.stdout.flush(); os._exit(0)
`);
    let out = '';
    try { out = execFileSync(py, [script], { env: { ...process.env, HSE_LIVE_FILE: path.join(cfg, 'HarmoniousSaveEditor', 'live.json') }, timeout: 600000 }).toString(); } catch (e) { out = String(e.stdout || '') + e.message; }
    console.log(out.split('\n').filter((l) => /^(GAP|WORST|FINGER|PICK|SHOWN|Traceback|  File|\w+Error)/.test(l)).join('\n'));
    const line = (k) => (out.match(new RegExp('^' + k + ' (.*)$', 'm')) || [])[1] || '';
    ok('the add-on sees the traveller in the editor', line('TRAVELLER') === 'Pastullio');
    ok('Import my traveller brings in the skeleton', line('IMPORT').includes('FINISHED') && +line('BONES') > 200);
    ok('turning a bone moves the body', +line('MOVED') > 100);
    ok('the sticks are hidden until a part is clicked', line('SHOWN') === '0');
    const [gap, mirror] = line('GAP').split(' ').map(Number);
    ok('every bone starts where it joins the body', gap < 0.05 && mirror < 0.01);
    const [fmove] = line('FINGERMOVE').split(' ').map(Number);
    ok('turning a finger bends it at the hand', fmove > 0.002 && fmove < 0.06);
    const [want, got] = line('PICK').split(' ');
    ok('clicking the hand picks the bone that moves it', got && got !== 'None' && /r_(arm|hand)/.test(got));
    ok('…and shows just that stick', /^1 /.test(line('SHOWNAFTER')) && line('SHOWNAFTER').endsWith(got));
    const png = (line('STATUS').match(/Saved (.*\.png)/) || [])[1];
    ok('Save the pose as a picture writes a transparent PNG to Exports', png && fs.existsSync(png) && png.includes('Exports') && fs.readFileSync(png)[25] === 6);
  } else console.log('SKIP the add-on part (no bpy)');
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
