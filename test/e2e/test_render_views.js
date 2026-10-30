const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Automatic corvette renders and extra camera angles, with real Blender renders through Charon Forge.
// Needs what test_render.js needs: bpy 4.5 at <scratch>/bpyenv, Charon Forge linked under ~/.config/blender/4.5/extensions/user_default,
// a real save in <scratch>/dbroot/NMS. Usage: node test/e2e/test_render_views.js <scratch>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'rvcfg'), root = path.join(SP, 'rvroot');
  fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // small, fast renders for the test
  fs.mkdirSync(path.join(cfg, 'HarmoniousSaveEditor'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'settings.json'), JSON.stringify({ size: 256, samples: 4 }));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48015'], { env: { ...process.env, SP, XDG_CONFIG_HOME: cfg, HSE_BLENDER: path.join(__dirname, 'fake-blender.sh') } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  const setup = await p.evaluate(() => renderSetup());
  ok('Blender and Charon Forge are found, and automatic renders are on by default', setup.ready && setup.autoRender === true);
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const n = await p.evaluate(() => coverItems().filter((x) => x.kind === 'corvette').length);
  // with nothing pressed, every corvette gets a cover in the background
  const coversDir = path.join(cfg, 'HarmoniousSaveEditor', 'covers');
  const pngs = () => (fs.existsSync(coversDir) ? fs.readdirSync(coversDir).filter((f) => /^[0-9a-f]+\.png$/.test(f)) : []);
  const t0 = Date.now();
  for (let k = 0; k < 600 && pngs().length < n; k++) await p.waitForTimeout(1000);
  console.log(`auto renders: ${pngs().length} of ${n} in ${Math.round((Date.now() - t0) / 1000)} s`);
  ok('corvettes without a cover are rendered on their own after the save opens', pngs().length === n);
  await p.waitForFunction(() => /rendered in the background/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).catch(() => {});
  ok('and it says so when done', /corvette covers? rendered in the background/.test(await p.textContent('#toast')));
  // Hangar: the extra angles
  await p.click('nav button[data-s="hangar"]'); await p.waitForTimeout(800);
  await p.click('.chip[data-f="corvette"]'); await p.waitForTimeout(800);
  await p.waitForSelector('#hViews', { timeout: 20000 });
  ok('a rendered corvette shows its views, the extra ones not rendered yet', await p.$eval('#hViews', (v) => !v.querySelector('[data-v="hero"]').disabled && v.querySelector('[data-v="top"]').disabled && !v.querySelector('#hMoreViews').hidden));
  await p.click('#hMoreViews');
  await p.waitForFunction(() => { const v = document.querySelector('#hViews'); return v && !v.querySelector('[data-v="top"]').disabled; }, null, { timeout: 600000, polling: 1000 });
  const views = fs.readdirSync(coversDir).filter((f) => /-(front|side|back|top)\.png$/.test(f));
  ok('one Blender run renders the four other angles', views.length === 4);
  const name = await p.evaluate(() => document.querySelector('.cf-item.center, .cf-item[aria-selected="true"]')?.textContent || '');
  await p.click('#hViews [data-v="top"]'); await p.waitForTimeout(800);
  ok('picking a view changes the cover and is remembered', await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('hse-render-view') || '{}'); return Object.values(m).includes('top') && document.querySelector('#hViews [data-v="top"]').classList.contains('on'); }));
  await p.screenshot({ path: SP + '/shots/render-views-top.png' });
  await p.click('#hViews [data-v="side"]'); await p.waitForTimeout(800); await p.screenshot({ path: SP + '/shots/render-views-side.png' });
  await p.click('#hViews [data-v="front"]'); await p.waitForTimeout(800); await p.screenshot({ path: SP + '/shots/render-views-front.png' });
  // after a reload the chosen view is the cover
  await p.click('#hViews [data-v="top"]'); await p.waitForTimeout(500);
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="hangar"]'); await p.waitForTimeout(800); await p.click('.chip[data-f="corvette"]'); await p.waitForTimeout(2500);
  ok('after reopening, the chosen view is still the cover', await p.evaluate(() => !!document.querySelector('#hViews [data-v="top"].on')));
  // turning it off
  await p.evaluate(() => api('/api/render-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: 256, samples: 4, autoRender: false }) }));
  ok('automatic renders can be turned off', (await p.evaluate(() => renderSetup())).autoRender === false);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
