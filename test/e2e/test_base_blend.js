const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// Bases from Blender: "Load from a .blend" on the Bases page (read through Blender, put on the base the file names) and
// LiveLink for bases (a Base Builder .blend names its base; the wrong base is asked about).
// Usage: node test/e2e/test_base_blend.js <scratch> <Lighthouse.blend> <SkyDreams.blend>
// (the owner's Base Builder files for two bases in the test save; bpy 4.5 in <scratch>/bpyenv, see CLAUDE.md)
const SP = process.argv[2], RIGHT = path.resolve(process.argv[3]), WRONG = path.resolve(process.argv[4]);
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'bblendcfg'), root = path.join(SP, 'bblendroot');
  fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48011'], { env: { ...process.env, SP, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_BLENDER: path.join(__dirname, 'fake-blender.sh'), HSE_PICK_FILE: RIGHT } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const liveFile = path.join(cfg, 'HarmoniousSaveEditor', 'live.json');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  // open SkyDreams, and take 8 parts off Lighthouse so loading its .blend visibly puts them back
  const before = await p.evaluate(() => {
    const L = playerBases().find(({ b }) => str(g(b, 'Name')) === 'Lighthouse'), K = playerBases().find(({ b }) => str(g(b, 'Name')) === 'SkyDreams');
    const objs = g(L.b, 'Objects'), stamps = objs.map((o) => num(g(o, 'Timestamp'))).sort().join(); objs.splice(0, 8);
    S.bases = { tab: 'bases', pick: K.i }; go('bases'); return { L: L.i, K: K.i, n: objs.length, stamps };
  });
  await p.waitForSelector('[data-a="blend"]'); await p.click('[data-a="blend"]');
  await p.waitForFunction(() => /^Load /.test(document.querySelector('#dlgTitle').textContent) && document.querySelector('#dlg').open, null, { timeout: 180000 });
  ok('the .blend is read through Blender and its base is chosen by name and address, not the open one', (await p.$eval('#blendBase', (s) => +s.value)) === before.L && /is the base <b>Lighthouse<\/b>|is the base Lighthouse/.test(await p.innerHTML('#dlgBody')));
  await p.screenshot({ path: SP + '/shots/base-blend-load.png' });
  await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(500);
  const after = await p.evaluate((L) => { const objs = g(g(ps(), 'PersistentPlayerBases')[L], 'Objects'); return { n: objs.length, stamps: objs.map((o) => num(g(o, 'Timestamp'))).sort().join(), dirty: S.dirty, pick: S.bases.pick }; }, before.L);
  ok('Lighthouse gets all 408 parts back, the same ones the save had', before.n === 400 && after.n === 408 && after.stamps === before.stamps);
  ok('nothing is written until Save to game, and Lighthouse is opened', after.dirty && after.pick === before.L);
  // LiveLink on Lighthouse
  await p.waitForSelector('#liveToggle'); await p.click('#liveToggle'); await p.waitForSelector('#dlg[open]');
  ok('turning LiveLink on for a base says so and offers its .blend (remembered from the load)', /LiveLink is on/.test(await p.textContent('#dlgTitle')) && /Lighthouse.*base.*is linked/.test(await p.textContent('#dlgBody')) && /Lighthouse\.blend/.test(await p.textContent('#dlgBody')));
  await p.click('#dlgActs .btn.ghost');
  ok('the sidebar shows Live on Bases', !!(await p.$('nav [data-s="bases"] .live-pill')));
  await p.screenshot({ path: SP + '/shots/base-live-on.png' });
  let stdout = '';
  const bp = spawn(path.join(SP, 'bpyenv/bin/python'), ['-u', path.join(__dirname, 'live_base_blender.py'), path.join(__dirname, '../../desktop/addon'), RIGHT, WRONG], { env: { ...process.env, HSE_LIVE_FILE: liveFile } });
  bp.stdout.on('data', (d) => { stdout += d; });
  const done = new Promise((r) => bp.on('exit', r));
  await p.waitForFunction(() => document.querySelector('#dlg').open && /Which base\?/.test(document.querySelector('#dlgTitle').textContent), null, { timeout: 300000 }).catch(() => {});
  const which = await p.textContent('#dlgBody').catch(() => '');
  ok('a file for another base: the editor asks which base', /SkyDreams/.test(which) && /Lighthouse/.test(which));
  await p.screenshot({ path: SP + '/shots/base-live-which.png' });
  await p.click('#dlgActs .btn.ghost').catch(() => {});
  await Promise.race([done, new Promise((r) => setTimeout(r, 120000))]);
  const out = stdout.split('\n').filter((l) => /^(BASEINFO|SAME|LINK|READ|RIGHT|WRONG) /.test(l)); console.log(out.join('\n'));
  ok('the add-on reads which base the file is', out.includes('BASEINFO Lighthouse 0x20800932D4A99D') && out.includes('SAME True False'));
  ok('Blender sees LiveLink is on for the base', out.includes('LINK on base Lighthouse'));
  ok('it reads the base parts from the scene', out.includes('READ 408 the scene'));
  ok('saving the right base writes it', out.some((l) => /^RIGHT 408 parts from Lighthouse\.blend written to the base Lighthouse/.test(l)));
  ok('"Don\'t write" for the wrong base leaves the save alone and Blender says why', out.some((l) => /^WRONG Not written: SkyDreams\.blend is the base SkyDreams/.test(l)));
  // on disk
  await p.waitForTimeout(300); await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const disk = await p.evaluate(() => playerBases().map(({ b }) => [str(g(b, 'Name')), (g(b, 'Objects') || []).length]).filter(([n]) => /Lighthouse|SkyDreams/.test(n)));
  ok('on disk: Lighthouse has its 408 parts, SkyDreams is untouched', JSON.stringify(disk) === JSON.stringify([['SkyDreams', 2992], ['Lighthouse', 408]]) || JSON.stringify(disk) === JSON.stringify([['Lighthouse', 408], ['SkyDreams', 2992]]));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
