const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// The plain editors (difficulty, standing, knowledge and words, bases and settlements, companions, frigates)
// and the find-anything box, on a copy of a real save, saved and opened again.
// Usage: node test/e2e/test_editors.js <scratch dir with dbroot/NMS holding a real save> [item library folder]
// The item library (for names, words, frigate traits and perks) is copied from <scratch>/itemlibcfg if it is there
// (test_itemlib.js builds it), or from the folder given.
const SP = process.argv[2], LIB = process.argv[3] || path.join(SP, 'itemlibcfg/HarmoniousSaveEditor/itemlib');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'edcfg'), root = path.join(SP, 'edroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });   // a copy, because this test saves
  if (fs.existsSync(LIB)) fs.cpSync(LIB, path.join(cfg, 'HarmoniousSaveEditor/itemlib'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47981'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_GAME: SP + '/fakebanks' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  await open();
  await p.waitForFunction(() => S.db && S.db.src === 'lib', null, { timeout: 120000 });
  const shot = (n) => p.screenshot({ path: `${SP}/shots/ed-${n}.png`, fullPage: true });
  const navs = await p.$$eval('#nav button', (x) => x.map((b) => b.dataset.s));
  ok('new sections in the sidebar', ['companions', 'bases', 'knowledge', 'standing', 'difficulty'].every((s) => navs.includes(s)));
  const before = await p.evaluate(() => ({ prods: g(ps(), 'KnownProducts').length, tech: g(ps(), 'KnownTech').length, words: g(ps(), 'KnownWordGroups').length, bases: g(ps(), 'PersistentPlayerBases').length }));

  // ---- difficulty
  await p.evaluate(() => go('difficulty')); await p.waitForSelector('#dPreset');
  ok('difficulty shows the settings', (await p.$$eval('[data-e]', (x) => x.length)) >= 20 && (await p.$$eval('[data-b]', (x) => x.length)) >= 7);
  ok('current values shown', await p.evaluate(() => $('[data-e="DamageGiven"]').value === 'High' && $('[data-e="CreatureHostility"]').value === 'NeverAttack'));
  await shot('difficulty');
  await p.selectOption('[data-e="DamageReceived"]', 'Normal');
  await p.selectOption('#dPreset', 'Normal');
  ok('preset and setting change', await p.evaluate(() => enumVal(g(difficultyState(), 'Preset')) === 'Normal' && enumVal(g(difficultyState(), 'Settings', 'DamageReceived')) === 'Normal' && S.diffPreset === 2));
  await p.click('[data-b="TutorialEnabled"]');
  ok('changing a setting makes the preset Custom', await p.evaluate(() => enumVal(g(difficultyState(), 'Preset')) === 'Custom' && $('#dPreset').value === 'Custom' && g(difficultyState(), 'Settings', 'TutorialEnabled') === true));
  await p.selectOption('#dPreset', 'Survival');

  // ---- standing
  await p.evaluate(() => go('standing')); await p.waitForSelector('[data-stat="TRA_STANDING"]');
  ok('standing shows each race', (await p.inputValue('[data-stat="TRA_STANDING"]')) === '1012' && (await p.inputValue('[data-stat="EXP_STANDING"]')) === '1041');
  await p.fill('[data-stat="TRA_STANDING"]', '250'); await p.press('[data-stat="TRA_STANDING"]', 'Tab');
  ok('standing edits', await p.evaluate(() => statValue('TRA_STANDING') === 250));
  await p.click('[data-max="BUI_STANDING"]');
  ok('max on a stat with no value yet (the top rank from the game, or 1000 without it)', await p.evaluate(() => { const r = rankAt('BUI_STANDING', 0); return statValue('BUI_STANDING') === (r ? r.top.value : 1000) && kOf(g(statEntry('BUI_STANDING'), 'Value'), 'IntValue') != null; }));
  await p.fill('[data-stat="DIST_WALKED"]', '123456.5'); await p.press('[data-stat="DIST_WALKED"]', 'Tab');
  ok('float milestones stay floats', await p.evaluate(() => kOf(g(statEntry('DIST_WALKED'), 'Value'), 'FloatValue') != null && statValue('DIST_WALKED') === 123456.5));
  await shot('standing');

  // ---- knowledge
  await p.evaluate(() => go('knowledge')); await p.waitForSelector('#kRows .know-row');
  ok('known technology listed with names', await p.evaluate(() => $('#kCount').textContent.includes('242') && [...document.querySelectorAll('#kRows .nm')].some((n) => n.textContent === 'Scanner')));
  await shot('knowledge');
  const first = await p.evaluate(() => str(g(ps(), 'KnownTech')[0]));
  await p.click('#kRows [data-forget="0"]');
  ok('forget a blueprint', await p.evaluate((id) => !g(ps(), 'KnownTech').map(str).includes(id), first));
  await p.click('#kAdd'); await p.fill('#kFind', first.replace('^', '')); await p.waitForSelector('#kRes button[data-id]');
  await p.click(`#kRes button[data-id="${first}"]`); await p.click('#dlgActs .btn.primary');
  ok('learn it again from the search', await p.evaluate((id) => g(ps(), 'KnownTech').map(str).includes(id), first));
  await p.click('.ed-tabs [data-t="words"]'); await p.waitForSelector('.word-races .wr');
  const wr = await p.$$eval('.word-races .wr', (x) => x.map((d) => d.textContent));
  console.log(wr.join(' | '));
  ok('words per race, from the game', wr.length === 5 && /Gek/.test(wr[0]));
  await shot('words');
  await p.click('.wr[data-r="4"]'); await p.waitForSelector('#wRows .word');
  const w0 = await p.$eval('#wRows .word input', (c) => ({ g: c.dataset.g, on: c.checked }));
  await p.click('#wRows .word input');
  ok('a word can be unlearnt and learnt', await p.evaluate((w) => g(knownWordMap().get(w.g), 'Races')[4] === !w.on, w0));
  await p.click('#wAll');
  const wafter = await p.evaluate(() => { const k = knownWordMap(); return [...wordGroups().values()].filter((w) => WORD_RACES.some(([r]) => r === w.race)).every((w) => { const e = k.get(w.group); return e && g(e, 'Races')[w.race] === true; }); });
  ok('learn every word', wafter);
  ok('new word groups added in the game\'s shape', await p.evaluate(() => { const arr = g(ps(), 'KnownWordGroups'), e = arr[arr.length - 1]; return arr.length > 3821 && [...e.keys()].map(nameOf).join() === 'Group,Races' && g(e, 'Races').length === 9; }));

  // ---- bases and settlements
  await p.evaluate(() => go('bases')); await p.waitForSelector('#bName');
  ok('bases list without corvettes', (await p.$$eval('.ed-list [data-k]', (x) => x.length)) === 19);
  ok('base place and parts', (await p.$$eval('.base-where .glyph', (x) => x.length)) === 12 && (await p.$$eval('.base-parts > div', (x) => x.length)) > 3);
  await shot('bases');
  await p.fill('#bName', 'Gas Display II'); await p.press('#bName', 'Tab');
  ok('rename a base', await p.evaluate(() => str(g(g(ps(), 'PersistentPlayerBases')[0], 'Name')) === 'Gas Display II'));
  await p.click('.sw-acts [data-a="copy"]');
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok('copy parts gives plain JSON', /"ObjectID"/.test(clip) && JSON.parse(clip).length === 92);
  const nearIdx = await p.evaluate(() => g(ps(), 'PersistentPlayerBases').findIndex((b) => str(g(b, 'Name')) === 'near perfect'));
  await p.click(`.ed-list [data-k="${nearIdx}"]`); await p.waitForTimeout(200);
  await p.click('.sw-acts [data-a="del"]'); await p.click('#dlgActs .btn.danger');
  ok('delete a base', await p.evaluate(() => g(ps(), 'PersistentPlayerBases').length === 22 && !g(ps(), 'PersistentPlayerBases').some((b) => str(g(b, 'Name')) === 'near perfect')));
  await p.click('.ed-tabs [data-t="settlements"]'); await p.waitForSelector('[data-st-tab]');
  const owned0 = await p.evaluate(() => { const me = myUID(); return (g(ps(), 'SettlementStatesV2') || []).filter((x) => me && str(g(x, 'Owner', 'UID')) === me).length; });
  if (!owned0) {
    ok('no settlement of your own: Owned says so', /don't run a settlement/.test(await p.textContent('#page')));
    await p.click('[data-st-tab="visited"]'); await p.waitForSelector('.ro-grid');
    ok('visited settlements listed, view only', (await p.$$eval('.ed-list [data-k]', (x) => x.length)) >= 90 && !(await p.$('#sName')) && !(await p.$('[data-st]')) && !(await p.$('#sFix')));
    await shot('settlements-visited');
    // make one of them yours to check the editor
    await p.evaluate(() => { const st = g(ps(), 'SettlementStatesV2').find((x) => str(g(x, 'Name'))); set(g(st, 'Owner'), 'UID', myUID()); S.bases.setTab = 'owned'; S.bases.set = null; render(); });
  }
  await p.waitForSelector('#sName');
  ok('your settlements are editable', !!(await p.$('[data-st="5"]')));
  const sIdx = await p.evaluate(() => S.bases.set);
  await p.fill('[data-st="5"]', '777'); await p.press('[data-st="5"]', 'Tab');
  await p.click('#sFix');
  ok('settlement debt cleared', await p.evaluate((i) => num(g(g(ps(), 'SettlementStatesV2')[i], 'Stats')[5]) === 0, sIdx));
  await p.fill('#sName', 'Harmony'); await p.press('#sName', 'Tab');
  await shot('settlements');

  // ---- companions
  await p.evaluate(() => go('companions')); await p.waitForSelector('#pName');
  ok('companions listed', (await p.$$eval('.ed-list [data-k]', (x) => x.length)) === 13);
  await p.fill('#pName', 'Noodle'); await p.press('#pName', 'Tab');
  await p.click('#pHappy');
  ok('companion renamed, trusting and content', await p.evaluate(() => { const pt = g(ps(), 'Pets')[0]; return str(g(pt, 'CustomName')) === 'Noodle' && num(g(pt, 'Trust')) === 1 && g(pt, 'Moods').every((m) => num(m) === 0) && String(g(pt, 'Trust').raw).includes('.'); }));
  await p.$eval('[data-trait="1"]', (r) => { r.value = '-0.5'; r.dispatchEvent(new Event('change')); });
  ok('temperament slider', await p.evaluate(() => num(g(g(ps(), 'Pets')[0], 'Traits')[1]) === -0.5));
  await p.click('#pSlots');
  ok('every companion slot unlocked', await p.evaluate(() => g(ps(), 'UnlockedPetSlots').every((x) => x === true)));
  await shot('companions');

  // ---- frigates
  await p.evaluate(() => go('freighter')); await p.waitForSelector('#fName');
  ok('frigates on the freighter page', (await p.$$eval('#frigates ~ .ed .ed-list [data-k]', (x) => x.length)) === 30);
  ok('frigate traits named from the game', await p.evaluate(() => [...document.querySelectorAll('.ed .perks b')].some((x) => !/^LIVING_/.test(x.textContent))));
  await p.fill('#fName', 'Sunrise'); await p.press('#fName', 'Tab');
  await p.selectOption('#fInv', 'A');
  await p.fill('[data-fs="6"]', '99'); await p.press('[data-fs="6"]', 'Tab');
  ok('frigate edits', await p.evaluate(() => { const f = g(ps(), 'FleetFrigates')[0]; return str(g(f, 'CustomName')) === 'Sunrise' && str(g(f, 'InventoryClass', 'InventoryClass')) === 'A' && num(g(f, 'Stats')[6]) === 99; }));
  await (await p.$('#frigates')).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SP}/shots/ed-frigates.png` });

  // ---- find anything
  const find = async (q) => { await p.click('#findBox'); await p.fill('#findBox', q); await p.waitForSelector('#findRes:not([hidden]) [data-k]'); return p.$$eval('#findRes [data-k]', (x) => x.map((b) => b.textContent)); };
  let r = await find('lighthouse'); console.log(r.slice(0, 3));
  ok('find a base by name', /Base/.test(r[0]) && /Lighthouse/.test(r[0]));
  await p.screenshot({ path: `${SP}/shots/ed-find.png` });
  await p.keyboard.press('Enter'); await p.waitForSelector('#bName');
  ok('enter opens it', (await p.inputValue('#bName')) === 'Lighthouse');
  r = await find('permadeath'); await p.keyboard.press('Enter'); await p.waitForSelector('#dPreset');
  ok('find the difficulty page', await p.evaluate(() => S.section === 'difficulty'));
  r = await find('creatures'); ok('find a difficulty setting by its label', r.some((t) => /Setting/.test(t) && /Creatures/.test(t)));
  r = await find('snow eagle'); await p.keyboard.press('Enter'); await p.waitForSelector('#pName');
  ok('find a companion', (await p.inputValue('#pName')) === 'Snow Eagle');
  const item = await p.evaluate(() => { const s = slotsOf(g(ps(), 'Inventory'))[0]; return { name: (dbItem(idOf(s)) || {}).name, id: idOf(s) }; });
  r = await find(item.name); console.log(item, r.slice(0, 4));
  const k = r.findIndex((t) => /^Item/.test(t) && t.includes('Exosuit cargo'));
  ok('find an item in an inventory', k >= 0);
  await p.click(`#findRes [data-k="${k}"]`); await p.waitForTimeout(500);
  ok('jumps to its slot', await p.evaluate(() => S.section === 'exosuit' && !!document.querySelector('.cell.sel')));
  r = await find('ZarkinFrood'); await p.click(`#findRes [data-k="${r.length - 1}"]`); await p.waitForTimeout(800);
  ok('the last result searches raw data', await p.evaluate(() => S.section === 'raw' && S.raw.hits && S.raw.hits.length > 0));
  await p.keyboard.press('Control+k'); ok('Ctrl+K focuses the box', await p.evaluate(() => document.activeElement.id === 'findBox'));
  await p.keyboard.press('Escape');

  // ---- save and open again
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }).catch(() => {});
  const dlg = await p.$('#dlg[open]'); if (dlg) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }); }
  await open();
  const re = await p.evaluate(() => ({ preset: enumVal(g(difficultyState(), 'Preset')), meta: S.save.meta.info.difficultyPreset, tut: g(difficultyState(), 'Settings', 'TutorialEnabled'), tra: statValue('TRA_STANDING'), base: str(g(g(ps(), 'PersistentPlayerBases')[0], 'Name')), bases: g(ps(), 'PersistentPlayerBases').length,
    pet: str(g(g(ps(), 'Pets')[0], 'CustomName')), frig: str(g(g(ps(), 'FleetFrigates')[0], 'CustomName')), prods: g(ps(), 'KnownProducts').length, tech: g(ps(), 'KnownTech').length, words: g(ps(), 'KnownWordGroups').length }));
  console.log(JSON.stringify(re), JSON.stringify(before));
  ok('difficulty saved, with the preset in the meta file', re.preset === 'Survival' && re.meta === 5 && re.tut === true);
  ok('standing, base, companion and frigate saved', re.tra === 250 && re.base === 'Gas Display II' && re.bases === before.bases - 1 && re.pet === 'Noodle' && re.frig === 'Sunrise');
  ok('blueprints kept, words added', re.prods === before.prods && re.tech === before.tech && re.words > before.words);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  for (const s of ['difficulty', 'knowledge', 'companions']) { await p.evaluate((x) => go(x), s); await p.waitForTimeout(300); await shot(s + '-dark'); }
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
