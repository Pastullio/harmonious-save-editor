const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
// Live link: the Blender add-on (run in bpy 4.5) sends a build on "Send now" and on saving the .blend; the editor puts
// it on the chosen corvette and writes the save with a backup. Usage: node test/e2e/test_live.js <scratch dir>
// (needs SP/bpyenv with bpy, see CLAUDE.md, and a real save in SP/dbroot/NMS)
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'livecfg'), root = path.join(SP, 'liveroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // a stand-in Blender that notes what it was asked to open, and the answer the file dialog gives
  const blend = path.join(SP, 'live_test.blend'), argsFile = path.join(SP, 'blender_args.txt'), fakeBlender = path.join(SP, 'fake-blender-open.sh');
  fs.writeFileSync(blend, 'not really a blend'); fs.rmSync(argsFile, { force: true });
  fs.writeFileSync(fakeBlender, `#!/bin/sh\necho "$@" > '${argsFile}'\n`, { mode: 0o755 });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48009'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_BLENDER: fakeBlender, HSE_PICK_FILE: blend } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const liveFile = path.join(cfg, 'HarmoniousSaveEditor', 'live.json');
  ok('live.json tells the add-on where the editor is', JSON.parse(fs.readFileSync(liveFile, 'utf8')).port === 48009);
  // without the live token, the build endpoint is closed
  const bad = await fetch('http://127.0.0.1:48009/api/live/build', { method: 'POST', body: '{}' }); ok('other programs can\'t send builds', bad.status === 403);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForTimeout(600); };
  await open();
  // the parts of one corvette, sent to another
  const info = await p.evaluate(() => { const cs = ships().filter((x) => slotIsCorvette(x.s)); const from = cs.find((x) => shipBuild(x.i)), to = cs.find((x) => x.i !== from.i && shipBuild(x.i));
    return { from: from.i, to: to.i, toName: str(g(to.s, 'Name')), n: g(shipBuild(from.i), 'Objects').length, objs: JSON.parse(C.stringifyJSON(toPlain(cloneJSON(g(shipBuild(from.i), 'Objects'))))) }; });
  fs.writeFileSync(SP + '/live_build.json', JSON.stringify(info.objs));
  await p.evaluate((i) => { (S.wright || (S.wright = { q: '', sel: new Set(), auto: false, json: false })).slot = i; S.wright.auto = false; go('shipwright'); }, info.to);
  await p.waitForSelector('#liveToggle'); await p.click('#liveToggle');
  await p.waitForSelector('#dlg[open]');
  ok('turning it on says so, and offers to open the corvette in Blender', /Live link is on/.test(await p.textContent('#dlgTitle')) && new RegExp(info.toName + '.*is linked').test(await p.textContent('#dlgBody')) && /Choose the \.blend/.test(await p.textContent('#dlgActs')));
  await p.screenshot({ path: SP + '/shots/live-dialog.png' });
  await p.click('#dlgActs .btn.primary');   // Choose the .blend file… (the dialog's answer is set by HSE_PICK_FILE)
  for (let k = 0; k < 30 && !fs.existsSync(argsFile); k++) await p.waitForTimeout(100);
  ok('Blender opens with the chosen file', fs.existsSync(argsFile) && fs.readFileSync(argsFile, 'utf8').trim() === blend);
  await p.waitForSelector('#swLive.on');
  ok('the panel and the corvette list show the linked file', /live_test\.blend/.test(await p.textContent('#swLive .live-file')) && /live_test\.blend/.test(await p.textContent('.sw-corv.on')));
  ok('Live link turns on for the open corvette', /slot/.test(await p.textContent('#swLive .live-state')));
  ok('the sidebar shows Live on Shipwright', !!(await p.$('nav [data-s="shipwright"] .live-pill')));
  ok('and it waits for Blender until the add-on checks in', /Waiting for Blender/.test(await p.textContent('#liveBlender')));
  await p.screenshot({ path: SP + '/shots/live-on.png' });
  const bakDir = path.join(cfg, 'HarmoniousSaveEditor', 'backups');
  const countBackups = () => (fs.existsSync(bakDir) ? fs.readdirSync(bakDir).reduce((n, d) => n + (fs.statSync(path.join(bakDir, d)).isDirectory() ? fs.readdirSync(path.join(bakDir, d)).length : 0), 0) : 0);
  const backupsBefore = countBackups();
  // Blender
  const py = path.join(SP, 'bpyenv/bin/python');
  // (bpy as a module reports leaked memory and a non-zero status on exit; only its output matters here)
  const outp = spawnSync(py, [path.join(__dirname, 'live_blender.py'), path.join(__dirname, '../../desktop/addon'), SP + '/live_build.json', SP + '/live_test.blend'],
    { env: { ...process.env, HSE_LIVE_FILE: liveFile }, encoding: 'utf8', timeout: 300000 }).stdout.split('\n').filter((l) => /^(PANEL|LINK|SEND|SAVE) /.test(l));
  console.log(outp.join('\n'));
  ok('the add-on registers its panel', outp.some((l) => l === 'PANEL True'));
  ok('Blender sees it is linked, and to which corvette', outp.some((l) => l.startsWith('LINK on ') && l.includes(info.toName)));
  ok('Send now: the build is written to the corvette', outp.some((l) => l.startsWith('SEND') && new RegExp(`${info.n.toLocaleString()} parts written to ${info.toName}.*backed up`).test(l)));
  ok('saving the .blend sends it again', outp.some((l) => l.startsWith('SAVE') && /written to/.test(l)));
  const backupsAfter = countBackups();
  ok('each write is backed up', backupsAfter >= backupsBefore + 2);
  await p.waitForTimeout(500);
  await p.waitForSelector('#liveBlender.ok', { timeout: 8000 }).catch(() => {});
  ok('the editor shows Blender is linked', /Blender is linked/.test(await p.textContent('#liveBlender')));
  ok('the editor lists what arrived', (await p.$$('#swLive .live-log li')).length >= 2);
  await p.screenshot({ path: SP + '/shots/live-log.png' });
  // turned off: the add-on is told
  await p.click('#liveToggle'); await p.waitForTimeout(300);
  const tok = JSON.parse(fs.readFileSync(liveFile, 'utf8')).token;
  const off = await (await fetch('http://127.0.0.1:48009/api/live/build', { method: 'POST', headers: { 'X-Live-Token': tok }, body: JSON.stringify({ objects: info.objs }) })).json();
  ok('with Live link off, Blender is told how to turn it on', /Live link is off/.test(off.message));
  // what's on disk
  await open();
  const n = await p.evaluate((i) => g(shipBuild(i), 'Objects').length, info.to);
  ok('the corvette on disk has the Blender build', n === info.n);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  // closing the editor ends the link: the app leaves and takes live.json with it
  const gone = new Promise((r) => proc.on('exit', r));
  await p.goto('about:blank'); await Promise.race([gone, new Promise((r) => setTimeout(r, 20000))]);
  ok('closing the editor turns the link off', proc.exitCode !== null && !fs.existsSync(liveFile));
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
