const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Item names and icons from Goatfungus's NMSSaveEditor.jar, found by the app on its own.
// Usage: node test/e2e/test_itemdb.js <scratch dir> <path to NMSSaveEditor.jar>
// Needs dist/hse-linux (cd desktop && go build -o ../dist/hse-linux .) and a save under <scratch>/rroot/NMS/st_*/.
const SP = process.argv[2], JAR = process.argv[3];
const home = path.join(SP, 'idbhome'), cfg = path.join(SP, 'idbcfg');
fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true });
fs.mkdirSync(path.join(home, 'Downloads', 'NMSSaveEditor'), { recursive: true });
fs.symlinkSync(path.resolve(JAR), path.join(home, 'Downloads', 'NMSSaveEditor', 'NMSSaveEditor.jar'));
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/rroot/NMS', '-port', '47961'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  ok('icons refuse calls without the token', (await fetch(url + 'api/itemdb/icon?name=SUBSTANCE-FUEL1.PNG')).status === 403);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  const tok = await p.evaluate(() => window.NMS_APP.token), H = { 'X-Token': tok };
  const info = await (await fetch(url + 'api/itemdb', { headers: H })).json();
  ok('found NMSSaveEditor.jar in Downloads by itself', info.ready && info.path.endsWith('NMSSaveEditor.jar'));
  ok('remembered the jar in settings', JSON.parse(fs.readFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'settings.json'), 'utf8')).itemdb === info.path);
  ok('refuses odd icon names', (await fetch(url + 'api/itemdb/icon?name=..%2Fx.png', { headers: H })).status === 400);
  const icon = await fetch(url + 'api/itemdb/icon?name=substance-fuel1.png&t=' + tok);
  ok('serves an icon from inside the jar', icon.status === 200 && icon.headers.get('content-type') === 'image/png');
  await p.waitForFunction(() => S.db && S.db.list.length > 1000, null, { timeout: 15000 });
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="exosuit"]'); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => ({ cells: document.querySelectorAll('.grid.named .cell.has').length, named: [...document.querySelectorAll('.grid.named .cell .nm:not(.raw)')].length, imgs: [...document.querySelectorAll('.grid.named .cell img')].filter((i) => i.complete && i.naturalWidth > 0).length, qty: document.querySelector('.grid.named .cell .qty')?.textContent }));
  console.log(st);
  ok('inventory cells show icon, name and amount/max', st.cells > 0 && st.named > 0 && st.imgs > 0 && /^\d+(\.\d)?k?\/\d+(\.\d)?k?$/.test(st.qty || ''));
  await p.screenshot({ path: SP + '/shots/70-itemdb-exosuit.png' });
  await p.click('nav button[data-s="items"]'); await p.waitForSelector('#dbPath');
  await p.click('#dbForget'); await p.waitForFunction(() => !S.db && document.querySelector('#dbPath'), null, { timeout: 15000 });
  const off = await (await fetch(url + 'api/itemdb', { headers: H })).json();
  ok('stop using it clears names and the app stops looking', !off.ready);
  await p.fill('#dbPath', path.dirname(path.join(home, 'Downloads', 'NMSSaveEditor', 'x'))); await p.click('#dbForm .btn.primary');
  await p.waitForFunction(() => !!S.db, null, { timeout: 15000 });
  ok('a folder path finds the jar inside it', true);
  await p.fill('#dbPath', path.join(home, 'nope.jar')); await p.click('#dbForm .btn.primary');
  await p.waitForFunction(() => document.querySelector('#dbErr')?.textContent.length > 0, null, { timeout: 15000 });
  ok('a wrong path shows an error', true);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
