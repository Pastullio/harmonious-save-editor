const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
// A corvette in 3D on the Traveller page without opening Blender (owner 2026-11-12): picking it makes its model in the
// background with the owner's Blender and Charon Forge (hidden, like covers), then it turns with the middle button.
// Needs what test_render.js needs: bpy 4.5 at <scratch>/bpyenv, Charon Forge under ~/.config/blender/4.5/extensions/user_default,
// a real save in <scratch>/dbroot/NMS. Usage: node test/e2e/test_corvette3d.js <scratch>
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'c3cfg'), root = path.join(SP, 'c3root'), home = path.join(SP, 'c3home');
  for (const d of [cfg, root, home]) fs.rmSync(d, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true }); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'HarmoniousSaveEditor'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'settings.json'), JSON.stringify({ size: 256, samples: 4, autoRender: false, charon: path.join(require('os').homedir(), '.config/blender/4.5/extensions/user_default') }));
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48016'], { env: { ...process.env, SP, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: path.join(__dirname, 'fake-blender.sh') } });
  proc.stderr.on('data', () => {});
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcShip', { state: 'attached' });
  const corv = await p.evaluate(() => { const c = coverItems().find((x) => x.kind === 'corvette'); return c && { key: c.key, name: c.name }; });
  ok('the save has a corvette', !!corv);
  await p.click('.tc-box[data-box="ship"] summary'); await p.waitForSelector('#tcShip');
  await p.selectOption('#tcShip', corv.key);
  await p.waitForFunction(() => /Making it in 3D/.test((document.querySelector('#tc3dNote') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  ok('picking the corvette starts making it in 3D, and says so', /Making it in 3D/.test(await p.evaluate(() => (document.querySelector('#tc3dNote') || {}).textContent || '')));
  const t0 = Date.now();
  await p.waitForFunction(() => TC.shipGlb && tcShipMode() === '3d', null, { timeout: 600000, polling: 1000 }).catch(() => {});
  console.log('made in', Math.round((Date.now() - t0) / 1000), 's');
  ok('…and when it is made, the corvette shows in 3D', await p.evaluate(() => !!TC.shipGlb && tcShipMode() === '3d' && tcIs3d('ship')));
  const glbs = fs.readdirSync(path.join(cfg, 'HarmoniousSaveEditor', 'covers')).filter((f) => /^[0-9a-f]+\.glb$/.test(f));
  ok('the model is kept with the covers', glbs.length === 1 && fs.statSync(path.join(cfg, 'HarmoniousSaveEditor', 'covers', glbs[0])).size > 10000);
  ok('it says it is ready', /ready in 3D/.test(await p.textContent('#toast')));
  await p.waitForTimeout(800);
  const drawn = await p.evaluate(() => { const h = TC.hits.find((x) => x.id === 'ship'); if (!h) return 0; const c = $('#tcCanvas'), d = c.getContext('2d').getImageData(Math.max(0, h.x), Math.max(0, h.y), Math.min(h.w, c.width - h.x), Math.min(h.h, c.height - h.y)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; });
  ok('it is drawn on the picture (' + drawn + ' bright pixels)', drawn > 300);
  // the middle button turns it, as with the traveller
  const box = await p.$eval('#tcCanvas', (c) => { const r = c.getBoundingClientRect(), h = TC.hits.find((x) => x.id === 'ship'), k = r.width / c.width; return { x: r.left + (h.x + h.w / 2) * k, y: r.top + (h.y + h.h / 2) * k }; });
  const y0 = await p.evaluate(() => TC.state.layers.ship.yaw);
  await p.mouse.move(box.x, box.y); await p.mouse.down({ button: 'middle' }); await p.mouse.move(box.x + 90, box.y + 20, { steps: 6 }); await p.mouse.up({ button: 'middle' }); await p.waitForTimeout(300);
  ok('the middle button turns it', await p.evaluate((y0) => TC.state.layers.ship.yaw !== y0, y0));
  // find the angle, then Render this angle: Blender renders it with its textures from that angle, in the same spot
  await p.evaluate(() => { TC.state.layers.ship.yaw = 60; TC.state.layers.ship.pitch = 25; TC.cache.ship = null; });
  ok('a 3D corvette offers Render this angle', await p.isVisible('#tcRenderAngle'));
  await p.click('#tcRenderAngle');
  await p.waitForFunction(() => tcShipMode() === 'renders' && TC.state.shipView === 'a60_25', null, { timeout: 600000, polling: 1000 }).catch(() => {});
  ok('…which renders it and shows the picture in its place', await p.evaluate(() => tcShipMode() === 'renders' && TC.state.shipView === 'a60_25' && !!TC.img.ship));
  ok('…kept with the covers', fs.readdirSync(path.join(cfg, 'HarmoniousSaveEditor', 'covers')).some((f) => /^[0-9a-f]+-a60_25\.png$/.test(f)));
  // the render matches the preview's outline (Blender's camera from the same side and height)
  const fit = await p.evaluate(() => {
    const mask = (im) => { const c = document.createElement('canvas'); c.width = c.height = 200; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 200, 200); const d = x.getImageData(0, 0, 200, 200).data, m = []; for (let i = 0; i < d.length; i += 4) m.push(d[i + 3] > 20); return m; };
    const iou = (a, b) => { let i = 0, u = 0; a.forEach((v, k) => { if (v && b[k]) i++; if (v || b[k]) u++; }); return i / Math.max(1, u); };
    const r = Math.PI / 180, pre = mask(GLTEX.render(TC.shipGlb, 512, 60 * r, 25 * r, 'studio')), ren = mask(TC.img.ship), mir = mask(GLTEX.render(TC.shipGlb, 512, -60 * r, 25 * r, 'studio'));
    return [iou(pre, ren), iou(mir, ren)].map((v) => Math.round(v * 100) / 100);
  });
  ok('…seen from the same side as the 3D preview (outline overlap ' + fit[0] + ', the mirrored side ' + fit[1] + ')', fit[0] > .55 && fit[0] > fit[1]);
  await p.$eval('#tcCanvas', (c) => c.toDataURL()).then((u) => fs.writeFileSync(path.join(SP, 'c3angle.png'), Buffer.from(u.split(',')[1], 'base64')));
  ok('a 3D model button brings the turning back', await p.evaluate(() => tcShipModes().includes('3d')));
  // another visit: the model is there already, nothing is made again
  await p.click('nav button[data-s="exosuit"]'); await p.waitForTimeout(300); await p.evaluate(() => { TC.shipGlb = null; TC.img.ship = null; });
  await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcShip', { state: 'attached' });
  await p.waitForFunction(() => TC.shipGlb && TC.shipViews.length, null, { timeout: 20000 }).catch(() => {});
  ok('coming back, the kept model loads straight away, and the rendered angle is still there', await p.evaluate(() => !!TC.shipGlb && !TC.making3d && TC.shipViews.some(([v]) => v === 'a60_25')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? fails.length + ' FAILED' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})();
