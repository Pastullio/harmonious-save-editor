// What's new after an update, and the version in About (owner, 2026-11-05). Builds the app with a release version.
// Usage: node test/e2e/test_whatsnew.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'whatsnewtest'); fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(path.join(T, 'home', 'Documents'), { recursive: true });
  const log = JSON.parse(fs.readFileSync(path.join(__dirname, '../../desktop/changelog.json'), 'utf8'));
  const V = log[0].version, older = log[3].version;
  const exe = path.join(T, 'hse');
  execFileSync('go', ['build', '-o', exe, '-ldflags', '-X main.appVersion=' + V, '.'], { cwd: path.join(__dirname, '../../desktop') });
  const proc = spawn(exe, ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '48112'], { env: { ...process.env, HOME: path.join(T, 'home'), XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_UPDATE_URL: 'http://127.0.0.1:9/none' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // a first start: nothing
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.waitForTimeout(800);
  ok('a first start shows no list of changes', !(await p.$('#dlg[open]')));
  ok('and remembers this version', (await p.evaluate(() => localStorage.getItem('hse-seen-version'))) === V);
  // after an update from an older version: every version since
  await p.evaluate((o) => localStorage.setItem('hse-seen-version', o), older);
  await p.reload(); await p.waitForSelector('#dlg[open] .whatsnew', { timeout: 5000 });
  const n = (await p.$$('#dlg .whatsnew li')).length;
  ok('after an update it lists every version since the last one, by day', n === log.slice(0, 3).reduce((a, e) => a + e.notes.length, 0) && (await p.$$('#dlg .whatsnew section')).length === new Set(log.slice(0, 3).map((e) => e.date)).size);
  ok('titled with the new version', (await p.textContent('#dlgTitle')).includes(V));
  await p.click('#dlgX'); await p.reload(); await p.waitForSelector('.slot-row'); await p.waitForTimeout(800);
  ok('only once', !(await p.$('#dlg[open]')));
  // someone coming from a version without this: the newest notes
  await p.evaluate(() => { localStorage.removeItem('hse-seen-version'); localStorage.setItem('hse-theme', 'light'); });
  await p.reload(); await p.waitForSelector('#dlg[open] .whatsnew', { timeout: 5000 });
  ok('an update from before this shows the newest notes', (await p.$$('#dlg .whatsnew section')).length === 1);
  await p.click('#dlgX');
  // About: the version and What's new
  await p.click('.land-corner .about-btn'); await p.waitForSelector('#dlg[open] .about-version');
  const t = await p.textContent('.about-version');
  ok('About says which version this is', t.includes('Harmonious Save Editor version: ' + V));
  await p.click('#aboutNew'); await p.waitForSelector('#dlg[open] .whatsnew');
  ok("What's new in About lists the recent changes", (await p.$$('#dlg .whatsnew li')).length >= 5);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
