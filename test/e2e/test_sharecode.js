const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path');
// Traveller share codes (owner 2026-11-23): a traveller's look as a text code to post in Discord, read back from a
// pasted message, kept under Shared travellers. Runs on the synthetic fixture in the browser build (no game files, so
// no model or picture; test_traveller.js covers building travellers).
// Usage: node test/e2e/test_sharecode.js <dir with the synthetic fixture from test/make_fixture.py>   (SHOTS=<dir> for pictures)
const FX = process.argv[2]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../dist/nms-save-editor.html'));
  await p.setInputFiles('#filePick', [path.join(FX, 'save3.hg'), path.join(FX, 'mf_save3.hg')]); await p.waitForSelector('#app:not(.hidden)');
  // a traveller the size of a real one: 14 part groups, 22 colours, 6 texture choices
  const T = { name: 'Pastullio', groups: ['^HEAD_VYK4', '^TORSO_VYK', '^LEGS_VYK2', '^HANDS_VYKEEN', '^BOOTS_VYK1', '^BACKPACK_KORV', '^ARMOUR_GEK3', '^HELMET_ASTRO2', '^CAPE_SMUGGLER', '^SHOULDERS_EXP4', '^BELT_TRADER', '^VISOR_ANOMALY', '^GLOVES_FOURTH', '^SKIRT_ATLAS'],
    look: { c: Array.from({ length: 22 }, (_, k) => ({ p: ['Custom_Head', 'Custom_Torso', 'Custom_Legs', 'Custom_Hands', 'Custom_Backpack', 'Custom_Cape'][k % 6], a: ['Primary', 'Alternative1', 'Alternative2', 'Alternative3', 'Unique'][k % 5], c: [0.1234567 + k / 40, 0.7654321 - k / 50, 0.3333333, 1] })),
      t: [['HEAD_TEX', 'VYK_SCALES2'], ['TORSO_TEX', 'CLOTH_WORN'], ['LEGS_TEX', 'PLATES'], ['CAPE_TEX', 'STRIPES_B'], ['BACKPACK_TEX', 'DECAL_4'], ['VISOR_TEX', 'GLOW']] } };
  const r = await p.evaluate(async (T) => {
    const code = await travCodeMake(T), back = await travCodeRead(code);
    const near = (a, b) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 1e-4);
    const same = back.name === T.name && JSON.stringify(back.groups) === JSON.stringify(T.groups) && JSON.stringify(back.look.t) === JSON.stringify(T.look.t) && back.look.c.length === T.look.c.length && back.look.c.every((x, k) => x.p === T.look.c[k].p && x.a === T.look.c[k].a && near(x.c, T.look.c[k].c));
    const wrapped = await travCodeRead('check out my traveller!\n```\n' + code + '\n```\nposted by someone');
    const none = await travCodeRead('just a normal message with no code');
    const err = async (t) => { try { await travCodeRead(t); return ''; } catch (e) { return e.message; } };
    const evil = 'HDT1:' + btoa(String.fromCharCode(...new Uint8Array(await new Response(new Blob([JSON.stringify({ v: 1, n: 'x', g: ['../../etc', 'A&look=1'] })]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())));
    const tagged = 'HDT1:' + btoa(String.fromCharCode(...new Uint8Array(await new Response(new Blob([JSON.stringify({ v: 1, n: '<b>Bad</b>/name', g: ['HEAD_A'] })]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()))).replace(/=+$/, '');
    return { code, len: code.length, same, wrapped: !!wrapped && wrapped.code === code, none, cut: await err(code.slice(0, code.length - 40)), newer: await err(code.replace('HDT1:', 'HDT9:')), evil: await err(evil), tagName: (await travCodeRead(tagged)).name, chars: /^HDT1:[A-Za-z0-9+/]+$/.test(code) };
  }, T);
  console.log('     code length for a full traveller: ' + r.len + ' characters');
  ok('a traveller survives the round trip (name, parts, colours, texture choices)', r.same);
  ok('the code uses only letters, digits, + and / (nothing Discord\'s formatting eats)', r.chars);
  ok('a full traveller fits in one Discord message', r.len + 8 <= 2000);
  ok('the code is found inside a pasted message', r.wrapped);
  ok('a message without a code gives nothing', r.none === null);
  ok('a cut-off code is refused with a plain reason', /cut off or damaged/.test(r.cut));
  ok('a code from a newer version says to update', /newer DryDock/.test(r.newer));
  ok('part names that aren\'t plain words are refused', /isn't a traveller/.test(r.evil));
  ok('a name loses tags and file-name characters', r.tagName === 'Badname');
  // Share: the save's own traveller
  await p.evaluate((T) => { window.travellerGroups = () => T.groups; window.travellerLook = () => T.look; window.travellerName = () => T.name; }, T);
  p.evaluate(() => travellerShareCode()).catch(() => {});
  await p.waitForFunction(() => document.querySelector('#dlg').open && /^Share /.test(document.querySelector('#dlgTitle').textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok('Share copies the code in a code block', clip === '```\n' + r.code + '\n```' && (await p.inputValue('#tsCode')) === clip);
  ok('…and says it fits in one Discord message', /Fits in one Discord message/.test(await p.textContent('#dlgBody')));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'sharecode-share.png') });
  await p.click('#dlgX');
  // Shared travellers: the code on the clipboard is offered, Add keeps it
  p.evaluate(() => sharedTravellersDialog()).catch(() => {});
  await p.waitForFunction(() => document.querySelector('#dlg').open && document.querySelector('#dlgTitle').textContent === 'Shared travellers');
  ok('a code on the clipboard is already in the paste box', (await p.inputValue('#stPaste')) === clip);
  await p.click('#stAdd'); await p.waitForSelector('.st-item.on');
  ok('Add lists the traveller by name and opens it', (await p.textContent('.st-item.on b')) === 'Pastullio' && /14 parts, 22 colours/.test(await p.textContent('#stView')));
  ok('…with Use in Blender, Export, Copy the code and Remove', (await p.$$eval('#stView [data-st]', (l) => l.map((x) => x.textContent).join('|'))) === 'Use in Blender|Export for Blender (.glb)|Copy the code|Remove');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'sharecode-shared.png') });
  await p.fill('#stPaste', clip); await p.click('#stAdd'); await p.waitForTimeout(200);
  ok('the same code isn\'t added twice', (await p.$$('.st-item')).length === 1);
  await p.fill('#stPaste', 'hello'); await p.click('#stAdd'); await p.waitForTimeout(200);
  ok('text without a code is turned away', /No share code/.test(await p.textContent('#toast')));
  await p.click('#dlgX');
  ok('it is kept for next time', await p.evaluate(() => sharedTravs().length === 1 && sharedTravs()[0].name === 'Pastullio'));
  p.evaluate(() => sharedTravellersDialog()).catch(() => {}); await p.waitForSelector('.st-item'); await p.click('.st-item'); await p.waitForSelector('#stView [data-st="remove"]'); await p.click('#stView [data-st="remove"]');
  ok('Remove takes it out', await p.evaluate(() => sharedTravs().length === 0));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
