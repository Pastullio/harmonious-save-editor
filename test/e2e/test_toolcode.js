const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path');
// Multi-tool share codes and the Add a multi-tool window (owner 2026-11-23). Runs on the synthetic fixture in the browser
// build, with two multi-tools made here (the fixture has none) and four empty slots.
// Usage: node test/e2e/test_toolcode.js <dir with the synthetic fixture from test/make_fixture.py>   (SHOTS=<dir> for pictures)
const FX = process.argv[2]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../dist/nms-save-editor.html'));
  await p.setInputFiles('#filePick', [path.join(FX, 'save3.hg'), path.join(FX, 'mf_save3.hg')]); await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(() => {
    const tool = (name, file, seed, cls, tech) => fromPlain(C.parseJSON(JSON.stringify({ Layout: { Slots: 24, Seed: [true, '0x1'], Level: 1 },
      Store: { Slots: tech.map((id, k) => ({ Type: { InventoryType: 'Technology' }, Id: id, Amount: 100, MaxAmount: 100, DamageFactor: 0, FullyInstalled: true, AddedAutomatically: false, Index: { X: k, Y: 0 } })),
        ValidSlotIndices: Array.from({ length: 24 }, (_, k) => ({ X: k % 8, Y: Math.floor(k / 8) })), Class: { InventoryClass: cls }, SubstanceMaxStorageMultiplier: 1, ProductMaxStorageMultiplier: 1, BaseStatValues: [], SpecialSlots: [], Width: 8, Height: 3, IsCool: false, Name: '', Version: 1 },
      Seed: [true, seed], Name: name, Resource: { Filename: file, Seed: [true, seed], AltId: '', ProceduralTexture: { Samplers: [] } }, UseLegacyColours: false, IsLarge: false, PrimaryMode: 'BOLT', SecondaryMode: 'NONE' })));
    const W = 'MODELS/COMMON/WEAPONS/MULTITOOL/';
    const a = tool('Old Reliable', W + 'MULTITOOL.SCENE.MBIN', '0xABCDEF0123456789', 'A', ['^LASER', '^BOLT', '^SCAN1']), c = tool('Crown', W + 'ROYALMULTITOOL.SCENE.MBIN', '0x1122334455667788', 'S', ['^LASER']);
    set(ps(), 'Multitools', [a, c, blankEntity(a), blankEntity(a), blankEntity(a), blankEntity(a)]); set(ps(), 'ActiveMultioolIndex', N(0));
  });
  ok('the test save has two multi-tools and four empty slots', await p.evaluate(() => tools().length === 2 && g(ps(), 'Multitools').length === 6));
  const r = await p.evaluate(async () => {
    const t = { name: 'Old Reliable', scene: 'MODELS/COMMON/WEAPONS/MULTITOOL/MULTITOOL.SCENE.MBIN', seed: '0xabcdef0123456789', cls: 'A', legacy: true, picks: { _Barrel_: '_Barrel_C', _Stock_: '_Stock_A|_Stock_B' } };
    const code = await toolCodeMake(t), back = await toolCodeRead('look at this\n```\n' + code + '\n```');
    const err = async (x) => { try { await toolCodeRead(x); return ''; } catch (e) { return e.message; } };
    const mk = async (doc) => 'HDM1:' + btoa(String.fromCharCode(...new Uint8Array(await new Response(new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()))).replace(/=+$/, '');
    return { code, len: code.length, back, none: await toolCodeRead('HDT1:abcdefgh a traveller code, not a tool'), cut: await err(code.slice(0, -12)), newer: await err(code.replace('HDM1:', 'HDM7:')),
      npc: await err(await mk({ v: 1, n: 'x', m: 'MODELS/COMMON/WEAPONS/MULTITOOL/STAFFNPCMULTITOOL.SCENE.MBIN', s: '0x1' })), badSeed: await err(await mk({ v: 1, n: 'x', m: 0, s: 'DROP TABLE' })),
      badPath: await err(await mk({ v: 1, n: 'x', m: '../../secrets.SCENE.MBIN', s: '0x1' })), custom: (await toolCodeRead(await mk({ v: 1, n: '<i>Mod</i>', m: 'MODELS/COMMON/WEAPONS/MULTITOOL/NEWTOOL.SCENE.MBIN', s: '0x2', c: 'Z', p: { 'bad key!': 'x', _Ok_: '_Ok_A' } }))) };
  });
  console.log('     code length: ' + r.len + ' characters');
  ok('a multi-tool survives the round trip (name, model, seed, class, old colours, part picks)', r.back.name === 'Old Reliable' && /MULTITOOL\/MULTITOOL\.SCENE/.test(r.back.scene) && r.back.seed === '0xABCDEF0123456789' && r.back.cls === 'A' && r.back.legacy === true && r.back.picks._Barrel_ === '_Barrel_C' && r.back.picks._Stock_ === '_Stock_A|_Stock_B' && r.back.type === 'Standard');
  ok('the code is short and plain (letters, digits, + and /)', r.len < 400 && /^HDM1:[A-Za-z0-9+/]+$/.test(r.code));
  ok('a traveller code is not taken for a multi-tool', r.none === null);
  ok('a cut-off code and a newer one are refused with a plain reason', /cut off or damaged/.test(r.cut) && /newer DryDock/.test(r.newer));
  ok('the NPC staff, which breaks a save, is refused', /NPC staff/.test(r.npc));
  ok('a seed or a model path that isn\'t one is refused', /isn't a multi-tool/.test(r.badSeed) && /isn't a multi-tool/.test(r.badPath));
  ok('a model DryDock doesn\'t list still comes through, cleaned up', r.custom.name === 'Mod' && r.custom.cls === 'C' && r.custom.type === 'Newtool' && JSON.stringify(r.custom.picks) === '{"_Ok_":"_Ok_A"}');
  // Share on a multi-tool's page
  await p.evaluate(() => { S.pick.tool = 0; go('tools'); }); await p.waitForSelector('[data-k="share"]'); await p.click('[data-k="share"]');
  await p.waitForFunction(() => document.querySelector('#dlg').open && /^Share /.test(document.querySelector('#dlgTitle').textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  const mine = await p.evaluate((c) => toolCodeRead(c), clip);
  ok('Share copies this tool\'s code in a code block', /^```\nHDM1:[A-Za-z0-9+/]+\n```$/.test(clip) && mine.name === 'Old Reliable' && mine.seed === '0xABCDEF0123456789' && mine.cls === 'A');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'toolcode-share.png') });
  await p.click('#dlgX');
  // someone else's tool arrives as a code: Add a multi-tool
  const theirs = await p.evaluate(() => toolCodeMake({ name: 'Star Lance', scene: 'MODELS/COMMON/WEAPONS/MULTITOOL/SENTINELMULTITOOL.SCENE.MBIN', seed: '0x0FEDCBA987654321', cls: 'S', legacy: false, picks: {} }));
  await p.evaluate((c) => navigator.clipboard.writeText('```\n' + c + '\n```'), theirs);
  await p.click('#addTool'); await p.waitForFunction(() => document.querySelector('#dlg').open && document.querySelector('#dlgTitle').textContent === 'Add a multi-tool');
  ok('the Add window has its four ways', (await p.$$eval('#dlgBody [data-tab]', (l) => l.map((x) => x.textContent).join('|'))) === 'From a share code|Copy one of mine|Build a staff|Pick the parts');
  ok('…says which slot it goes in', /It goes in slot 3/.test(await p.textContent('#dlgBody')));
  ok('a code on the clipboard is already in the paste box', /HDM1:/.test(await p.inputValue('#atPaste')));
  await p.click('#atKeep'); await p.waitForSelector('#atView [data-at="add"]');
  ok('Add lists the tool with its type, class and seed', (await p.textContent('.st-item.on b')) === 'Star Lance' && /Sentinel, S class, seed 0x0FEDCBA987654321/.test(await p.textContent('#atView')));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'toolcode-add.png') });
  await p.selectOption('#atDonor', '0'); await p.click('#atView [data-at="add"]'); await p.waitForTimeout(300);
  const added = await p.evaluate(() => { const t = g(ps(), 'Multitools')[2], d = g(ps(), 'Multitools')[0]; return { name: str(g(t, 'Name')), file: str(g(t, 'Resource', 'Filename')), seed: JSON.stringify(g(t, 'Seed')), rseed: JSON.stringify(g(t, 'Resource', 'Seed')), cls: invClass(g(t, 'Store')), tech: g(t, 'Store', 'Slots').length, donorTech: g(d, 'Store', 'Slots').length, donorName: str(g(d, 'Name')), donorSeed: str(g(d, 'Seed')[1]), n: tools().length, dirty: S.dirty, pick: S.pick.tool, open: document.querySelector('#dlg').open }; });
  ok('Add to my save puts it in the first empty slot with the shared model, seed, name and class', added.name === 'Star Lance' && /SENTINELMULTITOOL\.SCENE/.test(added.file) && added.seed === '[true,"0x0FEDCBA987654321"]' && added.rseed === added.seed && added.cls === 'S' && added.n === 3);
  ok('…with the technology of the tool it was copied from, which is itself untouched', added.tech === 3 && added.donorTech === 3 && added.donorName === 'Old Reliable' && added.donorSeed === '0xABCDEF0123456789');
  ok('…nothing is written until Save to game, and the new tool is opened', added.dirty && added.pick === 2 && !added.open);
  // the other tabs
  await p.click('#addTool'); await p.waitForSelector('#dlg[open] [data-tab="copy"]');
  ok('the shared tool is kept in the list for next time', (await p.$$('.st-item')).length === 1);
  await p.click('[data-tab="staff"]'); ok('Build a staff says what it needs', /Not built yet/.test(await p.textContent('[data-pane="staff"]')) && !(await p.$eval('[data-pane="staff"]', (x) => x.hidden)) && (await p.$eval('[data-pane="code"]', (x) => x.hidden)));
  await p.click('[data-tab="parts"]'); ok('Pick the parts says why it isn\'t possible yet', /seed/.test(await p.textContent('[data-pane="parts"]')) && !(await p.$eval('[data-pane="parts"]', (x) => x.hidden)));
  await p.click('[data-tab="copy"]'); await p.selectOption('#addWhat', '1'); await p.click('#atCopy'); await p.waitForTimeout(300);
  ok('Copy one of mine still adds a copy', await p.evaluate(() => str(g(g(ps(), 'Multitools')[3], 'Name')) === 'Crown copy' && tools().length === 4));
  // all slots in use
  await p.evaluate(() => { const l = g(ps(), 'Multitools'); l[4] = cloneJSON(l[0]); l[5] = cloneJSON(l[0]); });
  await p.click('#addTool'); await p.waitForSelector('#dlg[open] [data-tab="copy"]');
  ok('with every slot in use it says so and the add buttons are off', /All 6 multi-tool slots are in use/.test(await p.textContent('#dlgBody')) && await p.$eval('#atCopy', (x) => x.disabled));
  await p.click('#dlgX');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
