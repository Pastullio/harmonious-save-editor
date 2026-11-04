// Corvette renders stay with their build (owner, 2026-11-04: covers dropped back to the hologram after every change):
// renders are named after the build's shape (no part timestamps), an older render is copied to the new name, and a
// changed build shows its last render while a new one is made.
// Usage: node test/e2e/test_render_keep.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a 2×2 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDEgAUYGBgAqfgL/2mEhSQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const T = path.join(SP, 'rendertest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), cfg = path.join(T, 'cfg'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const covers = path.join(cfg, 'HarmoniousSaveEditor', 'covers'); fs.mkdirSync(covers, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48110'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // part timestamps don't change the name
  const same = await p.evaluate(async () => { const it = coverItems().find((x) => x.kind === 'corvette'); const base = corvetteBase(it.i); const o = g(base, 'Objects')[0]; const before = (await buildPayload({ ...it, _payload: null })).key; set(o, 'Timestamp', N(1234567)); const after = (await buildPayload({ ...it, _payload: null })).key; return before === after; });
  ok('changing part timestamps keeps the render', same);
  const keys = await p.evaluate(async () => { const it = coverItems().find((x) => x.kind === 'corvette'); const k = await buildPayload(it); return { key: k.key, legacy: k.legacy, name: it.name, ik: it.key }; });
  ok('the shape key differs from the old whole-build key', keys.key !== keys.legacy);
  // an old render under the whole-build name, with an extra angle
  fs.writeFileSync(path.join(covers, keys.legacy + '.png'), PNG); fs.writeFileSync(path.join(covers, keys.legacy + '-side.png'), PNG);
  await p.evaluate(() => go('shipwright')); await wait(2500);
  ok('the old render is copied to the new name', fs.existsSync(path.join(covers, keys.key + '.png')) && fs.existsSync(path.join(covers, keys.key + '-side.png')));
  ok('and shown on the corvette', await p.evaluate((k) => !!COVER_MEM.render.get(k), keys.ik));
  // a changed build: its last render stays up
  await p.evaluate(() => { const it = coverItems().find((x) => x.kind === 'corvette'); const base = corvetteBase(it.i); const o = g(base, 'Objects')[0]; const pos = g(o, 'Position'); pos[0] = N(num(pos[0]) + 3); markDirty(); });
  await p.evaluate(() => { COVER_MEM.render.clear(); render(); }); await wait(2500);
  ok('a changed build keeps showing its last render', await p.evaluate((k) => !!COVER_MEM.render.get(k), keys.ik));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
