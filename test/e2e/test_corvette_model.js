const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Corvettes in 3D from the game's part models (/api/model/build). Usage: node test/e2e/test_corvette_model.js <scratch> <PCBANKS>
// The test archives have no corvette modules, so HSE_TEST_PARTSCENES stands one model in for every part.
const SP = process.argv[2], BANKS = process.argv[3];
const cfg = path.join(SP, 'cmodelcfg'), home = path.join(SP, 'modelhome');
fs.rmSync(cfg, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
const map = path.join(SP, 'partscenes.json');
fs.writeFileSync(map, JSON.stringify({ '*': 'MODELS/COMMON/WEAPONS/MULTITOOL/MULTITOOL.SCENE.MBIN' }));
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47976'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_GAME: BANKS, HSE_TEST_PARTSCENES: map, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  await p.waitForFunction(() => S.lib && S.lib.game, null, { timeout: 60000 });
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // straight from the API: one mesh for the whole build
  const direct = await p.evaluate(async () => {
    const it = coverItems().find((x) => x.kind === 'corvette'); const pl = await buildPayload(it);
    const r = await api('/api/model/build?lod=3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pl.text });
    const m = parseMesh(await r.arrayBuffer()); return { parts: it.holo.objs, tris: m.tris, missing: r.headers.get('X-Parts-Missing'), dropped: +r.headers.get('X-Parts-Dropped') };
  });
  console.log(direct);
  ok('a corvette build comes back as one mesh', direct.tris > direct.parts && direct.missing === '0');
  ok('a build over the triangle budget drops its smallest parts and stays under it', direct.tris <= 1500000 && direct.dropped > 0);
  // Starships page: corvette covers switch from the parts hologram to the model
  await p.click('nav button[data-s="ships"]');
  await p.evaluate(() => { const c = coverItems().find((x) => x.kind === 'corvette'); S.pick.ship = c.i; render(); });
  // the hologram is points and lines; the model fills the cover with shaded faces, so many more pixels change
  await p.waitForFunction(() => [...buildMeshes.values()].length > 0, null, { timeout: 60000 }).catch(() => {});
  const got = await p.evaluate(async () => { const r = await Promise.all([...buildMeshes.values()]); return r.filter((x) => x && x.mesh).length; });
  ok('corvette covers get their 3D model', got > 0);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: SP + '/shots/corvette-model.png' });
  // a bad request is refused, not a crash
  const bad = await p.evaluate(async () => { try { await api('/api/model/build', { method: 'POST', body: '{"Objects":[]}' }); return 'ok'; } catch (e) { return e.message; } });
  ok('an empty build gets a plain answer', /none of the build/.test(bad));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
