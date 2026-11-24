const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
// A corvette's .blend that is behind the save (owner 2026-11-23): before LiveLink opens the .blend, the build in the
// save is compared with the build in the file. The same: it just opens. Different: the editor asks, and "Update it"
// copies the .blend to Blender backups, then opens it with the save's build put in (not saved).
// Usage: node test/e2e/test_stale_blend.js <scratch dir> <dir with the synthetic fixture from test/make_fixture.py>
// Needs bpy: <scratch>/bpyenv/bin/python (see CLAUDE.md), or HSE_TEST_PYTHON=<a python that has bpy>.
const SP = path.resolve(process.argv[2]), FX = path.resolve(process.argv[3]);
const PY = process.env.HSE_TEST_PYTHON || path.join(SP, 'bpyenv/bin/python');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
(async () => {
  const cfg = path.join(SP, 'stalecfg'), root = path.join(SP, 'staleroot'), home = path.join(SP, 'stalehome'), shots = path.join(SP, 'shots');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'st_76561198000000000'), { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
  for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(root, 'st_76561198000000000', f));
  const blend = path.join(SP, 'stale_test.blend'), argsFile = path.join(SP, 'stale_args.txt'), outBlend = path.join(SP, 'stale_updated.blend');
  for (const f of [blend, argsFile, outBlend]) fs.rmSync(f, { force: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48031'], { env: { ...process.env, SP, HSE_TEST_PYTHON: PY, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: path.join(__dirname, 'fake-blender-update.sh'), STALE_ARGS: argsFile, STALE_OUT: outBlend } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const done = async (code) => { await b.close(); proc.kill(); process.exit(code); };
  try {
    await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForTimeout(500);
    // a corvette with a starter build, and a .blend that holds that build
    const plain = () => p.evaluate(() => JSON.parse(C.stringifyJSON(toPlain(cloneJSON(g(shipBuild(0), 'Objects'))))));
    const name = await p.evaluate(() => {
      const s = g(ps(), 'ShipOwnership')[0];
      if (!Array.isArray(g(ps(), 'PersistentPlayerBases'))) set(ps(), 'PersistentPlayerBases', []);
      set(g(s, 'Resource'), 'Filename', 'MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN'); makeStarterBase(0, 'Stale test'); markDirty();
      return str(g(s, 'Name')) || 'Corvette';
    });
    const first = await plain();
    ok('the test corvette has a build', first.length >= 4);
    fs.writeFileSync(path.join(SP, 'stale_build.json'), JSON.stringify(first));
    const made = spawnSync(PY, [path.join(__dirname, 'make_corvette_blend.py'), path.join(SP, 'stale_build.json'), blend, '0', name], { encoding: 'utf8', timeout: 300000 });
    ok('the test .blend is made', /MADE/.test(made.stdout));
    await p.evaluate(async (f) => { await liveSetFile(0, f); (S.wright || (S.wright = { q: '', sel: new Set(), json: false })).slot = 0; S.wright.auto = false; go('shipwright'); }, blend);
    const args = () => (fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : null);
    const waitArgs = async () => { for (let k = 0; k < 100 && !fs.existsSync(argsFile); k++) await p.waitForTimeout(100); return args(); };
    const title = () => p.evaluate(() => (document.querySelector('#dlg').open ? document.querySelector('#dlgTitle').textContent : ''));
    const waitTitle = (re) => p.waitForFunction((src) => document.querySelector('#dlg').open && new RegExp(src).test(document.querySelector('#dlgTitle').textContent), re.source, { timeout: 180000 });
    const sent = async () => (await p.evaluate(async (f) => (await api('/api/live/sent?file=' + encodeURIComponent(f))).json(), blend));

    // 1. the file and the save agree: turning LiveLink on and choosing Open in Blender just opens it
    await p.waitForSelector('#liveToggle'); await p.click('#liveToggle'); await waitTitle(/LiveLink is on/);
    ok('nothing is known about the file yet', (await sent()).found === false);
    await p.click('#dlgActs .btn.primary');   // Open in Blender: the file is read through Blender to check it
    let a = await waitArgs();
    ok('a file that matches the save opens without a question', !!a && a.length === 1 && a[0] === blend && !/differ/.test(await title()));
    let note = await sent();
    ok('what the file holds is noted for next time', note.found && note.fresh && note.parts.length === first.length);
    fs.rmSync(argsFile, { force: true });
    await p.waitForSelector('#liveOpen'); await p.click('#liveOpen'); a = await waitArgs();
    ok('…so the next open is checked at once', !!a && a.length === 1 && a[0] === blend);

    // 2. the corvette changes in the save (as the game would): one part gone, one moved, one new, one recoloured
    const change = await p.evaluate(() => {
      const objs = g(shipBuild(0), 'Objects'), id = (o) => str(g(o, 'ObjectID')), count = (x) => objs.filter((o) => id(o) === x).length;
      const gone = objs.findIndex((o) => count(id(o)) === 1), goneId = id(objs[gone]); objs.splice(gone, 1);
      const mv = objs[0], pos = g(mv, 'Position').map(num); set(mv, 'Position', [N(pos[0] + 3), N(pos[1]), N(pos[2] - 2)]);
      const add = cloneJSON(objs[1]); const ap = g(add, 'Position').map(num); set(add, 'Position', [N(ap[0]), N(ap[1] + 9), N(ap[2])]); set(add, 'Timestamp', N(num(g(add, 'Timestamp')) + 60)); objs.push(add);
      set(objs[2], 'UserData', N(num(g(objs[2], 'UserData')) + 3));
      markDirty(); return { goneId, n: objs.length };
    });
    const second = await plain();
    fs.rmSync(argsFile, { force: true });
    const before = sha(blend);
    await p.click('#liveOpen'); await waitTitle(/The Blender file and your save differ/);
    const body = await p.textContent('#dlgBody');
    ok('a file behind the save: the editor asks, and says what differs', /1 part added, 1 part removed, 1 part moved, 1 part recoloured/.test(body));
    ok('…with both choices', /Open the Blender file as it is/.test(await p.textContent('#dlgActs')) && /Update it with the changes from the game/.test(await p.textContent('#dlgActs .btn.primary')));
    await p.screenshot({ path: path.join(shots, 'stale-blend-ask.png') });
    ok('Blender isn\'t started until a choice is made', args() === null);
    await p.click('#dlgActs .btn:not(.primary):not(.ghost)');   // Open the Blender file as it is
    a = await waitArgs();
    ok('"as it is" opens the file unchanged', !!a && a.length === 1 && a[0] === blend);

    // 3. update it: a backup first, then Blender gets the file and the save's build
    fs.rmSync(argsFile, { force: true });
    await p.click('#liveOpen'); await waitTitle(/The Blender file and your save differ/);
    await p.click('#dlgActs .btn.primary'); await waitTitle(/^Updating /);
    const backup = (await p.textContent('#dlgBody .live-file .mono')).trim();
    ok('a copy of the file as it was is in Blender backups', /Blender backups/.test(backup) && fs.existsSync(backup) && sha(backup) === before);
    await p.screenshot({ path: path.join(shots, 'stale-blend-updating.png') });
    a = await waitArgs();
    ok('Blender opens the file with the update script and the build', !!a && a[0] === blend && a[1] === '--python' && /blend_update\.py$/.test(a[2]) && a[3] === '--' && fs.existsSync(a[4]));
    for (let k = 0; k < 600 && !fs.existsSync(outBlend); k++) await p.waitForTimeout(200);
    await p.waitForTimeout(500);
    const report = a && fs.existsSync(a[5]) ? JSON.parse(fs.readFileSync(a[5], 'utf8')) : {};
    ok('the script reports what it changed', report.ok === true && report.added === 1 && report.removed === 1 && report.moved === 1 && report.parts === second.length);
    ok('the .blend on disk is untouched until it is saved in Blender', sha(blend) === before);
    await p.click('#dlgActs .btn.primary');
    // the scene as Blender would hold it, read back the way the add-on reads it
    const back = await p.evaluate(async (f) => JSON.parse(await (await api('/api/blend/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: f }) })).text()), outBlend);
    const close = (x, y) => x.every((v, k) => Math.abs(v - y[k]) < 1e-3), unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
    const same = back.objects.length === second.length && back.objects.every((o, k) => o.ObjectID === second[k].ObjectID && close(o.Position, second[k].Position) && close(o.Up, second[k].Up) && close(o.At, unit(second[k].At)) && String(o.UserData) === String(second[k].UserData) && String(o.Timestamp) === String(second[k].Timestamp));
    ok('the updated scene is the save\'s build: same parts, places, colours, times and order', same);

    // 4. saved in Blender (the updated scene becomes the file): no more question
    fs.copyFileSync(outBlend, blend); fs.rmSync(argsFile, { force: true });
    ok('a changed file is checked again, not trusted from the note', (await sent()).fresh === false);
    await p.click('#liveOpen'); a = await waitArgs();
    ok('once the file is saved with the update, it opens without a question', !!a && a.length === 1 && a[0] === blend && !/differ/.test(await title()));

    // 5. a build that arrives from a saved file is noted; one sent with unsaved changes isn't
    const res = await p.evaluate(async ([f, objs]) => {
      const body = (saved) => new Map([['file', f], ['saved', saved], ['overwrite', true]]), objects = C.parseJSON(JSON.stringify(objs));   // overwrite: this step is about the note, not the changed-outside-Blender question (test_stale_save.js)
      LIVE.write = false; LIVE.on = true; LIVE.kind = 'corvette'; LIVE.slot = 0;
      await api('/api/live/sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: f, parts: [['X', 0, 0, 0, 0, 1, 0, 0, 0, 1, '0']] }) });
      await liveWrite(body(false), objects); await new Promise((r) => setTimeout(r, 300));
      const unsaved = (await (await api('/api/live/sent?file=' + encodeURIComponent(f))).json()).parts.length;
      await liveWrite(body(true), objects); await new Promise((r) => setTimeout(r, 300));
      return { unsaved, saved: (await (await api('/api/live/sent?file=' + encodeURIComponent(f))).json()).parts.length };
    }, [blend, first]);
    ok('a build sent after saving in Blender is noted; one sent with unsaved changes is not', res.unsaved === 1 && res.saved === first.length);

    // 6. only the newest five backups of a file are kept
    const dir = path.dirname(backup); for (let k = 0; k < 7; k++) fs.copyFileSync(blend, path.join(dir, `stale_test 2020-01-0${k + 1} 120000.blend`));
    await p.evaluate(async ([f, objs]) => { await api('/api/live/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: f, objects: objs }) }); }, [blend, second]);
    const kept = fs.readdirSync(dir).filter((x) => /^stale_test /.test(x)).sort();
    ok('the newest five backups of a file are kept', kept.length === 5 && !kept.some((x) => /2020-01-0[1-4]/.test(x)));
    ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  } catch (e) { console.log('ERROR', e); fails.push('ran to the end'); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); await done(fails.length ? 1 : 0);
})();
