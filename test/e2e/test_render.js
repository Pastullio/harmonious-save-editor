const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs');
// Needs: a real save in $SP/rroot/NMS/st_*/, Blender-as-a-module at $SP/bpyenv, Charon Forge linked under ~/.config/blender/<ver>/extensions/user_default.
const SP = process.env.SP || process.argv[2];
(async () => {
  const proc = spawn('/home/claude/harmonious-save-editor/dist/hse-linux', ['-no-window', '-root', SP + '/rroot/NMS', '-port', '47950'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/rcfg', HSE_BLENDER: SP + '/fake-blender' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="hangar"]'); await p.waitForSelector('#renderAll');
  const setup = await p.evaluate(() => renderSetup());
  console.log('setup:', setup.ready, setup.blender.split('/').pop(), setup.charon.replace(/.*\/blender\//, '…/'));
  const t0 = Date.now(); await p.click('#renderAll');
  await p.waitForFunction(() => document.querySelector('#renderAll').disabled, null, { timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector('#renderAll').disabled, null, { timeout: 900000, polling: 1000 });
  console.log('render all took', Math.round((Date.now() - t0) / 1000), 's; toast:', await p.textContent('#toast'));
  const covers = fs.readdirSync(SP + '/rcfg/HarmoniousSaveEditor/covers'); console.log('covers on disk:', covers);
  await p.click('.chip[data-f="corvette"]'); await p.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1200); await p.screenshot({ path: SP + '/shots/40-hangar-rendered.png' });
  await p.click('.chip[data-f="all"]'); await p.waitForTimeout(1500); await p.screenshot({ path: SP + '/shots/41-hangar-all-rendered.png' });
  // re-render of an unchanged build is served from the cache
  const t1 = Date.now(); const again = await p.evaluate(async () => { const it = coverItems().find((x) => x.kind === 'corvette'); await renderCorvette(it, false); return 'ok'; });
  console.log('cached re-render:', again, Date.now() - t1, 'ms');
  console.log('errors', errs); await b.close(); proc.kill();
})();
