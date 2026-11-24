const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
// The ship builder (owner 2026-11-24): Add a ship's Build a ship tab, a built ship's Parts and colours, and covers
// drawn from a built ship's parts. Runs the app on the synthetic fixture with stand-in answers for the model calls
// (the parts come from game files this test doesn't have); what the save gets is checked against the shape of the
// owner's fabricator-built fighter.
// Usage: node test/e2e/test_shipbuild.js <fixture dir> <scratch dir>   (SHOTS=<dir> for pictures)
const FX = process.argv[2], SP = process.argv[3]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const SHOTS = process.env.SHOTS;
const SLOTS = { fighter: [{ id: 'FIGHTER_COCKPIT', label: 'UI_SHIP_BUILDER_INPUT_BODY', parts: [{ group: 'FIGHT_COCKAA', item: 'FIGHT_COCKAA', names: ['_COCKPIT_A', '_ANOSE_A'] }, { group: 'FIGHT_COCKAB', item: 'FIGHT_COCKAB', names: ['_COCKPIT_A', '_ANOSE_B'] }] },
  { id: 'FIGHTER_ENGINES', label: 'UI_SHIP_BUILDER_INPUT_ENGINE', parts: [{ group: 'FIGHT_ENGIB', item: 'FIGHT_ENGIB', names: ['_ENGINE_B'] }, { group: 'FIGHT_ENGIC', item: 'FIGHT_ENGIC', names: ['_ENGINE_C'] }] },
  { id: 'FIGHTER_WINGS', label: 'UI_SHIP_BUILDER_INPUT_WINGS', parts: Array.from({ length: 30 }, (_, n) => ({ group: 'FIGHT_WING' + String.fromCharCode(65 + n % 26) + (n > 25 ? 'X' : ''), item: 'FIGHT_WING' + n, names: ['_WINGS_' + n, '_ACC_NONE'] })) }],
  sail: [{ id: 'SAIL_BODY', label: 'UI_SHIP_BUILDER_INPUT_BODY', parts: [{ group: 'SAIL_BODYA', item: 'SAIL_BODYA', names: ['_Body_A'] }] }, { id: 'SAIL_SAIL', label: 'UI_SHIP_BUILDER_INPUT_SAIL', parts: [{ group: 'SAIL_SAILA', item: 'SAIL_SAILA', names: ['_Sails_A'] }] }] };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const cfg = path.join(SP, 'shipcfg'), root = path.join(SP, 'shiproot'), home = path.join(SP, 'shiphome');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'st_76561198000000000'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
  for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(root, 'st_76561198000000000', f));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48045'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  try {
    const c2 = await b.newContext({ viewport: { width: 1440, height: 1000 } }), q = await c2.newPage(); const errs = []; q.on('pageerror', (e) => errs.push(e.message));
    const glb = (() => { const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, .4, .1, 1] } }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }], buffers: [{ byteLength: 44 }] });
      const jb = Buffer.from(json + ' '.repeat((4 - json.length % 4) % 4)), bin = Buffer.alloc(44); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4)); [0, 1, 2].forEach((v, i) => bin.writeUInt16LE(v, 36 + i * 2));
      const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
      const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4E4F534A, 4); const c3 = Buffer.alloc(8); c3.writeUInt32LE(bin.length, 0); c3.writeUInt32LE(0x004E4942, 4);
      return Buffer.concat([head, c1, jb, c3, bin]); })();
    const mesh = (() => { const m = Buffer.alloc(12 + 36 + 12); m.write('HSEM', 0); m.writeUInt32LE(3, 4); m.writeUInt32LE(3, 8); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => m.writeFloatLE(v, 12 + i * 4)); [0, 1, 2].forEach((v, i) => m.writeUInt32LE(v, 48 + i * 4)); return m; })();
    const asked = { build: [], glb: [], mesh: [] };
    await q.route('**/api/model/shipbuild**', (rt) => { const u = new URL(rt.request().url()).searchParams, kind = u.get('kind'), gs = (u.get('groups') || '').split(',').filter(Boolean); asked.build.push(kind + '|' + gs.join(','));
      const slots = SLOTS[kind] || [], all = new Map(slots.flatMap((s) => s.parts.map((p) => [p.group, p.names])));
      rt.fulfill({ json: { scene: 'x', slots, names: gs.flatMap((x) => all.get(x) || []), colours: gs.length ? [{ p: 'Undercoat', a: 'Primary', avg: [.5, .5, .5], layer: 'BASE' }, { p: 'Paint', a: 'Primary', avg: [.2, .2, .2], layer: 'PRIMARY' }] : [] } }); });
    await q.route('**/api/model/glb**', (rt) => { asked.glb.push(new URL(rt.request().url()).searchParams); rt.fulfill({ body: glb, contentType: 'model/gltf-binary' }); });
    await q.route('**/api/model/mesh**', (rt) => { asked.mesh.push(new URL(rt.request().url()).searchParams); rt.fulfill({ body: mesh, contentType: 'application/octet-stream' }); });
    await q.goto(url); await q.waitForSelector('.slot-row'); await q.click('.slot-row'); await q.waitForSelector('#app:not(.hidden)');
    // two free slots, and customisation entries in the game's shape
    await q.evaluate(() => {
      const list = g(ps(), 'ShipOwnership'); list[4] = blankEntity(list[0]); list[7] = blankEntity(list[0]);
      const cc = () => fromPlain(C.parseJSON(JSON.stringify({ SelectedPreset: '^', CustomData: { DescriptorGroups: [], PaletteID: '^', Colours: [], TextureOptions: [], BoneScales: [], Scale: 1.5 } }).replace('1.5', '1.0')));
      set(ps(), 'CharacterCustomisationData', Array.from({ length: 26 }, cc)); set(ps(), 'ShipUsesLegacyColours', Array.from({ length: 12 }, () => true));
      S.lib = { ...(S.lib || {}), game: true }; go('ships');
    });
    await q.click('#addShip'); await q.waitForSelector('#dlg[open] [data-tab="build"]');
    ok('Add a ship opens on Build a ship, with New corvette or a copy beside it', (await q.$eval('[data-tab="build"]', (x) => x.getAttribute('aria-selected'))) === 'true' && !!(await q.$('[data-tab="copy"]')) && (await q.$eval('[data-pane="copy"]', (x) => x.hidden)));
    await q.waitForSelector('#shHost .sb-crow'); await q.waitForTimeout(1200);
    ok('the five kinds of ship the game can build are offered', (await q.$$eval('#shHost [data-kind]', (l) => l.map((x) => x.textContent.trim()).join('|'))) === 'Fighter|Hauler|Explorer|Shuttle|Solar');
    ok('the slots and parts come from the game\'s table, named plainly', (await q.$$eval('#shHost .pg-name', (l) => l.map((x) => x.firstChild.textContent.trim()).join('|'))) === 'Body|Engines|Wings' && (await q.$$eval('#shHost .parts-group:first-child .sb-tile', (l) => l.length)) === 2 && (await q.$$eval('#shHost .parts-group:nth-child(3) .sb-tile', (l) => l.length)) === 30);
    ok('a long list of parts scrolls in its own box', await q.$eval('#shHost .parts-group:nth-child(3) .sb-tiles', (x) => x.classList.contains('many') && x.scrollHeight > x.clientHeight + 20 && x.clientHeight < 300));
    const whole = () => asked.glb;
    ok('the 3D ship is asked for with every part\'s nodes and the colours it shows', JSON.parse(whole()[0].get('picks'))._names === '_COCKPIT_A|_ANOSE_A|_ENGINE_B|_WINGS_0|_ACC_NONE' && JSON.stringify(JSON.parse(whole()[0].get('look')).c.map((x) => x.p)) === '["Paint","Undercoat"]' && JSON.stringify(JSON.parse(whole()[0].get('look')).t) === '[["SHIP_FIGHT","COATING"]]');
    ok('each part\'s picture is the ship with that part on it', asked.mesh.some((u) => JSON.parse(u.get('picks'))._names === '_COCKPIT_A|_ANOSE_B|_ENGINE_B|_WINGS_0|_ACC_NONE') && asked.mesh.some((u) => JSON.parse(u.get('picks'))._names === '_COCKPIT_A|_ANOSE_A|_ENGINE_C|_WINGS_0|_ACC_NONE'));
    ok('pictures further down the list wait until they are scrolled to', !asked.mesh.some((u) => /_WINGS_29\|/.test(JSON.parse(u.get('picks'))._names)));
    let n0 = whole().length;
    await q.click('#shHost .sb-tile[data-g="FIGHT_COCKAB"]'); await q.click('#shHost .sb-tile[data-g="FIGHT_ENGIC"]'); await q.waitForTimeout(900);
    ok('picking parts redraws the ship', whole().length > n0 && JSON.parse(whole()[whole().length - 1].get('picks'))._names === '_COCKPIT_A|_ANOSE_B|_ENGINE_C|_WINGS_0|_ACC_NONE' && (await q.textContent('#shHost [data-sb="what"]')).split(' · ').length === 3);
    ok('…and the other slots\' pictures follow the new picks', asked.mesh.some((u) => JSON.parse(u.get('picks'))._names === '_COCKPIT_A|_ANOSE_B|_ENGINE_C|_WINGS_1|_ACC_NONE'));
    n0 = whole().length;
    await q.click('#shHost [data-finish="METALBOLT"]'); await q.waitForTimeout(600);
    ok('a finish repaints it', whole().length === n0 + 1 && JSON.stringify(JSON.parse(whole()[n0].get('look')).t) === '[["SHIP_FIGHT","METALBOLT"]]');
    await q.click('#shHost .sb-crow:first-child .sb-dot[data-hex="#3fc66b"]'); await q.waitForTimeout(600);
    ok('a swatch repaints it in that colour', JSON.stringify(JSON.parse(whole()[whole().length - 1].get('look')).c[0].c) === '[0.2471,0.7765,0.4196,1]' && (await q.$$eval('#shHost .sb-cname', (l) => l.map((x) => x.textContent.trim()).join('|'))) === 'Paint|Undercoat');
    if (SHOTS) await q.screenshot({ path: path.join(SHOTS, 'shipbuild.png') });
    await q.fill('#shName', 'Test Wing'); await q.selectOption('#shCls', 'A');
    const slot = +(await q.$eval('#shSlot', (x) => x.value));
    await q.click('#dlgActs .btn.primary'); await q.waitForTimeout(500);
    const got = await q.evaluate((slot) => { const s = g(ps(), 'ShipOwnership')[slot], cd = g(g(ps(), 'CharacterCustomisationData')[shipCcdIndex(slot)], 'CustomData'), plain = JSON.parse(C.stringifyJSON(toPlain(cloneJSON(cd)))), cols = plain.Colours;
      const col = (p, a) => cols.find((x) => x.Palette.Palette === p && x.Palette.ColourAlt === a);
      return { slot, name: str(g(s, 'Name')), file: str(g(s, 'Resource', 'Filename')), seed: g(s, 'Resource', 'Seed').map(str), lay: (g(s, 'InventoryLayout', 'Seed') || [0, str(g(s, 'Resource', 'Seed')[1])]).map(str), cls: str(g(s, 'Inventory', 'Class', 'InventoryClass')), tech: C.stringifyJSON(g(s, 'Inventory', 'Slots')), donorTech: C.stringifyJSON(g(g(ps(), 'ShipOwnership')[+document.querySelector('#shDonor') ? 0 : 0], 'Inventory', 'Slots')),
        groups: plain.DescriptorGroups, n: cols.length, paint: col('Paint', 'Primary'), keys: Object.keys(cols[0]).join(','), tex: plain.TextureOptions, pal: plain.PaletteID, legacy: g(ps(), 'ShipUsesLegacyColours')[slot], other: g(ps(), 'ShipUsesLegacyColours')[0], picked: S.pick.ship, raw: C.stringifyJSON(g(cd, 'Colours')[0]) }; }, slot);
    ok('the built ship lands in the free slot as that kind of ship, with a seed, its name and class', got.slot === 4 && got.name === 'Test Wing' && /FIGHTERS\/FIGHTER_PROC\.SCENE\.MBIN$/.test(got.file) && got.seed[0] === 'true' && /^0x[0-9A-F]{16}$/.test(got.seed[1]) && got.lay[1] === got.seed[1] && got.cls === 'A' && got.picked === 4);
    ok('its technology comes from the ship it was copied from', got.tech === got.donorTech);
    ok('its parts are in its slot\'s customisation entry, as the game writes them', JSON.stringify(got.groups) === '["^FIGHT_COCKAB","^FIGHT_ENGIC","^FIGHT_WINGA"]');
    ok('with the game\'s full colour list (330), the chosen colour in it, numbers written as decimals', got.n === 330 && got.keys === 'Palette,Colour' && JSON.stringify(got.paint.Colour) === '[0.2471,0.7765,0.4196,1]' && got.paint.Palette.Index === -1 && /,1\.0\]\}$/.test(got.raw.replace(/\s/g, '')));
    ok('the finish is recorded, with the metallic palette for a metal finish', JSON.stringify(got.tex) === '[{"TextureOptionGroupName":"^SHIP_FIGHT","TextureOptionName":"^METALBOLT"}]' && got.pal === '^SHIP_METALLIC');
    ok('old colours are switched off for that ship only', got.legacy === false && got.other === true);
    // the ship's page offers Parts and colours, opening on what the save holds
    await q.waitForSelector('[data-k="shipparts"]'); await q.click('[data-k="shipparts"]'); await q.waitForSelector('#shHost .sb-crow'); await q.waitForTimeout(900);
    ok('Parts and colours opens on the ship\'s own parts, finish and colours, without the kind buttons', (await q.$$eval('#shHost .sb-tile.on', (l) => l.map((x) => x.dataset.g).join('|'))) === 'FIGHT_COCKAB|FIGHT_ENGIC|FIGHT_WINGA' && (await q.$eval('#shHost [data-finish][aria-pressed="true"]', (x) => x.dataset.finish)) === 'METALBOLT' && (await q.$eval('#shHost .sb-crow input', (x) => x.value)) === '#3fc66b' && !(await q.$('#shHost [data-kind]')));
    await q.click('#shHost .sb-tile[data-g="FIGHT_COCKAA"]'); await q.click('#shHost [data-finish="COATING"]'); await q.waitForTimeout(500);
    await q.click('#dlgActs .btn.primary'); await q.waitForTimeout(400);
    const got2 = await q.evaluate(() => { const cd = JSON.parse(C.stringifyJSON(toPlain(cloneJSON(g(g(ps(), 'CharacterCustomisationData')[shipCcdIndex(4)], 'CustomData'))))); return { groups: cd.DescriptorGroups, tex: cd.TextureOptions[0].TextureOptionName, pal: cd.PaletteID, n: cd.Colours.length, name: str(g(g(ps(), 'ShipOwnership')[4], 'Name')) }; });
    ok('Apply changes the parts and finish in place and keeps the rest', JSON.stringify(got2.groups) === '["^FIGHT_COCKAA","^FIGHT_ENGIC","^FIGHT_WINGA"]' && got2.tex === '^COATING' && got2.pal === '^' && got2.n === 330 && got2.name === 'Test Wing');
    ok('a built ship\'s cover is drawn from its parts', await q.evaluate(() => { const it = coverItems().find((x) => x.kind === 'ship' && x.i === 4); return !!it && it.picks._groups === 'FIGHT_COCKAA,FIGHT_ENGIC,FIGHT_WINGA' && it.key.endsWith('|FIGHT_COCKAA,FIGHT_ENGIC,FIGHT_WINGA') && !coverItems().find((x) => x.i === 0).picks; }));
    // a kind with no finish list and fewer slots; and the old dialog's choices on the other tab
    await q.click('#addShip'); await q.waitForSelector('#shHost .sb-crow'); await q.click('#shHost [data-kind="sail"]'); await q.waitForTimeout(900);
    ok('another kind brings its own slots', (await q.$$eval('#shHost .pg-name', (l) => l.map((x) => x.firstChild.textContent.trim()).join('|'))) === 'Body|Sail' && (await q.$$eval('#shHost [data-finish]', (l) => l.length)) === 4 && asked.build.includes('sail|SAIL_BODYA,SAIL_SAILA'));
    await q.click('#shHost [data-kind="shuttle"]'); await q.waitForTimeout(600);
    ok('a kind whose parts can\'t be read says so, and Add adds nothing', /couldn't read/.test(await q.textContent('#shHost [data-sb="slots"]')));
    const before = await q.evaluate(() => ships().length); await q.click('#dlgActs .btn.primary'); await q.waitForTimeout(300);
    ok('…nothing added', (await q.evaluate(() => ships().length)) === before);
    await q.click('#addShip'); await q.waitForSelector('#dlg[open] [data-tab="copy"]'); await q.click('[data-tab="copy"]');
    ok('the other tab keeps the new corvette and the copy, and the developer zip button', (await q.$$eval('#addWhat option', (l) => l.length)) > 1 && !!(await q.$('#shipSample')) && !(await q.$eval('[data-pane="copy"]', (x) => x.hidden)));
    await q.selectOption('#addWhat', '0'); await q.click('#dlgActs .btn.primary'); await q.waitForTimeout(300);
    ok('a copy still works from there', await q.evaluate(() => /copy$/.test(str(g(g(ps(), 'ShipOwnership')[7], 'Name')))));
    ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  } finally { proc.kill(); await b.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
