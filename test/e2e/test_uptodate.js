const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const http = require('http');
// Check for updates with nothing newer (owner 2026-11-13): a "You're up to date" pop-up shows over the About window,
// goes by itself after 3 s, and its × closes it at once.
// Usage: node test/e2e/test_uptodate.js <scratch dir with dbroot/NMS holding a save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const dir = path.join(SP, 'uptodate'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ver = '2026.11.13.2100';
  execFileSync('go', ['build', '-ldflags', `-X main.appVersion=${ver}`, '-o', dir + '/hse', '.'], { cwd: path.join(__dirname, '../../desktop') });
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ version: ver, date: '2026-11-13', size: 1, sha256: '00', url: 'http://127.0.0.1:1/x' })); }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const env = { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: dir + '/cfg', HSE_UPDATE_URL: `http://127.0.0.1:${srv.address().port}/version.json` };
  const proc = spawn(dir + '/hse', ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '48017'], { env });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage(); await p.setViewportSize({ width: 1300, height: 860 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(2500);
  await p.evaluate(() => { const d = document.querySelector('#dlg'); if (d.open) d.close(); aboutDialog(); });
  await p.waitForSelector('#aboutUpd');
  await p.click('#aboutUpd');
  await p.waitForSelector('.upd-ok.show', { timeout: 5000 }).catch(() => {});
  const pop = await p.evaluate(() => { const e = document.querySelector('.upd-ok'); if (!e) return null; const r = e.getBoundingClientRect(), x = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: e.textContent, inDialog: !!e.closest('dialog[open]'), onTop: !!(x && x.closest('.upd-ok')) }; });
  ok('Check for updates with nothing newer says so (' + (pop && pop.text.replace(/\s+/g, ' ').trim()) + ')', pop && /up to date/.test(pop.text) && pop.text.includes(ver));
  ok('…in a pop-up shown over the About window', pop && pop.inDialog && pop.onTop);
  await p.screenshot({ path: path.join(SP, 'uptodate.png') });
  await p.waitForTimeout(3600);
  ok('…that goes by itself after about 3 s', !(await p.$('.upd-ok')));
  ok('…and About stays open', await p.$eval('#dlg', (d) => d.open));
  await p.click('#aboutUpd'); await p.waitForSelector('.upd-ok.show', { timeout: 5000 }).catch(() => {});
  await p.click('.upd-ok-x'); await p.waitForTimeout(400);
  ok('its × closes it at once', !(await p.$('.upd-ok')));
  ok('the button is back to Check for updates', (await p.textContent('#aboutUpd')) === 'Check for updates');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill(); srv.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
