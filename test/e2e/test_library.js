const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Ship library on a copy of a real save: Garage capture, library, linked folders, putting ships and builds
// into slots (corvette base re-linked via UserData), tags/favourites, delete to Deleted, save and reopen.
// Usage: node test/e2e/test_library.js <scratch dir with dbroot/NMS holding a real save with corvettes>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'libtest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), linked = path.join(T, 'My ships');
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true }); fs.mkdirSync(linked);
  // a library from before the rename (Ships\Library) must move to Dock Yard\Ship storage
  const oldLib = path.join(home, 'Documents', 'Harmonious Save Editor', 'Ships', 'Library'); fs.mkdirSync(oldLib, { recursive: true });
  fs.writeFileSync(path.join(oldLib, 'From before.json'), JSON.stringify({ Objects: [{ Timestamp: 1, ObjectID: '^U_PARAGON', UserData: 0, Position: [0, 0, 0], Up: [0, 1, 0], At: [0, 0, 1] }] }));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47979'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg') } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const apiJ = (u, opts) => p.evaluate(async ([u, opts]) => (await api(u, opts)).json(), [u, opts]);
  await p.goto(url); await p.evaluate(() => localStorage.setItem('hse-covers', 'grid'));   /* these checks use the grid of cards; Cover Flow is covered in test_add.js */
  await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  ok('the Dock Yard is announced: New in the menu and a spotlight on the Overview', !!(await p.$('nav [data-s="library"] .new-pill')) && !!(await p.$('.dy-spot')));
  p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('console:', m.text()); });
  const lib = path.join(home, 'Documents', 'Harmonious Save Editor', 'Dock Yard');
  for (let t = 0; t < 60 && !(fs.existsSync(path.join(lib, 'Garage')) && fs.readdirSync(path.join(lib, 'Garage')).length >= 6); t++) await p.waitForTimeout(500);
  const garage = fs.readdirSync(path.join(lib, 'Garage'));
  console.log(garage);
  ok('every ship in the save went to the Garage', garage.length === 6 && garage.some((f) => /^The Cutting Remark /.test(f)));
  const cr = JSON.parse(fs.readFileSync(path.join(lib, 'Garage', garage.find((f) => /^The Cutting Remark /.test(f)))));
  ok('a Garage corvette carries its build', cr.CorvetteBase && cr.CorvetteBase.Objects.length === 2091 && cr.Ship.Name === 'The Cutting Remark');
  // opening the same save again adds nothing new
  await p.evaluate(() => garageCapture()); ok('the Garage keeps one copy per version', fs.readdirSync(path.join(lib, 'Garage')).length === 6);
  // library + linked folder
  await p.evaluate(() => saveShipToLibrary(5));
  ok('save to the Dock Yard', fs.existsSync(path.join(lib, 'Ship storage', 'The Cutting Remark.ship.json')));
  ok('the old Ships\\Library moved to Dock Yard\\Ship storage', fs.existsSync(path.join(lib, 'Ship storage', 'From before.json')) && !fs.existsSync(path.join(home, 'Documents', 'Harmonious Save Editor', 'Ships')));
  fs.writeFileSync(path.join(linked, 'just the build.json'), JSON.stringify({ Objects: cr.CorvetteBase.Objects.slice(0, 300) }));
  fs.writeFileSync(path.join(linked, 'notes.txt'), 'not a ship');
  fs.mkdirSync(path.join(linked, 'sub')); fs.writeFileSync(path.join(linked, 'sub', 'Formula copy.json'), JSON.stringify({ Harmonious: { kind: 'ship', version: 2 }, Ship: cr.Ship, CorvetteBase: cr.CorvetteBase }));
  // the owner's real files: a corvette build (.txt), a TAZ .nmsship, and a .so made from its so.json
  const ATT = '/mnt/user-data/attachments/c7a04859-a3e4-54e4-aad1-f1e3f48b3fdb/';
  const taz = fs.existsSync(ATT + '1ebbbc19-Death_n_Glory.nmsship');
  if (taz) {
    fs.copyFileSync(ATT + '0289520e-Death___Glory_3.txt', path.join(linked, 'Death & Glory 3.txt'));
    fs.copyFileSync(ATT + '1ebbbc19-Death_n_Glory.nmsship', path.join(linked, 'Death n Glory.nmsship'));
    fs.copyFileSync(path.join(SP, 'nmsship/so.json'), path.join(linked, 'Death n Glory.so'));
  }
  await apiJ('/api/ships/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add: linked }) });
  await p.click('nav button[data-s="library"]'); await p.waitForFunction(() => /ships? in /.test(document.querySelector('.lib-status').textContent), null, { timeout: 30000 });
  ok('the New badge goes once the Dock Yard is opened', !(await p.$('nav [data-s="library"] .new-pill')));
  const counts = await p.$$eval('[data-n]', (n) => n.map((x) => x.dataset.n + '=' + x.textContent).join(' ')); console.log(counts);
  ok('Ship storage, Garage, Favourites and linked folders counted', counts === `garage=6 ships library=2 ships fav=0 ships linked=(${taz ? 6 : 3})`);
  ok('Ship storage is the first view', (await p.getAttribute('.dy-tab[data-v="library"]', 'aria-selected')) === 'true' && (await p.$$('.lib-card')).length === 2);
  await p.click('.dy-sub [data-v="all"]'); await p.waitForFunction(() => document.querySelectorAll('.lib-card').length > 10);
  await p.waitForTimeout(2500); await p.screenshot({ path: SP + '/shots/lib0.png' });
  const caps = await p.$$eval('.lib-card .tc-cap', (c) => c.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log(caps.slice(0, 12));
  ok('a build-only file is recognised', caps.some((c) => /^just the build\s*Corvette, 300 parts/.test(c)));
  ok('an unknown file is listed as not readable', caps.some((c) => /^notes\s*Not readable yet/.test(c)));
  ok('subfolders show on the card', caps.some((c) => /The Cutting Remark.*My ships \/ sub/.test(c)));
  ok('covers drawn', (await p.$$eval('.lib-card .tc-art canvas, .lib-card .tc-art img', (x) => x.length)) >= 6);
  if (taz) {
    ok('a TAZ .nmsship is read', caps.some((c) => /^Death n Glory\s*Corvette, S class, 941 parts/.test(c)));
    ok('a TAZ .so is read', caps.some((c) => /^Death n Glory\s*Corvette, S class My ships/.test(c)));
    ok('a corvette .txt is read', caps.filter((c) => /^The Cutting Remark\s*Corvette, 2,091 parts My ships/.test(c)).length === 1);
    // export The Cutting Remark as .nmsship and read it back
    const back = await p.evaluate(async () => { const b = await shipNmsship(5); const buf = await b.arrayBuffer(); const r = await loadShipFile(buf, 'x.nmsship'); return { parts: r.objects.length, name: str(g(r.ship, 'Name')), ccd: r.ccd instanceof Map, b64: btoa(String.fromCharCode(...new Uint8Array(buf.slice(0, 4)))), bytes: [...new Uint8Array(buf)] }; });
    fs.writeFileSync(path.join(T, 'export.nmsship'), Buffer.from(back.bytes));
    const py = require('child_process').execFileSync('python3', ['-c', `import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),sorted(z.namelist()));d=z.read('objects.json');print(d[:3]==b'\\xef\\xbb\\xbf', b'\\r\\n' in d, len(json.loads(d.decode('utf-8-sig'))))`, path.join(T, 'export.nmsship')]).toString().trim();
    console.log(py);
    ok('.nmsship export reads back here and in Python', back.parts === 2091 && back.name === 'The Cutting Remark' && back.ccd && /^None \['ccd.json', 'objects.json', 'so.json'\]\nTrue True 2091$/.test(py));
  }
  // put the library copy of The Cutting Remark into empty slot 7 (index 6)
  await p.click('.dy-tabs [data-v="library"]'); await p.waitForSelector('.lib-card'); await p.waitForTimeout(500);
  const firstLib = (await p.$$('.lib-card'))[1]; ok('the card is The Cutting Remark', /The Cutting Remark/.test(await firstLib.textContent()));
  await firstLib.click(); await p.waitForSelector('#dlg[open] .lib-detail');
  ok('corvettes can be rendered from the Dock Yard', await p.$$eval('#dlgActs button', (b) => b.some((x) => x.textContent === 'Render with Blender')));
  await p.fill('#ldTags', 'favourite, combat'); await p.check('#ldFav'); await p.waitForTimeout(600);
  await p.screenshot({ path: SP + '/shots/lib1-detail.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForSelector('#putSlot');
  const slotOpts = await p.$$eval('#putSlot option', (o) => o.map((x) => x.textContent + (x.disabled ? ' (disabled)' : '')));
  console.log(slotOpts);
  ok('the current ship cannot be replaced', slotOpts.some((t) => /current ship.*disabled/.test(t)));
  await p.selectOption('#putSlot', '6'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
  let st = await p.evaluate(() => { const L = g(ps(), 'ShipOwnership'); const bases = (g(ps(), 'PersistentPlayerBases') || []).filter((b) => str(g(b, 'BaseType', 'PersistentBaseTypes')) === 'PlayerShipBase'); return { name: str(g(L[6], 'Name')), b6: (shipBuild(6) && g(shipBuild(6), 'Objects').length), b5: (shipBuild(5) && g(shipBuild(5), 'Objects').length), n: bases.length, dirty: S.dirty }; });
  console.log(JSON.stringify(st));
  ok('the corvette lands in the empty slot with its own build', st.name === 'The Cutting Remark' && st.b6 === 2091 && st.b5 === 2091 && st.n === 5 && st.dirty);
  const idx = JSON.parse(fs.readFileSync(path.join(lib, 'library.json')));
  const m = Object.entries(idx.meta).find(([k]) => /^library\|\|The Cutting/.test(k));
  ok('tags and favourite are kept', m && m[1].fav === true && m[1].tags.join() === 'favourite,combat');
  if (taz) {
    // the .nmsship into empty slot 8 (index 7): ship, 941 parts in the game's field order, customisation in its slot
    st = await p.evaluate(async () => {
      const f = { src: 'linked', root: ShipLib.folders[0].dir, path: 'Death n Glory.nmsship' }; const pr = await ShipLib.load(f), sum = shipSummary(pr, f.path);
      const done = putShipInSave(pr, sum); await new Promise((r) => setTimeout(r, 300)); $('#putSlot').value = '7'; $('#dlgActs .btn.primary').click(); await done;
      const b = shipBuild(7), o = g(b, 'Objects'), ref = g(shipBuild(5), 'Objects')[0];
      return { name: str(g(g(ps(), 'ShipOwnership')[7], 'Resource', 'Filename')), parts: o.length, order: [...o[0].keys()].join() === [...ref.keys()].join(), ud: num(g(b, 'UserData')), ccd: !!g(ps(), 'CharacterCustomisationData')[18] };
    });
    console.log(JSON.stringify(st));
    ok('a .nmsship goes into an empty slot with its build', /BIGGS/.test(st.name) && st.parts === 941 && st.order && st.ud === 7 && st.ccd);
    // the .so onto Yautja Claw (index 3): keeps its name and build, takes the loadout
    st = await p.evaluate(async () => {
      const before = g(shipBuild(3), 'Objects').length;
      const f = { src: 'linked', root: ShipLib.folders[0].dir, path: 'Death n Glory.so' }; const pr = await ShipLib.load(f), sum = shipSummary(pr, f.path);
      const done = putShipInSave(pr, sum); await new Promise((r) => setTimeout(r, 300));
      const opts = [...document.querySelectorAll('#putSlot option')].map((o) => o.value);
      $('#putSlot').value = '3'; $('#dlgActs .btn.primary').click(); await done;
      const s3 = g(ps(), 'ShipOwnership')[3];
      return { opts, name: str(g(s3, 'Name')), cls: invClass(g(s3, 'Inventory')), parts: g(shipBuild(3), 'Objects').length, before, shipOnly: sum.shipOnly };
    });
    console.log(JSON.stringify(st));
    ok('a .so only goes onto corvettes and keeps their name and build', st.shipOnly && st.opts.join() === '1,3,4,5,6,7' && st.name === 'Yautja Claw' && st.cls === 'S' && st.parts === st.before);
  }
  // Render corvettes without Blender set up opens the cover settings
  await p.click('.dy-tabs [data-v="library"]'); await p.waitForSelector('#libRender'); await p.click('#libRender'); await p.waitForSelector('#dlg[open]');
  ok('Render corvettes asks for Blender when it is not set up', /Cover settings/.test(await p.textContent('#dlgTitle')));
  await p.click('#dlgActs .btn.ghost');
  // a build-only file onto corvette Max (slot 5, index 4)
  await p.click('.dy-sub [data-v="linked"]'); await p.waitForTimeout(800);
  const cards = await p.$$('.lib-card'); let target;
  for (const c of cards) if (/just the build/.test(await c.textContent())) target = c;
  await target.click(); await p.waitForSelector('#dlg[open] .lib-detail'); await p.click('#dlgActs .btn.primary'); await p.waitForSelector('#putSlot');
  const bopts = await p.$$eval('#putSlot option', (o) => o.map((x) => x.value + ':' + x.textContent)); console.log(bopts);
  ok('a build can only go on corvettes', bopts.length === (taz ? 6 : 5));
  await p.selectOption('#putSlot', '4'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(300);
  st = await p.evaluate(() => ({ max: g(shipBuild(4), 'Objects').length, name: str(g(g(ps(), 'ShipOwnership')[4], 'Name')), bname: str(g(shipBuild(4), 'Name')) }));
  ok('the build replaces Max\'s parts and keeps the ship', st.max === 300 && st.name === 'Max' && st.bname === 'Max');
  // delete a Garage copy: it moves to Deleted
  const garageBefore = fs.readdirSync(path.join(lib, 'Garage')).length;
  await p.click('.dy-tabs [data-v="garage"]'); await p.waitForTimeout(800);
  await p.click('.lib-card'); await p.waitForSelector('#dlg[open] .lib-detail');
  await p.click('#dlgActs .btn.danger'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await p.waitForTimeout(800);
  ok('delete moves the file to Deleted', fs.readdirSync(path.join(lib, 'Garage')).length === garageBefore - 1 && fs.readdirSync(path.join(lib, 'Deleted')).length === 1);
  // save, reopen, check
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }).catch(() => {});
  if (await p.$('#dlg[open]')) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }); }
  await p.reload(); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  st = await p.evaluate(() => ({ name: str(g(g(ps(), 'ShipOwnership')[6], 'Name')), b6: g(shipBuild(6), 'Objects').length, max: g(shipBuild(4), 'Objects').length, b7: shipBuild(7) && g(shipBuild(7), 'Objects').length }));
  ok('it all survives saving and reopening', st.name === 'The Cutting Remark' && st.b6 === 2091 && st.max === 300 && (!taz || st.b7 === 941));
  await p.click('nav button[data-s="library"]'); await p.click('.dy-tabs [data-v="fav"]'); await p.waitForTimeout(1500);
  ok('favourites filter', (await p.$$('.lib-card')).length === 1);
  // a .so written by TAZ itself (owner, 2026-10-29): ours must have the same format byte for byte (only the
  // supercharged slots differ, because the save moved on after TAZ wrote it)
  const tazSo = ATT + '139b3fef-The_Cutting_Remark.so';
  if (fs.existsSync(tazSo)) {
    const ours = Buffer.from(await p.evaluate(() => [...soJSON(toPlain(cloneJSON(g(ps(), 'ShipOwnership').find((s) => str(g(s, 'Name')) === 'The Cutting Remark'))))]));
    const theirs = fs.readFileSync(tazSo), strip = (b) => b.toString('utf8').replace(/"SpecialSlots": \[[\s\S]*?\r\n {4}\]/g, '');
    { const a = strip(ours), b = strip(theirs); let i = 0; while (i < a.length && a[i] === b[i]) i++; if (a !== b) console.log('so diff', ours.length, theirs.length, JSON.stringify(a.slice(i - 80, i + 60)), JSON.stringify(b.slice(i - 80, i + 60))); }
    ok('.so export matches the format TAZ writes', ours.length === theirs.length && ours[0] === 0x7B && theirs[0] === 0x7B && strip(ours) === strip(theirs));
    const pr = await p.evaluate(async (bytes) => { const r = await loadShipFile(new Uint8Array(bytes).buffer, 'x.so'); const s = shipSummary(r, 'x.so'); return s.shipOnly && s.name === 'The Cutting Remark' && s.cls === 'S'; }, [...theirs]);
    ok('a .so written by TAZ reads as a corvette loadout', pr);
  }
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.click('.dy-sub [data-v="all"]'); await p.waitForTimeout(2500);
  await p.screenshot({ path: SP + '/shots/lib2-dark.png' });
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
