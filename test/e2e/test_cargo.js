const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Cargo page (where is everything, gather, consolidate) and drag and drop between slots, on a copy of a real save
// that is saved and opened again. Nothing may be created or lost: every item's total across all inventories stays the same.
// Usage: node test/e2e/test_cargo.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'cgcfg'), root = path.join(SP, 'cgroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const LIB = path.join(SP, 'itemlibcfg/HarmoniousSaveEditor/itemlib'); if (fs.existsSync(LIB)) fs.cpSync(LIB, path.join(cfg, 'HarmoniousSaveEditor/itemlib'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47988'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_GAME: SP + '/fakebanks' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  await open();
  // totals per item over every inventory (cargo and technology), plus sanity of every grid
  const census = () => p.evaluate(() => {
    const tot = {}, bad = [];
    for (const inv of allInvs()) {
      const seen = new Set(), valid = validSet(inv);
      for (const s of slotsOf(inv)) {
        const k = posOf(s).join(','); if (seen.has(k)) bad.push('two items in one slot ' + k); seen.add(k);
        if (!valid.has(k)) bad.push('item in a locked slot ' + k);
        if (typeOf(s) !== 'Technology') { if (num(g(s, 'Amount')) > num(g(s, 'MaxAmount'))) bad.push('over the stack limit ' + idOf(s)); tot[idOf(s)] = (tot[idOf(s)] || 0) + num(g(s, 'Amount')); }
        else tot[idOf(s)] = (tot[idOf(s)] || 0) + 1;
      }
    }
    return { tot, bad, stacks: allInvs().reduce((t, inv) => t + slotsOf(inv).length, 0) };
  });
  const same = (a, b) => JSON.stringify(Object.entries(a).filter(([, v]) => v).sort()) === JSON.stringify(Object.entries(b).filter(([, v]) => v).sort());
  const c0 = await census(); console.log('stacks', c0.stacks, 'problems already in the save', c0.bad.length);
  await p.evaluate(() => go('cargo')); await p.waitForSelector('.cargo-row');
  ok('every item listed with its total', (await p.$$eval('.cargo-row', (x) => x.length)) > 20);
  await p.screenshot({ path: SP + '/shots/cg-0-where.png' });
  // gather the item with the most stacks into the freighter
  const pick = await p.evaluate(() => { const m = {}; for (const pl of cargoPlaces()) for (const s of slotsOf(pl.inv)) if (typeOf(s) !== 'Technology') m[idOf(s)] = (m[idOf(s)] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]; });
  await p.fill('#cgQ', pick.replace('^', '')); await p.waitForTimeout(150);
  await p.click(`.cargo-row[data-id="${pick}"]`); await p.waitForSelector('#cgGather');
  await p.screenshot({ path: SP + '/shots/cg-1-item.png' });
  const stacksOf = (id) => p.evaluate((id) => cargoPlaces().reduce((t, pl) => t + slotsOf(pl.inv).filter((s) => idOf(s) === id).length, 0), id);
  const nBefore = await stacksOf(pick);
  await p.selectOption('#cgTo', { label: 'Freighter cargo' }); await p.click('#cgGather'); await p.waitForTimeout(300);
  console.log(await p.textContent('#toast'), nBefore, await stacksOf(pick));
  const c1 = await census();
  const where = await p.evaluate((id) => cargoPlaces().filter((pl) => slotsOf(pl.inv).some((s) => idOf(s) === id)).map((pl) => pl.label), pick);
  console.log(pick, where);
  ok('gather keeps every amount', same(c0.tot, c1.tot) && c1.bad.length <= c0.bad.length);
  ok('and brings the stacks together', where.includes('Freighter cargo') && (await stacksOf(pick)) < nBefore);
  // consolidate into the exosuit cargo
  await p.click('.ed-tabs [data-t="tidy"]'); await p.waitForSelector('#tdDest');
  await p.selectOption('#tdDest', { label: 'Exosuit cargo' }); await p.waitForTimeout(200);
  const rows = await p.$$eval('.tidy-row', (x) => x.length); console.log(rows + ' plan rows');
  await p.screenshot({ path: SP + '/shots/cg-2-plan.png', fullPage: true });
  const skipped = await p.$eval('.tidy-row input', (c) => c.dataset.skip);
  const before = await p.evaluate((id) => cargoPlaces().map((pl) => slotsOf(pl.inv).filter((s) => idOf(s) === id).map((s) => num(g(s, 'Amount'))).join('+')).join('|'), skipped);
  await p.click('.tidy-row input'); await p.waitForTimeout(200);
  if (await p.$('#tdGo:not([disabled])')) await p.click('#tdGo'); await p.waitForTimeout(300);
  const c2 = await census();
  ok('consolidate keeps every amount and every grid valid', same(c0.tot, c2.tot) && c2.bad.length <= c0.bad.length);
  ok('fewer stacks than before', c2.stacks < c1.stacks);
  ok('an unticked item is left alone', (await p.evaluate((id) => cargoPlaces().map((pl) => slotsOf(pl.inv).filter((s) => idOf(s) === id).map((s) => num(g(s, 'Amount'))).join('+')).join('|'), skipped)) === before);
  // drag and drop on the exosuit page
  await p.evaluate(() => { try { localStorage.setItem('hse-invtab', 'all'); } catch (_) {} go('exosuit'); }); await p.waitForSelector('.inv');
  const blocks = await p.$$eval('section.inv h3', (x) => x.map((h) => h.textContent.trim()));
  console.log(blocks);
  const ci = blocks.findIndex((t) => /^Cargo/.test(t)), ti = blocks.findIndex((t) => /^Technology/.test(t));
  const cell = async (bi, q) => (await p.$$('section.inv'))[bi].$(q);
  const xy = async (h) => h.evaluate((c) => [+c.dataset.x, +c.dataset.y]);
  const drag = async (a, b) => {
    await p.evaluate(([s, d]) => { const dt = new DataTransfer(); s.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); d.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); s.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })); }, [a, b]);
    await p.waitForTimeout(300); };
  let a = await cell(ci, '.cell.has'), e = await cell(ci, '.cell:not(.has):not(.locked)');
  const eXY = await xy(e); await drag(a, e);
  ok('drag a stack into an empty slot', await p.evaluate(([x, y]) => !!slotAt(g(ps(), 'Inventory'), x, y), eXY) && same(c0.tot, (await census()).tot));
  a = await cell(ci, '.cell.has'); const tcell = await cell(ti, '.cell:not(.locked)');
  await drag(a, tcell);
  console.log('toast:', await p.textContent('#toast'));
  ok('cargo refused in a technology grid', /technology/i.test(await p.textContent('#toast')) && same(c0.tot, (await census()).tot));
  const ths = await (await p.$$('section.inv'))[ti].$$('.cell.has');
  const p0 = await xy(ths[0]), p1 = await xy(ths[1]);
  const ids = await p.evaluate(([p0, p1]) => [p0, p1].map(([x, y]) => idOf(slotAt(g(ps(), 'Inventory_TechOnly'), x, y))), [p0, p1]);
  await drag(ths[0], ths[1]);
  ok('technology swaps places within its grid', await p.evaluate(([p0, p1, ids]) => idOf(slotAt(g(ps(), 'Inventory_TechOnly'), ...p0)) === ids[1] && idOf(slotAt(g(ps(), 'Inventory_TechOnly'), ...p1)) === ids[0], [p0, p1, ids]));
  await p.screenshot({ path: SP + '/shots/cg-3-exosuit.png' });
  const c3 = await census();
  // save, open again
  await p.click('#saveBtn'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }).catch(() => {});
  const dlg = await p.$('#dlg[open]'); if (dlg) { await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 60000 }); }
  await open();
  const c4 = await census();
  ok('saved and opened again with nothing gained or lost', same(c0.tot, c4.tot) && c4.stacks === c3.stacks && c4.bad.length <= c0.bad.length);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
