// Companions: creature battle type and stat classes (owner, 2026-11-09). Type changes the pet's Biome unless the
// species' type is fixed by the game (greyed out); "Set the stat classes here" turns the game's overrides on.
// Usage: node test/e2e/test_petbattle.js <scratch dir with dbroot/NMS (a real save with companions)>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const C = require('../../src/codec.js');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'petbattle'); fs.rmSync(T, { recursive: true, force: true });
  const root = path.join(T, 'root'); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true }); fs.mkdirSync(path.join(T, 'home', 'Documents'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47993'], { env: { ...process.env, HOME: path.join(T, 'home'), XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="companions"]'); await p.waitForSelector('.list-item, [data-k]');
  const pets = await p.evaluate(() => (g(ps(), 'Pets') || []).map((q, i) => ({ i, id: str(g(q, 'CreatureID')), biome: str(g(q, 'Biome', 'Biome')) })).filter((x) => x.id && x.id !== '^'));
  const snake = pets.find((x) => x.id === '^FLYINGSNAKE'), free = pets.find((x) => !['FLYINGSNAKE', 'ROBO_PET', 'HOVER_PET', 'LAND_JELLYFISH', 'PLANTCAT', 'BONECAT', 'FIEND', 'BUGFIEND', 'SCUTTLER_PET', 'PURPLE_WEIRD', 'BONECOW', 'ROBO_RODENT', 'WALKER_CRAB', 'FISHBOWL_PET3', 'LANDSQUID_PET', 'SPIDERQUAD_PET', 'HORROR_PET', 'ROBOTANTELOPE', 'WALKINGBUILDING'].includes(x.id.slice(1)));
  ok('the save has a fixed-type companion and a free one', !!snake && !!free);
  const pick = async (i) => { await p.evaluate((i) => { S.pets.pick = i; render(); }, i); await p.waitForSelector('.pet-battle'); };
  await pick(snake.i);
  ok('a flying snake is always Desert, greyed out', await p.$eval('#pType', (s) => s.disabled && s.value === 'Desert'));
  ok('…with a tip saying why', /can't be changed/.test(await p.$eval('.pet-battle', (e) => e.innerHTML)));
  ok('stat classes start as the game rolls them', await p.$eval('#pClsUse', (c) => !c.checked) && await p.$$eval('[data-pcls]', (l) => l.length === 3 && l.every((s) => s.disabled && s.value === 'Rolled')));
  await p.click('#pAllS');
  const st = await p.evaluate((i) => { const q = g(ps(), 'Pets')[i]; return { use: g(q, 'PetBattlerUseCoreStatClassOverrides'), cls: g(q, 'PetBattlerCoreStatClassOverrides').map((o) => str(g(o, 'InventoryClass'))), dirty: S.dirty }; }, snake.i);
  ok('Make every stat S class sets all three and turns the override on', st.use === true && st.cls.join() === 'S,S,S' && st.dirty);
  ok('the selects show S and can be changed', await p.$$eval('[data-pcls]', (l) => l.every((s) => !s.disabled && s.value === 'S')));
  await p.selectOption('[data-pcls="1"]', 'A');
  ok('one class can be changed on its own', (await p.evaluate((i) => g(g(ps(), 'Pets')[i], 'PetBattlerCoreStatClassOverrides').map((o) => str(g(o, 'InventoryClass'))).join(), snake.i)) === 'S,A,S');
  await p.click('#pClsUse');
  ok('turning it off goes back to the game\'s roll', await p.evaluate((i) => g(g(ps(), 'Pets')[i], 'PetBattlerUseCoreStatClassOverrides') === false, snake.i));
  await pick(free.i);
  ok('another companion\'s type can be changed', await p.$eval('#pType', (s) => !s.disabled && s.options.length >= 7));
  await p.selectOption('#pType', 'Frozen');
  ok('choosing Frost sets its biome to Frozen', (await p.evaluate((i) => str(g(g(ps(), 'Pets')[i], 'Biome', 'Biome')), free.i)) === 'Frozen' && await p.$eval('#pType', (s) => s.value === 'Frozen'));
  await p.screenshot({ path: path.join(T, 'petbattle.png'), fullPage: false });
  // written save: obfuscated keys, the right fields
  const saved = await p.evaluate(() => !!encodeSave()).catch((e) => 'err ' + e.message);
  ok('the edited save encodes', saved === true);
  const keys = await p.evaluate((i) => [...g(ps(), 'Pets')[i].keys()], snake.i);
  ok('the save keeps its own (obfuscated) keys for the new fields', keys.includes('isp') && keys.includes('E<S') && !keys.includes('PetBattlerUseCoreStatClassOverrides'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
