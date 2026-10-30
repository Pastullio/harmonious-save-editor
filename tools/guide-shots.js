// Retakes the user guide's screenshots (docs/guide/shots/*.webp) from a running desktop app.
// Start the app on a copy of a real save, with the game's files for item names and models, e.g.
//   XDG_CONFIG_HOME=<cfg> HOME=<home> HSE_GAME=<PCBANKS> HSE_BLENDER=/nonexistent dist/hse-linux -no-window -root <saves> -port 48100
// (copy rendered corvette covers into <cfg>/HarmoniousSaveEditor/covers and an accountdata pair next to the save for the
// Rewards page), then: node tools/guide-shots.js http://127.0.0.1:48100/
// Paths from this machine are swapped for Windows-looking ones before each picture. Needs Pillow (python3) for WebP.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const URL = process.argv[2] || 'http://127.0.0.1:48100/', OUT = path.join(__dirname, '../docs/guide/shots'), TMP = fs.mkdtempSync('/tmp/guide-shots-');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => console.log('page error:', e.message));
  await p.addInitScript(() => { try { localStorage.setItem('hse-theme', 'dark'); localStorage.setItem('hse-dockyard-spot', 'hidden'); localStorage.setItem('hse-cover-view', 'flow');
    for (const k of ['dockyard', 'shipwright', 'bases', 'companions', 'knowledge', 'standing', 'difficulty', 'rewards', 'cargo']) localStorage.setItem('hse-' + k + '-seen', '1'); } catch (_) {} });
  const wait = (ms) => p.waitForTimeout(ms);
  const go = async (s, ms = 2500) => { await p.click(`nav button[data-s="${s}"]`); await wait(ms); await p.evaluate(() => { const m = document.querySelector('#main'); if (m) m.scrollTop = 0; }); };
  const shot = async (name) => {
    await p.evaluate(() => {
      // game folders first, then anything else (the save folder) becomes the usual Windows save folder
      const fix = (t) => t.replace(/\/(tmp|home|root)\/[^\s"'<]*?(PCBANKS|banks)\b/gi, "C:\\Program Files (x86)\\Steam\\steamapps\\common\\No Man's Sky\\GAMEDATA\\PCBANKS")
        .replace(/\/(tmp|home|root)\/[^\s"'<]+/g, 'C:\\Users\\you\\AppData\\Roaming\\HelloGames\\NMS\\st_76561198000000000');
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { if (/(^|\s)\/(tmp|home|root)\//.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue); n.nodeValue = n.nodeValue.replace(/\. [\d,]+ icons couldn't be read\./, '.'); }
      document.querySelectorAll('input').forEach((i) => { if (/^\/(tmp|home|root)\//.test(i.value)) i.value = fix(i.value); });
      const t = document.querySelector('#toast'); if (t) t.classList.remove('show');
    });
    await p.screenshot({ path: path.join(TMP, name + '.png') }); console.log(name);
  };
  await p.goto(URL); await p.waitForSelector('.slot-row'); await wait(1500); await shot('saves');
  await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await wait(4000); await shot('overview');
  const pages = { shipwright: 'shipwright', coords: 'coords', tools: 'tools', ships: 'ships', freighter: 'freighter', vehicles: 'vehicles', companions: 'companions', bases: 'bases', storage: 'storage', cargo: 'cargo', knowledge: 'knowledge', rewards: 'rewards', standing: 'standing', difficulty: 'difficulty', items: 'items', raw: 'raw' };
  for (const [s, name] of Object.entries(pages)) { await go(s); await shot(name); }
  await go('hangar', 2000); await p.click('.chip[data-f="corvette"]'); await wait(2500); await shot('hangar-corvettes');
  const front = await p.$('#hViews button:nth-child(3)'); if (front) { await front.click(); await wait(1500); await shot('hangar-views'); }
  await p.click('.chip[data-f="tool"]'); await wait(1500); if (await p.$('#hParts')) { await p.click('#hParts'); await p.waitForSelector('#dlg[open]'); await wait(9000); await shot('parts'); await p.click('#dlgX'); }
  await p.evaluate(() => localStorage.setItem('hse-cover-view', 'grid')); await go('hangar'); await shot('hangar-grid');
  await go('library', 3000); await p.click('.dy-tabs [data-v="garage"]'); await wait(3500); await shot('dockyard-garage');
  for (const c of await p.$$('.lib-card')) if (/versions/.test(await c.textContent())) { await c.click(); await p.waitForSelector('#dlg[open] .lib-detail'); await wait(2500); await shot('dockyard-card'); await p.click('#dlgX'); break; }
  await p.evaluate(() => localStorage.setItem('hse-cover-view', 'flow')); await go('library', 3000); await p.click('.dy-tabs [data-v="garage"]'); await wait(3500); await shot('dockyard-flow');
  await go('exosuit', 1500); const cell = (await p.$$('.cell.has'))[3]; if (cell) { await cell.click(); await wait(800); } await shot('exosuit-slot');
  await go('cargo', 1500); await p.click('[data-t="tidy"]'); await wait(1500); await shot('cargo-tidy');
  await go('coords', 2000); await p.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => /about this system/i.test(x.textContent)); if (h) h.scrollIntoView(); }); await wait(1500); await shot('coords-system');
  await go('freighter', 1500); await p.evaluate(() => { const h = document.querySelector('#frigates'); if (h) h.scrollIntoView(); }); await wait(800); await shot('frigates');
  await go('bases', 1500); await p.click('[data-t="settlements"]'); await wait(800); const v = await p.$('[data-st-tab="visited"]'); if (v) { await v.click(); await wait(1200); } await shot('settlements');
  await go('knowledge', 1500); await p.click('[data-t="words"]'); await wait(1500); await shot('knowledge-words');
  await go('overview', 1000); await p.keyboard.press('Control+k'); await p.keyboard.type('cutting'); await wait(1200); await shot('find'); await p.keyboard.press('Escape');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await go('overview', 1500); await shot('overview-light');
  await b.close();
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('python3', ['-c', 'import sys,glob,os\nfrom PIL import Image\nfor f in glob.glob(os.path.join(sys.argv[1],"*.png")):\n  Image.open(f).convert("RGB").save(os.path.join(sys.argv[2],os.path.basename(f)[:-4]+".webp"),"WEBP",quality=80,method=6)', TMP, OUT]);
  console.log('saved to', OUT);
})();
