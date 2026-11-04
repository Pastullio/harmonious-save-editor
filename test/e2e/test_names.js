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
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
