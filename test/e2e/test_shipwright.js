const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Shipwright on a copy of a real save: build checks, tune up, copy/paste/load, part moves, duplicates, JSON, save.
// Usage: node test/e2e/test_shipwright.js <scratch dir with dbroot/NMS (real save) and fakebanks (item library paks)>
const SP = process.argv[2], ATT = '/mnt/user-data/attachments/c7a04859-a3e4-54e4-aad1-f1e3f48b3fdb/';
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'swtest'); fs.rmSync(T, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', path.join(T, 'root'), { recursive: true }); fs.mkdirSync(path.join(T, 'home', 'Documents'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', path.join(T, 'root'), '-port', '47985'], { env: { ...process.env, HOME: path.join(T, 'home'), XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_GAME: SP + '/fakebanks' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.replace(/\/\?.*$/, '').replace(/\/$/, '') });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  await p.waitForFunction(() => S.db && S.db.items && S.db.items.size > 100, null, { timeout: 120000 }).catch(() => {});
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const nav = await p.$$eval('nav button', (b) => b.map((x) => x.dataset.s)); ok('Shipwright sits right under Overview', nav[0] === 'overview' && nav[1] === 'shipwright');
  ok('Shipwright is marked New until opened', !!(await p.$('nav [data-s="shipwright"] .new-pill')));
  await p.click('nav button[data-s="shipwright"]'); await p.waitForSelector('.sw-corv');
  ok('…and not after', !(await p.$('nav [data-s="shipwright"] .new-pill')));
  const corvs = await p.$$eval('.sw-corv b', (b) => b.map((x) => x.textContent)); console.log(corvs);
  ok('lists the save\'s corvettes', corvs.join() === 'Formula1c,Yautja Claw,Max,The Cutting Remark');
  const named = await p.evaluate(() => [partGroup('^B_GEN_1'), partGroup('^B_WNG_O_0'), partGroup('^B_WNG_A'), partGroup('^B_TUR_A'), partGroup('^B_SHL_C'), partGroup('^B_LND_B'), partGroup('^B_ALK_B'), partGroup('^B_HAB1_C'), partGroup('^B_COK_D'), partGroup('^U_MINIPORTAL'), partGroup('^B_ROOF_M'), (dbItem('^B_GEN_1') || {}).name].join());
  console.log(named);
  ok('parts are grouped by what they are', named === 'reactor,rockhopper,engine,weapon,shield,gear,bay,other,cockpit,other,other,Medusa-Class Reactor');
  // health and tune up on each corvette
  const before = await p.evaluate(() => ships().filter(({ s }) => /BIGGS/.test(str(g(s, 'Resource', 'Filename')))).map(({ i }) => ({ i, tuned: isTuned(g(shipBuild(i), 'Objects')), n: g(shipBuild(i), 'Objects').length })));
  console.log(JSON.stringify(before));
  const untuned = before.find((x) => !x.tuned);
  ok('at least one build is out of order', !!untuned);
  await p.click(`.sw-corv[data-i="${untuned.i}"]`); await p.waitForSelector('.sw-health');
  ok('the build check says so', /out of order/.test(await p.textContent('.sw-health')));
  await p.screenshot({ path: SP + '/shots/sw0.png' });
  const keyParts = () => p.evaluate((i) => { const o = g(shipBuild(i), 'Objects'); const pick = (grp) => o.filter((x) => partGroup(g(x, 'ObjectID')) === grp).map((x) => C.stringifyJSON(g(x, 'Position'))); return { cock: pick('cockpit'), bay: pick('bay'), n: o.length }; }, untuned.i);
  const k0 = await keyParts();
  await p.click('.sw-bar [data-a="tune"]'); await p.waitForTimeout(300);
  const k1 = await keyParts();
  ok('tune up puts parts in the game\'s order', await p.evaluate((i) => isTuned(g(shipBuild(i), 'Objects')), untuned.i) && /in the order the game reads them/.test(await p.textContent('.sw-health')));
  ok('…keeps every part and the cockpit and landing bay order', k1.n === k0.n && k1.cock.join() === k0.cock.join() && k1.bay.join() === k0.bay.join());
  ok('…and the first rows are the performance parts', /Rockhopper|Reactor/.test(await p.textContent('.sw-row[data-k="0"]')));
  await p.screenshot({ path: SP + '/shots/sw1-tuned.png' });
  // copy all
  await p.click('.sw-bar [data-a="copy"]'); const clip = await p.evaluate(() => navigator.clipboard.readText());
  const cj = JSON.parse(clip); ok('copy all gives the whole build as plain JSON', cj.Objects.length === k0.n && cj.BaseType.PersistentBaseTypes === 'PlayerShipBase' && cj.UserData === untuned.i);
  // paste all onto Max (slot index 4): the Death & Glory .txt
  await p.click('.sw-corv[data-i="4"]'); await p.waitForSelector('.sw-health');
  await p.evaluate((t) => navigator.clipboard.writeText(t), fs.readFileSync(ATT + '0289520e-Death___Glory_3.txt', 'utf8'));
  await p.click('.sw-bar [data-a="paste"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(500);
  let st = await p.evaluate(() => { const b = shipBuild(4); return { n: g(b, 'Objects').length, ud: num(g(b, 'UserData')), name: str(g(b, 'Name')), ship: str(g(g(ps(), 'ShipOwnership')[4], 'Name')), tuned: isTuned(g(b, 'Objects')), order: [...g(b, 'Objects')[0].keys()].map(nameOf).join() }; });
  console.log(JSON.stringify(st));
  ok('paste all replaces the build and keeps the slot link and name', st.n === 2091 && st.ud === 4 && st.name === 'Max' && st.ship === 'Max' && st.tuned && st.order === 'Timestamp,ObjectID,UserData,Position,Up,At');
  // load a .nmsship onto Yautja Claw (index 3)
  await p.click('.sw-corv[data-i="3"]'); await p.waitForSelector('#swFile', { state: 'attached' });
  await p.setInputFiles('#swFile', ATT + '1ebbbc19-Death_n_Glory.nmsship'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(500);
  st = await p.evaluate(() => ({ n: g(shipBuild(3), 'Objects').length, ud: num(g(shipBuild(3), 'UserData')), order: [...g(shipBuild(3), 'Objects')[0].keys()].map(nameOf).join() }));
  ok('load file (.nmsship) works', st.n === 941 && st.ud === 3 && st.order === 'Timestamp,ObjectID,UserData,Position,Up,At');
  // a single pasted part is added, twice makes a duplicate, which the check finds and removes
  const one = JSON.stringify(cj.Objects[cj.Objects.length - 1]);
  for (let r = 0; r < 2; r++) { await p.evaluate((t) => navigator.clipboard.writeText(t), one); await p.click('.sw-bar [data-a="paste"]'); await p.waitForTimeout(400); }
  ok('a single part is added', (await p.evaluate(() => g(shipBuild(3), 'Objects').length)) === 943);
  ok('the duplicate is found', /exactly on top of an identical part/.test(await p.textContent('.sw-health')));
  await p.click('.sw-health [data-a="dedupe"]'); await p.waitForTimeout(300);
  ok('and removed', (await p.evaluate(() => g(shipBuild(3), 'Objects').length)) === 942);
  // moving parts: select rows 5-7 with shift, move to top; then delete them
  await p.click('.sw-row[data-k="5"]'); await p.click('.sw-row[data-k="7"]', { modifiers: ['Shift'] });
  const ids = await p.evaluate(() => [5, 6, 7].map((k) => C.stringifyJSON(g(shipBuild(3), 'Objects')[k])));
  await p.click('.sw-move [data-m="top"]'); await p.waitForTimeout(300);
  ok('move to the top', await p.evaluate((ids) => ids.every((x, k) => C.stringifyJSON(g(shipBuild(3), 'Objects')[k]) === x), ids) && (await p.$$('.sw-row.sel')).length === 3);
  await p.click('.sw-move [data-m="down"]'); await p.waitForTimeout(300);
  ok('move down keeps the block together', await p.evaluate((ids) => ids.every((x, k) => C.stringifyJSON(g(shipBuild(3), 'Objects')[k + 1]) === x), ids));
  await p.click('.sw-move [data-m="del"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await p.waitForTimeout(300);
  ok('delete parts', (await p.evaluate(() => g(shipBuild(3), 'Objects').length)) === 939);
  // search
  await p.fill('#swQ', 'reactor'); await p.waitForTimeout(200);
  const shown = await p.$$eval('.sw-row .nm', (n) => n.map((x) => x.textContent)); ok('search finds parts by name or group', shown.length > 0 && shown.every((t) => /Reactor|Generator/.test(t)));
  await p.fill('#swQ', '');
  // JSON box: drop the last part and apply
  await p.click('.sw-json summary'); await p.waitForTimeout(300);
  await p.evaluate(() => { const ta = $('#swJson'); const j = JSON.parse(ta.value); j.Objects.pop(); ta.value = JSON.stringify(j, null, 2); });
  await p.click('.sw-json [data-a="apply"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
  ok('JSON apply', (await p.evaluate(() => g(shipBuild(3), 'Objects').length)) === 938);
  await p.screenshot({ path: SP + '/shots/sw2.png' });
  // Add corvette: a starter build in the first empty slot, then a real build pasted over it
  await p.click('#swAdd'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
  st = await p.evaluate(() => {
    const s = g(ps(), 'ShipOwnership')[6], b = shipBuild(6), tpl = shipBuild(5);
    return { name: str(g(s, 'Name')), file: str(g(s, 'Resource', 'Filename')), cls: invClass(g(s, 'Inventory')), items: ['Inventory', 'Inventory_TechOnly', 'Inventory_Cargo'].map((k) => slotsOf(g(s, k)).length).join(),
      seedNew: str(g(s, 'Resource', 'Seed')[1]) !== str(g(g(ps(), 'ShipOwnership')[5], 'Resource', 'Seed')[1]), parts: g(b, 'Objects').map((o) => str(g(o, 'ObjectID'))).join(),
      ud: num(g(b, 'UserData')), keys: [...b.keys()].join() === [...tpl.keys()].join(), okeys: [...g(b, 'Objects')[0].keys()].map(nameOf).join(), shipKeys: [...s.keys()].join() === [...g(ps(), 'ShipOwnership')[5].keys()].join(),
      selected: S.wright.slot };
  });
  console.log(JSON.stringify(st));
  ok('Add corvette makes a C-class corvette with empty inventories in the first empty slot', st.name === 'New corvette' && /BIGGS/.test(st.file) && st.cls === 'C' && st.items === '0,0,0' && st.seedNew && st.shipKeys && st.selected === 6);
  ok('…with a starter build linked to that slot, in the game\'s layout', st.ud === 6 && st.keys && st.okeys === 'Timestamp,ObjectID,UserData,Position,Up,At' && st.parts === '^B_GEN_1,^B_TRU_F,^B_TUR_D,^B_LND_A,^B_ALK_A,^B_COK_D,^B_HAB1_A,^U_PARAGON');
  const hc = await p.textContent('.sw-health'); console.log(hc.replace(/\s+/g, ' '));
  ok('…which passes the build check', !/No cockpit|No landing bay|out of order|won't work/.test(hc));
  await p.evaluate((t) => navigator.clipboard.writeText(t), fs.readFileSync(ATT + '0289520e-Death___Glory_3.txt', 'utf8'));
  await p.click('.sw-bar [data-a="paste"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(500);
  ok('a real build pastes over the starter', (await p.evaluate(() => [g(shipBuild(6), 'Objects').length, num(g(shipBuild(6), 'UserData')), str(g(shipBuild(6), 'Name'))].join())) === '2091,6,New corvette');
  // add a second one, then delete it again
  await p.click('#swAdd'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
  ok('a second corvette goes into the next empty slot', (await p.evaluate(() => S.wright.slot)) === 7 && !!(await p.evaluate(() => shipBuild(7))));
  await p.click('#swDel'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await p.waitForTimeout(400);
  ok('Delete corvette removes the ship and its build', await p.evaluate(() => !str(g(g(ps(), 'ShipOwnership')[7], 'Resource', 'Filename')) && !shipBuild(7)));
  // save, reopen
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }).catch(() => {});
  if (await p.$('#dlg[open]')) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }); }
  await p.reload(); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  st = await p.evaluate((u) => ({ y: g(shipBuild(3), 'Objects').length, max: g(shipBuild(4), 'Objects').length, tuned: isTuned(g(shipBuild(u), 'Objects')), nw: shipBuild(6) && g(shipBuild(6), 'Objects').length, nm: str(g(g(ps(), 'ShipOwnership')[6], 'Name')) }), untuned.i);
  ok('it all survives saving and reopening', st.y === 938 && st.max === 2091 && st.tuned && st.nw === 2091 && st.nm === 'New corvette');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.click('nav button[data-s="shipwright"]'); await p.waitForTimeout(800);
  await p.screenshot({ path: SP + '/shots/sw3-dark.png' });
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
