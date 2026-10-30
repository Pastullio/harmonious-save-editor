const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
// Self-update: an old build sees a newer version.json, offers it, downloads and checks it, swaps itself and restarts.
// Usage: node test/e2e/test_update.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const dir = path.join(SP, 'upd'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir + '/pub', { recursive: true });
  const build = (ver, out) => execFileSync('go', ['build', '-ldflags', `-X main.appVersion=${ver}`, '-o', out, '.'], { cwd: path.join(__dirname, '../../desktop') });
  build('2026.01.01.0000', dir + '/hse'); build('2026.12.31.2359', dir + '/pub/hse-new');
  const bin = fs.readFileSync(dir + '/pub/hse-new');
  const srv = http.createServer((q, r) => {
    if (q.url === '/version.json') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ version: '2026.12.31.2359', date: '2026-12-31', notes: 'Test release', size: bin.length, sha256: crypto.createHash('sha256').update(bin).digest('hex'), url: `http://127.0.0.1:${srv.address().port}/hse-new` })); return; }
    if (q.url === '/hse-new') {   // slowly, in 20 pieces over about 4 s, so the updating screen can be seen mid-download
      r.setHeader('content-length', bin.length); let k = 0; const step = Math.ceil(bin.length / 20);
      const t = setInterval(() => { r.write(bin.subarray(k, k + step)); k += step; if (k >= bin.length) { clearInterval(t); r.end(); } }, 200); return;
    }
    r.statusCode = 404; r.end();
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const env = { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: dir + '/cfg', HSE_UPDATE_URL: `http://127.0.0.1:${srv.address().port}/version.json` };
  const proc = spawn(dir + '/hse', ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '48003'], { env });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('#dlg[open]', { timeout: 15000 }).catch(() => {});
  ok('a newer version is offered', /new version is available/i.test(await p.textContent('#dlgTitle').catch(() => '')) && /Test release/.test(await p.textContent('#dlgBody')));
  ok('the offer shows the traveller art', await p.$eval('#dlgBody .upd-offer img', (i) => i.complete && i.naturalWidth > 0).catch(() => false));
  await p.setViewportSize({ width: 1440, height: 900 }); await p.screenshot({ path: SP + '/shots/update-offer.png' });
  const exited = new Promise((r) => proc.on('exit', r));
  await p.click('#dlgActs .btn.primary');
  await p.waitForSelector('#updScreen:not([hidden])', { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => /MB/.test(document.querySelector('#updPct').textContent) && parseFloat(document.querySelector('#updBar').style.width) > 20, null, { timeout: 15000 }).catch(() => {});
  const mid = await p.evaluate(() => ({ stage: $('#updStage').textContent, pct: $('#updPct').textContent, w: parseFloat($('#updBar').style.width) }));
  console.log(mid);
  ok('the updating screen shows real download progress', mid.stage === 'Downloading' && /of [\d.]+ MB/.test(mid.pct) && mid.w > 8 && mid.w < 90);
  await p.screenshot({ path: SP + '/shots/update-progress.png' });
  await p.waitForFunction(() => /Starting the new version/.test(document.querySelector('#updStage').textContent), null, { timeout: 30000 }).catch(() => {});
  ok('then it says the new version is starting', /Starting the new version/.test(await p.textContent('#updStage')));
  await p.screenshot({ path: SP + '/shots/update-restarting.png' });
  await exited;
  ok('the new version is put in place (the old one is cleared once the new one starts)', fs.readFileSync(dir + '/hse').equals(bin) && !fs.existsSync(dir + '/hse.new'));
  // the restarted app answers on the same port with the new version
  let ver = '';
  for (let k = 0; k < 40 && !ver; k++) { await new Promise((r) => setTimeout(r, 250)); try { const t = await (await fetch('http://127.0.0.1:48003/')).text(); ver = (t.match(/version: "([^"]+)"/) || [])[1] || ''; } catch (_) {} }
  ok('the new version is running', ver === '2026.12.31.2359');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  try { execFileSync('pkill', ['-f', dir + '/hse']); } catch (_) {}
  await b.close(); srv.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
