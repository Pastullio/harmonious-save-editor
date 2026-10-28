// End-to-end UI test: load the fixture through the file picker, edit, download, verify with the codec.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs');
const C = require('../src/codec.js');
const fx = process.argv[2], shots = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../dist/nms-save-editor.html'));
  await page.screenshot({ path: shots + '/01-landing.png' });
  await page.setInputFiles('#filePick', [path.join(fx, 'save3.hg'), path.join(fx, 'mf_save3.hg')]);
  await page.waitForSelector('#app:not(.hidden)');
  const name = await page.textContent('#saveName');
  console.log('save name:', name);
  await page.screenshot({ path: shots + '/02-overview.png' });

  // edit currency
  await page.fill('[data-cur="Units"]', '123456789'); await page.dispatchEvent('[data-cur="Units"]', 'change');
  await page.click('[data-add="Nanites"][data-n="max"]');
  // exosuit: select first item, fill; select empty slot and add
  await page.click('nav button[data-s="exosuit"]');
  await page.click('.inv .cell.has >> nth=0');
  await page.screenshot({ path: shots + '/03-exosuit.png' });
  await page.click('#sFill');
  const emptyCount = await page.locator('.inv >> nth=0 >> .cell:not(.has):not(.locked)').count();
  console.log('empty valid cells in exosuit general:', emptyCount);
  if (emptyCount) {
    await page.click('.inv >> nth=0 >> .cell:not(.has):not(.locked) >> nth=0');
    await page.fill('#aId', 'ANTIMATTER'); await page.selectOption('#aType', 'Product'); await page.click('#aAdd');
  }
  // unlock all in tech inventory
  await page.click('.inv >> nth=1 >> [data-act="unlock"]');
  // ships page
  await page.click('nav button[data-s="ships"]');
  await page.screenshot({ path: shots + '/04-ships.png' });
  await page.click('.pick >> nth=2');
  await page.fill('.panel input >> nth=0', 'Trimaxion'); await page.dispatchEvent('.panel input >> nth=0', 'change');
  // storage / items / freighter / tools render without errors
  for (const s of ['tools', 'freighter', 'vehicles', 'storage', 'items']) await page.click(`nav button[data-s="${s}"]`);
  // raw data search + edit
  await page.click('nav button[data-s="raw"]');
  await page.fill('#sq', 'Big'); await page.click('#sf button');
  await page.click('.search-hits button >> nth=0');
  await page.screenshot({ path: shots + '/05-raw.png' });
  // mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('nav button[data-s="exosuit"]');
  await page.screenshot({ path: shots + '/06-mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // download
  const downloads = [];
  page.on('download', async (d) => downloads.push(d));
  await page.click('#saveBtn');
  await page.waitForTimeout(1500);
  for (const d of downloads) await d.saveAs(path.join(fx, 'ui_' + d.suggestedFilename()));
  console.log('downloads:', downloads.map((d) => d.suggestedFilename()));
  await browser.close();

  const save = C.readSave(fs.readFileSync(path.join(fx, 'ui_save3.hg')), fs.readFileSync(path.join(fx, 'ui_mf_save3.hg')), 'save3.hg');
  const ps = save.json.get('vLc').get('6f=');
  const checks = [
    ['units', String(ps.get('wGS')) === '123456789'],
    ['nanites max', String(ps.get('7QL')) === '4294967295'],
    ['ship renamed', save.json.get('vLc').get('6f=').get('@Cs')[2].get('NKm') === 'Trimaxion'],
    ['antimatter added', !emptyCount || ps.get(';l5').get(':No').some((s) => s.get('b2n') === '^ANTIMATTER')],
    ['tech slots unlocked', ps.get('PMT').get('hl?').length === 60],
    ['meta sizes', save.meta.info.sizeDecompressed > 0],
    ['no page errors', errors.length === 0],
  ];
  checks.forEach(([n, ok]) => console.log((ok ? 'PASS ' : 'FAIL ') + n));
  if (errors.length) console.log(errors);
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})();
