// Exports land in Documents\Harmonious Save Editor\Exports (the app window shows no browser downloads), and a ship can be
// moved into the Dock Yard's Ship storage, freeing its slot. Usage: node test/e2e/test_export.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'exporttest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48103'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const exp = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports'), lib = path.join(home, 'Documents', 'Harmonious Save Editor', 'Dock Yard', 'Ship storage');
  await p.evaluate(() => go('ships')); await p.waitForTimeout(800);
  const pick = await p.evaluate(() => { const prim = num(g(ps(), 'PrimaryShip')); const s = ships().find((x) => x.i !== prim && !isCorvetteEntry(x.s)); S.pick.ship = s.i; render(); return { i: s.i, name: str(g(s.s, 'Name')) }; });
  await p.waitForTimeout(600);
  await p.click('[data-k="exportMenu"] summary'); await p.click('[data-k="export"]');
  await p.waitForFunction(() => /Exports/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 }).catch(() => {});
  const files = fs.existsSync(exp) ? fs.readdirSync(exp) : []; console.log(files);
  ok('an export is saved in the Exports folder and says where', files.some((f) => f.endsWith('.ship.json')) && /Exports/.test(await p.textContent('#toast')));
  const one = JSON.parse(fs.readFileSync(path.join(exp, files.find((f) => f.endsWith('.ship.json')))));
  ok('and it holds the ship', one.Ship && one.Ship.Name === pick.name);
  await p.click('[data-k="exportMenu"] summary'); await p.click('[data-k="so"]'); await p.waitForTimeout(800);
  await p.click('[data-k="exportMenu"] summary').catch(() => {}); await p.click('[data-k="export"]').catch(() => {}); await p.waitForTimeout(800);
  const files2 = fs.readdirSync(exp); console.log(files2);
  ok('a second export of the same ship gets its own name', files2.filter((f) => f.endsWith('.ship.json')).length === 2 && files2.some((f) => f.endsWith('.so')));
  // move to the Dock Yard
  await p.click('[data-k="tolib"]'); await p.waitForSelector('#dlg[open]');
  ok('the Dock Yard button offers keep a copy or move', /Keep a copy/.test(await p.textContent('#dlgActs')) && /Move it/.test(await p.textContent('#dlgActs')));
  for (const bt of await p.$$('#dlgActs button')) if ((await bt.textContent()).trim() === 'Move it') { await bt.click(); break; }
  await p.waitForTimeout(800);
  const after = await p.evaluate((i) => ({ file: str(g(g(ps(), 'ShipOwnership')[i], 'Resource', 'Filename')), dirty: S.dirty }), pick.i);
  const stored = fs.existsSync(lib) ? fs.readdirSync(lib) : []; console.log(stored, JSON.stringify(after));
  ok('moving puts it in Ship storage and frees the slot', stored.some((f) => f.startsWith(pick.name.replace(/[^\w ]/g, '').slice(0, 8))) && !after.file && after.dirty);
  // the current ship can only be copied
  await p.evaluate(() => { S.pick.ship = num(g(ps(), 'PrimaryShip')); render(); }); await p.waitForTimeout(500);
  await p.click('[data-k="tolib"]'); await p.waitForSelector('#dlg[open]');
  ok('the current ship can only be copied, not moved', !/Move it/.test(await p.textContent('#dlgActs')) && /current ship/.test(await p.textContent('#dlgBody')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
