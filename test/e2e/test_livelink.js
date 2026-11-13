const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const http = require('http');
// The LiveLink page (owner 2026-11-13): in the first group under Shipwright, the setup checklist (Blender, the add-on
// and its version, linked, Charon Forge), what's linked, and the 3D print library (STLs in Exports with a turning
// preview, Show in folder, Delete to Exports\Deleted).
// Usage: node test/e2e/test_livelink.js <scratch dir with dbroot/NMS holding a save>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'lltest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), cfg = path.join(T, 'cfg'), exp = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports');
  fs.mkdirSync(exp, { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // two prints as the add-on writes them: binary STL in mm, resting on z 0 (a stepped tower and a sphere-ish blob)
  execFileSync('python3', ['-c', `
import struct, math
def stl(path, tris):
    with open(path, 'wb') as f:
        f.write(b'test'.ljust(80, b' ')); f.write(struct.pack('<I', len(tris)))
        for a, b, c in tris: f.write(struct.pack('<12fH', 0, 0, 0, *a, *b, *c, 0))
def box(x0, y0, z0, x1, y1, z1):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    q = [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    return [t for a,b,c,d in q for t in ((v[a],v[b],v[c]),(v[a],v[c],v[d]))]
stl(${JSON.stringify(path.join(exp, 'Pastullio print 54mm 2026-11-13 120000.stl'))}, box(0,0,0,30,30,4) + box(10,10,4,20,20,54))
s = []
n = 120
for i in range(n):
    for j in range(n):
        def p(a, b): th, ph = math.pi * a / n, 2 * math.pi * b / n; return (40 * math.sin(th) * math.cos(ph), 40 * math.sin(th) * math.sin(ph), 40 + 40 * math.cos(th))
        s += [(p(i, j), p(i + 1, j), p(i + 1, j + 1)), (p(i, j), p(i + 1, j + 1), p(i, j + 1))]
stl(${JSON.stringify(path.join(exp, 'The Cutting Remark print 100mm 2026-11-13 130000.stl'))}, s)
`]);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' };
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48171'], { env });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  const ids = await p.evaluate(() => [...document.querySelector('nav .nav-group').querySelectorAll('button[data-s]')].map((x) => x.dataset.s));
  ok('LiveLink sits in the first group, under Shipwright and above Coordinates (' + ids.join(',') + ')', ids.indexOf('livelink') === ids.indexOf('shipwright') + 1 && ids.indexOf('coords') === ids.indexOf('livelink') + 1);
  await p.click('nav button[data-s="livelink"]'); await p.waitForSelector('.ll-setup', { timeout: 15000 });
  const steps = await p.$$eval('.ll-step', (xs) => xs.map((x) => x.className.split(' ')[1] + ':' + x.querySelector('b').textContent));
  ok('Setup: Blender (found or not), the add-on not seen yet, not linked, Charon Forge optional (' + steps.join(' | ') + ')', steps.length === 4 && /^(ok|bad):Blender/.test(steps[0]) && /^bad:LiveLink add-on/.test(steps[1]) && /^bad:Blender is linked/.test(steps[2]) && /^opt:Charon/.test(steps[3]));
  ok('…with the first-time steps open', await p.$eval('.ll-first', (d) => d.open && /Import my traveller/.test(d.textContent)));
  // the add-on checks in, as Blender would (an older one doesn't say its version)
  const lj = JSON.parse(fs.readFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'live.json'), 'utf8'));
  const checkIn = (q) => new Promise((ok2) => http.get({ host: '127.0.0.1', port: lj.port, path: '/api/live/build?' + q, headers: { 'X-Live-Token': lj.token } }, (r) => { r.resume(); r.on('end', ok2); }));
  await checkIn('file=Cutting.blend');
  await p.waitForFunction(() => /older version/.test((document.querySelector('.ll-step:nth-child(2)') || {}).textContent || ''), null, { timeout: 9000 }).catch(() => {});
  ok('an older add-on is asked to update', await p.$eval('.ll-step:nth-child(2)', (x) => x.classList.contains('bad') && /older version/.test(x.textContent)));
  const latest = await p.evaluate(() => LL.status.addonLatest);
  await checkIn('file=Cutting.blend&addon=' + latest + '&blender=4.5.1');
  await p.waitForFunction(() => document.querySelector('.ll-step:nth-child(2)').classList.contains('ok'), null, { timeout: 9000 }).catch(() => {});
  const st2 = await p.$$eval('.ll-step', (xs) => xs.map((x) => x.className.split(' ')[1]));
  ok('the current add-on is up to date and Blender shows as linked, with the file (' + st2.join(',') + ')', st2[1] === 'ok' && st2[2] === 'ok' && /Cutting\.blend/.test(await p.textContent('.ll-step:nth-child(3)')));
  ok('What\'s linked lists the save\'s corvettes and bases with Turn on', (await p.$$('.ll-target [data-ll-on]')).length >= 1);
  // the print library
  await p.waitForSelector('.ll-print', { timeout: 10000 });
  const cards = await p.$$eval('.ll-print .tc-cap b', (xs) => xs.map((x) => x.textContent));
  ok('3D prints lists both STLs, newest first (' + cards.join(', ') + ')', cards.length === 2 && cards[0] === 'The Cutting Remark' && cards[1] === 'Pastullio');
  ok('…with their size in mm and triangles', /80 × 80 × 80 mm · 28,800 triangles/.test(await p.textContent('.ll-print[data-k="0"]')) && /30 × 30 × 54 mm · 24 triangles/.test(await p.textContent('.ll-print[data-k="1"]')));
  await p.waitForFunction(() => [...document.querySelectorAll('.ll-print .tc-art canvas')].length === 2 && LL.glb.size === 2, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const snap = () => p.evaluate(() => document.querySelector('.ll-print[data-k="0"] .tc-art canvas').toDataURL());
  const a = await snap();
  const box = await p.$eval('.ll-print[data-k="0"] .tc-art', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y); await p.waitForTimeout(900);
  ok('…each shows its model and turns on hover', a.length > 2000 && (await snap()) !== a);
  await p.mouse.move(0, 0);
  // the preview is thinned: the sphere's 28,800 triangles come back fewer
  const pv = await p.evaluate(async () => { const r = await api('/api/exports/print?preview=1&name=' + encodeURIComponent('The Cutting Remark print 100mm 2026-11-13 130000.stl')); const b = await r.arrayBuffer(), dv = new DataView(b), jl = dv.getUint32(12, true), j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, jl))); return j.accessors[2].count / 3; });
  ok('…previews are thinned (' + pv + ' triangles from 28,800)', pv > 1000 && pv < 28800);
  await p.screenshot({ path: path.join(SP, 'livelink.png'), fullPage: true });
  await p.click('.ll-print[data-k="1"] [data-pr="del"]'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.danger');
  await p.waitForFunction(() => document.querySelectorAll('.ll-print').length === 1, null, { timeout: 6000 }).catch(() => {});
  ok('Delete moves the print to Exports\\Deleted and the library updates', !fs.existsSync(path.join(exp, 'Pastullio print 54mm 2026-11-13 120000.stl')) && fs.existsSync(path.join(exp, 'Deleted', 'Pastullio print 54mm 2026-11-13 120000.stl')) && (await p.$$('.ll-print')).length === 1);
  ok('the nav shows Live on LiveLink while it is on', await p.evaluate(async () => { const x = LL.targets[0]; liveStart(x.t); await new Promise((r) => setTimeout(r, 300)); const pill = !!document.querySelector('nav [data-s="livelink"] .live-pill'); liveStop(); return pill; }));
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SP, 'livelink-dark.png') });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
