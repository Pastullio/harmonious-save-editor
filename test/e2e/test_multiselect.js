const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
const SP = process.argv[2]; // scratch dir with dbroot/NMS (a real save) and dbcfg pointing at a jar
(async () => {
  const proc = spawn('/home/claude/harmonious-save-editor/dist/hse-linux', ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47964'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/dbcfg' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.waitForFunction(() => S.db, null, { timeout: 15000 });
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(() => localStorage.setItem('hse-invtab', 'all'));
  await p.click('nav button[data-s="exosuit"]'); await p.waitForTimeout(1000);
  const cargo = '[data-t="Cargo"] .grid .cell';
  await p.click(`${cargo}[data-x="0"][data-y="0"]`);
  await p.click(`${cargo}[data-x="3"][data-y="0"]`, { modifiers: ['Shift'] });
  ok('shift selects a range of 4', (await p.$$('.cell.sel')).length === 4);
  await p.click(`${cargo}[data-x="5"][data-y="2"]`, { modifiers: ['Control'] });
  await p.click(`${cargo}[data-x="1"][data-y="0"]`, { modifiers: ['Control'] });
  ok('ctrl adds and removes', (await p.$$('.cell.sel')).length === 4);
  console.log(await p.textContent('.insp-slot .title'), '|', await p.textContent('.insp-slot .sub'));
  await p.waitForTimeout(300); await p.screenshot({ path: SP + '/shots/95-multi.png' });
  // fill + remove
  const before = await p.evaluate(() => slotsOf(S.sel.inv).length);
  await p.click('.insp-slot [data-b="del"]'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => slotsOf(ps().get ? g(ps(), 'Inventory') : null).length);
  ok('removed 4 items', before - after === 4);
  ok('selection kept after removal', (await p.$$('.cell.sel')).length === 4);
  await p.keyboard.press('Escape');
  // ctrl+a then move to a ship? exosuit has only tech + cargo; move needs same kind, so test on freighter-less: check Ctrl+A count
  await p.click(`${cargo}[data-x="0"][data-y="1"]`); await p.keyboard.press('Control+a');
  ok('ctrl+a selects whole cargo', (await p.$$('.cell.sel')).length === 120);
  await p.keyboard.press('Escape');
  await p.click(`${cargo}[data-x="0"][data-y="1"]`); await p.click(`${cargo}[data-x="2"][data-y="1"]`, { modifiers: ['Shift'] });
  const opts = await p.$$eval('#bTo option', (o) => o.map((x) => x.textContent)); console.log('move targets', opts);
  const shipIdx = opts.findIndex((o) => /Cutting Remark cargo/.test(o));
  const shipBefore = await p.evaluate(() => slotsOf(g(ships().find(({ s }) => str(g(s, 'Name')) === 'The Cutting Remark').s, 'Inventory')).length);
  await p.selectOption('#bTo', String(shipIdx)); await p.click('[data-b="move"]'); await p.waitForTimeout(800);
  const shipAfter = await p.evaluate(() => slotsOf(g(ships().find(({ s }) => str(g(s, 'Name')) === 'The Cutting Remark').s, 'Inventory')).length);
  ok('moved 3 items into The Cutting Remark cargo', shipAfter - shipBefore === 3);
  console.log('toast', await p.textContent('#toast'));
  // the save still encodes and decodes
  const okEnc = await p.evaluate(() => { const b = C.writeSave(S.save); const r = C.readSave(b.data, b.meta, S.save.dataName || 'save.hg'); return !!r.json; }).catch((e) => 'err ' + e.message);
  console.log('re-encode', okEnc);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
})();
