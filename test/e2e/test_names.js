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
  // renaming your own discovery in the save (experimental)
  const tgt = await p.evaluate(() => {
    const recs = g(S.save.json, 'DiscoveryManagerData', 'DiscoveryData-v1', 'Store', 'Record');
    const rec = recs.find((x) => str(g(x, 'DD', 'DT')) === 'Planet' && str(g(x, 'OWS', 'UID')) === myUID() && !str(g(x, 'RID')) && !str(g(x, 'DM', 'CN')));
    const other = recs.find((x) => str(g(x, 'DD', 'DT')) === 'Planet' && str(g(x, 'OWS', 'UID')) && str(g(x, 'OWS', 'UID')) !== myUID());
    const at = Place.fromPacked(g(rec, 'DD', 'UA')), ot = Place.fromPacked(g(other, 'DD', 'UA'));
    S.coords = { p: { ...at, planet: 0 }, digits: Place.portal({ ...at, planet: 0 }) }; go('coords');
    return { planet: at.planet, otherOk: renameState(ot).ok };
  });
  ok("another traveller's discovery can't be renamed", tgt.otherOk === false);
  await p.waitForSelector(`#pred [data-rename="${tgt.planet}"]`, { timeout: 8000 });
  await p.click(`#pred [data-rename="${tgt.planet}"]`); await p.waitForSelector('#rnName');
  ok('the dialog says it is not uploaded yet', /haven't uploaded/.test(await p.textContent('#dlgBody')));
  await p.fill('#rnName', 'Harmony Prime'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(1200);
  ok('the planet takes the new name', await p.evaluate(() => S.dirty) && (await p.textContent('#pred .pred-planets')).includes('Harmony Prime'));
  ok('and the save still encodes', await p.evaluate(() => { try { encodeSave(); return true; } catch (e) { return e.message; } }) === true);
  await p.click(`#pred [data-rename="${tgt.planet}"]`); await p.waitForSelector('#rnName');
  await p.click('#dlgActs .btn.ghost'); await p.waitForTimeout(1000);
  ok("Use the game's name clears it", !(await p.textContent('#pred .pred-planets')).includes('Harmony Prime'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
