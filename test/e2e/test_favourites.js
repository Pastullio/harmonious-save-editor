// Favourite places (owner, 2026-11-04): star a base, station, settlement or system, find it under Favourite places on
// Coordinates, load its glyphs and warp there. Kept in Documents\Harmonious Save Editor\Favourite places.json.
// Usage: node test/e2e/test_favourites.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const T = path.join(SP, 'favtest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const start = () => { const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48108'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } }); return new Promise((res) => proc.stdout.on('data', (d) => res({ proc, url: String(d).trim() }))); };
  let { proc, url } = await start();
  const b = await chromium.launch(); let p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  await open();
  const file = path.join(home, 'Documents', 'Harmonious Save Editor', 'Favourite places.json');
  const saved = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).places; } catch (_) { return []; } };

  // Coordinates: an empty list says how to add places
  await p.evaluate(() => go('coords')); await p.waitForSelector('#favBox');
  await wait(400);
  ok('empty favourites explain the stars', /Star a place/.test(await p.textContent('#favBox')));
  // a destination, starred
  const dest = '10A1FE8B2C3D';
  await p.fill('#fPortal', dest); await p.waitForSelector('#destStar .fav-star', { timeout: 8000 });
  await p.click('#destStar .fav-star'); await wait(500);
  let list = saved();
  ok('starring the destination saves it to the file', list.length === 1 && list[0].portal === dest && list[0].kind === 'Planet');
  ok('the star shows it is a favourite', (await p.getAttribute('#destStar .fav-star', 'aria-pressed')) === 'true');
  ok('it is listed under Favourite places', (await p.$$('#favBox .fav-list li')).length === 1);
  // a base from the Bases page, with its spot on the planet
  await p.evaluate(() => go('bases')); await p.waitForSelector('.base-where .fav-star', { timeout: 5000 }).catch(() => {});
  const baseStar = await p.$('.base-where .fav-star');
  ok('a base has a star', !!baseStar);
  let baseName = '';
  if (baseStar) {
    baseName = await p.evaluate(() => JSON.parse(document.querySelector('.base-where .fav-star').dataset.fav).name);
    await baseStar.click(); await wait(500);
    list = saved();
    const fb = list.find((x) => x.name === baseName);
    ok('the base is saved with its place on the planet', !!fb && (!fb.spot || (fb.spot.planet > 0 && fb.spot.local.length === 3)));
    console.log('  base:', baseName, fb && fb.kind, fb && fb.spot ? 'spot on planet ' + fb.spot.planet : 'no spot');
  }
  // back on Coordinates: pick the base, the glyphs load, warp works
  await p.evaluate(() => go('coords')); await p.waitForSelector('#favBox .fav-list li');
  ok('both are listed, newest first', (await p.$$eval('#favBox .fav-list li b', (x) => x.map((n) => n.textContent)))[0] === baseName);
  await p.click('#favBox .fav-list li:first-child [data-fgo]'); await wait(400);
  const want = list.find((x) => x.name === baseName);
  ok('Go here loads its glyphs', (await p.inputValue('#fPortal')) === want.portal);
  ok('and its galaxy', (await p.inputValue('#fGalaxy')) === String(want.gi));
  ok('the picked favourite is marked', !!(await p.$('#favBox .fav-list li.on')));
  // edit: a note and a new name
  await p.click('#favBox .fav-list li:first-child [data-fedit]'); await p.waitForSelector('#dlg[open]');
  await p.fill('#fvNote', 'by the lagoon'); await p.fill('#fvName', 'Lagoon home');
  await p.click('#dlgActs .btn.primary'); await wait(400);
  ok('a renamed favourite keeps its star lit', await (async () => { await p.evaluate(() => go('bases')); await wait(500); const v = await p.getAttribute('.base-where .fav-star', 'aria-pressed'); await p.evaluate(() => go('coords')); await p.waitForSelector('#favBox .fav-list li'); return v === 'true'; })());
  ok('edits are saved', saved().some((x) => x.name === 'Lagoon home' && x.note === 'by the lagoon'));
  // the favourites survive a restart and another save open
  await b.close(); proc.kill(); await wait(500);
  ({ proc, url } = await start());
  const b2 = await chromium.launch(); p = await b2.newPage({ viewport: { width: 1440, height: 1000 } }); p.on('pageerror', (e) => errs.push(e.message));
  await open(); await p.evaluate(() => go('coords')); await p.waitForSelector('#favBox .fav-list li');
  ok('favourites are there after a restart', (await p.$$('#favBox .fav-list li')).length === 2);
  // warp from a favourite
  await p.click('#favBox .fav-list li:last-child [data-fgo]'); await wait(400);
  await p.click('#warpBtn'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await wait(300);
  ok('warping to a favourite sets the location', await p.evaluate((d) => Place.portal({ ...Place.fromUA(g(ps(), 'UniverseAddress')), planet: 0 }) === '0' + d.slice(1), dest));
  // export and import (duplicates are skipped)
  await p.evaluate(() => go('coords')); await p.waitForSelector('#favExp');
  const share = path.join(T, 'share.json'); fs.writeFileSync(share, JSON.stringify({ places: [...saved(), { name: 'Friend base', kind: 'Base you visited', portal: '30F1FE8B2C3D', gi: 0 }] }));
  await p.setInputFiles('#favImp', share); await wait(600);
  ok('import adds only new places', saved().length === 3 && saved().some((x) => x.name === 'Friend base'));
  // removing with the star
  await p.click('#destStar .fav-star').catch(() => {}); await wait(400);
  ok('a filled star removes the place', saved().length === 2);
  ok('a backup of the previous list is kept', fs.existsSync(file + '.bak'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b2.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
