const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Shipwright's tune-up order (the gear beside Tune up): move groups, save, tune up in that order, back to standard.
// Usage: node test/e2e/test_tuneorder.js <scratch dir with dbroot/NMS (real save) and fakebanks (item library paks)>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'tunetest'); fs.rmSync(T, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', path.join(T, 'root'), { recursive: true }); fs.mkdirSync(path.join(T, 'home', 'Documents'), { recursive: true });
  fs.mkdirSync(SP + '/shots', { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', path.join(T, 'root'), '-port', '47991'], { env: { ...process.env, HOME: path.join(T, 'home'), XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_GAME: SP + '/fakebanks', HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  await p.waitForFunction(() => S.db && S.db.items && S.db.items.size > 100, null, { timeout: 120000 }).catch(() => {});
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="shipwright"]'); await p.waitForSelector('.sw-corv');
  const i = await p.evaluate(() => ships().find(({ s }) => /BIGGS/.test(str(g(s, 'Resource', 'Filename')))).i);
  await p.click(`.sw-corv[data-i="${i}"]`); await p.waitForSelector('#swTuneSet');
  ok('a gear sits beside Tune up', !!(await p.$('.sw-tune-wrap #swTuneSet')) && !(await p.$('.sw-tune-dot:not([hidden])')));
  await p.click('#swTuneSet'); await p.waitForSelector('#dlg[open] #toList');
  const names = () => p.$$eval('#toList li', (l) => l.map((x) => x.dataset.g));
  const std = await p.evaluate(() => PART_GROUPS.map(([k]) => k));
  ok('the dialog lists every group in the standard order', (await names()).join() === std.join());
  ok('…with how many of each are in this build', /in this build/.test(await p.textContent('#toList')));
  ok('the first group can\'t move up, the last can\'t move down', await p.$eval('#toList [data-up="0"]', (x) => x.disabled) && await p.$eval(`#toList [data-down="${std.length - 1}"]`, (x) => x.disabled));
  await p.click('#toList [data-down="0"]');   // rockhopper below reactor
  await p.click('#toList [data-up="8"]');     // everything else above cockpits
  const want = [...std]; [want[0], want[1]] = [want[1], want[0]]; [want[7], want[8]] = [want[8], want[7]];
  ok('the arrows move groups', (await names()).join() === want.join());
  // drag and drop: weapons to the top
  const dt = await p.evaluateHandle(() => new DataTransfer());
  await p.dispatchEvent('#toList li[data-g="weapon"]', 'dragstart', { dataTransfer: dt });
  await p.dispatchEvent(`#toList li[data-g="${want[0]}"]`, 'dragover', { dataTransfer: dt });
  await p.dispatchEvent(`#toList li[data-g="${want[0]}"]`, 'drop', { dataTransfer: dt });
  await p.dispatchEvent('#toList li[data-g="weapon"]', 'dragend', { dataTransfer: dt });
  const want2 = ['weapon', ...want.filter((k) => k !== 'weapon')];
  ok('dragging a group moves it', (await names()).join() === want2.join());
  await p.screenshot({ path: SP + '/shots/tune-order.png' });
  // Cancel keeps the standard order
  await p.click('#dlgActs .btn:not(.primary):not(.ghost)').catch(() => p.click('#dlgX'));
  ok('Cancel saves nothing', await p.evaluate(() => localStorage.getItem('hse-tune-order') === null && isDefaultTune()));
  // again, and save
  await p.click('#swTuneSet'); await p.waitForSelector('#dlg[open] #toList');
  await p.click('#toList [data-down="0"]');
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(200);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('hse-tune-order') || 'null'));
  ok('Save keeps the order', saved && saved[0] === std[1] && saved[1] === std[0]);
  await p.waitForSelector('#swTuneSet');
  ok('the gear shows the order is your own', !!(await p.$('.sw-tune-dot:not([hidden])')));
  // tune up follows it
  await p.click('.sw-bar [data-a="tune"]'); await p.waitForTimeout(300);
  const groups = await p.evaluate((i) => g(shipBuild(i), 'Objects').map((o) => partGroup(g(o, 'ObjectID'))), i);
  const firstOf = (k) => groups.indexOf(k), lastOf = (k) => groups.lastIndexOf(k);
  const ordered = saved.filter((k) => groups.includes(k));
  ok('Tune up uses the saved order', ordered.every((k, n) => n === 0 || lastOf(ordered[n - 1]) < firstOf(k)) && await p.evaluate((i) => isTuned(g(shipBuild(i), 'Objects')), i));
  ok('…and the build check agrees', /in the order the game reads them/.test(await p.textContent('.sw-health')));
  // junk in storage doesn't break it
  await p.evaluate(() => localStorage.setItem('hse-tune-order', JSON.stringify(['bay', 'nonsense', 'bay'])));
  const fixed = await p.evaluate(() => tuneOrder());
  ok('unknown or repeated groups are dropped and missing ones added', fixed[0] === 'bay' && fixed.length === std.length && new Set(fixed).size === std.length && !fixed.includes('nonsense'));
  await p.evaluate(() => localStorage.setItem('hse-tune-order', '{oops'));
  ok('an unreadable order falls back to the standard one', await p.evaluate(() => isDefaultTune()));
  // back to standard
  await p.evaluate((o) => localStorage.setItem('hse-tune-order', JSON.stringify(o)), saved);
  await p.click('#swTuneSet'); await p.waitForSelector('#dlg[open] #toList');
  await p.click('#dlgActs [data-v="std"], #dlgActs .btn.ghost');
  await p.waitForTimeout(200);
  ok('Standard order puts it back', await p.evaluate(() => localStorage.getItem('hse-tune-order') === null && isDefaultTune()));
  ok('…and the gear\'s dot goes', !(await p.$('.sw-tune-dot:not([hidden])')));
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await p.click('#swTuneSet'); await p.waitForSelector('#dlg[open] #toList');
  await p.screenshot({ path: SP + '/shots/tune-order-dark.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
