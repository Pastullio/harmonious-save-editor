const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Add buttons (ship, multi-tool, exocraft, companion), archived ships, the Cover Flow / Grid switch and the close button
// in dialogs. Usage: node test/e2e/test_add.js <scratch dir> <folder with a save pair (save2.hg) that has archived ships>
const SP = process.argv[2], ARCH = process.argv[3];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'adcfg'), root = path.join(SP, 'adroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root + '/st_1', { recursive: true }); for (const f of ['save2.hg', 'mf_save2.hg']) fs.copyFileSync(path.join(ARCH, f), path.join(root, 'st_1', f));
  fs.cpSync(SP + '/itemlibcfg', cfg, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48005'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForTimeout(600); };
  await open();
  const confirm = async () => { await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(250); };
  const shipsNow = () => p.evaluate(() => g(ps(), 'ShipOwnership').map((s) => str(g(s, 'Name'))));
  // ---- nav order
  ok('Hangar sits above Dock Yard', await p.evaluate(() => { const ids = [...document.querySelectorAll('#nav button')].map((x) => x.dataset.s); return ids.indexOf('hangar') === ids.indexOf('library') - 1; }));
  // ---- dialogs close from the top-right corner
  await p.click('#side .about-btn'); await p.waitForSelector('#dlg[open]');
  const x = await p.$eval('#dlgX', (e) => { const r = e.getBoundingClientRect(), d = document.querySelector('#dlg').getBoundingClientRect(); return { right: d.right - r.right, top: r.top - d.top }; });
  ok('dialogs close from an × in the top-right corner', x.right < 30 && x.top < 30 && !(await p.$$eval('#dlgActs button', (bs) => bs.some((b) => b.textContent === 'Close'))));
  await p.click('#dlgX'); ok('the × closes it', !(await p.$('#dlg[open]')));
  // ---- ships
  await p.evaluate(() => go('ships')); await p.waitForSelector('#addShip');
  ok('Starships has Add a ship and Render corvettes', !!(await p.$('#renderCorv')));
  const before = await shipsNow();
  await p.click('#addShip'); await p.waitForSelector('#dlg[open]');
  const corvIdx = await p.evaluate(() => ships().find((x) => isCorvetteEntry(x.s)).i);
  await p.selectOption('#addWhat', String(corvIdx)); const slot = +(await p.$eval('#addSlot', (e) => e.value)); await confirm();
  const after = await shipsNow();
  const dup = await p.evaluate(([src, slot]) => { const a = shipBuild(src), c = shipBuild(slot); return !!c && g(c, 'Objects').length === g(a, 'Objects').length && C.stringifyJSON(g(ps(), 'CharacterCustomisationData')[shipCcdIndex(src)]) === C.stringifyJSON(g(ps(), 'CharacterCustomisationData')[shipCcdIndex(slot)]); }, [corvIdx, slot]);
  ok('a copy of a corvette lands in the free slot with its build and colours', after[slot] === before[corvIdx] + ' copy' && dup);
  await p.click('#addShip'); await p.waitForSelector('#dlg[open]'); const slot2 = +(await p.$eval('#addSlot', (e) => e.value)); await confirm();
  ok('a new corvette with a starter build', await p.evaluate((s) => isCorvetteEntry(g(ps(), 'ShipOwnership')[s]) && !!shipBuild(s), slot2));
  ok('no slot problems after adding', (await p.evaluate(() => shipSlotIssues().length)) === 0);
  // ---- archived ships
  await p.evaluate(() => { (S.slots || (S.slots = {})).open = true; go('ships'); }); await p.waitForSelector('.arch');
  const a0 = await p.evaluate(() => archList().filter(archFilled).map((e) => str(g(e, 'ArchivedName'))));
  ok('archived ships are listed', (await p.$$('.arch-list li')).length === a0.length && a0.length > 0);
  const name = a0[a0.length - 1];
  await p.click(`[data-unarch="${a0.length - 1}"]`); await p.waitForSelector('#dlg[open]'); const rs = +(await p.$eval('#unSlot', (e) => e.value)); await confirm();
  const r = await p.evaluate((s) => ({ name: str(g(g(ps(), 'ShipOwnership')[s], 'Name')), n: archList().filter(archFilled).length, last: archFilled(archList()[archList().length - 1]) }), rs);
  ok('restoring puts the ship back in a slot under its name', r.name === name && r.n === a0.length - 1 && !r.last);
  await p.click('#archShip'); await p.waitForSelector('#dlg[open]'); await p.selectOption('#arSlot', String(rs)); await confirm();
  const r2 = await p.evaluate((s) => ({ slotEmpty: !slotHasShip(g(ps(), 'ShipOwnership')[s]), names: archList().filter(archFilled).map((e) => str(g(e, 'ArchivedName'))) }), rs);
  ok('archiving it again empties the slot and lists it', r2.slotEmpty && r2.names[r2.names.length - 1] === name && r2.names.length === a0.length);
  // ---- multi-tools, exocraft, companions
  await p.evaluate(() => go('tools')); await p.waitForSelector('#addTool'); await p.click('#addTool'); await p.waitForTimeout(300);
  const toolsFull = await p.evaluate(() => tools().length === g(ps(), 'Multitools').length);
  if (toolsFull) ok('all multi-tool slots used: says so', /in use/.test(await p.textContent('#toast')));
  else { await confirm(); ok('a multi-tool copy is added', /copy$/.test(await p.evaluate(() => str(g(g(ps(), 'Multitools')[S.pick.tool], 'Name'))))); }
  await p.evaluate(() => go('vehicles')); await p.waitForSelector('#addExo'); await p.click('#addExo'); await p.waitForSelector('#dlg[open]');
  ok('exocraft dialog lists the seven exocraft', (await p.$$('#dlgBody .place-facts li')).length === 7); await p.click('#dlgX');
  await p.evaluate(() => go('companions')); await p.waitForSelector('#addPet');
  const n0 = await p.evaluate(() => g(ps(), 'Pets').filter(isPet).length);
  await p.click('#addPet'); await confirm();
  ok('a companion copy is added', (await p.evaluate(() => g(ps(), 'Pets').filter(isPet).length)) === n0 + 1);
  // ---- cover flow or grid
  await p.evaluate(() => go('hangar')); await p.waitForSelector('.view-switch');
  await p.click('.view-switch [data-view="grid"]'); await p.waitForSelector('.cg-card');
  const cards = await p.$$('.cg-card'); await cards[1].click(); await p.waitForTimeout(200);
  ok('grid view: cards instead of Cover Flow, picking one shows its details', !(await p.$('.cf-stage')) && (await p.$eval('.cg-card[aria-pressed="true"] b', (e) => e.textContent)) === (await p.$eval('#hangarDetail h2', (e) => e.textContent)));
  await p.evaluate(() => go('ships')); await p.waitForSelector('.cg-card');
  ok('the choice is remembered on other pages', !(await p.$('.cf-stage')));
  await p.click('.view-switch [data-view="flow"]'); await p.waitForSelector('.cf-stage'); ok('and switches back', true);
  await p.evaluate(() => go('library')); await p.waitForSelector('.dy-tab[data-v="garage"]'); await p.click('.dy-tab[data-v="garage"]');
  await p.waitForSelector('.cf-item', { timeout: 20000 }).catch(() => {});
  const nflow = (await p.$$('.cf-item')).length;
  if (nflow) { await p.click('.cf-item.center'); await p.waitForSelector('#dlg[open] .lib-detail', { timeout: 10000 }).catch(() => {}); }
  ok('the Garage in Cover Flow, opening a ship shows its card', nflow > 0 && !!(await p.$('#dlg[open] .lib-detail')));
  if (await p.$('#dlg[open]')) await p.click('#dlgX');
  // ---- save and reopen
  await p.click('#saveBtn'); await confirm(); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 });
  await open();
  ok('saved and opened again', (await p.evaluate(() => shipSlotIssues().length)) === 0 && (await shipsNow())[slot] === after[slot]);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
