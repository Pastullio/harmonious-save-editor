const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
// The staff builder (owner 2026-11-23). Part 1 runs in the browser build on the synthetic fixture, with multi-tools made
// here in the shape of the owner's real ones (the seed on the entry, Resource.Seed unset, CustomisationData). Part 2
// (with a scratch dir) runs the app with stand-in answers for the three model calls, to drive the 3D staff and the
// colour pickers, which need game files this test doesn't have.
// Usage: node test/e2e/test_staff.js <fixture dir> [scratch dir]   (SHOTS=<dir> for pictures)
const FX = process.argv[2], SP = process.argv[3]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const SHOTS = process.env.SHOTS;
const makeTools = () => {
  const tool = (file, seed, cls, groups) => fromPlain(C.parseJSON(JSON.stringify({ Layout: { Slots: 10, Seed: [true, '0x1'], Level: 1 },
    Store: { Slots: [{ Type: { InventoryType: 'Technology' }, Id: '^SCANBINOC1', Amount: 100, MaxAmount: 100, DamageFactor: 0.5, FullyInstalled: true, AddedAutomatically: false, Index: { X: 1, Y: 0 } }], ValidSlotIndices: [{ X: 0, Y: 0 }, { X: 1, Y: 0 }], Class: { InventoryClass: cls },
      StackSizeGroup: { InventoryStackSizeGroup: 'Default' }, BaseStatValues: [], SpecialSlots: [], Width: 10, Height: 10, IsCool: false, Name: '', Version: 1, NumSlotsFromTech: 0 },
    ScreenData: { ScreenScale: 0.029999999329447746, ScreenOffset: [0.019999999552965164, 0.11999999731779099, -0.05000000074505806], ScreenRotation: [0.5, 1.5, 0.5, 2.792526960372925] },
    Seed: [true, seed], CustomisationData: { DescriptorGroups: groups || [], PaletteID: '^', Colours: [], TextureOptions: [], BoneScales: [], Scale: 1.5 }, Name: '', IsLarge: false, PrimaryMode: 16, SecondaryMode: 9, UseLegacyColours: true,
    Resource: { Filename: file, Seed: [false, '0x0'], ProceduralTexture: { Samplers: [] }, AltId: '' } }).replace(/"DamageFactor":0\.5/, '"DamageFactor":0.0')));
  const a = tool('MODELS/COMMON/WEAPONS/MULTITOOL/MULTITOOL.SCENE.MBIN', '0x63AA6FE7FA976887', 'A');
  set(ps(), 'Multitools', [a, blankEntity(a), blankEntity(a), blankEntity(a), blankEntity(a), blankEntity(a)]); set(ps(), 'ActiveMultioolIndex', N(0));
  const cc = () => fromPlain(C.parseJSON(JSON.stringify({ SelectedPreset: '^', CustomData: { DescriptorGroups: [], PaletteID: '^', Colours: [], TextureOptions: [], BoneScales: [], Scale: 1.5 } })));
  set(ps(), 'CharacterCustomisationData', Array.from({ length: 26 }, cc));
};
const staffAt = (i) => { const t = toPlain(g(ps(), 'Multitools')[i]); const j = JSON.parse(C.stringifyJSON(t)); return j; };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../dist/nms-save-editor.html'));
  await p.setInputFiles('#filePick', [path.join(FX, 'save3.hg'), path.join(FX, 'mf_save3.hg')]); await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(makeTools);
  console.log('     the fixture\'s keys are ' + (await p.evaluate(() => (S.obf ? 'obfuscated' : 'plain'))));
  ok('a multi-tool\'s seed is the entry\'s own when Resource.Seed is unset', await p.evaluate(() => str(seedOf(g(ps(), 'Multitools')[0])[1]) === '0x63AA6FE7FA976887' && coverItems().find((x) => x.kind === 'tool').seed === '0x63AA6FE7FA976887'));
  // the builder in the Add window
  await p.evaluate(() => go('tools')); await p.click('#addTool'); await p.waitForSelector('#dlg[open] [data-tab="staff"]');
  await p.waitForSelector('#sbHost .sb-tile');
  ok('Add a multi-tool opens on Build a staff', (await p.$eval('[data-tab="staff"]', (x) => x.getAttribute('aria-selected'))) === 'true' && (await p.$eval('[data-pane="code"]', (x) => x.hidden)));
  const tiles = await p.$$eval('#sbHost .parts-group', (l) => l.map((x) => [...x.querySelectorAll('.sb-tile')].map((t) => t.textContent.trim())));
  ok('seven heads, six cores and six poles, by their names', tiles.length === 3 && tiles[0].length === 7 && tiles[1].length === 6 && tiles[2].length === 6 && tiles[0][4] === 'Reclaimed Head' && tiles[1][0] === 'Atlantideum Chamber' && tiles[2][5] === 'Runic Beam');
  ok('without the game files it says so and still builds', /need the game files/.test(await p.textContent('#sbHost .sb-pic')) && /standard colours/.test(await p.textContent('#sbHost .sb-cols')));
  await p.click('#sbHost .sb-tile[data-g="STAFF_HEAD_5A"]'); await p.click('#sbHost .sb-tile[data-g="STAFF_CORE_5"]'); await p.click('#sbHost .sb-tile[data-g="STAFF_POLE_2"]');
  ok('the chosen parts are marked and named', (await p.$$eval('#sbHost .sb-tile.on', (l) => l.map((x) => x.dataset.g).join())) === 'STAFF_HEAD_5A,STAFF_CORE_5,STAFF_POLE_2' && (await p.textContent('#sbHost [data-sb="what"]')) === 'Reclaimed Head · Reclaimed Grip · Salvaged Shaft');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'staff-browser.png') });
  await p.fill('#sbName', 'Old Bones'); await p.selectOption('#sbCls', 'S'); await p.click('#sbAdd'); await p.waitForFunction(() => !document.querySelector('#dlg').open);
  const s1 = await p.evaluate(staffAt, 1), d0 = await p.evaluate(staffAt, 0);
  const cd = s1.CustomisationData;
  ok('the staff lands in the first empty slot with the staff model and its three parts', s1.Resource.Filename === 'MODELS/COMMON/WEAPONS/MULTITOOL/STAFFMULTITOOL.SCENE.MBIN' && JSON.stringify(cd.DescriptorGroups) === '["^STAFF_HEAD_5A","^STAFF_CORE_5","^STAFF_POLE_2"]' && s1.Name === 'Old Bones');
  ok('it holds a colour for every palette and alternative, as the game writes them', cd.Colours.length === 330 && JSON.stringify(cd.Colours[0]) === '{"Palette":{"Palette":"Grass","ColourAlt":"Primary","Index":-1},"Colour":[0.631,0.333,0.02,1]}' && cd.Colours[329].Palette.Palette === 'Hulk' && cd.Colours[329].Palette.ColourAlt === 'Alternative4' && cd.Scale === 1.5 && cd.PaletteID === '^');
  ok('it is a large tool that uses its stored colours, with a staff\'s screen place, a new seed of its own and the class asked for', s1.IsLarge === true && s1.UseLegacyColours === false && d0.UseLegacyColours === true && s1.ScreenData.ScreenOffset[2] === -0.10000000149011612 && s1.ScreenData.ScreenRotation[3] === 1.9198620319366455 && s1.Seed[0] === true && /^0x[0-9A-F]{16}$/.test(s1.Seed[1]) && s1.Seed[1] !== d0.Seed[1] && JSON.stringify(s1.Resource.Seed) === '[false,"0x0"]' && s1.Store.Class.InventoryClass === 'S');
  ok('the technology and size come from the tool it copies, which is left alone', s1.Store.Slots[0].Id === '^SCANBINOC1' && s1.Store.Width === 10 && d0.Resource.Filename.endsWith('/MULTITOOL.SCENE.MBIN') && d0.CustomisationData.Colours.length === 0 && d0.IsLarge === false && d0.Store.Class.InventoryClass === 'A');
  ok('floats keep their decimal point in the file', await p.evaluate(() => { const t = C.stringifyJSON(g(ps(), 'Multitools')[1]); return /\[0\.631,0\.333,0\.02,1\.0\]/.test(t) && /"?[\w=:;<>?@]+"?:-1[,}]/.test(t) && /1\.9198620319366455/.test(t); }));
  ok('the save still encodes and reads back the same', await p.evaluate(() => { const out = encodeSave(); const t = C.stringifyJSON(g(S.ctx, 'PlayerStateData')); return !!out && t.length > 1000 && C.stringifyJSON(C.parseJSON(t)) === t; }));
  ok('the new staff is selected and its page offers Staff parts and colours', await p.evaluate(() => S.pick.tool === 1) && !!(await p.$('[data-k="staff"]')));
  // its cover shows its real parts
  ok('the staff\'s picture asks for its own parts', await p.evaluate(() => coverItems().find((x) => x.kind === 'tool' && x.i === 1).picks._names === '_STAFFHEAD_5A|_STAFFCORE_5|_STAFFPOLE_2'));
  // change an existing staff; equip it first so the traveller's copy follows
  await p.evaluate(() => set(ps(), 'ActiveMultioolIndex', N(1)));
  await p.click('[data-k="staff"]'); await p.waitForSelector('#seHost .sb-tile');
  ok('the edit window starts on the staff\'s own parts', (await p.$$eval('#seHost .sb-tile.on', (l) => l.map((x) => x.dataset.g).join())) === 'STAFF_HEAD_5A,STAFF_CORE_5,STAFF_POLE_2');
  await p.click('#seHost .sb-tile[data-g="STAFF_HEAD_7"]'); await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !document.querySelector('#dlg').open);
  const s1b = await p.evaluate(staffAt, 1), ccd = await p.evaluate(() => JSON.parse(C.stringifyJSON(toPlain(g(ps(), 'CharacterCustomisationData')))));
  ok('Apply changes the part and keeps the rest', s1b.CustomisationData.DescriptorGroups[0] === '^STAFF_HEAD_7' && s1b.CustomisationData.DescriptorGroups[1] === '^STAFF_CORE_5' && s1b.Seed[1] === s1.Seed[1] && s1b.Name === 'Old Bones' && s1b.CustomisationData.Colours.length === 330);
  ok('the equipped staff\'s copy in the traveller\'s customisation follows, and only that entry', JSON.stringify(ccd[2].CustomData) === JSON.stringify(s1b.CustomisationData) && ccd[0].CustomData.Colours.length === 0 && ccd[3].CustomData.DescriptorGroups.length === 0);
  // Cancel changes nothing
  await p.click('[data-k="staff"]'); await p.waitForSelector('#seHost .sb-tile'); await p.click('#seHost .sb-tile[data-g="STAFF_POLE_7"]'); await p.click('#dlgX'); await p.waitForFunction(() => !document.querySelector('#dlg').open);
  ok('closing the edit window without Apply changes nothing', (await p.evaluate(staffAt, 1)).CustomisationData.DescriptorGroups[2] === '^STAFF_POLE_2');
  // share codes
  const r = await p.evaluate(async () => {
    const o = g(ps(), 'Multitools')[1], t = await toolShareOf(o, 1), code = await toolCodeMake({ ...t, cols: [['Paint', 'Primary', [1, 0, 0.5]], ['Crystal', 'Alternative2', [0.1, 0.2, 0.3]]] }), back = await toolCodeRead(code);
    const mk = async (doc) => 'HDM1:' + btoa(String.fromCharCode(...new Uint8Array(await new Response(new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()))).replace(/=+$/, '');
    const bad = await toolCodeRead(await mk({ v: 1, n: 'x', m: 6, s: '0x1', g: ['STAFF_CORE_1', 'STAFF_HEAD_1', 'STAFF_POLE_1'], k: [['Paint', 0, 1, 2, 3]] }));
    const junk = await toolCodeRead(await mk({ v: 1, n: 'x', m: 6, s: '0x1', g: ['STAFF_HEAD_1', 'STAFF_CORE_1', 'STAFF_POLE_1'], k: [['Nope', 0, 1, 2, 3], ['Paint', 9, 1, 2, 3], ['Paint', 1, 5000, 2, 3], ['Paint', 1, 500, 250, 0], 'x'] }));
    const pistol = await toolCodeRead(await mk({ v: 1, n: 'x', m: 0, s: '0x1', g: ['STAFF_HEAD_1', 'STAFF_CORE_1', 'STAFF_POLE_1'] }));
    return { t, len: code.length, back, bad, junk, pistol };
  });
  console.log('     staff code length: ' + r.len + ' characters');
  ok('a staff\'s share code carries its parts and colours', JSON.stringify(r.back.groups) === '["STAFF_HEAD_7","STAFF_CORE_5","STAFF_POLE_2"]' && JSON.stringify(r.back.cols) === '[["Paint","Primary",[1,0,0.5]],["Crystal","Alternative2",[0.1,0.2,0.3]]]' && r.back.name === 'Old Bones' && r.back.cls === 'S' && r.len < 400);
  ok('parts in the wrong slots are dropped, bad colours too, and a pistol never gets staff parts', !r.bad.groups && JSON.stringify(r.junk.cols) === '[["Paint","Alternative1",[0.5,0.25,0]]]' && !r.pistol.groups);
  const slot = await p.evaluate((back) => addSharedTool(back, 0), r.back);
  const s2 = await p.evaluate(staffAt, slot);
  const col = (s, pl, a) => s.CustomisationData.Colours.find((x) => x.Palette.Palette === pl && x.Palette.ColourAlt === a).Colour;
  ok('adding a shared staff builds it with those parts and colours', slot === 2 && JSON.stringify(s2.CustomisationData.DescriptorGroups) === '["^STAFF_HEAD_7","^STAFF_CORE_5","^STAFF_POLE_2"]' && JSON.stringify(col(s2, 'Paint', 'Primary')) === '[1,0,0.5,1]' && JSON.stringify(col(s2, 'Crystal', 'Alternative2')) === '[0.1,0.2,0.3,1]' && JSON.stringify(col(s2, 'Grass', 'Primary')) === '[0.631,0.333,0.02,1]' && s2.CustomisationData.Colours.length === 330 && s2.Seed[1] === r.back.seed && s2.IsLarge === true);
  // a shared pistol: the seed goes on the entry, Resource.Seed stays as the game leaves it
  const s3 = await p.evaluate(async () => { const t = await toolCodeRead(await toolCodeMake({ name: 'Zap', scene: 'MODELS/COMMON/WEAPONS/MULTITOOL/ROYALMULTITOOL.SCENE.MBIN', seed: '0xAA', cls: 'B', legacy: false, picks: {} })); const k = addSharedTool(t, 0); return JSON.parse(C.stringifyJSON(toPlain(g(ps(), 'Multitools')[k]))); });
  ok('a shared pistol gets its seed where a multi-tool keeps it', JSON.stringify(s3.Seed) === '[true,"0xAA"]' && JSON.stringify(s3.Resource.Seed) === '[false,"0x0"]' && s3.Resource.Filename.endsWith('ROYALMULTITOOL.SCENE.MBIN') && s3.CustomisationData.DescriptorGroups.length === 0);
  // a pistol built on a staff doesn't keep the staff's parts and colours
  const s4 = await p.evaluate(async () => { const t = await toolCodeRead(await toolCodeMake({ name: 'Plain', scene: 'MODELS/COMMON/WEAPONS/MULTITOOL/MULTITOOL.SCENE.MBIN', seed: '0xBB', cls: 'C', legacy: true, picks: {} })); const k = addSharedTool(t, 1); const out = JSON.parse(C.stringifyJSON(toPlain(g(ps(), 'Multitools')[k]))); g(ps(), 'Multitools')[k] = blankEntity(g(ps(), 'Multitools')[0]); return out; });
  ok('a pistol copied from a staff drops the staff\'s parts and colours and keeps its technology', s4.CustomisationData.DescriptorGroups.length === 0 && s4.CustomisationData.Colours.length === 0 && s4.Store.Slots[0].Id === '^SCANBINOC1' && (await p.evaluate(staffAt, 1)).CustomisationData.Colours.length === 330);
  // a save whose tools have no customisation data
  const old = await p.evaluate(() => { const l = g(ps(), 'Multitools'), e = cloneJSON(l[0]); e.delete(kOf(e, 'CustomisationData')); return applyStaff(e, { groups: ['STAFF_HEAD_1', 'STAFF_CORE_1', 'STAFF_POLE_1'], cols: staffStandardColours() }, false); });
  ok('a tool without customisation data is refused with a reason, not guessed at', /no customisation data/.test(old));
  ok('no page errors (browser build)', errs.length === 0); if (errs.length) console.log(errs);
  await ctx.close();

  // ---- part 2: the app, with stand-in model answers
  if (SP) {
    const cfg = path.join(SP, 'staffcfg'), root = path.join(SP, 'staffroot'), home = path.join(SP, 'staffhome');
    for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, 'st_76561198000000000'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
    for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(root, 'st_76561198000000000', f));
    const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48044'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' } });
    const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
    try {
      const c2 = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }), q = await c2.newPage(); const e2 = []; q.on('pageerror', (e) => e2.push(e.message));
      // a one-triangle .glb and a one-triangle mesh
      const glb = (() => { const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, .4, .1, 1] } }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }], buffers: [{ byteLength: 44 }] });
        const jb = Buffer.from(json + ' '.repeat((4 - json.length % 4) % 4)), bin = Buffer.alloc(44); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4)); [0, 1, 2].forEach((v, i) => bin.writeUInt16LE(v, 36 + i * 2));
        const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
        const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4E4F534A, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004E4942, 4);
        return Buffer.concat([head, c1, jb, c2, bin]); })();
      const mesh = (() => { const m = Buffer.alloc(12 + 36 + 12); m.write('HSEM', 0); m.writeUInt32LE(3, 4); m.writeUInt32LE(3, 8); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => m.writeFloatLE(v, 12 + i * 4)); [0, 1, 2].forEach((v, i) => m.writeUInt32LE(v, 48 + i * 4)); return m; })();
      const asked = { staff: [], glb: [], mesh: [] };
      await q.route('**/api/model/staff**', (rt) => { const gs = new URL(rt.request().url()).searchParams.get('groups'); asked.staff.push(gs);
        rt.fulfill({ json: { scene: 'x', names: gs.split(',').map((x) => x.replace(/^STAFF_(HEAD|CORE|POLE)_/, '_STAFF$1_')), slots: [{ id: 'STAFF_HEAD', label: 'UI', parts: [{ group: 'STAFF_HEAD_1', item: 'STAFF_PART_C' }, { group: 'STAFF_HEAD_9', item: 'STAFF_HEAD8' }] }],
          colours: /HEAD_9/.test(gs) ? [] : [{ p: 'Paint', a: 'Primary', avg: [.5, .5, .5], layer: 'BASE' }, { p: 'Paint', a: 'Alternative1', avg: [.2, .2, .2], layer: 'TRIM' }, { p: 'Crystal', a: 'Primary', avg: [1, 1, 0], layer: 'GLOW' }] } }); });
      await q.route('**/api/model/glb**', (rt) => { asked.glb.push(new URL(rt.request().url()).searchParams); rt.fulfill({ body: glb, contentType: 'model/gltf-binary' }); });
      await q.route('**/api/model/mesh**', (rt) => { asked.mesh.push(new URL(rt.request().url()).searchParams); rt.fulfill({ body: mesh, contentType: 'application/octet-stream' }); });
      await q.goto(url); await q.waitForSelector('.slot-row'); await q.click('.slot-row'); await q.waitForSelector('#app:not(.hidden)');
      await q.evaluate(makeTools); await q.evaluate(() => { S.lib = { ...(S.lib || {}), game: true }; go('tools'); });
      await q.click('#addTool'); await q.waitForSelector('#dlg[open] [data-tab="staff"]');
      await q.waitForSelector('#sbHost .sb-crow'); await q.waitForFunction(() => !!document.querySelector('#sbHost .sb-pic canvas')); await q.waitForTimeout(2500);
      ok('the game\'s own part list is used when the app reads it (a part this DryDock never heard of shows up)', (await q.$$eval('#sbHost .parts-group:first-child .sb-tile', (l) => l.map((x) => x.textContent.trim()).join('|'))) === 'Concentric Transducer|Head 9' && (await q.$$eval('#sbHost .parts-group:nth-child(2) .sb-tile', (l) => l.length)) === 6);
      ok('each part gets its own picture, of that part alone', asked.mesh.some((u) => u.get('only') === '_StaffHead' && u.get('depth') === '1' && JSON.parse(u.get('picks'))._names === '_STAFFHEAD_1') && asked.mesh.some((u) => u.get('only') === '_StaffPole' && JSON.parse(u.get('picks'))._names === '_STAFFPOLE_7') && (await q.$$eval('#sbHost .sb-tile canvas', (l) => l.length)) === 14);
      const whole = () => asked.glb.filter((u) => !u.get('only')), first = whole()[0];
      ok('each part is then drawn in its textures and the staff\'s colours', asked.glb.filter((u) => u.get('only') === '_StaffHead' && u.get('look')).length === 2 && asked.glb.filter((u) => u.get('only') === '_StaffPole').length === 6 && JSON.parse(asked.glb.find((u) => u.get('only') === '_StaffCore').get('picks'))._names.startsWith('_STAFFCORE_'));
      ok('the parts stay on one line', await q.$$eval('#sbHost .sb-tiles', (l) => l.every((row) => new Set([...row.children].map((x) => x.offsetTop)).size === 1)));
      ok('the 3D staff is asked for with its parts and the colours it shows', JSON.parse(first.get('picks'))._names === '_STAFFHEAD_1|_STAFFCORE_1|_STAFFPOLE_1' && JSON.stringify(JSON.parse(first.get('look')).c.map((x) => x.p + x.a)) === '["PaintPrimary","CrystalPrimary","PaintAlternative1"]' && JSON.stringify(JSON.parse(first.get('look')).c[0].c) === '[0.925,0.38,0.396,1]');
      ok('only the colours this staff shows are offered, named by what they paint', (await q.$$eval('#sbHost .sb-cname', (l) => l.map((x) => x.textContent.trim()).join('|'))) === 'Paint|Glow|Paint 2' && (await q.$eval('#sbHost .sb-crow input', (x) => x.value)) === '#ec6165' && (await q.$$eval('#sbHost .sb-crow:first-child .sb-dot', (l) => l.length)) === 16);
      let n0 = whole().length;
      await q.click('#sbHost .sb-crow:first-child .sb-dot[data-hex="#3fc66b"]'); await q.waitForTimeout(700);
      ok('a swatch repaints the staff in that colour and marks it', whole().length === n0 + 1 && JSON.stringify(JSON.parse(whole()[n0].get('look')).c[0].c) === '[0.2471,0.7765,0.4196,1]' && (await q.$eval('#sbHost .sb-crow:first-child .sb-dot.on', (x) => x.dataset.hex)) === '#3fc66b' && (await q.textContent('#sbHost .sb-crow:first-child .sb-hex')) === '#3fc66b');
      n0 = whole().length;
      await q.$eval('#sbHost .sb-crow input', (x) => { x.value = '#ff0080'; x.dispatchEvent(new Event('input', { bubbles: true })); });
      await q.waitForTimeout(700);
      ok('the + takes any colour', whole().length === n0 + 1 && JSON.stringify(JSON.parse(whole()[n0].get('look')).c[0].c) === '[1,0,0.502,1]' && (await q.$eval('#sbHost .sb-crow:first-child .sb-plus', (x) => x.classList.contains('on'))));
      // looking round the 3D staff
      const art = await q.$('#sbHost .sb-pic .tc-art'), bx = await art.boundingBox(), v0 = await q.evaluate(() => window.__sb.view().view());
      await q.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await q.mouse.down(); await q.mouse.move(bx.x + bx.width / 2 + 60, bx.y + bx.height / 2 + 30, { steps: 4 }); await q.mouse.up();
      const v1 = await q.evaluate(() => window.__sb.view().view());
      await q.mouse.wheel(0, -400); await q.waitForTimeout(100); const v2 = await q.evaluate(() => window.__sb.view().view());
      await q.keyboard.down('Shift'); await q.mouse.down(); await q.mouse.move(bx.x + bx.width / 2 + 100, bx.y + bx.height / 2 + 30, { steps: 3 }); await q.mouse.up(); await q.keyboard.up('Shift');
      const v3 = await q.evaluate(() => window.__sb.view().view());
      await q.mouse.dblclick(bx.x + bx.width / 2, bx.y + bx.height / 2); const v4 = await q.evaluate(() => window.__sb.view().view());
      ok('dragging turns the staff both ways', v1.yaw > v0.yaw + .5 && v1.pitch > v0.pitch + .2 && v1.zoom === 1);
      ok('the wheel zooms in, Shift-drag moves it, a double click puts it back', v2.zoom > 1.5 && v3.x > v2.x + .05 && v3.yaw === v2.yaw && JSON.stringify(v4) === JSON.stringify(v0));
      if (SHOTS) await q.screenshot({ path: path.join(SHOTS, 'staff-app.png') });
      await q.click('#sbHost [data-sb="randcol"]'); await q.waitForTimeout(600);
      const rc = JSON.parse(whole()[whole().length - 1].get('look')).c;
      ok('Random colours picks from the swatches, and Standard colours puts them back', rc.length === 3 && rc.every((x) => x.c.every((v) => v >= 0 && v <= 1)) && (await q.$$eval('#sbHost .sb-dot.on', (l) => l.length)) === 3);
      await q.click('#sbHost [data-sb="stdcol"]'); await q.waitForTimeout(600);
      ok('…Standard colours', JSON.stringify(JSON.parse(whole()[whole().length - 1].get('look')).c[0].c) === '[0.925,0.38,0.396,1]');
      await q.$eval('#sbHost .sb-crow input', (x) => { x.value = '#ff0080'; x.dispatchEvent(new Event('input', { bubbles: true })); });
      await q.click('#sbShare'); await q.waitForTimeout(300);
      const shared = await q.evaluate(async () => toolCodeRead(await navigator.clipboard.readText()).catch((e) => ({ err: e.message })));
      ok('Copy a share code holds the parts and the colours shown', shared && JSON.stringify(shared.groups) === '["STAFF_HEAD_1","STAFF_CORE_1","STAFF_POLE_1"]' && shared.cols.length === 3 && JSON.stringify(shared.cols[0]) === '["Paint","Primary",[1,0,0.502]]');
      await q.fill('#sbName', 'Pink'); await q.click('#sbAdd'); await q.waitForFunction(() => !document.querySelector('#dlg').open);
      const made = await q.evaluate(staffAt, 1), pc = made.CustomisationData.Colours.find((x) => x.Palette.Palette === 'Paint' && x.Palette.ColourAlt === 'Primary').Colour;
      ok('Add writes the picked colour and leaves the others standard', JSON.stringify(pc) === '[1,0,0.502,1]' && made.CustomisationData.Colours.length === 330 && JSON.stringify(made.CustomisationData.Colours[1].Colour) === '[0.493,0.258,0.332,1]' && made.Name === 'Pink');
      // a second staff copies the colour list's shape from the first; a part with no readable colours says so
      await q.evaluate(() => navigator.clipboard.writeText('')); await q.click('#addTool'); await q.waitForSelector('#dlg[open] [data-tab="staff"]'); await q.waitForSelector('#sbHost .sb-crow');
      ok('a new staff starts from the colours of a staff already in the save', (await q.$eval('#sbHost .sb-crow input', (x) => x.value)) === '#ff0080');
      await q.click('#sbHost .sb-tile[data-g="STAFF_HEAD_9"]'); await q.waitForFunction(() => /no colours DryDock can read/.test(document.querySelector('#sbHost .sb-cols').textContent));
      ok('parts with no readable colours say so', true);
      await q.click('#dlgX');
      ok('no page errors (app)', e2.length === 0); if (e2.length) console.log(e2);
    } finally { proc.kill(); }
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
