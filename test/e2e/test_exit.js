// Leaving with unsaved changes (owner, 2026-11-03): the Exit button and Cancel on the browser's "Leave app?" box both
// bring up the editor's own question with Save & exit, which writes the save and closes the window.
// Usage: node test/e2e/test_exit.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'exittest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48106'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); let p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  await open();
  const saveFile = () => { const f = []; (function walk(d) { for (const n of fs.readdirSync(d)) { const q = path.join(d, n); if (fs.statSync(q).isDirectory()) walk(q); else if (/^save\d*\.hg$/.test(n)) f.push(q); } })(root); return f[0]; };
  const before = fs.statSync(saveFile()).mtimeMs;
  await p.evaluate(() => { set(common() || ps(), 'SaveName', 'Exit test'); markDirty(); });
  // Cancel on the browser's own box: the page stays, and the editor's question follows (headless Chromium doesn't show
  // that box, so the event is sent here as the browser would before asking)
  await p.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  await p.waitForSelector('#dlg[open]', { timeout: 5000 }).catch(() => {});
  const t1 = await p.textContent('#dlg[open]').catch(() => '');
  ok('Cancel on "Leave app?" brings up Save & exit', /Unsaved changes/.test(t1) && /Save & exit/.test(t1) && /Exit without saving/.test(t1));
  await p.click('#dlgActs .btn.ghost');   // keep editing
  ok('Keep editing keeps the window and the changes', !p.isClosed() && await p.evaluate(() => S.dirty));
  // the Exit button, then Save & exit
  ok('there is an Exit button', !!(await p.$('#exitBtn:not(.hidden)')));
  await p.click('#exitBtn'); await p.waitForSelector('#dlg[open]');
  await p.click('#dlgActs .btn.primary');
  await new Promise((r) => setTimeout(r, 2500));
  ok('Save & exit writes the save', fs.statSync(saveFile()).mtimeMs > before);
  console.log('window closed:', p.isClosed());
  ok('and closes the window (or says it can be closed)', p.isClosed() || /close the window/.test(await p.textContent('#toast')));
  // the save has the change
  p = await b.newPage(); await open();
  ok('the change is in the save', await p.evaluate(() => str(g(common() || ps(), 'SaveName')) === 'Exit test'));
  // Exit without saving leaves the file alone
  const mid = fs.statSync(saveFile()).mtimeMs;
  await p.evaluate(() => { set(common() || ps(), 'SaveName', 'Not saved'); markDirty(); });
  await p.click('#exitBtn'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await new Promise((r) => setTimeout(r, 1200));
  ok('Exit without saving writes nothing', fs.statSync(saveFile()).mtimeMs === mid);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
