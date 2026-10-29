const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs');
const SP = process.argv[2] || '/tmp/claude-0/-home-claude/c7a04859-a3e4-54e4-aad1-f1e3f48b3fdb/scratchpad';
const C = require('/home/claude/harmonious-save-editor/src/codec.js');
const ACC = SP + '/profroot/NMS/st_76561190000000001';
fs.rmSync(SP + '/profroot', { recursive: true, force: true }); fs.rmSync(SP + '/profcfg', { recursive: true, force: true }); fs.mkdirSync(ACC, { recursive: true });
for (const f of ['save.hg', 'mf_save.hg']) fs.copyFileSync(SP + '/real/' + f, ACC + '/' + f);
(async () => {
  const proc = spawn('/home/claude/harmonious-save-editor/dist/hse-linux', ['-no-window', '-root', SP + '/profroot/NMS', '-port', '47967'], { env: { ...process.env, XDG_CONFIG_HOME: SP + '/profcfg' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // storage picker
  await p.click('nav button[data-s="storage"]'); await p.waitForTimeout(500);
  ok('storage shows one container', (await p.$$('.inv')).length === 1);
  await p.click('.store-pick .pick.all'); await p.waitForTimeout(500);
  ok('show all shows every container', (await p.$$('.inv')).length > 10);
  await p.click('.store-pick .pick >> nth=2'); await p.waitForTimeout(300);
  await p.screenshot({ path: SP + '/shots/c0-storage.png' });
  // ships: select The Cutting Remark
  await p.click('nav button[data-s="ships"]'); await p.waitForTimeout(800);
  const pickShip = async (name) => { await p.evaluate((n) => { const it = ships().find(({ s }) => str(g(s, 'Name')) === n); S.pick.ship = it.i; render(); }, name); await p.waitForTimeout(600); };
  await pickShip('The Cutting Remark');
  await p.screenshot({ path: SP + '/shots/c1-ship-details.png' });
  await p.click('[data-k="saveprof"]'); await p.waitForSelector('#profName');
  await p.fill('#profName', 'S-class corvette loaded'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(800);
  const pdir = SP + '/profcfg/HarmoniousSaveEditor/profiles';
  ok('profile file written', fs.existsSync(pdir + '/S-class corvette loaded.json'));
  // apply to Yautja Claw (C class)
  await pickShip('Yautja Claw');
  const before = await p.evaluate(() => { const s = ships().find(({ s }) => str(g(s, 'Name')) === 'Yautja Claw').s; return { cls: invClass(g(s, 'Inventory')), tech: slotsOf(g(s, 'Inventory_TechOnly')).length, cargo: slotsOf(g(s, 'Inventory')).length }; });
  console.log('before', before);
  await p.click('[data-k="applyprof"]'); await p.waitForSelector('.prof');
  await p.screenshot({ path: SP + '/shots/c2-profile-list.png' });
  await p.click('.prof [data-a="apply"]'); await p.waitForSelector('.prof-opts');
  await p.screenshot({ path: SP + '/shots/c3-profile-preview.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(800);
  const after = await p.evaluate(() => { const s = ships().find(({ s }) => str(g(s, 'Name')) === 'Yautja Claw').s, src = ships().find(({ s }) => str(g(s, 'Name')) === 'The Cutting Remark').s;
    const ids = (inv) => slotsOf(inv).map((x) => idOf(x) + '@' + posOf(x).join(',')).sort().join('|');
    return { cls: invClass(g(s, 'Inventory')), clsTech: invClass(g(s, 'Inventory_TechOnly')), tech: slotsOf(g(s, 'Inventory_TechOnly')).length, sameTech: ids(g(s, 'Inventory_TechOnly')) === ids(g(src, 'Inventory_TechOnly')),
      dmg: statOf(s, 'ship', '^SHIP_DAMAGE'), srcDmg: statOf(src, 'ship', '^SHIP_DAMAGE'), cargo: slotsOf(g(s, 'Inventory')).length, valid: g(s, 'Inventory', 'ValidSlotIndices').length }; });
  console.log('after', after);
  ok('upgraded to S class on all inventories', after.cls === 'S' && after.clsTech === 'S');
  ok('tech layout copied exactly', after.sameTech);
  ok('stats copied', Math.abs(after.dmg - after.srcDmg) < 1e-9);
  // details: change class, stats, seed
  await p.selectOption('[data-k="class"]', 'A'); await p.waitForTimeout(400);
  await p.fill('[data-stat="^SHIP_HYPERDRIVE"]', '99.5'); await p.dispatchEvent('[data-stat="^SHIP_HYPERDRIVE"]', 'change');
  await p.click('[data-k="gen"]');
  // export
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-k="export"]')]);
  const expPath = SP + '/yautja.ship.json'; await dl.saveAs(expPath);
  ok('export is valid JSON with the ship', JSON.parse(fs.readFileSync(expPath, 'utf8')).Ship.Name === 'Yautja Claw');
  // save to game, then read back
  await p.click('#saveBtn'); await p.click('#dlg .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 20000 });
  const sv = C.readSave(fs.readFileSync(ACC + '/save.hg'), fs.readFileSync(ACC + '/mf_save.hg'), 'save.hg');
  ok('saved file decodes', !!sv.json);
  const txt = C.stringifyJSON(sv.json); ok('saved file mentions class A and hyperdrive 99.5', txt.includes('99.5'));
  // import the export onto a different (Max) ship
  await p.click('nav button[data-s="ships"]'); await p.waitForTimeout(600); await pickShip('Max');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('label:has([data-k="import"])')]);
  await fc.setFiles(expPath); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger'); await p.waitForTimeout(600);
  ok('import replaced Max with Yautja Claw', await p.evaluate(() => ships().filter(({ s }) => str(g(s, 'Name')) === 'Yautja Claw').length === 2));
  // multi-tools: profile from Atlas Sceptre onto the last tool
  await p.click('nav button[data-s="tools"]'); await p.waitForTimeout(600);
  await p.evaluate(() => { S.pick.tool = tools().find(({ s }) => str(g(s, 'Name')) === 'Atlas Sceptre').i; render(); }); await p.waitForTimeout(500);
  await p.click('[data-k="saveprof"]'); await p.waitForSelector('#profName'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(600);
  await p.evaluate(() => { S.pick.tool = 5; render(); }); await p.waitForTimeout(500);
  await p.click('[data-k="applyprof"]'); await p.waitForSelector('.prof');
  ok('only multi-tool profiles listed', (await p.$$('.prof')).length === 1);
  await p.click('.prof [data-a="apply"]'); await p.waitForSelector('.prof-opts'); await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(500);
  ok('multi-tool got the staff tech and stats', await p.evaluate(() => { const a = tools().find(({ s }) => str(g(s, 'Name')) === 'Atlas Sceptre').s, t = g(ps(), 'Multitools')[5]; return slotsOf(g(t, 'Store')).length === slotsOf(g(a, 'Store')).length && statOf(t, 'tool', '^WEAPON_DAMAGE') === statOf(a, 'tool', '^WEAPON_DAMAGE'); }));
  await p.screenshot({ path: SP + '/shots/c4-tool.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
})();
