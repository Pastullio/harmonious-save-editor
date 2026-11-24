const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
// "Save a report for the developer" and the Mac's game files (owner 2026-11-24, for the Mac test build). Runs the app
// with HSE_GAME pointing at a folder laid out like the Mac's app bundle, holding an archive packed the Mac's way
// (test/make_test_paks.py), and checks the report says what it found; also that a build that can't swap itself
// offers a download instead of installing.
// Usage: node test/e2e/test_report.js <fixture dir> <scratch dir> <folder made by make_test_paks.py>
const FX = process.argv[2], SP = process.argv[3], PAKS = process.argv[4]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'repcfg'), root = path.join(SP, 'reproot'), home = path.join(SP, 'rephome'), app = path.join(SP, 'repgame', "No Man's Sky.app");
  for (const d of [cfg, root, home, path.join(SP, 'repgame')]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'st_76561198000000000'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'GAMEDATA'), { recursive: true }); fs.symlinkSync(path.join(PAKS, 'MACOSBANKS'), path.join(app, 'Contents', 'Resources', 'GAMEDATA', 'MACOSBANKS'));
  for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(root, 'st_76561198000000000', f));
  // a newer release on offer, to see what a build that can't swap itself does with it
  const http = require('http'); const rel = http.createServer((q, r) => r.end(JSON.stringify({ version: '2099.1.1.1', date: '2099-01-01', size: 1, sha256: 'x', url: 'http://127.0.0.1:1/x.exe', notes: 'Test release' }))); await new Promise((r) => rel.listen(48047, '127.0.0.1', r));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48046'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent', HSE_GAME: path.dirname(app), HSE_UPDATE_URL: 'http://127.0.0.1:48047/version.json' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch();
  try {
    const q = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); const errs = []; q.on('pageerror', (e) => errs.push(e.message));
    let opened = ''; await q.addInitScript(() => { window.open = (u) => { window.__opened = u; return null; }; });
    await q.goto(url); await q.waitForSelector('.slot-row');
    // the update offer comes first on a build with a version; this test build is "dev", so ask by hand
    const upd = await q.evaluate(async () => (await api('/api/update')).json());
    ok('a build that can\'t swap itself is told where the new one is', upd.newer === true && /releases\/latest/.test(upd.manual || ''));
    const inst = await q.evaluate(async () => { try { const r = await api('/api/update/install', { method: 'POST' }); return 'status ' + r.status; } catch (e) { return e.message; } });
    ok('…and never installs the Windows exe over itself', /doesn't update itself|status 501/.test(inst));
    ok('the save list has a Report button', !!(await q.$('.land-corner .report-btn')));
    await q.click('.land-corner .report-btn'); await q.waitForSelector('#dlg[open] .report-text', { timeout: 30000, state: 'attached' });
    const text = await q.textContent('#dlg .report-text'), file = (await q.textContent('#dlg p.mono')).trim();
    ok('the report is saved as a zip and says so', /DryDock report .*\.zip/.test(await q.textContent('#dlgBody')) && fs.existsSync(file) && fs.statSync(file).size > 500);
    ok('it says where it looked for saves and what is there', text.includes(root) && /st_76561198000000000\/: 2 save files.*an account DryDock lists/.test(text));
    ok('it found the game inside the app bundle', text.includes('Archives folder used: ' + path.join(app, 'Contents', 'Resources', 'GAMEDATA', 'MACOSBANKS')));
    ok('it names each archive with how it is packed', /NMSARC\.Test\.pak\s+\d+ bytes\s+\d+ files\s+LZ4, Mac, \d+ chunks/.test(text));
    ok('it counts the kinds of file and checks the ones DryDock reads', /\.scene\.mbin\s+\d+/.test(text) && /modularcustomisationdatatable\.mbin: \d+ bytes, starts [0-9a-f]{32}/.test(text) && /gcproducttable\.mbin: NOT READ/.test(text));
    ok('it covers Steam, Blender and Charon Forge', /== Steam/.test(text) && /Blender found: /.test(text) && /Charon Forge found: /.test(text));
    await q.click('#dlgX');
    // the game's own tables read through the app from the Mac-packed archive: the ship builder's part list
    const sb = await q.evaluate(async () => (await api('/api/model/shipbuild?kind=fighter&groups=FIGHT_COCKAB,FIGHT_WINGA,FIGHT_ENGIC')).json());
    ok('the ship builder reads its parts from a Mac-packed archive', Array.isArray(sb.slots) && sb.slots.length === 3 && sb.slots[2].parts.length === 53 && JSON.stringify(sb.names) === '["_COCKPIT_A","_ANOSE_B","_WINGS_A","_ACC_NONE","_ENGINE_C"]');
    ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  } finally { proc.kill(); rel.close(); await b.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
