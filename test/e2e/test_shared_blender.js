const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
// Shared travellers and Blender (owner 2026-11-23): DryDock's list reaches the LiveLink add-on (its "Import a shared
// traveller" menu), and Add to Blender asks the add-on to bring one in on its next check-in. Runs on the synthetic save
// (no game files: the models themselves aren't built; test_traveller.js covers that).
// Usage: node test/e2e/test_shared_blender.js <scratch dir> <fixture dir>     (bpy: <scratch>/bpyenv/bin/python or HSE_TEST_PYTHON)
const SP = path.resolve(process.argv[2]), FX = path.resolve(process.argv[3]);
const PY = process.env.HSE_TEST_PYTHON || path.join(SP, 'bpyenv/bin/python');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'sharedcfg'), root = path.join(SP, 'sharedroot'), home = path.join(SP, 'sharedhome');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'st_76561198000000000'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
  for (const f of ['save3.hg', 'mf_save3.hg']) fs.copyFileSync(path.join(FX, f), path.join(root, 'st_76561198000000000', f));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48032'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  try {
    await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.waitForTimeout(400);
    const liveFile = (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (e.name === 'live.json') return f; } return null; })(cfg) || (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (e.name === 'live.json') return f; } return null; })(home);
    ok('the app says where it is for the add-on', !!liveFile);
    const addon = () => { const r = spawnSync(PY, ['-u', path.join(__dirname, 'shared_blender.py'), path.join(__dirname, '../../desktop/addon'), '0'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, HSE_LIVE_FILE: liveFile } }); const m = /RESULT (.*)/.exec(r.stdout); if (!m) console.log(r.stdout.slice(-600), r.stderr.slice(-600)); return m ? JSON.parse(m[1]) : {}; };
    // two shared travellers in DryDock's list, and the save's own traveller
    await p.evaluate(async () => {
      window.travellerGroups = () => ['^HEAD_A', '^TORSO_A']; window.travellerLook = () => null; window.travellerName = () => 'Pastullio';
      const mk = async (n, g) => ({ name: n, code: await travCodeMake({ name: n, groups: g, look: { c: [{ p: 'Custom_Head', a: 'Primary', c: [1, 0, 0, 1] }], t: [] } }), added: Date.now() });
      sharedTravsStore([await mk('Dre', ['^HEAD_GEK', '^TORSO_GEK']), await mk('Zara', ['^HEAD_VYK'])]);
      await travellerShare(); await new Promise((r) => setTimeout(r, 300));
    });
    let a = addon();
    ok('the add-on\'s check-in lists DryDock\'s shared travellers, in order', JSON.stringify(a.shared) === '["Dre","Zara"]' && a.traveller === 'Pastullio');
    ok('its menu offers each one', JSON.stringify(a.menu) === '[["Dre",1],["Zara",2]]');
    ok('nothing is asked for until Add to Blender', a.want === null);
    ok('Import my traveller asks for the save\'s own, a menu pick for that shared traveller', JSON.stringify(a.asked) === '["traveller","traveller?who=2"]');
    // Add to Blender on Zara
    p.evaluate(() => sharedTravellersDialog()).catch(() => {});
    await p.waitForSelector('.st-item'); await p.click('.st-item:nth-child(2)'); await p.waitForSelector('#stView [data-st="blender"]');
    ok('the button reads Add to Blender', (await p.textContent('#stView [data-st="blender"]')) === 'Add to Blender');
    await p.click('#stView [data-st="blender"]'); await p.waitForFunction(() => document.querySelector('#stNote').textContent.length > 0);
    ok('with Blender checked in, it says the traveller is on the way', /Zara is on the way to Blender/.test(await p.textContent('#stNote')));
    a = addon();
    ok('the add-on is told to bring in Zara', a.want && a.want.who === 2);
    ok('…once only', a.want_again === null);
    // the app serves the right traveller (no game files here, so the model can't be built: the error says so, not "not in the list")
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    const get = async (q) => { const r = await fetch(`http://127.0.0.1:${live.port}/api/live/traveller${q}`, { headers: { 'X-Live-Token': live.token } }); return { s: r.status, t: await r.text() }; };
    const r2 = await get('?who=2'), r9 = await get('?who=9');
    ok('a traveller past the end of the list is refused plainly', r9.s === 404 && /isn't in DryDock's list/.test(r9.t));
    ok('a listed one gets as far as building the model', r2.s === 404 && !/isn't in DryDock's list/.test(r2.t));
    // with Blender gone (no check-in for a while), Add to Blender says so
    await p.evaluate(() => { const real = window.api; window.api = async (u, o) => (u === '/api/live/traveller/add' ? new Response(JSON.stringify({ ok: true, linked: false, addon: '' })) : real(u, o)); });
    await p.click('#stView [data-st="blender"]'); await p.waitForFunction(() => /isn't open/.test(document.querySelector('#stNote').textContent));
    ok('without Blender it says to open it', /Blender isn't open with the LiveLink add-on/.test(await p.textContent('#stNote')));
    // removing one updates Blender's list
    await p.evaluate(() => { window.api = window.api; }); await p.click('#stView [data-st="remove"]'); await p.waitForTimeout(500);
    a = addon();
    ok('removing a traveller takes it off Blender\'s list', JSON.stringify(a.shared) === '["Dre"]');
    ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  } catch (e) { console.log('ERROR', e); fails.push('ran to the end'); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); await b.close(); proc.kill(); process.exit(fails.length ? 1 : 0);
})();
