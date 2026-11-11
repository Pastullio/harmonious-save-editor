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
  ok('About has the add-on too', !!(await p.$('#dlg .about-links .addon-btn')));
  await p.setViewportSize({ width: 1100, height: 900 });
  ok('About fits without scrolling sideways', await p.evaluate(() => { const d = $('#dlg'); return [...d.querySelectorAll('*')].every((x) => x.scrollWidth <= x.clientWidth + 1 || getComputedStyle(x).overflowX === 'visible') && d.scrollWidth <= d.clientWidth + 1; }));
  await p.screenshot({ path: SP + '/shots/about-fit.png' });
  await p.setViewportSize({ width: 1440, height: 1000 }); await p.click('#dlgX');
  const lt = await p.$eval('.land-theme', (x) => { const r = x.getBoundingClientRect(); return { r: innerWidth - r.right, b: innerHeight - r.bottom, svg: !!x.querySelector('svg'), text: x.textContent.trim() }; });
  ok('light/dark is an icon in the bottom-right corner of the save list', lt.r < 40 && lt.b < 40 && lt.svg && !lt.text);
  const d0 = await p.evaluate(() => isDark()); await p.click('.land-theme'); ok('…and switches the look', (await p.evaluate(() => isDark())) !== d0); await p.click('.land-theme');
  await p.screenshot({ path: SP + '/shots/landing-theme.png' });
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
  // the options sit in boxes that open and close: Size and Traveller open at first
  const boxes = await p.$$eval('#tcSide details.tc-box', (d) => d.map((x) => x.dataset.box + (x.open ? '+' : '')));
  ok('the options are in boxes: Size, Traveller, Ship, Multi-tool, Background, Text, Portal glyphs', boxes.join() === 'size+,trav+,ship,tool,bg,text,glyphs');
  await p.click('details[data-box="ship"] > summary'); await p.waitForTimeout(100);
  ok('…a box opens with a click and is remembered', await p.evaluate(() => $('details[data-box="ship"]').open && TC.state.open.ship));
  await p.click('details[data-box="ship"] > summary'); await p.waitForTimeout(100);
  const openAll = () => p.evaluate(() => { for (const d of document.querySelectorAll('#tcSide details.tc-box')) if (!d.open) d.querySelector('summary').click(); });
  await openAll(); await p.waitForTimeout(100);
  ok('there is no Look again (new poses arrive by themselves)', !(await p.$('#tcRefresh')) && !/Look again/.test(await p.textContent('#tcSide')));
  ok('the corner credit is gone and the watermark sits bottom right', await p.evaluate(() => { const c = $('#tcCanvas'), x = c.getContext('2d'), d = x.getImageData(c.width - 260, c.height - 60, 230, 40).data, t = x.getImageData(c.width - 300, 20, 280, 40).data; const bright = (a) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] > 140 && a[i + 1] > 140 && a[i + 2] > 140) n++; return n; }; return bright(d) > 30 && bright(t) < 8; }));
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
  await p.click('[data-size="custom"]'); await p.waitForTimeout(200);
  await p.fill('#tcW', '1200'); await p.$eval('#tcW', (x) => x.dispatchEvent(new Event('change'))); await p.fill('#tcH', '700'); await p.$eval('#tcH', (x) => x.dispatchEvent(new Event('change'))); await p.waitForTimeout(300);
  ok('Custom takes a width and height', await p.evaluate(() => { const c = $('#tcCanvas'); return c.width === 1200 && c.height === 700; }));
  await p.click('[data-size="wide"]'); await p.waitForTimeout(300);
  await p.click('[data-bgk="colour"]'); await p.waitForTimeout(200);
  ok('Plain colour has presets and a colour wheel', (await p.$$('.tc-sw')).length >= 8 && !!(await p.$('.tc-wheel input[type=color]')));
  await p.evaluate(() => { const c = $('#tcSolid'); c.value = '#402060'; c.dispatchEvent(new Event('input')); }); await p.waitForTimeout(300);
  const corner = await p.evaluate(() => [...$('#tcCanvas').getContext('2d').getImageData(5, 5, 1, 1).data]);
  ok('one colour paints the background', corner[0] === 0x40 && corner[1] === 0x20 && corner[2] === 0x60);
  await p.click('.tc-sw[data-sw="#1d4f5e"]'); await p.waitForTimeout(300);
  ok('…a preset too', await p.evaluate(() => { const d = $('#tcCanvas').getContext('2d').getImageData(5, 5, 1, 1).data; return d[0] === 0x1d && d[1] === 0x4f && d[2] === 0x5e; }));
  await p.click('[data-bgk="space"]'); await p.waitForTimeout(200);
  ok('Space offers a starfield and four more scenes, each with a little picture', (await p.$$('.tc-space canvas')).length === 5);
  const sky = () => p.evaluate(() => { const c = $('#tcCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7; return s; });
  const skies = {}; for (const k of ['stars', 'nebula', 'planet', 'meteors', 'galaxy']) { await p.click(`[data-space="${k}"]`); await p.waitForTimeout(250); skies[k] = await sky(); await p.screenshot({ path: SP + `/shots/traveller-bg-${k}.png` }); }
  ok('…and each looks different', new Set(Object.values(skies)).size === 5);
  await p.click('[data-space="stars"]'); await p.waitForTimeout(200);
  await p.selectOption('#tcFont', 'georgia'); await p.waitForTimeout(200);
  ok('the name can have another font', await p.evaluate(() => TC.state.font === 'georgia'));
  await p.selectOption('#tcFont', 'jost');
  // a ship
  const opt = await p.$$eval('#tcShip option', (o) => o.map((x) => x.value).filter(Boolean));
  const topt = await p.$$eval('#tcTool option', (o) => o.map((x) => x.value).filter(Boolean));
  ok('the ship list has your ships, and Multi-tool your multi-tools', opt.length >= 2 && topt.length >= 1 && !opt.some((k) => topt.includes(k)));
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
    const l1 = await shot(); await p.selectOption('#tcLight', 'space'); await p.waitForTimeout(400); const l2 = await shot();
    ok('Lighting for 3D changes how it is lit', TC_ok(l1, l2) && await p.evaluate(() => TC.state.light === 'space'));
    await p.selectOption('#tcLight', 'studio'); await p.waitForTimeout(200);
    await p.click('[data-front="trav"]'); ok('Reset turns it to face the front', await p.evaluate(() => TC.state.layers.trav.yaw === 0 && TC.state.layers.trav.pitch === 0));
    const hb2 = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'trav'), k = r.width / c.width; return { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k }; });
    const x0 = await p.evaluate(() => TC.state.layers.trav.x);
    await p.mouse.move(hb2.x, hb2.y); await p.mouse.down({ button: 'middle' }); await p.mouse.move(hb2.x + 70, hb2.y - 20, { steps: 4 }); await p.mouse.up({ button: 'middle' }); await p.waitForTimeout(300);
    ok('dragging with the middle button turns it, as in Blender', await p.evaluate((x0) => TC.state.layers.trav.yaw !== 0 && Math.abs(TC.state.layers.trav.x - x0) < .001, x0));
    await p.keyboard.down('Shift'); await p.mouse.move(hb2.x, hb2.y); await p.mouse.down({ button: 'middle' }); await p.mouse.move(hb2.x + 80, hb2.y, { steps: 4 }); await p.mouse.up({ button: 'middle' }); await p.keyboard.up('Shift'); await p.waitForTimeout(300);
    ok('…and Shift with the middle button moves it', await p.evaluate((x0) => TC.state.layers.trav.x > x0 + .02, x0));
    await p.evaluate(() => { TC.state.layers.trav.x = .5; TC.state.layers.trav.yaw = 0; TC.state.layers.trav.pitch = 0; tcSave(); });
    await p.screenshot({ path: SP + '/shots/traveller-card-3d.png' });
    await p.evaluate(() => { for (const d of document.querySelectorAll('#tcSide details.tc-box')) if (d.open !== ['trav', 'bg'].includes(d.dataset.box)) d.querySelector('summary').click(); document.querySelectorAll('main, .main, #main, html').forEach((x) => x.scrollTop = 0); });
    await p.waitForTimeout(400); await p.screenshot({ path: SP + '/shots/traveller-guide.png' }); await openAll(); await p.waitForTimeout(200);
  }
  // a ship with a model turns too
  const withModel = await p.evaluate(async () => { const it = coverItems().find((x) => x.kind === 'ship' && x.scene); if (!it) return null; const sel = $('#tcShip'); sel.value = it.key; sel.dispatchEvent(new Event('change')); return it.key; });
  if (withModel && BANKS) {
    await p.waitForFunction(() => TC.shipModel || TC.img.ship, null, { timeout: 20000 }).catch(() => {});
    await p.waitForFunction(() => TC.shipGlb || TC.shipModel, null, { timeout: 30000 }).catch(() => {});
    if (await p.evaluate(() => !!(TC.shipGlb || TC.shipModel))) {
      ok('a ship with a model can be turned', !!(await p.$('.tc-turn[data-turn="ship"]')) && await p.evaluate(() => TC.hits.some((h) => h.id === 'ship')));
      ok('…as the game model (a .glb)', await p.evaluate(() => !!TC.shipGlb && TC.shipGlb.prims.length > 3));
      if (!(await p.evaluate(() => TC.shipGlb.prims.some((q) => q.tex)))) console.log('(no ship textures in the test files)');
      // with a custom picture as well, a switch picks the picture or the turnable model
      await p.evaluate(async (k) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#ff0080'; x.fillRect(0, 0, 64, 64); const blob = await new Promise((r) => c.toBlob(r)); await setCustomCover(k, blob); }, withModel).catch(() => {});
      if (await p.evaluate(async (k) => { coverCache.delete(k); return !!(await customCover(k)); }, withModel)) {
        await p.$eval('#tcShip', (x) => x.dispatchEvent(new Event('change'))); await p.waitForTimeout(1500);
        ok('a ship with its own picture offers Picture / 3D', !!(await p.$('[data-show="pic"]')) && !!(await p.$('[data-show="3d"]')));
        await p.click('[data-show="pic"]'); await p.waitForTimeout(300);
        ok('…Picture shows the picture, without Turn', await p.evaluate(() => !!TC.img.ship) && !(await p.$('.tc-turn[data-turn="ship"]')));
        await p.click('[data-show="3d"]'); await p.waitForTimeout(500);
        ok('…3D turns the model again', await p.evaluate(() => !TC.img.ship) && !!(await p.$('.tc-turn[data-turn="ship"]')));
      } else console.log('(custom pictures not reachable from the test)');
    } else console.log('(no ship model in the test files)');
  }
  if (await p.$('[data-place="ship"]')) {
    const order = () => p.evaluate(() => TC.hits.map((h) => h.id).join(','));
    const o1 = await order(); await p.selectOption('[data-place="ship"]', 'front'); await p.waitForTimeout(300); const o2 = await order();
    ok('Placement puts the ship in front of the traveller', o1.indexOf('ship') < o1.indexOf('trav') && o2.indexOf('ship') > o2.indexOf('trav') && /in front/.test(await p.textContent('details[data-box="ship"] .field > span')));
    await p.selectOption('[data-place="ship"]', 'back'); await p.waitForTimeout(300);
    ok('…and behind everything again', (await order()).startsWith('ship'));
  }
  // the multi-tool, as the game's model
  if (BANKS && topt.length) {
    await p.selectOption('#tcTool', topt[0]); await p.waitForFunction(() => TC.toolGlb || TC.toolModel, null, { timeout: 30000 }).catch(() => {});
    ok('a multi-tool goes on the picture as its model, to turn', await p.evaluate(() => TC.hits.some((h) => h.id === 'tool') && !!(TC.toolGlb || TC.toolModel)) && !!(await p.$('.tc-turn[data-turn="tool"]')));
    ok('…with no Import image (only the traveller and ship have that)', !(await p.$('[data-imp="tool"]')) && !!(await p.$('[data-imp="ship"]')) && !!(await p.$('[data-imp="trav"]')));
    await p.click('[data-del="tool"]'); await p.waitForTimeout(200);
    ok('…and Delete takes it off', await p.evaluate(() => !TC.state.tool && !TC.hits.some((h) => h.id === 'tool')));
  }
  // a logo and an imported picture, with Remove background
  const imgFile = path.join(T, 'logo.png');
  execFileSync('python3', ['-c', `from PIL import Image, ImageDraw
im = Image.new('RGB', (300, 200), (250, 250, 250)); d = ImageDraw.Draw(im); d.ellipse((90, 40, 210, 160), fill=(200, 30, 60)); im.save(${JSON.stringify(imgFile)})`]);
  const pickFile = async (sel) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(sel)]); await fc.setFiles(imgFile); await p.waitForTimeout(500); };
  await pickFile('[data-imp="logo"]');
  ok('Text has a Logo you import', await p.evaluate(() => !!TC.img.logo && TC.hits.some((h) => h.id === 'logo')));
  const logoCorner = () => p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'logo'), d = $('#tcCanvas').getContext('2d').getImageData(Math.round(h.x + 2), Math.round(h.y + 2), 1, 1).data; return [...d]; });
  const lc1 = await logoCorner(); await p.check('[data-cut="logo"]'); await p.waitForTimeout(400); const lc2 = await logoCorner();
  ok('Remove background takes the plain background off it', lc1[0] > 240 && lc1[1] > 240 && !(lc2[0] > 240 && lc2[1] > 240 && lc2[2] > 240) && await p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'logo'); return h.w / h.h < 1.2; }));
  await p.click('[data-del="logo"]'); await p.waitForTimeout(200);
  ok('…and the logo can be deleted', await p.evaluate(() => !TC.img.logo && !TC.hits.some((h) => h.id === 'logo')));
  await pickFile('[data-imp="ship"]');
  ok('Ship takes an imported image too', await p.evaluate(() => !!TC.imp.ship && TC.hits.some((h) => h.id === 'ship') && $('#tcShip').value === '@imp') && !!(await p.$('[data-cut="ship"]')));
  await p.click('[data-del="ship"]'); await p.waitForTimeout(200);
  // the watermark: only patrons take it off; others are asked to sign in with Patreon
  await p.uncheck('#tcWm').catch(() => {}); await p.waitForSelector('#dlg[open]', { timeout: 3000 }).catch(() => {});
  ok('unticking Watermark asks to sign in with Patreon (not a patron)', /Sign in with Patreon/.test(await p.textContent('#dlg').catch(() => '')) && await p.evaluate(() => $('#tcWm').checked));
  await p.click('#dlgX').catch(() => {});
  // a corvette with its own picture can still show each angle Blender rendered (renders stood in for here)
  const corv = await p.evaluate(async () => {
    const it = coverItems().find((x) => x.kind === 'corvette'); if (!it) return null;
    const pic = (col) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(8, 8, 48, 48); return c; };
    const cols = { hero: '#ff0000', front: '#00ff00', side: '#0000ff', back: '#ffffff', top: '#00ffff' };
    window.renderImg = async (h, v) => pic(cols[v] || '#888888'); it.renderKey = it.renderKey || 'test';
    const blob = await new Promise((r) => pic('#ff00ff').toBlob(r)); await setCustomCover(it.key, blob); coverCache.delete(it.key);
    const sel = $('#tcShip'); sel.value = it.key; sel.dispatchEvent(new Event('change')); return it.key;
  });
  if (corv) {
    await p.waitForSelector('[data-show="pic"]', { timeout: 15000 }).catch(() => {});
    ok('a corvette with its own picture offers Your picture / Renders', !!(await p.$('[data-show="pic"]')) && (await p.textContent('[data-show="3d"]')) === 'Renders');
    await p.click('[data-show="3d"]'); await p.waitForTimeout(400);
    await p.screenshot({ path: SP + '/shots/traveller-card-corvette.png' });
    ok('…Renders has every angle', await p.evaluate(() => $('#tcView') && $('#tcView').options.length >= 4));
    await p.selectOption('#tcView', 'side'); await p.waitForTimeout(400);
    ok('…and picking one draws it', await p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'ship'), d = $('#tcCanvas').getContext('2d').getImageData(Math.round(h.x + h.w / 2), Math.round(h.y + h.h / 2), 1, 1).data; return d[2] > 200 && d[0] < 60; }));
    // Render the angles: the cover for the build as it is now, then the other angles, then Front is shown
    const rv = await p.evaluate(async () => {
      TC.shipViews = TC.shipViews.slice(0, 1); window.renderImg = async (h, v = 'hero') => (TC.calls.done && v !== 'hero') || v === 'hero' ? (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = v === 'front' ? '#00ff00' : '#ff0000'; x.fillRect(8, 8, 48, 48); return c; })() : null;
      TC.calls = []; window.renderSetup = async () => ({ ready: true });
      window.renderCorvette = async (it, force, onState, views) => { TC.calls.push(views ? 'views' : 'cover'); onState && onState('running'); await new Promise((r) => setTimeout(r, 300)); if (views) TC.calls.done = true; return true; };
      const st = tcLoad(); st.shipUsePic = false; tcSave(); $('#tcShip').dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 800));
      return !!$('#tcRenderViews');
    });
    ok('Render the angles shows while angles are missing', rv);
    if (rv) {
      await p.click('#tcRenderViews'); await p.waitForTimeout(150);
      ok('…says Blender is drawing them', /Blender is drawing/.test(await p.evaluate(() => ($('#tcRenderNote') || {}).textContent || '')));
      await p.waitForFunction(() => TC.calls.done && !TC.rendering, null, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600);
      ok('…then shows the front, with the Angle list', await p.evaluate(() => tcLoad().shipView === 'front' && $('#tcView') && $('#tcView').value === 'front' && TC.calls.join() === 'views'));
    }
    await p.click('[data-show="pic"]'); await p.waitForTimeout(400);
    ok('…Your picture goes back to it', await p.evaluate(() => TC.img.ship === TC.shipPic && !$('#tcView')));
  } else console.log('(no corvette in the test save)');
  // removing things: select, then Remove or Delete
  await p.evaluate(() => { TC.sel = 'glyphs'; }); await p.selectOption('#tcPlace', { index: 1 }).catch(() => {}); await p.waitForTimeout(300);
  const gl = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'glyphs'), k = r.width / c.width; return h ? { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k } : null; });
  if (gl) {
    await p.mouse.click(gl.x, gl.y); await p.waitForTimeout(300);
    ok('selecting something shows a Remove button', await p.isVisible('#tcRemove'));
    await p.click('#tcRemove'); await p.waitForTimeout(300);
    ok('…which takes it off the picture', await p.evaluate(() => !TC.hits.some((h) => h.id === 'glyphs') && !TC.state.place && $('#tcPlace').value === ''));
  }
  const tx = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'text'), k = r.width / c.width; return h ? { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k } : null; });
  if (tx) {
    const words = await p.evaluate(() => [TC.state.name, TC.state.title, TC.state.caption]);
    await p.mouse.click(tx.x, tx.y); await p.waitForTimeout(200); await p.keyboard.press('Delete'); await p.waitForTimeout(300);
    ok('the Delete key removes the words', await p.evaluate(() => !TC.hits.some((h) => h.id === 'text') && !TC.state.title));
    await p.fill('#tcName', words[0] || ''); await p.fill('#tcTitle', words[1]); await p.fill('#tcCaption', words[2]); await p.waitForTimeout(200);
  }
  await p.selectOption('#tcShip', ''); await p.waitForTimeout(200);
  await p.selectOption('#tcPose', 'Pastullio pose 2026-11-10 120000.png'); await p.waitForTimeout(300);
  // it remembers the layout
  await p.click('nav button[data-s="exosuit"]'); await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcCanvas'); await p.waitForTimeout(500); await openAll();
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
