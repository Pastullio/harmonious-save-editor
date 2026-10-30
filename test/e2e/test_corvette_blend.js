const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
// Shipwright's "Load from a .blend": a corvette .blend (made here from a real build, set in the LiveLink add-on to
// another corvette than the one open) is read through Blender and goes on the corvette it is set to; a base .blend is
// sent to the Bases page. Usage: node test/e2e/test_corvette_blend.js <scratch> <a base .blend, e.g. Lighthouse.blend>
const SP = process.argv[2], BASE_BLEND = path.resolve(process.argv[3]);
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'cblendcfg'), root = path.join(SP, 'cblendroot'), blend = path.join(SP, 'corvette_test.blend'), pickFile = path.join(SP, 'cblend_pick.txt');
  fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // a stand-in file dialog that answers with whatever the test wrote last
  const picker = path.join(SP, 'cblend_pick.sh'); fs.writeFileSync(picker, `#!/bin/sh\ncat '${pickFile}'\n`, { mode: 0o755 });
  fs.writeFileSync(pickFile, blend);
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48014'], { env: { ...process.env, SP, HOME: SP + '/nocharon', XDG_CONFIG_HOME: cfg, HSE_BLENDER: path.join(__dirname, 'fake-blender.sh'), HSE_PICK_FILE: blend } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // the build of one corvette, saved as a .blend set to another corvette; a third corvette is open
  const info = await p.evaluate(() => {
    const cs = ships().filter(({ s, i }) => slotIsCorvette(s) && shipBuild(i)); const [src, to, open] = [cs[0], cs[1], cs[2] || cs[0]];
    return { to: to.i, toName: str(g(to.s, 'Name')), open: open.i, objs: JSON.parse(C.stringifyJSON(toPlain(cloneJSON(g(shipBuild(src.i), 'Objects'))))) };
  });
  fs.writeFileSync(SP + '/cblend_build.json', JSON.stringify(info.objs));
  const made = spawnSync(path.join(SP, 'bpyenv/bin/python'), [path.join(__dirname, 'make_corvette_blend.py'), SP + '/cblend_build.json', blend, String(info.to), info.toName], { encoding: 'utf8', timeout: 300000 });
  ok('the test .blend is made', /MADE/.test(made.stdout));
  await p.evaluate((i) => { (S.wright || (S.wright = { q: '', sel: new Set(), json: false })).slot = i; S.wright.auto = false; go('shipwright'); }, info.open);
  await p.waitForSelector('[data-a="blend"]'); await p.click('[data-a="blend"]');
  await p.waitForFunction(() => /^Load /.test(document.querySelector('#dlgTitle').textContent) && document.querySelector('#dlg').open, null, { timeout: 180000 });
  ok('the corvette the file is set to is chosen, not the open one', (await p.$eval('#blendCorv', (s) => +s.value)) === info.to && new RegExp(`set to <b>${info.toName}</b>`).test(await p.innerHTML('#dlgBody')));
  await p.screenshot({ path: SP + '/shots/corvette-blend-load.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
  const after = await p.evaluate(([to, n]) => { const objs = g(shipBuild(to), 'Objects'); const pl = JSON.parse(C.stringifyJSON(toPlain(cloneJSON(objs)))); return { n: objs.length, pl, dirty: S.dirty, slot: S.wright.slot }; }, [info.to, info.objs.length]);
  const close = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-3);
  const same = after.n === info.objs.length && after.pl.every((o, k) => o.ObjectID === info.objs[k].ObjectID && close(o.Position, info.objs[k].Position) && close(o.Up, info.objs[k].Up) && close(o.At, info.objs[k].At));
  ok('the corvette gets the same parts, in order and in place', same);
  ok('nothing is written until Save to game, and that corvette is opened', after.dirty && after.slot === info.to);
  // a base .blend is pointed at the Bases page
  fs.writeFileSync(pickFile, BASE_BLEND);
  await p.evaluate(() => { const swap = window.api; window.api = (u, o) => (u.startsWith('/api/live/pick') ? Promise.resolve(new Response(JSON.stringify({ file: window.__pick }))) : swap(u, o)); }); await p.evaluate((f) => { window.__pick = f; }, BASE_BLEND);
  await p.click('[data-a="blend"]');
  await p.waitForFunction(() => /This is a base/.test(document.querySelector('#dlgTitle').textContent) && document.querySelector('#dlg').open, null, { timeout: 180000 }).catch(() => {});
  ok('a base .blend is sent to the Bases page', /This is a base/.test(await p.textContent('#dlgTitle')) && /Lighthouse/.test(await p.textContent('#dlgBody')));
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(300);
  ok('and Bases opens on that base', await p.evaluate(() => S.section === 'bases' && str(g(g(ps(), 'PersistentPlayerBases')[S.bases.pick], 'Name')) === 'Lighthouse'));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
