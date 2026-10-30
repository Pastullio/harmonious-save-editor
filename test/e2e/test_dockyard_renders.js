const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Corvette renders made earlier show in the Dock Yard's Cover Flow, also after switching tabs and coming back
// (they used to fall back to the hologram until Render corvettes was pressed again). Usage: node test/e2e/test_dockyard_renders.js <scratch>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'dyrcfg'), root = path.join(SP, 'dyrroot'), home = path.join(SP, 'dyrhome');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true }); fs.mkdirSync(home, { recursive: true });
  const covers = path.join(cfg, 'HarmoniousSaveEditor', 'covers'); fs.mkdirSync(covers, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'settings.json'), JSON.stringify({ autoRender: false }));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48019'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForTimeout(2500);   // the Garage copies the save's ships when it opens
  // a "render" on disk for every corvette in the Garage (any PNG named by the build's hash will do)
  const keys = await p.evaluate(async () => {
    const out = [];
    for (const f of (await ShipLib.files()).filter((f) => f.src === 'garage')) { const pr = await ShipLib.load(f); if (pr.error || !pr.objects) continue; const pl = await buildPayload(libCoverItem(f, pr, shipSummary(pr, f.path))); if (pl) out.push(pl.key); }
    return out;
  }).catch((e) => { console.log('keys', e.message); return []; });
  const png = fs.readFileSync(path.join(__dirname, '../../src/assets/icon.png'));
  for (const k of keys) fs.writeFileSync(path.join(covers, k + '.png'), png);
  console.log('renders on disk', keys.length);
  await p.evaluate(() => { window.__lib = 0; document.addEventListener('cover-render', (e) => { if (/^lib\|/.test(e.detail.key)) window.__lib++; }); });
  await p.click('nav button[data-s="library"]'); await p.click('.dy-tabs [data-v="garage"]'); await p.waitForTimeout(2500);
  const first = await p.evaluate(() => window.__lib);
  ok('the Garage\'s corvettes show their renders', keys.length > 0 && first > 0);
  await p.click('.dy-tabs [data-v="library"]'); await p.waitForTimeout(1200);
  await p.click('.dy-tabs [data-v="garage"]'); await p.waitForTimeout(2500);
  ok('and still do after switching tabs and coming back', (await p.evaluate(() => window.__lib)) > first);
  await p.screenshot({ path: SP + '/shots/dockyard-renders.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
