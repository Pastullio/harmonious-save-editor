const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path');
// Shipwright's duplicate parts (owner 2026-11-22): the parts list marks every part that sits exactly on an identical one,
// Show them lists only those, and Remove them takes the extra copies out.
// Usage: node test/e2e/test_duplicates.js <dir with the synthetic fixture from test/make_fixture.py>   (SHOTS=<dir> for pictures)
const FX = process.argv[2]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../dist/nms-save-editor.html'));
  await p.setInputFiles('#filePick', [path.join(FX, 'save3.hg'), path.join(FX, 'mf_save3.hg')]); await p.waitForSelector('#app:not(.hidden)');
  // a corvette with a starter build, then three copies of part 1 (same moment) and one of part 2 (placed later)
  const made = await p.evaluate(() => {
    const list = g(ps(), 'ShipOwnership'), s = list[0];
    if (!Array.isArray(g(ps(), 'PersistentPlayerBases'))) set(ps(), 'PersistentPlayerBases', []);   // the synthetic save has no bases
    set(g(s, 'Resource'), 'Filename', 'MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN'); makeStarterBase(0, 'Dup test');
    const objs = g(shipBuild(0), 'Objects'), n = objs.length;
    for (let k = 0; k < 3; k++) objs.push(cloneJSON(objs[1]));
    const late = cloneJSON(objs[2]); set(late, 'Timestamp', N(num(g(late, 'Timestamp')) + 500)); objs.push(late);
    markDirty(); return n;
  });
  ok('the test corvette has a starter build', made >= 3);
  await p.click('nav button[data-s="shipwright"]'); await p.waitForSelector('.sw-health');
  const line = await p.evaluate(() => { const li = [...document.querySelectorAll('.sw-health li')].find((l) => /identical/.test(l.textContent)); return li ? { t: li.textContent, b: [...li.querySelectorAll('button')].map((x) => x.textContent) } : null; });
  ok('Build check says 4 parts sit on an identical part', !!line && /^4 parts sit exactly on top of an identical part/.test(line.t.trim()));
  ok('…with Show them and Remove them', !!line && line.b.join() === 'Show them,Remove them');
  ok('Tune up keeps its own button', await p.evaluate(() => [...document.querySelectorAll('.sw-health [data-a="tune"]')].every((x) => x.textContent === 'Tune up')));
  ok('Parts starts closed', await p.evaluate(() => !document.querySelector('details.sw-parts').open));
  await p.click('.sw-health [data-a="showdup"]'); await p.waitForTimeout(400);
  const st = await p.evaluate((made) => { const rows = [...document.querySelectorAll('#swRows .sw-row')]; return {
    open: document.querySelector('details.sw-parts').open, n: rows.length, dup: rows.filter((r) => r.classList.contains('dup')).length, first: rows.filter((r) => r.classList.contains('dup-first')).length,
    sel: rows.filter((r) => r.classList.contains('sel')).map((r) => +r.dataset.k), marks: rows.map((r) => (r.querySelector('.sw-dup') || {}).textContent || ''), titles: rows.map((r) => (r.querySelector('.sw-dup') || {}).title || ''),
    box: (document.querySelector('#swOnlyDup') || {}).checked, label: (document.querySelector('.sw-onlydup') || {}).textContent, made }; }, made);
  ok('Show them opens Parts', st.open);
  ok('…and lists only the 4 copies and the 2 parts under them', st.n === 6 && st.dup === 4 && st.first === 2);
  ok('…with the 4 extra copies selected, not the parts under them', st.sel.join() === [made, made + 1, made + 2, made + 3].join());
  ok('a copy says which part it sits on', st.marks.filter((m) => m === 'Copy of 1').length === 3 && st.marks.filter((m) => m === 'Copy of 2').length === 1);
  ok('the part underneath says how many sit on it', st.marks.includes('3 copies on top') && st.marks.includes('1 copy on top'));
  ok('the tooltip tells same-moment copies from later ones', st.titles.filter((t) => /same timestamp/.test(t)).length === 3 && st.titles.filter((t) => /different time/.test(t)).length === 1);
  ok('Only duplicates is ticked and shows the count', st.box === true && /Only duplicates\s*4/.test(st.label));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/duplicates.png' });
  await p.click('#swOnlyDup'); await p.waitForTimeout(150);
  const all = await p.evaluate(() => ({ n: document.querySelectorAll('#swRows .sw-row').length, dup: document.querySelectorAll('#swRows .sw-row.dup').length }));
  ok('unticking it lists every part again, duplicates still marked', all.n === made + 4 && all.dup === 4);
  await p.click('#swOnlyDup'); await p.fill('#swQ', 'zzzz-nothing'); await p.waitForTimeout(150);
  ok('search still narrows the list', await p.evaluate(() => document.querySelectorAll('#swRows .sw-row').length === 0));
  await p.fill('#swQ', ''); await p.waitForTimeout(150);
  // selecting works as before on a marked row
  await p.click('#swRows .sw-row.dup-first'); ok('a click still selects one row', await p.evaluate(() => document.querySelectorAll('#swRows .sw-row.sel').length === 1));
  await p.click('.sw-health [data-a="dedupe"]'); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ n: g(shipBuild(0), 'Objects').length, dup: document.querySelectorAll('#swRows .sw-row.dup, #swRows .sw-row.dup-first').length, box: !!document.querySelector('#swOnlyDup'), warn: [...document.querySelectorAll('.sw-health li')].some((l) => /identical/.test(l.textContent)), rows: document.querySelectorAll('#swRows .sw-row').length }));
  ok('Remove them takes out the 4 extra copies and keeps the parts under them', after.n === made);
  ok('…and nothing is marked, the filter and the warning are gone, every part is listed', after.dup === 0 && !after.box && !after.warn && after.rows === made);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
