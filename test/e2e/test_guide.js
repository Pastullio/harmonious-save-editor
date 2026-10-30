// The user guide: built into one file with its screenshots, served by the app at /guide and linked from the editor.
// node test/e2e/test_guide.js <dir>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'guidetest'); fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(path.join(T, 'root/st_1'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', path.join(T, 'root'), '-port', '48101'], { env: { ...process.env, XDG_CONFIG_HOME: path.join(T, 'cfg'), HOME: path.join(T, 'home'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const errs = [];
  const file = path.join(__dirname, '../../dist/Harmonious Save Editor Guide.html');
  ok('the guide sits next to the exe in dist', fs.existsSync(file) && fs.statSync(file).size > 500000);
  const html = fs.readFileSync(file, 'utf8');
  ok('everything is inlined: no outside pictures, scripts or fonts', !/src="shots\//.test(html) && !/@@/.test(html) && !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html));
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.land-corner .guide-btn');
  ok('the save list links to the guide', (await p.getAttribute('.land-corner .guide-btn', 'href')) === '/guide');
  ok('the sidebar and About link to it too', (await p.getAttribute('#sideRes .guide-link', 'href')) === '/guide' && /href="\$\{GUIDE_URL\}"/.test(fs.readFileSync(path.join(__dirname, '../../src/app.html'), 'utf8')));
  const r = await p.request.get(url + 'guide'); ok('the app serves the guide at /guide', r.ok() && (await r.text()).length === html.length);
  await p.goto(url + 'guide');
  const info = await p.evaluate(() => ({ pages: [...document.querySelectorAll('.page')].map((x) => x.id), nav: [...document.querySelectorAll('#nav a')].map((a) => a.getAttribute('href')),
    links: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)).filter(Boolean) }));
  ok('every page is in the contents', info.pages.length >= 28 && info.nav.length === info.pages.length);
  const missing = await p.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), [...new Set(info.links)]);
  ok('every link inside the guide goes somewhere', missing.length === 0); if (missing.length) console.log(missing);
  // every page shows, and every picture on it loads
  let broken = [];
  for (const id of info.pages) {
    await p.goto(url + 'guide#' + id); await p.waitForTimeout(80);
    const st = await p.evaluate(() => { const on = document.querySelectorAll('.page.on'); const imgs = [...on[0].querySelectorAll('img')]; return { on: on.length, id: on[0].id, imgs: imgs.length, bad: imgs.filter((i) => !i.complete || !i.naturalWidth).length, w: document.documentElement.scrollWidth }; });
    await p.evaluate(() => Promise.all([...document.querySelectorAll('.page.on img')].map((i) => i.decode().catch(() => {}))));
    const bad2 = await p.evaluate(() => [...document.querySelectorAll('.page.on img')].filter((i) => !i.naturalWidth).length);
    if (st.on !== 1 || st.id !== id || bad2 || st.w > 1440) broken.push(id + ':' + JSON.stringify(st));
  }
  ok('each page opens on its own with its pictures', broken.length === 0); if (broken.length) console.log(broken);
  // search narrows the contents
  await p.goto(url + 'guide'); await p.fill('#q', 'livelink'); await p.waitForTimeout(100);
  const shown = await p.$$eval('#nav a:not(.hide)', (a) => a.map((x) => x.textContent.trim()));
  console.log(shown); ok('search narrows the contents', shown.includes('Blender') && shown.length < info.pages.length / 2);
  // picture viewer
  await p.goto(url + 'guide#hangar'); await p.click('.page.on figure img'); ok('pictures open full size', await p.isVisible('#zoom.on')); await p.keyboard.press('Escape'); ok('and close', !(await p.isVisible('#zoom.on')));
  await p.screenshot({ path: path.join(T, 'guide-desktop.png') });
  // theme
  await p.click('#theme'); const th = await p.evaluate(() => document.documentElement.dataset.theme); await p.screenshot({ path: path.join(T, 'guide-theme.png') });
  ok('the theme switch works', th === 'dark' || th === 'light');
  // phone width: no sideways scrolling, the contents behind a button
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); m.on('pageerror', (e) => errs.push(e.message));
  let wide = [];
  for (const id of info.pages) { await m.goto(url + 'guide#' + id); await m.waitForTimeout(60); const w = await m.evaluate(() => document.documentElement.scrollWidth); if (w > 390) wide.push(id + ':' + w); }
  ok('phone width: nothing scrolls sideways', wide.length === 0); if (wide.length) console.log(wide);
  await m.goto(url + 'guide#coordinates'); await m.screenshot({ path: path.join(T, 'guide-phone.png') });
  await m.click('#menuBtn'); await m.waitForTimeout(300); await m.screenshot({ path: path.join(T, 'guide-phone-menu.png') });
  await m.click('#nav a[href="#cargo"]'); await m.waitForTimeout(300);
  ok('phone menu opens and goes to a page', (await m.evaluate(() => document.querySelector('.page.on').id)) === 'cargo' && !(await m.evaluate(() => document.body.classList.contains('menu'))));
  // the editor links to it
  const e = await b.newPage(); await e.goto(url); await e.waitForSelector('.slot-row').catch(() => {});
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
