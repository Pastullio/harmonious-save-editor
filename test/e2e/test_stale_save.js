const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs'); const crypto = require('crypto'); const { spawn } = require('child_process');
// Never an older copy over a newer save (owner 2026-11-24: DryDock stayed open through a play session, a build then
// arrived from Blender, and the save from before the session went over the game's newer one; decals placed in the game
// were lost). Runs the app on the synthetic save: the "game" saves by rewriting the file with a newer time; builds
// "from Blender" are handed to the page's own liveWrite.
// Usage: node test/e2e/test_stale_save.js <fixture dir> <scratch dir>
const FX = process.argv[2], SP = process.argv[3]; const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
(async () => {
  const cfg = path.join(SP, 'stalecfg'), root = path.join(SP, 'staleroot'), home = path.join(SP, 'stalehome'), acct = path.join(root, 'st_76561198000000000');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(acct, { recursive: true }); fs.mkdirSync(home, { recursive: true });
  for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(acct, f));
  const blend = path.join(SP, 'stale_ship.blend'); fs.writeFileSync(blend, 'not really a blend');
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48048'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch();
  // the game saves: the same bytes again (or a file given), with a time a little in the future
  let tick = 0; const gameSaves = (name, from) => { const p = path.join(acct, name); fs.copyFileSync(from || p, p + '.tmp'); fs.renameSync(p + '.tmp', p); const t = new Date(Date.now() + 5000 + 3000 * ++tick); fs.utimesSync(p, t, t); };
  try {
    const q = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); const errs = []; q.on('pageerror', (e) => errs.push(e.message));
    await q.goto(url); await q.waitForSelector('.slot-row'); await q.click('.slot-row'); await q.waitForSelector('#app:not(.hidden)');
    await q.waitForFunction(() => S.src && S.src.seen);
    const title = () => q.textContent('#dlgTitle'), btn = (t) => q.click(`#dlgActs button:has-text("${t}")`);
    const build = () => q.evaluate(() => JSON.parse(C.stringifyJSON(toPlain(cloneJSON(g(shipBuild(0), 'Objects'))))));
    const send = (objs, extra) => q.evaluate(([f, objs, extra]) => { LIVE.write = true; LIVE.on = true; LIVE.kind = 'corvette'; LIVE.slot = 0; window.__res = null; liveWrite(new Map([['file', f], ['saved', true], ...Object.entries(extra || {})]), C.parseJSON(JSON.stringify(objs))).then((r) => { window.__res = r; }); }, [blend, objs, extra]);
    const result = async () => { await q.waitForFunction(() => window.__res); return q.evaluate(() => window.__res); };
    const backupsNow = () => { const d = path.join(cfg, 'HarmoniousSaveEditor', 'backups', 'st_76561198000000000'); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; };
    // a corvette with a starter build, written to the save on disk
    await q.evaluate(async () => { const s = g(ps(), 'ShipOwnership')[0]; if (!Array.isArray(g(ps(), 'PersistentPlayerBases'))) set(ps(), 'PersistentPlayerBases', []);
      set(g(s, 'Resource'), 'Filename', 'MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN'); makeStarterBase(0, 'Stale test'); markDirty(); await appWriteFiles(encodeSave()); S.dirty = false; });
    await q.waitForTimeout(1100);   // backup folders are named to the second
    const first = await build(); ok('the save has a corvette with a build', first.length > 2);
    const base0 = backupsNow(), backups = () => backupsNow() - base0;

    // 1. the game saves while DryDock has the save open; then a build arrives from Blender
    gameSaves('save3.hg'); gameSaves('mf_save3.hg'); const before = sha(path.join(acct, 'save3.hg'));
    await send(first.slice(0, -1)); await q.waitForSelector('#dlg[open]');
    ok('a build arriving after the game saved is not written, and says why', /Not written: the game has saved since/.test(await title()) && /Nothing was written/.test(await q.textContent('#dlgBody')));
    await btn('Not now'); let r = await result();
    ok('…Blender is told it wasn\'t written', r.ok === false && /game saved after DryDock opened/.test(r.message));
    ok('…the save on disk and the build in the editor are untouched, and no backup was needed', sha(path.join(acct, 'save3.hg')) === before && (await build()).length === first.length && backups() === 0);
    // 2. Save to game says the same, and Cancel leaves the file alone
    await q.evaluate(() => markDirty()); await q.click('#saveBtn'); await q.waitForSelector('#dlg[open]');
    ok('Save to game warns that the game has saved since', /The game has saved since you opened this/.test(await title()) && /older save back/.test(await q.textContent('#dlgBody')));
    await btn('Cancel'); await q.waitForTimeout(200);
    ok('…Cancel writes nothing', sha(path.join(acct, 'save3.hg')) === before);
    // 3. anything else that tries to write is refused too, by the page and by the app itself
    const direct = await q.evaluate(async () => { try { await appWriteFiles(encodeSave()); return 'written'; } catch (e) { return e.message; } });
    const raw = await q.evaluate(async () => { const out = encodeSave(), fd = new FormData(); fd.append('dir', S.src.dir); fd.append('dataName', S.src.dataName); fd.append('metaName', S.src.metaName); fd.append('seenMtime', String(S.src.seen.mtime)); fd.append('seenSize', String(S.src.seen.size));
      fd.append('data', new Blob([out.data]), S.src.dataName); fd.append('meta', new Blob([out.meta]), S.src.metaName); try { const x = await api('/api/write', { method: 'POST', body: fd }); return 'status ' + x.status; } catch (e) { return e.message; } });
    ok('any other write is refused by the page', /Nothing was written/.test(direct) && sha(path.join(acct, 'save3.hg')) === before);
    ok('…and by the app, whatever the page does', /after DryDock opened it|409/.test(raw) && sha(path.join(acct, 'save3.hg')) === before);
    // 4. the slot's other save (manual) written by the game counts too
    await q.evaluate(() => { S.src.seen = null; return appSeen(S.src); }); await q.waitForFunction(() => S.src.seen);
    ok('after looking again, nothing is stale', (await q.evaluate(() => diskStale())) === null);
    gameSaves('save4.hg', path.join(acct, 'save3.hg')); gameSaves('mf_save4.hg', path.join(acct, 'mf_save3.hg'));
    const st = await q.evaluate(() => diskStale());
    ok('the same slot\'s other save being newer counts as the game having saved', !!st && st.same === false && st.file.name === 'save4.hg');
    for (const f of ['save4.hg', 'mf_save4.hg']) fs.rmSync(path.join(acct, f));
    // 5. with the save up to date, the first build from this file goes in, backed up, and is noted for the corvette
    await send(first.slice(0, -1)); r = await result();
    ok('an up-to-date save takes the build, with a backup', r.ok === true && r.written === true && (await build()).length === first.length - 1 && backups() === 1);
    ok('…and the next build from Blender goes straight in', await (async () => { await send(first.slice(0, -2)); const x = await result(); return x.ok === true && (await build()).length === first.length - 2; })());
    // 6. the corvette changes outside Blender (a decal placed in the game), then Blender sends its build again
    await q.evaluate(() => { const objs = g(shipBuild(0), 'Objects'), d = cloneJSON(objs[0]); set(d, 'ObjectID', '^DECAL_TEST'); set(d, 'Position', [N(1.5), N(2.5), N(3.5)]); objs.push(d); });
    const withDecal = (await build()).length;
    await send(first.slice(0, -2)); await q.waitForSelector('#dlg[open]');
    ok('a build that would remove what was added outside Blender is asked about first', /was changed outside Blender/.test(await title()) && /1 part added/.test(await q.textContent('#dlgBody')) && /Nothing has been written/.test(await q.textContent('#dlgBody')));
    await btn("Don't write"); r = await result();
    ok('…Don\'t write keeps the decal', r.ok === false && (await build()).length === withDecal && (await build()).some((o) => o.ObjectID === '^DECAL_TEST'));
    await send(first.slice(0, -2)); await q.waitForSelector('#dlg[open]'); await btn("Use Blender's build"); r = await result();
    ok('…Use Blender\'s build is the only way it is replaced, and it is backed up', r.ok === true && r.written === true && !(await build()).some((o) => o.ObjectID === '^DECAL_TEST') && backups() === 3);
    ok('…after which builds go in again without a question', await (async () => { await send(first.slice(0, -1)); const x = await result(); return x.ok === true && !(await q.$('#dlg[open]')); })());
    // 7. opening the newer save from the question
    gameSaves('save3.hg'); gameSaves('mf_save3.hg');
    await send(first); await q.waitForSelector('#dlg[open]'); await btn('Open the new save'); r = await result();
    await q.waitForFunction(() => S.src && S.src.seen);
    ok('Open the new save reads the game\'s save, and the build can then be sent again', r.ok === false && /send the build again/.test(r.message) && (await q.evaluate(() => diskStale())) === null);
    ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  } catch (e) { console.log('ERROR', e); fails.push('ran to the end'); }
  finally { proc.kill(); await b.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
