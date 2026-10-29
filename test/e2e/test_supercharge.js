const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Supercharged slots (SpecialSlots TechBonus) on exosuit and starship technology, on a copy of a real save.
// Usage: node test/e2e/test_supercharge.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'chargetest'); fs.rmSync(T, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', path.join(T, 'root'), { recursive: true }); fs.mkdirSync(path.join(T, 'home', 'Documents'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', path.join(T, 'root'), '-port', '47984'], { env: { ...process.env, HOME: path.join(T, 'home'), XDG_CONFIG_HOME: path.join(T, 'cfg') } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const bonus = () => p.evaluate(() => chargedSet(g(ps(), 'Inventory_TechOnly')).size);
  const before = await bonus(); console.log('exosuit supercharged before:', before);
  await p.click('nav button[data-s="exosuit"]'); await p.waitForSelector('.inv');
  const heads = await p.$$eval('.inv', (bs) => bs.map((x) => x.querySelector('h3').textContent.trim() + ':' + !!x.querySelector('[data-act="charge"]')));
  console.log(heads);
  ok('Supercharge slots on Technology only', heads.some((h) => /^Technology.*:true$/.test(h)) && heads.filter((h) => /:true$/.test(h)).length === 1);
  ok('existing supercharged slots are shown', (await p.$$('.inv .cell.charged')).length === before && before > 0);
  await p.screenshot({ path: SP + '/shots/charge0-before.png' });
  await p.click('[data-act="charge"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(300);
  const all = await bonus(), cells = (await p.$$('.inv .cell.charged')).length;
  ok('every unlocked slot supercharged', all === 60 && cells === 60);
  ok('the save keeps the game\'s shape for new entries', await p.evaluate(() => { const arr = g(g(ps(), 'Inventory_TechOnly'), 'SpecialSlots'); const e = arr[arr.length - 1]; return [...e.keys()].map(nameOf).join() === 'Type,Index' && str(g(e, 'Type', 'InventorySpecialSlotType')) === 'TechBonus' && [...g(e, 'Index').keys()].map(nameOf).join() === 'X,Y'; }));
  await p.waitForTimeout(800); await p.screenshot({ path: SP + '/shots/charge1-all.png' });
  // remove all, then one slot from the side panel, then a selection of three
  await p.click('[data-act="charge"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await p.waitForTimeout(300);
  ok('remove all', (await bonus()) === 0 && (await p.$$('.inv .cell.charged')).length === 0);
  await p.click('.inv .cell[data-x="0"][data-y="0"]'); await p.waitForSelector('.charge-row input');
  await p.check('.charge-row input'); await p.waitForTimeout(200);
  ok('one slot from the side panel', (await bonus()) === 1 && !!(await p.$('.inv .cell.charged[data-x="0"][data-y="0"]')));
  await p.click('.inv .cell[data-x="3"][data-y="1"]'); await p.click('.inv .cell[data-x="5"][data-y="1"]', { modifiers: ['Shift'] });
  await p.waitForSelector('[data-b="charge"]'); await p.click('[data-b="charge"]'); await p.waitForTimeout(200);
  ok('a Shift-selection supercharged together', (await bonus()) === 4);
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(600);
  await (await p.$('.inv')).screenshot({ path: SP + '/shots/charge2-dark.png' });
  // starships
  await p.click('nav button[data-s="ships"]'); await p.waitForSelector('.inv');
  ok('starships have the button too', !!(await p.$('.inv [data-act="charge"]')) && (await p.$$('.inv .cell.charged')).length > 0);
  // save and reopen
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }).catch(() => {});
  if (await p.$('#dlg[open]')) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }); }
  await p.reload(); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  ok('supercharging survives saving and reopening', (await bonus()) === 4);
  // exocraft technology can be supercharged too
  await p.evaluate(() => { try { localStorage.setItem('hse-invtab', 'all'); } catch (_) {} go('vehicles'); }); await p.waitForSelector('.inv');
  const exo = await p.$$eval('.inv', (bs) => bs.map((x) => x.querySelector('h3').textContent.trim() + ':' + !!x.querySelector('[data-act="charge"]')));
  console.log(exo);
  ok('Supercharge slots on exocraft technology', exo.some((h) => /^Technology.*:true$/.test(h)) && !exo.some((h) => /^Cargo.*:true$/.test(h)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
