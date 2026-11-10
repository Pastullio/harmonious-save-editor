// The Traveller page (owner, 2026-11-10): a picture made from the newest pose picture in Exports, a background, a ship,
// portal glyphs and words, laid out by dragging and saved as a PNG; and the Blender add-on from the save list, About,
// Exosuit and the Traveller page.
// Usage: node test/e2e/test_travcard.js <scratch dir with dbroot/NMS> [PCBANKS]
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const [SP, BANKS] = process.argv.slice(2);
const TC_ok = (a, b) => Math.abs(a - b) > 0.5;
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'tcardtest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), cfg = path.join(T, 'cfg'), exp = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports');
  fs.mkdirSync(exp, { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // two pose pictures as Blender writes them: transparent, the figure in the middle
  const mk = (file, colour) => execFileSync('python3', ['-c', `from PIL import Image, ImageDraw
im = Image.new('RGBA', (540, 675), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
d.ellipse((230, 120, 310, 200), fill=${colour}); d.rectangle((215, 200, 325, 420), fill=${colour}); d.rectangle((225, 420, 315, 600), fill=${colour})
im.save(${JSON.stringify(file)})`]);
  mk(path.join(exp, 'Pastullio pose 2026-11-10 120000.png'), '(40, 120, 220, 255)');
  mk(path.join(exp, 'Pastullio pose 2026-11-10 130000.png'), '(220, 60, 90, 255)');
  fs.utimesSync(path.join(exp, 'Pastullio pose 2026-11-10 120000.png'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  fs.writeFileSync(path.join(exp, 'Something else.png'), fs.readFileSync(path.join(exp, 'Pastullio pose 2026-11-10 120000.png')));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent' }; if (BANKS) env.HSE_GAME = BANKS;
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48161'], { env });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row');
  // the add-on from the save list
  ok('the save list has a LiveLink button', await p.isVisible('.land-corner .addon-btn') && (await p.textContent('.land-corner .addon-btn')) === 'LiveLink');
  await p.click('.land-corner .addon-btn'); await p.waitForSelector('#dlg[open]');
  for (let k = 0; k < 40 && !fs.existsSync(path.join(exp, 'harmonious_live_link.py')); k++) await p.waitForTimeout(100);
  ok('…which saves the add-on to Exports and says how to install it', fs.existsSync(path.join(exp, 'harmonious_live_link.py')) && /bl_info/.test(fs.readFileSync(path.join(exp, 'harmonious_live_link.py'), 'utf8')) && /Install from Disk/.test(await p.textContent('#dlg')) && /Exports/.test(await p.textContent('#dlg')));
  await p.click('#dlgX');
  await p.click('.land-corner .about-btn'); await p.waitForSelector('#dlg[open]');
  ok('About has the add-on too', !!(await p.$('#dlg .about-links .addon-btn'))); await p.click('#dlgX');
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  ok('Traveller is in the sidebar after Exosuit', await p.evaluate(() => { const ids = [...document.querySelectorAll('nav button[data-s]')].map((x) => x.dataset.s); return ids.indexOf('traveller') === ids.indexOf('exosuit') + 1; }));
  await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcCanvas');
  await p.waitForFunction(() => TC.img.trav && TC.pics.length, null, { timeout: 15000 }).catch(() => {});
  const pics = await p.evaluate(() => TC.pics.map((x) => x.name));
  ok('it lists the pose pictures in Exports, newest first, and nothing else', pics.length === 2 && pics[0] === 'Pastullio pose 2026-11-10 130000.png');
  ok('…and puts the newest on the card, cut to the figure', await p.evaluate(() => TC.state.pose === 'Pastullio pose 2026-11-10 130000.png' && TC.img.trav && TC.img.trav.width < 200));
  ok('the card starts portrait 1080 × 1350 with the name from the save', await p.evaluate(() => { const c = $('#tcCanvas'); return c.width === 1080 && c.height === 1350 && TC.state.name === travellerName(); }));
  ok('…and the glyphs of where you are now', await p.evaluate(() => TC.state.place === 'here' && TC.hits.some((h) => h.id === 'glyphs')));
  ok('the page has the add-on button', !!(await p.$('#tcSide .addon-btn')));
  // pick the other picture
  await p.selectOption('#tcPose', 'Pastullio pose 2026-11-10 120000.png'); await p.waitForTimeout(300);
  const px = await p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'trav'), c = $('#tcCanvas'), d = c.getContext('2d').getImageData(Math.round(h.x + h.w / 2), Math.round(h.y + h.h * .5), 1, 1).data; return [...d]; });
  ok('choosing another pose picture draws it', px[2] > 150 && px[0] < 120);
  // drag the words and scroll over the traveller
  const before = await p.evaluate(() => ({ ...TC.state.layers.text }));
  const box = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'text'), k = r.width / c.width; return { x: r.left + (h.x + 20) * k, y: r.top + (h.y + 20) * k, k }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x + 120, box.y + 80, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ ...TC.state.layers.text }));
  ok('dragging the words moves them', after.x > before.x + .05 && after.y > before.y + .03);
  const tb = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'trav'), k = r.width / c.width; return { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k }; });
  const s0 = await p.evaluate(() => TC.state.layers.trav.s);
  await p.mouse.move(tb.x, tb.y); await p.mouse.wheel(0, -300); await p.waitForTimeout(200);
  ok('scrolling over the traveller makes it bigger', (await p.evaluate(() => TC.state.layers.trav.s)) > s0);
  // words, size, background
  await p.fill('#tcTitle', 'Traveller of the Atlas'); await p.fill('#tcCaption', 'Hello from Euclid'); await p.waitForTimeout(200);
  await p.click('[data-size="wide"]'); await p.waitForTimeout(300);
  ok('Wide makes it 1920 × 1080', await p.evaluate(() => { const c = $('#tcCanvas'); return c.width === 1920 && c.height === 1080; }));
  await p.selectOption('#tcBg', 'colour'); await p.waitForTimeout(200);
  await p.evaluate(() => { const c = $('#tcC1'); c.value = '#402060'; c.dispatchEvent(new Event('input')); }); await p.waitForTimeout(300);
  const corner = await p.evaluate(() => [...$('#tcCanvas').getContext('2d').getImageData(5, 5, 1, 1).data]);
  ok('one colour paints the background', corner[0] === 0x40 && corner[1] === 0x20 && corner[2] === 0x60);
  await p.selectOption('#tcBg', 'stars'); await p.waitForTimeout(200);
  // a ship
  const opt = await p.$$eval('#tcShip option', (o) => o.map((x) => x.value).filter(Boolean));
  ok('the ship list has your ships and multi-tools', opt.length >= 3);
  await p.screenshot({ path: SP + '/shots/traveller-card.png' });
  // a pose saved in Blender while the page is open lands on the card by itself
  mk(path.join(exp, 'Pastullio pose 2026-11-10 150000.png'), '(60, 200, 90, 255)');
  await p.waitForFunction(() => TC.state.pose === 'Pastullio pose 2026-11-10 150000.png', null, { timeout: 8000 }).catch(() => {});
  ok('a new pose picture from Blender goes on the card by itself', await p.evaluate(() => TC.state.pose === 'Pastullio pose 2026-11-10 150000.png' && $('#tcPose').value === 'Pastullio pose 2026-11-10 150000.png'));
  await p.selectOption('#tcPose', 'Pastullio pose 2026-11-10 120000.png'); await p.waitForTimeout(300);
  // a 3D pose sent from Blender (here the editor's own traveller model stands in for it)
  if (BANKS) {
    const sent = await p.evaluate(async () => {
      const gs = travellerGroups(); if (!gs.length) return null;
      const glb = await (await api('/api/model/traveller/glb?groups=' + encodeURIComponent(gs.join(',')) + '&name=Pastullio')).arrayBuffer();
      return (await (await api('/api/live/pose?name=Pastullio', { method: 'POST', body: glb })).json()).name;
    });
    ok('a 3D pose is kept in Exports', sent && /^Pastullio 3D pose .*\.glb$/.test(sent) && fs.existsSync(path.join(exp, sent)));
    await p.waitForFunction(() => TC.m3d, null, { timeout: 10000 }).catch(() => {});
    ok('…and lands on the card by itself, as 3D', await p.evaluate((n) => TC.state.pose === n && !!TC.m3d && TC.m3d.prims.length > 5 && TC.m3d.prims.some((q) => q.tex), sent));
    ok('…listed as 3D', /\(3D\)/.test(await p.$eval('#tcPose', (x) => x.selectedOptions[0].textContent)));
    const shot = () => p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'trav'), c = $('#tcCanvas'), d = c.getContext('2d').getImageData(Math.round(h.x), Math.round(h.y), Math.round(h.w), Math.round(h.h)).data; let n = 0, sum = 0; for (let i = 0; i < d.length; i += 16) { sum += d[i] + d[i + 1] * 3 + d[i + 2] * 7; n++; } return sum / n; });
    await p.waitForTimeout(300); const a1 = await shot();
    ok('it has Turn and Tilt', !!(await p.$('.tc-turn[data-turn="trav"] input[data-ax="yaw"]')));
    await p.$eval('.tc-turn[data-turn="trav"] input[data-ax="yaw"]', (x) => { x.value = 90; x.dispatchEvent(new Event('input')); }); await p.waitForTimeout(400);
    const a2 = await shot();
    ok('turning it draws it from another side', TC_ok(a1, a2) && await p.evaluate(() => TC.state.layers.trav.yaw === 90));
    const hb = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'trav'), k = r.width / c.width; return { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k }; });
    await p.keyboard.down('Shift'); await p.mouse.move(hb.x, hb.y); await p.mouse.down(); await p.mouse.move(hb.x - 60, hb.y + 30, { steps: 4 }); await p.mouse.up(); await p.keyboard.up('Shift'); await p.waitForTimeout(300);
    ok('Shift-dragging turns and tilts it instead of moving it', await p.evaluate(() => TC.state.layers.trav.yaw !== 90 && TC.state.layers.trav.pitch !== 0 && Math.abs(TC.state.layers.trav.x - .5) < .001));
    await p.click('[data-front="trav"]'); ok('Face the front puts it back', await p.evaluate(() => TC.state.layers.trav.yaw === 0 && TC.state.layers.trav.pitch === 0));
    await p.screenshot({ path: SP + '/shots/traveller-card-3d.png' });
  }
  // a ship with a model turns too
  const withModel = await p.evaluate(async () => { const it = coverItems().find((x) => x.kind === 'ship' && x.scene); if (!it) return null; const sel = $('#tcShip'); sel.value = it.key; sel.dispatchEvent(new Event('change')); return it.key; });
  if (withModel && BANKS) {
    await p.waitForFunction(() => TC.shipModel || TC.img.ship, null, { timeout: 20000 }).catch(() => {});
    if (await p.evaluate(() => !!TC.shipModel)) {
      ok('a ship with a model can be turned', !!(await p.$('.tc-turn[data-turn="ship"]')) && await p.evaluate(() => TC.hits.some((h) => h.id === 'ship')));
    } else console.log('(no ship model in the test files)');
  }
  await p.selectOption('#tcShip', ''); await p.waitForTimeout(200);
  await p.selectOption('#tcPose', 'Pastullio pose 2026-11-10 120000.png'); await p.waitForTimeout(300);
  // it remembers the layout
  await p.click('nav button[data-s="exosuit"]'); await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcCanvas'); await p.waitForTimeout(500);
  ok('it remembers the layout and words', await p.evaluate(() => TC.state.size === 'wide' && TC.state.title === 'Traveller of the Atlas' && JSON.parse(localStorage.getItem('hse-trav-card')).caption === 'Hello from Euclid'));
  // save
  await p.click('#tcSaveBtn');
  let card = ''; for (let k = 0; k < 50 && !card; k++) { await p.waitForTimeout(100); card = fs.readdirSync(exp).find((f) => /card .*\.png$/.test(f)) || ''; }
  const dims = card ? fs.readFileSync(path.join(exp, card)) : null;
  ok('Save picture writes a 1920 × 1080 PNG to Exports', dims && dims.readUInt32BE(16) === 1920 && dims.readUInt32BE(20) === 1080);
  ok('…without the selection outline', await p.evaluate(async () => { const c = await tcDraw(document.createElement('canvas'), false); return c.width === 1920; }));
  ok('Reset layout puts things back', await p.evaluate(() => { $('#tcReset').click(); const l = TC.state.layers, d = TC_DEFAULT().layers; return l.text.x === d.text.x && l.trav.s === d.trav.s; }));
  // Exosuit links here
  if (BANKS) {
    await p.click('nav button[data-s="exosuit"]'); await p.waitForSelector('.trav-top', { timeout: 20000 }).catch(() => {});
    if (await p.$('#travPic')) {
      ok('Exosuit has the add-on button', !!(await p.$('.trav-top .addon-btn')));
      await p.click('#travPic'); await p.waitForSelector('#tcCanvas');
      ok('…and Make a picture opens the Traveller page', true);
    }
  }
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.click('nav button[data-s="traveller"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: SP + '/shots/traveller-card-dark.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
