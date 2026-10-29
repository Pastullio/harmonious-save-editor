const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// New saves written by the game while the app is open: the open save gets a note offering the newer one, and the save
// list refreshes on its own. Usage: node test/e2e/test_disk.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'dkcfg'), root = path.join(SP, 'dkroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const acct = path.join(root, fs.readdirSync(root).find((d) => /^st_/.test(d)));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47995'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForTimeout(3500);   // first check takes the baseline
  ok('no note while nothing changed', await p.$eval('#diskNote', (e) => e.hidden));
  // the game saves the same slot again
  const later = new Date(Date.now() + 60000);
  for (const f of ['save.hg', 'mf_save.hg']) fs.utimesSync(path.join(acct, f), later, later);
  await p.waitForSelector('#diskNote:not([hidden])', { timeout: 8000 }).catch(() => {});
  const txt = await p.$eval('#diskNote', (e) => (e.hidden ? '' : e.textContent));
  ok('a newer save on disk is noticed', /saved again/i.test(txt) && /out of date/.test(txt));
  await p.screenshot({ path: SP + '/shots/disk-note.png' });
  await p.evaluate(() => { S.marker = S.save; markDirty(); });
  await p.click('#diskNote [data-k="open"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger');
  await p.waitForFunction(() => S.save && S.save !== S.marker && !S.dirty, null, { timeout: 30000 });
  ok('opening it loads the new save, after asking about unsaved edits', await p.evaluate(() => S.src.dataName === 'save.hg' && !S.dirty));
  await p.waitForTimeout(3500);
  ok('and the note stays away for that save', await p.$eval('#diskNote', (e) => e.hidden));
  // our own write isn't reported as the game saving
  await p.evaluate(() => markDirty()); await p.click('#saveBtn'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary');
  await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }); await p.waitForTimeout(7000);
  ok('saving from the app does not raise the note', await p.$eval('#diskNote', (e) => e.hidden));
  // back on the save list, a new save shows up without reopening the app
  await p.click('#closeBtn'); await p.waitForSelector('.slot-row');
  await p.waitForTimeout(1500);
  const before = await p.$eval('#slotList', (e) => e.textContent);
  await p.evaluate(() => { document.querySelector('#slotList').dataset.mark = '1'; });
  fs.copyFileSync(path.join(acct, 'save.hg'), path.join(acct, 'save2.hg')); fs.copyFileSync(path.join(acct, 'mf_save.hg'), path.join(acct, 'mf_save2.hg'));
  await p.waitForFunction((t) => document.querySelector('#slotList').textContent !== t, before, { timeout: 12000 }).catch(() => {});
  ok('the save list refreshes when a new save appears', /save2\.hg|manual save/i.test(await p.$eval('#slotList', (e) => e.textContent)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
