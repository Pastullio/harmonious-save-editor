const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// The corvette hologram as solid blocks at each part's real size (/api/model/boxes), coloured by part type.
// Usage: node test/e2e/test_corvette_holo.js <scratch> <PCBANKS with the corvette module files and building tables>
const SP = process.argv[2], BANKS = process.argv[3];
const cfg = path.join(SP, 'choloccfg'), home = path.join(SP, 'modelhome');
fs.rmSync(cfg, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47979'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_GAME: BANKS, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForFunction(() => S.lib && S.lib.game, null, { timeout: 60000 });
  const boxes = await p.evaluate(async () => (await api('/api/model/boxes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['^B_HAB1_C', 'B_COK_D', 'NOT_A_PART'] }) })).json());
  console.log(boxes);
  const hab = boxes.B_HAB1_C;
  ok('a module\'s size comes from the game files (a habitat is a 6 x 3 x 6 m cell)', hab && Math.abs(hab[3] - hab[0] - 6) < .1 && Math.abs(hab[4] - hab[1] - 3) < .1 && Math.abs(hab[5] - hab[2] - 6) < .1);
  ok('the cockpit has a size too, and unknown parts are left out', !!boxes.B_COK_D && !('NOT_A_PART' in boxes));
  const g = await p.evaluate(() => { const it = coverItems().find((x) => x.kind === 'corvette'); return { groups: [...new Set(it.holo.groups)], n: it.holo.n, ids: it.holo.ids.length }; });
  ok('every part of a corvette has a type for its colour', g.ids === g.n && g.groups.includes('cockpit') && g.groups.length >= 3);
  // Hangar: the corvette's cover is drawn as blocks, with a key to the colours
  await p.click('nav button[data-s="hangar"]'); await p.waitForTimeout(800);
  await p.evaluate(() => { const i = [...document.querySelectorAll('.cf-item')].findIndex((e) => /Formula|Corvette/.test(e.textContent)); });
  const hasLegend = await p.evaluate(async () => { for (let k = 0; k < 12; k++) { if (document.querySelector('.holo-legend')) return true; document.querySelector('.cf-next, [aria-label="Next"]')?.click(); await new Promise((r) => setTimeout(r, 300)); } return false; });
  ok('the Hangar shows what the hologram colours mean', hasLegend && /Cockpit/.test(await p.textContent('.holo-legend')));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + '/shots/corvette-holo.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
