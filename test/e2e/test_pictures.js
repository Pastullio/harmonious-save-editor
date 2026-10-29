const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs');
const SP = process.argv[2]; // scratch dir with dbroot/NMS (a real save) and shots/a2-overview.png as a sample picture
(async () => {
  const proc = spawn('/home/claude/harmonious-save-editor/dist/hse-linux', ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47966'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/dbcfg' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const img = SP + '/shots/a2-overview.png';
  for (const [sec, sel] of [['ships', '.cf-pic'], ['freighter', '.pic-card .link'], ['vehicles', '.pic-card .link']]) {
    await p.click(`nav button[data-s="${sec}"]`); await p.waitForTimeout(800);
    await p.click(sel); await p.waitForSelector('#dlg[open]');
    if (sec === 'ships') await p.screenshot({ path: SP + '/shots/b0-picture-dialog.png' });
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#dlgActs button:has-text("Image file")')]);
    await chooser.setFiles(img);
    await p.waitForSelector('.crop canvas'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(900);
    const has = sec === 'ships' ? await p.$eval('.cf-item.center', (e) => !!e.querySelector('img')) : await p.$eval('.pic-card .tc-art', (e) => !!e.querySelector('img'));
    ok(sec + ': picture added', has);
    await p.screenshot({ path: `${SP}/shots/b-${sec}.png` });
  }
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
})();
