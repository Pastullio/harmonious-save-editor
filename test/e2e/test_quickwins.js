const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Custom covers kept on disk (and moved there from the browser profile), the turntable on cover cards, and drag-box
// selection in inventory grids. Usage: node test/e2e/test_quickwins.js <scratch dir with dbroot/NMS holding a real save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'qwcfg'), home = path.join(SP, 'qwhome'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', SP + '/dbroot/NMS', '-port', '47992'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForTimeout(600); };
  await open();
  const coverDir = () => { const f = []; (function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (/Covers/.test(q)) f.push(q); } })(home); return f; };
  // a picture chosen in the app goes to the Covers folder
  const png = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#36d6c3'; x.fillRect(0, 0, 64, 64); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); return setCustomCover('test|one', blob); });
  console.log(coverDir());
  ok('a custom cover is written to the Dock Yard Covers folder', png && coverDir().some((f) => /\.png$/.test(f)) && coverDir().some((f) => /covers\.json$/.test(f)));
  // one left in the browser profile by an older version moves to disk on the next start
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 32; const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await IDB.put('cover:test|old', blob); });
  await open(); await p.waitForTimeout(800);
  const moved = await p.evaluate(async () => ({ idb: await IDB.get('cover:test|old'), one: !!(await customCover('test|one')), old: !!(await customCover('test|old')) }));
  ok('covers from the browser profile move to disk', !moved.idb && moved.one && moved.old && coverDir().filter((f) => /\.png$/.test(f)).length === 2);
  await p.evaluate(() => setCustomCover('test|one', null));
  ok('and can be removed', coverDir().filter((f) => /\.png$/.test(f)).length === 1);
  // turntable: hovering the current ship's card turns its model
  const shot = () => p.$eval('#tcShip canvas', (c) => c.toDataURL());
  const has = await p.$('#tcShip canvas');
  if (has) { const a = await shot(); await p.hover('#tcShip .tc-art'); await p.waitForTimeout(700); const b2 = await shot(); ok('cover cards turn while hovered', a !== b2); await p.mouse.move(5, 5); }
  else console.log('SKIP turntable (the current ship has a picture or render)');
  // drag a box over empty slots to select them
  await p.evaluate(() => { try { localStorage.setItem('hse-invtab', 'all'); } catch (_) {} go('exosuit'); }); await p.waitForSelector('.inv');
  const cells = await p.$$('section.inv .grid .cell:not(.has)');
  if (cells.length >= 2) {
    const r1 = await cells[0].boundingBox(), r2 = await cells[Math.min(cells.length - 1, 3)].boundingBox();
    await p.mouse.move(r1.x + 8, r1.y + 8); await p.mouse.down(); await p.mouse.move(r2.x + r2.width - 8, r2.y + r2.height - 8, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
    const n = await p.evaluate(() => (S.sel ? S.sel.keys.size : 0)); console.log('selected', n);
    ok('a drag box selects a block of slots', n >= 2 && !!(await p.$('.insp-slot .inspector, .insp-slot .bulk, .insp-slot *')));
  } else console.log('SKIP drag box (no empty slots)');
  await p.screenshot({ path: SP + '/shots/qw-band.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
