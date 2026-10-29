const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Coordinates page: glyph keypad, typed and pasted codes, galactic addresses, places, warp.
// Usage: node test/e2e/test_coords.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'coordcfg'), root = path.join(SP, 'coordroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });   // a copy, because this test saves
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47978'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForTimeout(800);
  ok('overview shows glyphs', await p.$$eval('.tc.loc .portal-glyphs .glyph', (x) => x.length) === 12);
  await p.screenshot({ path: SP + '/shots/co0-overview.png' });
  await p.click('.loc-go'); await p.waitForSelector('#keypad');
  ok('starts at the current location', (await p.inputValue('#fPortal')) === (await p.evaluate(() => Place.portal(Place.fromUA(g(ps(), 'UniverseAddress'))))));
  // packed address decode agrees with a base's teleport endpoint
  ok('packed address decodes', await p.evaluate(() => JSON.stringify(Place.fromPacked(new Num('5656987440515406'))) === JSON.stringify({ x: -1714, z: -448, y: 6, gi: 0, sys: 1049, planet: 1 })));
  await p.click('#gClear');
  for (const d of '02458A31ECF9') await p.click(`#keypad button[data-d="${d}"]`);
  ok('glyph taps make a portal code', (await p.inputValue('#fPortal')) === '02458A31ECF9');
  ok('and the galactic address', (await p.inputValue('#fGal')) === '04F8:0009:0B1D:0245');   // nmsportals shows the same for this code
  await p.screenshot({ path: SP + '/shots/co1-glyphs.png', fullPage: true });
  await p.fill('#fGal', '0B1E:0081:0D51:0204');
  ok('typing an address fills the glyphs', /^0204/.test(await p.inputValue('#fPortal')) && (await p.$$eval('#destGlyphs .glyph:not(.empty)', (x) => x.length)) === 12);
  await p.fill('#fPortal', 'http://nmsportals.github.io/#02458A31ECF9');
  ok('pasting an nmsportals link works', (await p.inputValue('#fGal')) === '04F8:0009:0B1D:0245');
  // the ATLAS APF screenshot's system: Eissentam (galaxy 10), 115A30E59ECB
  await p.selectOption('#fGalaxy', '9'); await p.fill('#fPortal', '115A30E59ECB');
  await p.waitForSelector('#pred .pred-name', { timeout: 20000 });
  const pred = await p.evaluate(() => ({ name: $('#pred .pred-name').textContent, planets: [...document.querySelectorAll('#pred .pred-planets tbody tr td:nth-child(2)')].map((t) => t.textContent), text: $('#pred').textContent }));
  console.log(JSON.stringify(pred.planets), pred.text.replace(/\s+/g, ' ').slice(0, 260));
  ok('predicts the system name', pred.name === 'Iqueri-Rep');
  ok('predicts the planets', JSON.stringify(pred.planets) === JSON.stringify(['Nadyak Prime', 'Tomi 47/B2', 'Beherylano Dori']));
  ok('predicts race and pirates', /Korvax/.test(pred.text) && /Pirate controlled/.test(pred.text));
  await (await p.$('#destInfo')).screenshot({ path: SP + '/shots/co4-predict.png' });
  await p.click('#pred [data-planet="2"]');
  ok('picking a planet sets the portal address', (await p.inputValue('#fPortal')) === '215A30E59ECB');
  await p.selectOption('#fGalaxy', '0'); await p.fill('#fPortal', '02458A31ECF9');
  await p.click('#gBack'); ok('delete last glyph', (await p.inputValue('#fPortal')) === '02458A31ECF');
  await p.click('#keypad button[data-d="9"]');
  // pick a known base and see what the save knows about its system
  const opts = await p.$$eval('#fPlaces option', (o) => o.map((x) => x.textContent));
  const gi = opts.findIndex((t) => /^Gas Display/.test(t)); ok('your places are listed', opts.length > 20 && gi > 0);
  await p.selectOption('#fPlaces', String(gi - 1));
  const info = await p.textContent('#destInfo'); console.log(info.replace(/\s+/g, ' ').slice(0, 400));
  ok('shows discoveries and places for a known system', /discovered/.test(info) && /Gas Display/.test(info));
  await p.screenshot({ path: SP + '/shots/co2-known.png', fullPage: true });
  ok('a warp button at the top of the destination', await p.evaluate(() => { const b = $('#warpTop'); return b && !b.disabled && b.getBoundingClientRect().top < $('#keypad').getBoundingClientRect().top; }));
  // warp
  await p.click('#warpTop'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ ua: Place.fromUA(g(ps(), 'UniverseAddress')), prev: Place.fromUA(g(ps(), 'PreviousUniverseAddress')), st: str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')), dirty: S.dirty }));
  console.log(JSON.stringify(after));
  ok('warp sets the location', after.ua.x === -1714 && after.ua.sys === 1049 && after.ua.gi === 0 && after.ua.planet === 0);
  ok('keeps the old one as previous', after.prev.sys === 516 && after.prev.gi === 255);
  ok('arrives in the ship', after.st === 'InShip' && after.dirty);
  // save to disk, then open it again
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }).catch(() => {});
  const dlg = await p.$('#dlg[open]'); if (dlg) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }); }
  await p.reload(); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const re = await p.evaluate(() => ({ ua: Place.fromUA(g(ps(), 'UniverseAddress')), st: str(g(S.ctx, 'SpawnStateData', 'LastKnownPlayerState')) }));
  ok('the warp is saved to the game', re.ua.sys === 1049 && re.ua.gi === 0 && re.st === 'InShip');
  await p.evaluate(() => go('coords')); await p.waitForSelector('#keypad');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.click('#gClear');
  for (const d of '1079') await p.click(`#keypad button[data-d="${d}"]`);
  await p.screenshot({ path: SP + '/shots/co3-dark.png', fullPage: true });
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
