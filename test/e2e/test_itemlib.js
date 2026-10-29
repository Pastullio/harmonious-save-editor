const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// The app's own item library, built from game archives. Usage: node test/e2e/test_itemlib.js <scratch> <PCBANKS folder>
// <scratch>/dbroot/NMS must hold a save. The banks can be real, or .pak files built with HGPAKtool from extracted files.
const SP = process.argv[2], BANKS = process.argv[3];
const cfg = path.join(SP, 'itemlibcfg'), home = path.join(SP, 'itemlibhome');
fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47971'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_GAME: BANKS } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  await p.waitForFunction(() => S.db && S.db.src === 'lib', null, { timeout: 120000 });
  ok('library built from the game by itself on first start', await p.evaluate(() => S.db.list.length > 2500));
  const names = await p.evaluate(() => ['^FUEL1', '^UP_HOT3#123', '^HULK_REACTOR', '^ASTBELT1'].map((id) => (dbItem(id) || {}).name));
  console.log(names);
  ok('names resolve, including ones Goatfungus lacks', names.join('|') === 'Carbon|S-Class Thermal Protection Upgrade|Fuel Rod|Comet Dust');
  const tok = await p.evaluate(() => window.NMS_APP.token);
  const made = fs.readdirSync(path.join(cfg, 'HarmoniousSaveEditor', 'itemlib', 'icons')).filter((f) => f.endsWith('.png'));
  console.log(made.length + ' icons converted');
  const icon = await fetch(url + 'api/itemlib/icon?name=' + made[0] + '&t=' + tok);
  ok('icons served as PNG', icon.status === 200 && icon.headers.get('content-type') === 'image/png');
  ok('odd icon names refused', (await fetch(url + 'api/itemlib/icon?name=..%2Fx.png&t=' + tok)).status === 400);
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="items"]'); await p.waitForSelector('.lib-panel');
  ok('items page shows the library', /items from your game/.test(await p.textContent('.lib-panel')));
  await p.screenshot({ path: SP + '/shots/d0-items-page.png' });
  await p.click('#libBuild'); await p.waitForTimeout(400);
  await p.screenshot({ path: SP + '/shots/d1-rebuilding.png' });
  await p.waitForFunction(() => S.lib && S.lib.status.state === 'ready', null, { timeout: 120000 });
  ok('rebuild finishes', true);
  await p.click('nav button[data-s="exosuit"]'); await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + '/shots/d2-exosuit.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
