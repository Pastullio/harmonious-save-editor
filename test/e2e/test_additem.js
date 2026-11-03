const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Adding items to an empty slot by searching their name (owner, 2026-11-03): click a slot, type, Enter or click, and the
// item goes in as a full stack of the right size; technology grids only offer technology.
// Usage: node test/e2e/test_additem.js <scratch dir with dbroot/NMS holding a real save> [item library folder]
const SP = process.argv[2], LIB = process.argv[3] || path.join(SP, 'itemlibcfg/HarmoniousSaveEditor/itemlib');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'addcfg'), root = path.join(SP, 'addroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  if (fs.existsSync(LIB)) fs.cpSync(LIB, path.join(cfg, 'HarmoniousSaveEditor/itemlib'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47982'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_GAME: SP + '/fakebanks' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForFunction(() => S.db && S.db.src === 'lib', null, { timeout: 120000 });
  await p.evaluate(() => { localStorage.setItem('hse-invtab', 'all'); go('exosuit'); }); await p.waitForTimeout(800);
  // an empty cargo slot (the cargo grid is the last one shown)
  const before = await p.evaluate(() => slotsOf(g(ps(), 'Inventory')).length);
  // the cargo grid's first empty, unlocked slot
  const free = await p.evaluateHandle(() => { const inv = g(ps(), 'Inventory'), ok = validSet(inv); const box = [...document.querySelectorAll('.inv')].find((i) => /cargo/i.test(i.textContent.slice(0, 80)) && !/old/i.test(i.textContent.slice(0, 40))) || [...document.querySelectorAll('.inv')].pop();
    const c = [...box.querySelectorAll('.cell:not(.has):not(.locked)')].find((e) => ok.has(e.dataset.x + ',' + e.dataset.y)); c.scrollIntoView({ block: 'center' }); return c; });
  const [fx, fy] = await free.evaluate((c) => [+c.dataset.x, +c.dataset.y]);
  await free.click(); await p.waitForSelector('#aQ'); await p.waitForTimeout(200);
  console.log('focus on', await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className)), await p.evaluate(() => !!S.db));
  ok('the search box is ready to type in', await p.evaluate(() => document.activeElement && document.activeElement.id === 'aQ'));
  await p.keyboard.type('carbon'); await p.waitForTimeout(300);
  const names = await p.$$eval('.add-res [data-k]', (bs) => bs.map((x) => x.textContent));
  console.log(names.slice(0, 4));
  ok('cargo search finds items by name, best match first, no technology', /^Carbon/.test(names[0] || '') && !names.some((n) => /Technology,/.test(n)));
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const added = await p.evaluate(([x, y]) => { const s = slotAt(g(ps(), 'Inventory'), x, y); return s && { id: idOf(s), t: typeOf(s), a: num(g(s, 'Amount')), m: num(g(s, 'MaxAmount')) }; }, [fx, fy]);
  console.log(added);
  ok('Enter puts it in that slot as a full stack, the size other substances have here', added && added.id === '^FUEL1' && added.t === 'Substance' && added.a === added.m && added.m > 0
    && await p.evaluate((m) => slotsOf(g(ps(), 'Inventory')).filter((s) => typeOf(s) === 'Substance').some((s) => num(g(s, 'MaxAmount')) === m), added.m));
  ok('one slot more, and the slot is then open to fill or change', (await p.evaluate(() => slotsOf(g(ps(), 'Inventory')).length)) === before + 1 && !!(await p.$('#sFill')));
  // a technology slot only offers technology
  await p.evaluate(() => { S.sel = null; render(); }); await p.waitForTimeout(300);
  const tfree = await p.evaluateHandle(() => { const c = document.querySelector('.inv .cell:not(.has):not(.locked)'); if (c) c.scrollIntoView({ block: 'center' }); return c; });
  if (await tfree.evaluate((c) => !!c)) {
    await tfree.click(); await p.waitForSelector('#aQ'); await p.waitForTimeout(200); await p.fill('#aQ', 'pro'); await p.waitForTimeout(300);
    const tn = await p.$$eval('.add-res [data-k] .add-meta', (bs) => bs.map((x) => x.textContent)); console.log(tn.slice(0, 5), await p.textContent('.inspector .sub'));
    ok('technology slots offer only technology', tn.length > 0 && tn.every((n) => /^Technology/.test(n)));
    await p.click('.add-res [data-k="0"]'); await p.waitForTimeout(300);
    ok('clicking a result adds it too', await p.evaluate(() => !!document.querySelector('#sFill')));
  }
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
