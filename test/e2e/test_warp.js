// Warp here asks how to arrive (owner, 2026-11-04): in your ship, aboard your freighter, or on foot at a base in the
// system; a favourite base picked with Go here goes straight there. Places here lists each place once, with its star
// and Arrive here.
// Usage: node test/e2e/test_warp.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const T = path.join(SP, 'warptest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48109'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)').catch(async (e) => { await p.screenshot({ path: T + '/fail.png' }); throw e; }); };
  await open();
  // the system with the most bases you can land at; its planet centres are given here, as a save made there would
  const info = await p.evaluate(async () => {
    let best = null, n = -1; for (const k of knownPlaces()) { const c = placesHere(k.p).filter((x) => x.spot).length; if (c > n) { n = c; best = { ...k.p, planet: 0 }; } }
    await IDB.put(sysKey(best), [...Array(6)].map((_, i) => [1e5 * (i + 1), 0, 0]));
    S.coords = { p: best, digits: Place.portal(best) };
    const rows = placesHere(best); return { n: rows.length, spots: rows.filter((x) => x.spot).length, corv: rows.some((x) => /corvette/i.test(x.kind)), dup: new Set(rows.map((x) => x.name + x.at.planet)).size !== rows.length };
  });
  console.log('  places here:', info.n, 'with a spot:', info.spots);
  ok('each place is listed once', !info.dup);
  ok('corvette builds are not places', !info.corv);
  await p.evaluate(() => go('coords')); await p.waitForSelector('#placesHere li', { timeout: 8000 });
  ok('Places here shows the places with stars', (await p.$$('#placesHere li .fav-star')).length === info.n);
  ok('the old Arrive at a base list is gone', !(await p.$('#arrive')));
  await p.waitForSelector('#placesHere [data-arrive]', { timeout: 5000 }).catch(() => {});
  const arrives = (await p.$$('#placesHere [data-arrive]')).length;
  ok('bases you can land at have Arrive here', arrives > 0 && arrives <= info.spots);
  // Warp here: the three choices
  await p.click('#warpBtn'); await p.waitForSelector('#dlg[open] .arr-opts');
  const opts = await p.$$eval('#dlg .arr-opt', (l) => l.map((x) => [x.querySelector('b').textContent, !x.querySelector('input').disabled]));
  ok('ship, freighter and base are offered', opts.length === 3 && opts[0][1] && opts[2][1]);
  ok('in your ship is picked first', await p.$eval('#dlg input[value="ship"]', (x) => x.checked));
  const target = await p.$eval('#arrBase option:last-child', (o) => ({ v: o.value, t: o.textContent }));
  await p.selectOption('#arrBase', target.v);
  ok('choosing a base picks At a base', await p.$eval('#dlg input[value="base"]', (x) => x.checked));
  await p.click('#dlgActs .btn.primary'); await wait(300);
  const st = await p.evaluate(() => ({ state: str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')), planet: Place.fromUA(g(ps(), 'UniverseAddress')).planet }));
  ok('At a base lands on foot on its planet', st.state === 'OnFoot' && st.planet === +(/planet (\d+)\)/.exec(target.t) || [])[1]);
  // aboard the freighter
  await p.evaluate(() => go('coords')); await p.waitForSelector('#warpBtn');
  await p.click('#warpBtn'); await p.waitForSelector('#dlg[open] .arr-opts');
  if (await p.$('#dlg input[value="freighter"]:not([disabled])')) {
    await p.check('#dlg input[value="freighter"]'); await p.click('#dlgActs .btn.primary'); await wait(300);
    ok('Aboard your freighter puts you aboard', await p.evaluate(() => str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')) === 'AboardFleet'));
  } else ok('the save has a freighter', false);
  // in your ship
  await p.click('#warpBtn'); await p.waitForSelector('#dlg[open] .arr-opts'); await p.click('#dlgActs .btn.primary'); await wait(300);
  ok('In your ship puts you in your ship', await p.evaluate(() => str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')) === 'InShip'));
  // a favourite base: Go here, then Warp here goes straight to it
  await p.evaluate(async () => { const here = Place.fromUA(g(ps(), 'UniverseAddress')); const x = placesHere(here).find((r) => r.spot); await favToggle(favEntry(x.name, 'Base', x.at, x.spot)); });
  await p.waitForSelector('#favBox [data-fgo]'); await p.click('#favBox [data-fgo]'); await wait(400);
  await p.click('#warpBtn'); await p.waitForSelector('#dlg[open]');
  const t = await p.textContent('#dlgTitle');
  ok('a favourite base skips the choices', /^Arrive at /.test(t) && !(await p.$('#dlg .arr-opts')));
  await p.click('#dlgActs .btn.primary'); await wait(300);
  ok('and lands there', await p.evaluate(() => str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')) === 'OnFoot'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
