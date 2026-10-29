const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Arriving on foot at a base: planet centres come from the save (checked against the predicted planet seeds) and are
// remembered per system, so a save made elsewhere can still arrive there.
// Usage: node test/e2e/test_arrive.js <scratch dir> <folder with a save pair made on foot at a base> [folder with a save from another system]
const SP = process.argv[2], AT = process.argv[3], OTHER = process.argv[4] || path.join(SP, 'dbroot/NMS/st_76561190000000001');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'arcfg'), root = path.join(SP, 'arroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root + '/st_1', { recursive: true }); fs.mkdirSync(root + '/st_2', { recursive: true });
  for (const f of ['save.hg', 'mf_save.hg']) { fs.copyFileSync(path.join(AT, f), root + '/st_1/' + f); fs.copyFileSync(path.join(OTHER, f), root + '/st_2/' + f); }
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47993'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let which = 0;
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); const ac = await p.$$('#acctList .pick'); if (ac.length > 1) { const names = await p.$$eval('#acctList .pick .pn', (x) => x.map((e) => e.textContent).sort()); await p.click(`#acctList .pick:has-text("${names[which]}")`); await p.waitForTimeout(500); } await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)', { timeout: 8000 }).catch(async (e) => { await p.screenshot({ path: SP + '/shots/arr-fail.png' }); throw e; }); await p.waitForTimeout(800); };
  // the other system's save first, so it has to learn the base's system from the base save
  for (which = 0; which < 2; which++) { await open(); if (await p.evaluate(() => str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')) !== 'OnFoot')) break; }
  const earlier = await p.evaluate(() => savedPlanetCentres() && Place.portal(savedPlanetCentres().p)); console.log('other save system', earlier);
  which = 1 - which; await open();
  const orig = await p.evaluate(() => ({ here: Place.portal(Place.fromUA(g(ps(), 'UniverseAddress'))), pos: g(S.ctx, 'SpawnStateData', 'PlayerPositionInSystem').slice(0, 3).map(num), state: str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')), centres: savedPlanetCentres() }));
  console.log(orig.here, orig.state, orig.pos);
  ok('planet centres read from the save and match its planet seeds', !!orig.centres && orig.centres.centres.length >= 2);
  // the base the save was made at: arriving there puts you within a short walk of where you really stood
  const spots = await p.evaluate(() => arrivalSpots(Place.fromUA(g(ps(), 'UniverseAddress'))).map((x) => ({ name: x.name, kind: x.kind, planet: x.planet, local: x.local })));
  const near = spots.map((x) => ({ ...x, d: Math.hypot(...x.local.map((v, i) => orig.centres.centres[x.planet - 1][i] + v - orig.pos[i])) })).sort((a, b) => a.d - b.d)[0];
  console.log('nearest', near.name, Math.round(near.d), 'm');
  ok('a base\'s planet-relative position plus its planet centre lands where the player stood', near.d < 300);
  await p.evaluate(() => go('coords')); await p.waitForSelector('#hereUse'); await p.click('#hereUse');
  await p.waitForSelector('[data-arrive]');
  ok('arrive buttons for bases in this system', (await p.$$('[data-arrive]')).length === spots.length);
  const idx = spots.findIndex((x) => x.name === near.name && x.kind === near.kind);
  await p.click(`[data-arrive="${idx}"]`); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(200);
  const after = await p.evaluate(() => { const s = g(S.ctx, 'SpawnStateData'); return { pos: g(s, 'PlayerPositionInSystem').slice(0, 3).map(num), ship: g(s, 'ShipPositionInSystem').slice(0, 3).map(num), state: str(g(s, 'LastKnownPlayerState')), hover: g(s, 'ShipHovering'), planet: num(g(ps(), 'UniverseAddress', 'GalacticAddress', 'PlanetIndex')) }; });
  ok('spawn set on foot at the base', after.state === 'OnFoot' && after.hover === true && after.planet === near.planet && Math.hypot(...after.pos.map((v, i) => v - orig.pos[i])) < 300 && Math.hypot(...after.ship.map((v, i) => v - after.pos[i])) > 30);
  await (await p.$('#arrive')).scrollIntoViewIfNeeded(); await p.screenshot({ path: SP + '/shots/arrive.png', fullPage: false });
  await p.click('#saveBtn'); const dlg = await p.waitForSelector('#dlg[open]', { timeout: 3000 }).catch(() => null); if (dlg) await p.click('#dlgActs .btn.primary');
  await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 });
  await open();
  const re = await p.evaluate(() => ({ state: str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')), pos: g(S.ctx, 'SpawnStateData', 'PlayerPositionInSystem').map((v) => v.raw || String(v)) }));
  console.log(JSON.stringify(re));
  ok('saved and read back', re.state === 'OnFoot' && re.pos.every((v) => /\./.test(v) || v === '1'));
  // a save from another system now knows this system's planets too
  const gi = await p.evaluate(() => num(g(ps(), 'UniverseAddress', 'RealityIndex')));
  which = 1 - which; await open();
  const known = await p.evaluate(async ([code, gi]) => { const q = Place.fromPortal(code, gi); return !Place.sameSystem(Place.fromUA(g(ps(), 'UniverseAddress')), q) && !!(await planetCentres(q)); }, [orig.here, gi]);
  ok('planet centres remembered for the system', known);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
