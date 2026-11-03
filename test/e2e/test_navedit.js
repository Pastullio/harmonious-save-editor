// The owner's own sidebar: move pages (arrows and drag), move groups, hide pages, keep it after a reload, reset.
// Usage: node test/e2e/test_navedit.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'navtest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48104'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); };
  const groups = () => p.$$eval('#nav .nav-group', (gs) => gs.map((g) => [...g.querySelectorAll('button')].map((x) => x.dataset.s).join(',')));
  await p.goto(url); await open();
  const before = await groups();
  ok('the usual sidebar to begin with', before[0] === 'overview,shipwright,coords,hangar,library' && before.length === 5);
  await p.click('#navEditBtn'); await p.waitForSelector('#nav.nav-editing');
  await p.click('[data-eye="raw"]');
  for (let k = 0; k < 4; k++) await p.click('[data-im="library"][data-d="-1"]');
  await p.click('[data-im="companions"][data-d="1"]');                 // last in its group: goes to the top of the next one
  await p.dragAndDrop('.ne-item[data-id="cargo"]', '.ne-item[data-id="overview"]');
  await p.click('[data-gm="g3"][data-d="-1"]');
  await p.click('#neDone');
  const after = await groups(); console.log(after);
  ok('arrows and dragging move pages, also into another group', after[0] === 'library,cargo,overview,shipwright,coords,hangar' && after[3] === 'companions,bases,storage');
  ok('groups move, and a hidden page leaves the sidebar', after[2] === 'knowledge,rewards,standing,difficulty' && after[4] === 'items' && !after.join(',').includes('raw'));
  await p.click('#findBox'); await p.fill('#findBox', 'raw data'); await p.waitForTimeout(400);
  ok('a hidden page is still found', /Raw data/.test(await p.textContent('#findRes')));
  await p.keyboard.press('Escape');
  await p.reload(); await open();
  ok('the layout is kept after reopening', JSON.stringify(await groups()) === JSON.stringify(after));
  // a page the saved layout doesn't know about (a later version's new page) still shows, in its usual group
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('hse-nav')); v.groups.forEach((g) => { g.ids = g.ids.filter((id) => id !== 'standing'); }); localStorage.setItem('hse-nav', JSON.stringify(v)); renderSide(); });
  ok('a page missing from the saved layout comes back in its usual group', (await groups()).some((g) => /rewards,standing/.test(g)));
  await p.click('#navEditBtn'); await p.click('#neReset'); await p.click('#neDone');
  ok('Reset puts the usual sidebar back', JSON.stringify(await groups()) === JSON.stringify(before));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
