const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Real models from game archives. Usage: node test/e2e/test_models.js <scratch> <PCBANKS with model .paks>
const SP = process.argv[2], BANKS = process.argv[3];
const cfg = path.join(SP, 'modelcfg'), home = path.join(SP, 'modelhome');
fs.rmSync(cfg, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47973'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_GAME: BANKS } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if ((m.type() === 'warning' || m.type() === 'error') && !/404/.test(m.text())) console.log('console:', m.text()); });
  await p.goto(url); await p.waitForSelector('.slot-row');
  await p.waitForFunction(() => S.lib && S.lib.game, null, { timeout: 60000 });
  ok('WebGL2 available', await p.evaluate(() => GL3D.ok()));
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="tools"]');
  await p.waitForFunction(() => document.querySelectorAll('.cf-item').length > 0, null, { timeout: 20000 });
  await p.waitForTimeout(4000);
  const loaded = await p.evaluate(() => coverItems().length);
  await p.screenshot({ path: SP + '/shots/f0-tools.png' });
  await p.click('nav button[data-s="ships"]'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const it = coverItems().find((x) => /Golden/.test(x.name)); S.pick.ship = it.i; render(); }); await p.waitForTimeout(3000);
  await p.screenshot({ path: SP + '/shots/f1-golden.png' });
  // parts picker on a multitool
  await p.click('nav button[data-s="tools"]'); await p.waitForTimeout(1500);
  await p.evaluate(() => { S.pick.tool = 5; render(); }); await p.waitForTimeout(1500);
  await p.click('[data-k="parts"]'); await p.waitForSelector('.parts-dlg', { timeout: 20000 }); await p.waitForTimeout(1500);
  const groups = await p.$$eval('.parts-group', (gs) => gs.map((x) => x.querySelector('.pg-name').textContent + ' = ' + (x.querySelector('.part-tile.on') || {}).dataset?.o));
  console.log('groups', groups.length, groups.slice(0, 12));
  ok('parts picker lists choices', groups.length > 3);
  ok('nested parts are named without the parent\'s code', !groups.some((g) => /^(B\d|TS\d|LS\d)/.test(g)));
  await p.waitForFunction(() => [...document.querySelectorAll('.part-tile canvas')].slice(0, 6).every((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }), null, { timeout: 30000 }).catch(() => {});
  ok('each choice shows a picture of its part', await p.evaluate(() => [...document.querySelectorAll('.part-tile canvas')].slice(0, 6).every((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })));
  await p.screenshot({ path: SP + '/shots/f2-parts.png' });
  const tile = await p.$('.parts-group .part-tile:not(.on)'); const pick = { g: await tile.getAttribute('data-g'), o: await tile.getAttribute('data-o') };
  await tile.click(); await p.waitForTimeout(1500);
  ok('clicking a part picks it', await p.$eval(`.part-tile.on[data-g="${pick.g}"]`, (b) => b.dataset.o) === pick.o);
  await p.screenshot({ path: SP + '/shots/f3-parts-changed.png' });
  // the multi-tool has a _MultiTool group inside a _MultiTool group: picking inside must not undo the outer pick,
  // and the inner parts get pictures of their own
  const nested = await p.$$('.parts-group[data-depth="1"] .part-tile:not(.on)');
  if (nested.length) { await nested[0].click(); await p.waitForTimeout(1500); }
  ok('a choice inside a same-named group keeps the outer one', await p.$eval(`.parts-group[data-depth="0"] .part-tile.on`, (b) => b.dataset.o) === pick.o);
  const filled = async () => p.evaluate(() => [...document.querySelectorAll('.parts-group[data-depth="2"] .part-tile canvas')].slice(0, 4).map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }));
  await p.waitForTimeout(2500);
  const px = await filled(); console.log('nested thumb pixels', px);
  ok('parts two levels down have pictures too', px.length > 0 && px.every((n) => n > 200));
  await p.screenshot({ path: SP + '/shots/f4-parts-nested.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(1500);
  ok('parts saved', await p.evaluate(async () => Object.keys(await IDB.get('parts:' + coverItems().find((x) => x.kind === 'tool' && x.i === 5).key) || {}).length > 0));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
