const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs');
const SP = process.argv[2]; // scratch dir with dbroot/NMS (a real save) and shots/a2-overview.png as a sample picture
(async () => {
  for (const d of ['/piccfg', '/pichome']) fs.rmSync(SP + d, { recursive: true, force: true });
  fs.mkdirSync(SP + '/pichome/Documents', { recursive: true });   // a fresh start, so no picture from an earlier run is there
  const proc = spawn(require('path').join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47966'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/piccfg', HOME: SP + '/pichome' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const img = SP + '/shots/a2-overview.png';
  for (const [sec, sel] of [['ships', '.cf-pic'], ['freighter', '.pic-card .tc-gear'], ['vehicles', '.cf-pic']]) {
    await p.click(`nav button[data-s="${sec}"]`); await p.waitForTimeout(800);
    await p.click(sel);
    let chooser;
    const flow = sec !== 'freighter';   // Starships and Exocraft (owner 2026-11-13) use Cover Flow
    if (flow) {
      await p.waitForSelector('#dlg[open]'); if (sec === 'ships') await p.screenshot({ path: SP + '/shots/b0-picture-dialog.png' });
      [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#dlgActs button:has-text("Image file")')]);
    } else {   // the picture card's gear (owner 2026-11-12) opens its options
      await p.waitForSelector('.pic-card .tc-gearpop:not([hidden])');
      ok(sec + ': the gear opens the picture options, without the reset while there is no picture', /Import image/.test(await p.textContent('.pic-card .tc-gearpop')) && !/generated cover/.test(await p.textContent('.pic-card .tc-gearpop')));
      [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.pic-card .tc-gearpop label:has-text("Import image")')]);
    }
    await chooser.setFiles(img);
    await p.waitForSelector('#dlg[open] .crop canvas', { timeout: 60000 }); await p.click('#dlgActs .btn.primary');
    await p.waitForFunction((sec) => sec !== 'freighter' ? !!document.querySelector('.cf-item.center img') : !!document.querySelector('.pic-card .tc-art img'), sec, { timeout: 15000 }).catch(() => {});
    const has = flow ? await p.$eval('.cf-item.center', (e) => !!e.querySelector('img')) : await p.$eval('.pic-card .tc-art', (e) => !!e.querySelector('img'));
    ok(sec + ': picture added', has);
    if (!flow) {
      await p.click('.pic-card .tc-gear');
      ok(sec + ': …and then the gear offers the generated cover again', /Use the generated cover/.test(await p.textContent('.pic-card .tc-gearpop')));
      await p.keyboard.press('Escape');
    }
    await p.screenshot({ path: `${SP}/shots/b-${sec}.png` });
  }
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
})();
