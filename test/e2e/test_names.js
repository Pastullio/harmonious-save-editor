// Names players gave a system and its planets (owner, 2026-11-04): taken from the save's discovery records (DM.CN), shown
// instead of the game's generated names, with the generated one beside them.
// Usage: node test/e2e/test_names.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'namestest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48111'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // a system in the save that another player named
  const r = await p.evaluate(async () => {
    const recs = g(S.save.json, 'DiscoveryManagerData', 'DiscoveryData-v1', 'Store', 'Record');
    const rec = recs.find((x) => str(g(x, 'DD', 'DT')) === 'SolarSystem' && str(g(x, 'DM', 'CN')) && str(g(x, 'OWS', 'UID')) !== myUID());
    const at = Place.fromPacked(g(rec, 'DD', 'UA')); const sys = await predictSystem(at);
    S.coords = { p: { ...at, planet: 0 }, digits: Place.portal({ ...at, planet: 0 }) }; go('coords');
    return { cn: untag(str(g(rec, 'DM', 'CN'))), by: untag(str(g(rec, 'OWS', 'USN'))), name: sys.name, gen: sys.genName };
  });
  console.log('  ', r);
  ok('a renamed system shows the name players gave it', r.name === r.cn && r.gen && r.gen !== r.cn);
  await p.waitForSelector('.pred-name', { timeout: 8000 });
  const head = await p.textContent('.pred-head');
  ok('with the game\'s own name and who named it', head.includes(r.gen) && head.includes(r.by));
  // a planet and the system can be starred from the prediction
  await p.click('#pred .pred-planets tbody tr:first-child .fav-star'); await p.waitForTimeout(600);
  await p.click('#pred .pred-name .fav-star'); await p.waitForTimeout(600);
  const favs = await p.evaluate(() => FAVS.list.map((f) => [f.kind, f.name, f.note]));
  console.log('  ', favs);
  ok('a planet from the table is kept as a planet, with its system as the note', favs.some(([k, , n]) => k === 'Planet' && /^In /.test(n)));
  ok('the system is kept as a system', favs.some(([k, nm]) => k === 'System' && nm === r.cn));
  ok('the stars light up', (await p.$$('#pred .fav-star[aria-pressed="true"]')).length >= 2);
  // a renamed planet
  const pl = await p.evaluate(async () => {
    const recs = g(S.save.json, 'DiscoveryManagerData', 'DiscoveryData-v1', 'Store', 'Record');
    const rec = recs.find((x) => str(g(x, 'DD', 'DT')) === 'Planet' && str(g(x, 'DM', 'CN')));
    const at = Place.fromPacked(g(rec, 'DD', 'UA')); const sys = await predictSystem(at);
    return { cn: untag(str(g(rec, 'DM', 'CN'))), name: sys.planets[at.planet - 1], gen: sys.genPlanets[at.planet - 1] };
  });
  ok('a renamed planet shows its given name', pl.name === pl.cn && pl.gen !== pl.cn);
  // You are here, when your own system has a name
  await p.evaluate(() => { const here = Place.fromUA(g(ps(), 'UniverseAddress')); const recs = g(S.save.json, 'DiscoveryManagerData', 'DiscoveryData-v1', 'Store', 'Record'); const rec = recs.find((x) => str(g(x, 'DD', 'DT')) === 'SolarSystem' && Place.sameSystem(Place.fromPacked(g(x, 'DD', 'UA')), here)); set(g(rec, 'DM'), 'CN', 'Test Haven'); go('coords'); });
  await p.waitForTimeout(1500);
  const hn = await p.textContent('#hereName');
  ok('You are here shows the given name first', /^Test Haven \(/.test(hn));
  // nicknames: shown only in the editor, kept outside the save (owner, 2026-11-04)
  const tgt = await p.evaluate(() => { const here = Place.fromUA(g(ps(), 'UniverseAddress')); S.coords = { p: { ...here, planet: 0 }, digits: Place.portal({ ...here, planet: 0 }) }; S.dirty = false; go('coords'); return 1; });
  await p.waitForSelector('#pred [data-rename="1"]', { timeout: 8000 });
  await p.click('#pred [data-rename="1"]'); await p.waitForSelector('#rnName');
  ok('the dialog says a nickname does not rename it in the game', /only shown in this editor/.test(await p.textContent('#dlgBody')) && /upload it/.test(await p.textContent('#dlgBody')));
  await p.fill('#rnName', 'Harmony Prime'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(1200);
  ok('the planet shows its nickname, with the game name under it', (await p.textContent('#pred .pred-planets')).includes('Harmony Prime') && (await p.textContent('#pred .pred-planets')).includes('In the game:'));
  ok('the save is not changed', await p.evaluate(() => !S.dirty));
  const nickFile = path.join(home, 'Documents', 'Harmonious Save Editor', 'Nicknames.json');
  ok('the nickname is kept in Nicknames.json', fs.existsSync(nickFile) && fs.readFileSync(nickFile, 'utf8').includes('Harmony Prime'));
  // a name the old experiment wrote into the save is shown as a nickname and taken out when a nickname is set
  const stray = await p.evaluate(async () => { const here = Place.fromUA(g(ps(), 'UniverseAddress')); const r = discoveryRecord({ ...here, planet: 0 }); return nicknameOf({ ...here, planet: 0 }); });
  ok('an old in-save name counts as a nickname', stray === 'Test Haven');
  await p.click('#pred [data-rename="0"]'); await p.waitForSelector('#rnName'); await p.fill('#rnName', 'My System'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(1200);
  ok('setting a nickname clears the old in-save name', await p.evaluate(() => { const here = Place.fromUA(g(ps(), 'UniverseAddress')); return !str(g(discoveryRecord({ ...here, planet: 0 }), 'DM', 'CN')) && S.dirty; }));
  ok('and the system shows the nickname', (await p.textContent('#pred .pred-name')).includes('My System'));
  await p.click('#pred [data-rename="1"]'); await p.waitForSelector('#rnName'); await p.click('#dlgActs .btn.ghost'); await p.waitForTimeout(1000);
  ok('Remove nickname takes it away', !(await p.textContent('#pred .pred-planets')).includes('Harmony Prime'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
