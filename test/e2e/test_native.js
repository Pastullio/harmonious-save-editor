// The editor's own window (WebView2, desktop/webview_windows.go) talks to the page through chrome.webview. This runs
// the page with a stand-in for that bridge and checks the messages the window relies on: "ready", the theme for the
// title bar, and pressing X (hseCloseRequest): straight out when nothing is unsaved, else the editor's own question.
// The window itself only runs on Windows; try it there by hand.
// Usage: node test/e2e/test_native.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'nativetest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48107'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // what WebView2 adds: window.HSE_NATIVE (AddScriptToExecuteOnDocumentCreated) and chrome.webview.postMessage
  await p.addInitScript(() => { window.HSE_NATIVE = true; window.__msgs = []; window.chrome = window.chrome || {}; window.chrome.webview = { postMessage: (m) => window.__msgs.push(m) }; });
  const msgs = () => p.evaluate(() => window.__msgs.slice());
  const clear = () => p.evaluate(() => { window.__msgs.length = 0; });
  await p.goto(url); await p.waitForSelector('.slot-row');
  let m = await msgs();
  ok('the page says it is ready for close requests', m.includes('ready'));
  ok('and tells the window its theme', m.some((x) => /^theme:(dark|light)$/.test(x)));
  await clear(); await p.click('.land-corner .theme-btn');
  m = await msgs();
  ok('switching light/dark tells the window', m.some((x) => /^theme:/.test(x)));
  // X with nothing open or unsaved: out at once
  await clear(); await p.evaluate(() => hseCloseRequest());
  m = await msgs();
  ok('X with nothing unsaved exits straight away', m[0] === 'close-ack' && m.includes('exit'));
  // X with unsaved changes: the editor's question, nothing sent until a choice
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(() => { set(common() || ps(), 'SaveName', 'Native test'); markDirty(); });
  await clear(); await p.evaluate(() => hseCloseRequest());
  await p.waitForSelector('#dlg[open]');
  const t = await p.textContent('#dlg[open]');
  m = await msgs();
  ok('X with unsaved changes asks Save & exit', /Save & exit/.test(t) && /Exit without saving/.test(t) && m.join() === 'close-ack');
  await p.click('#dlgActs .btn.ghost');
  ok('Keep editing keeps it open', !(await msgs()).includes('exit') && await p.evaluate(() => S.dirty));
  await clear(); await p.evaluate(() => hseCloseRequest()); await p.waitForSelector('#dlg[open]');
  await p.click('#dlgActs .btn.danger'); await new Promise((r) => setTimeout(r, 300));
  ok('Exit without saving tells the window to close', (await msgs()).includes('exit'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
