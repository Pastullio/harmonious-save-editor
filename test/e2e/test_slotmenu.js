// Right-click on inventory slots (owner, 2026-11-03): a menu for a filled slot, an empty one, a locked one and a selection.
// Usage: node test/e2e/test_slotmenu.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'menutest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48105'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.evaluate(() => { localStorage.setItem('hse-invtab', 'all'); go('exosuit'); }); await p.waitForTimeout(800);
  const inv = () => p.evaluate(() => slotsOf(g(ps(), 'Inventory')).length);
  const menu = () => p.$$eval('#ctxMenu button, #ctxMenu .ctx-h', (bs) => bs.map((x) => x.textContent));
  // the slot inspector floats over the grid, so it's closed before right-clicking another slot (as a player would)
  const cell = async (sel, keep) => { const h = await p.evaluateHandle(([s, k]) => { if (!k) closeInspector(); const c = document.querySelector(s); c.scrollIntoView({ block: 'center' }); return c; }, [sel, !!keep]); return h; };
  const click = async (label) => { const bs = await p.$$('#ctxMenu button'); for (const x of bs) if ((await x.textContent()).startsWith(label)) { await x.click(); return true; } return false; };
  // a filled slot
  const n0 = await inv();
  let c = await cell('[data-t="Cargo"] .cell.has'); await c.click({ button: 'right' }); await p.waitForSelector('#ctxMenu');
  const m1 = await menu(); console.log(m1);
  ok('a filled slot offers fill, copy, duplicate, move and remove', ['Fill stack', 'Copy', 'Duplicate', 'Remove'].every((l) => m1.some((t) => t.startsWith(l))) && m1.includes('Move to'));
  await click('Duplicate'); await p.waitForTimeout(300);
  ok('Duplicate adds a copy in the next empty slot', (await inv()) === n0 + 1 && !(await p.$('#ctxMenu')));
  // copy, then paste into an empty slot
  c = await cell('[data-t="Cargo"] .cell.has'); await c.click({ button: 'right' }); await p.waitForSelector('#ctxMenu'); await click('Copy');
  const freeKey = await p.evaluate(() => { const inv = g(ps(), 'Inventory'), ok = validSet(inv); const e = [...document.querySelectorAll('[data-t="Cargo"] .cell:not(.has):not(.locked)')].find((x) => ok.has(x.dataset.x + ',' + x.dataset.y)); return e && [e.dataset.x, e.dataset.y]; });
  c = await cell(`[data-t="Cargo"] .cell[data-x="${freeKey[0]}"][data-y="${freeKey[1]}"]`); await c.click({ button: 'right' }); await p.waitForSelector('#ctxMenu');
  const m2 = await menu(); console.log(m2);
  ok('an empty slot offers adding and pasting', m2.some((t) => t.startsWith('Add an item')) && m2.some((t) => t.startsWith('Paste')));
  await click('Paste'); await p.waitForTimeout(300);
  ok('Paste puts the copied item in that slot', (await inv()) === n0 + 2 && await p.evaluate(([x, y]) => !!slotAt(g(ps(), 'Inventory'), +x, +y), freeKey));
  // Escape closes the menu
  c = await cell('[data-t="Cargo"] .cell.has'); await c.click({ button: 'right' }); await p.waitForSelector('#ctxMenu'); await p.keyboard.press('Escape');
  ok('Escape closes the menu', !(await p.$('#ctxMenu')));
  // a selection of two: remove both
  const two = await p.evaluate(() => { const inv = g(ps(), 'Inventory'), s = slotsOf(inv).slice(-2).map(posOf); S.sel = { inv, keys: new Set(s.map((q) => q.join(','))), anchor: s[0] }; render(); return s; });
  await p.waitForTimeout(400);
  c = await cell(`[data-t="Cargo"] .cell[data-x="${two[0][0]}"][data-y="${two[0][1]}"]`, true); await c.click({ button: 'right', force: true }); await p.waitForSelector('#ctxMenu');
  const m3 = await menu(); console.log(m3);
  ok('a selection gets a menu for all of it', m3.some((t) => /2 slots selected/i.test(t)) && m3.some((t) => t.startsWith('Remove 2 items')));
  await click('Remove 2 items'); await p.waitForTimeout(300);
  ok('Remove takes every selected item', (await inv()) === n0);
  // technology: supercharge from the menu
  await p.evaluate(() => { S.sel = null; render(); }); await p.waitForTimeout(500);
  c = await cell('[data-t="Technology"] .cell.has'); await c.click({ button: 'right' }); await p.waitForSelector('#ctxMenu');
  const m4 = await menu(); console.log(m4);
  ok('technology offers Recharge and Supercharge', m4.some((t) => t.startsWith('Recharge')) && m4.some((t) => /supercharge/i.test(t)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
