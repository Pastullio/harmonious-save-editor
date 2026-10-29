const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Ship slot manager on the Starships page: swap by drag and by click, close gaps, and every repair, on a copy of a
// real save that is saved and opened again. Usage: node test/e2e/test_slots.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'slcfg'), root = path.join(SP, 'slroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47987'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  await open();
  const state = () => p.evaluate(() => {
    const P = ps(), list = g(P, 'ShipOwnership');
    return { names: list.map((s) => str(g(s, 'Name'))), primary: num(g(P, 'PrimaryShip')), legacy: g(P, 'ShipUsesLegacyColours').slice(),
      ccd: list.map((s, i) => C.stringifyJSON(g(P, 'CharacterCustomisationData')[shipCcdIndex(i)])), builds: Object.fromEntries(shipBuilds().map((b) => [str(g(b, 'Name')), num(g(b, 'UserData'))])), issues: shipSlotIssues().map((x) => x[0]) };
  });
  const s0 = await state(); console.log(JSON.stringify({ names: s0.names, primary: s0.primary, builds: s0.builds, issues: s0.issues }));
  await p.evaluate(() => go('ships')); await p.waitForSelector('#shipSlots');
  ok('slots panel on the Starships page', (await p.$$eval('.slot-tile', (x) => x.length)) === 12 && /6 of 12 used/.test(await p.textContent('#shipSlots summary')));
  ok('no problems in a healthy save', s0.issues.length === 0 && !!(await p.$('.slots-ok')));
  await p.click('#shipSlots summary'); await p.waitForTimeout(200);
  await p.screenshot({ path: SP + '/shots/sl-0.png', fullPage: false });
  // click to swap: slot 1 (Golden Vector) with slot 6 (The Cutting Remark, current)
  await p.click('.slot-tile[data-slot="0"]'); await p.click('.slot-tile[data-slot="5"]'); await p.waitForSelector('#shipSlots[open]');
  const s1 = await state();
  ok('ships swapped', s1.names[0] === s0.names[5] && s1.names[5] === s0.names[0]);
  ok('current ship follows', s1.primary === 0);
  ok('corvette build follows', s1.builds['The Cutting Remark'] === 0);
  ok('colours and customisation follow', s1.legacy[5] === s0.legacy[0] && s1.legacy[0] === s0.legacy[5] && s1.ccd[0] === s0.ccd[5] && s1.ccd[5] === s0.ccd[0]);
  // drag to make a gap, then close it
  await p.dragAndDrop('.slot-tile[data-slot="2"]', '.slot-tile[data-slot="8"]'); await p.waitForTimeout(300);
  const s2 = await state();
  ok('drag onto an empty slot moves it', s2.names[8] === s1.names[2] && !s2.names[2] && s2.builds[s1.names[8] || 'x'] === undefined);
  await p.click('#slotsPack'); await p.waitForTimeout(300);
  const s3 = await state();
  ok('close the gaps', s3.names.slice(0, 6).every(Boolean) && s3.names.slice(6).every((n) => !n) && s3.builds['The Cutting Remark'] === s3.names.indexOf('The Cutting Remark'));
  // break things and repair them
  await p.evaluate(() => { const b = shipBuilds().find((x) => str(g(x, 'Name')) === 'Max'); set(b, 'UserData', N(9)); go('ships'); });
  await p.waitForSelector('.slot-issues');
  let issues = (await state()).issues; console.log(issues);
  ok('a build pointing at an empty slot is found, and the corvette left without one', issues.some((t) => /"Max".*slot 10, which is empty/.test(t)) && issues.some((t) => /Max in slot \d+ has no build/.test(t)));
  await p.screenshot({ path: SP + '/shots/sl-1-problems.png', fullPage: false });
  const attach = await p.$$eval('[data-fix]', (x) => x.map((b) => b.textContent));
  console.log(attach);
  await p.click('[data-fix="0:1"]');   // attach it back to the corvette that lost it
  ok('attach the build back', (await state()).issues.length === 0 && (await state()).builds.Max === (await state()).names.indexOf('Max'));
  await p.evaluate(() => { const b = shipBuilds().find((x) => str(g(x, 'Name')) === 'Max'); set(b, 'UserData', N(9)); go('ships'); });
  await p.waitForSelector('.slot-issues'); await p.click('[data-fix="0:0"]');   // put a corvette in slot 10 for it
  const s4 = await state();
  ok('give an orphan build its own corvette', s4.names[9] === 'Max' && s4.builds.Max === 9);
  ok('which leaves the old Max without a build', s4.issues.some((t) => /has no build/.test(t)));
  await p.click('.slot-issues [data-fix]:last-child');   // starter build
  ok('starter build for a corvette without one', (await state()).issues.length === 0);
  await p.evaluate(() => { const bs = shipBuilds(); const a = bs.find((x) => str(g(x, 'Name')) === 'Formula1c'), t = bs.find((x) => str(g(x, 'Name')) === 'Yautja Claw'); set(a, 'UserData', N(num(g(t, 'UserData')))); set(ps(), 'PrimaryShip', N(11)); go('ships'); });
  await p.waitForSelector('.slot-issues');
  issues = (await state()).issues; console.log(issues);
  ok('duplicate builds and an empty current ship found', issues.some((t) => /has 2 builds/.test(t)) && issues.some((t) => /current ship points at slot 12/.test(t)));
  for (let k = 0; k < 6 && (await state()).issues.length; k++) { await p.click('.slot-issues li:first-child [data-fix]'); await p.waitForTimeout(150); }
  const s5 = await state(); console.log(JSON.stringify({ names: s5.names, primary: s5.primary, builds: s5.builds }));
  ok('every problem fixed with the first offered fix', s5.issues.length === 0 && s5.names[s5.primary]);
  ok('and the first fix for a duplicate sends it home instead of deleting it', await p.evaluate(() => { const b = shipBuilds().find((x) => str(g(x, 'Name')) === 'Formula1c'); return b && g(b, 'Objects').length === 509 && str(g(g(ps(), 'ShipOwnership')[num(g(b, 'UserData'))], 'Name')) === 'Formula1c'; }));
  // save, open again
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }).catch(() => {});
  const dlg = await p.$('#dlg[open]'); if (dlg) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }); }
  await open();
  const s6 = await state();
  ok('saved and opened again', JSON.stringify(s6.names) === JSON.stringify(s5.names) && JSON.stringify(s6.builds) === JSON.stringify(s5.builds) && s6.primary === s5.primary && s6.issues.length === 0);
  await p.evaluate(() => { const b = shipBuilds()[0]; set(b, 'UserData', N(40)); go('shipwright'); });
  await p.waitForSelector('#swFixSlots'); await p.click('#swFixSlots'); await p.waitForSelector('#shipSlots[open] .slot-issues');
  ok('Shipwright sends you to the fix', true);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
