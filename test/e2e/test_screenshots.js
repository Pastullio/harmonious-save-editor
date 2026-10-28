const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
// Needs a fake Steam tree at $SP/steam/userdata/<id32>/760/remote/275850/screenshots and a real save under $SP/rroot/NMS/st_*/.
const SP = process.env.SP || process.argv[2];
(async () => {
  const proc = spawn('/home/claude/harmonious-save-editor/dist/hse-linux', ['-no-window', '-root', SP + '/rroot/NMS', '-port', '47960'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/rcfg', HSE_BLENDER: SP + '/fake-blender', HSE_STEAM: SP + '/steam' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="hangar"]'); await p.waitForSelector('#hShot');
  await p.click('.chip[data-f="ship"]'); await p.waitForTimeout(800);
  console.log('centre:', await p.textContent('.cf-caption .t'));
  await p.click('#hShot'); await p.waitForSelector('.shots button');
  console.log('screenshots offered:', await p.$$eval('.shots button', (e) => e.length));
  await p.waitForTimeout(400); await p.screenshot({ path: SP + '/shots/60-picker.png' });
  await p.click('.shots button >> nth=0'); await p.waitForSelector('.crop canvas');
  const box = await p.$eval('.crop canvas', (c) => { const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.$eval('.crop input[type=range]', (r) => { r.value = 1.35; r.dispatchEvent(new Event('input')); });
  await p.mouse.move(box[0], box[1]); await p.mouse.down(); await p.mouse.move(box[0] + 30, box[1] + 10, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(200); await p.screenshot({ path: SP + '/shots/61-crop.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(1000);
  console.log('cover is a picture now:', await p.$eval('.cf-item.center', (e) => !!e.querySelector('img')), '| reset offered:', !!(await p.$('#hReset')));
  await p.waitForTimeout(300); await p.screenshot({ path: SP + '/shots/62-hangar-shot-cover.png' });
  // bad requests are refused
  const tok = await p.evaluate(() => APP.token);
  const bad = await fetch(url + `api/screenshot?d=0&name=..%2F..%2Fsecret.jpg&t=${tok}`);
  console.log('path traversal refused:', bad.status === 400);
  console.log('errors', errs); await b.close(); proc.kill();
})();
