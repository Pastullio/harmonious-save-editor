const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const C = require('../../src/codec.js');
// Rewards page: expedition, Twitch and platform rewards in the account file, unlocked per expedition or all at
// once, saved to accountdata.hg + mf_accountdata.hg and read back. Supercharged slots stay calm.
// Usage: node test/e2e/test_rewards.js <scratch dir with dbroot/NMS holding a real save> <folder with accountdata.hg + mf_accountdata.hg>
// The item library comes from <scratch>/itemlibcfg (test_itemlib.js builds it).
const SP = process.argv[2], ACC = process.argv[3], LIB = path.join(SP, 'itemlibcfg/HarmoniousSaveEditor/itemlib');
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const cfg = path.join(SP, 'rwcfg'), root = path.join(SP, 'rwroot'); fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  const acctDir = path.join(root, fs.readdirSync(root).find((d) => /^st_/i.test(d)));
  for (const f of ['accountdata.hg', 'mf_accountdata.hg']) fs.copyFileSync(path.join(ACC, f), path.join(acctDir, f));
  fs.cpSync(LIB, path.join(cfg, 'HarmoniousSaveEditor/itemlib'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47983'], { env: { ...process.env, HOME: SP + '/modelhome', XDG_CONFIG_HOME: cfg, HSE_GAME: SP + '/fakebanks' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.waitForFunction(() => S.db && S.db.src === 'lib' && S.db.rewards, null, { timeout: 120000 });
  const tok = await p.evaluate(() => window.NMS_APP.token);
  ok('other files still refused', (await fetch(url + 'api/read?dir=' + encodeURIComponent(acctDir) + '&name=settings.json&t=' + tok)).status === 400);

  await p.evaluate(() => go('rewards')); await p.waitForSelector('.rw-stats');
  const stats = await p.$$eval('.rw-stats > div b', (x) => x.map((n) => n.textContent));
  console.log(stats);
  ok('counts what the account has unlocked', stats[0] === '276 of 293' && stats[1] === '405 of 435' && stats[2] === '0 of 3');
  ok('expeditions listed newest first', (await p.$$eval('.ed-list [data-k]', (x) => x.map((b) => b.dataset.k)))[0] === '23' && (await p.$$eval('.ed-list [data-k]', (x) => x.length)) === 23);
  const named = await p.evaluate(() => S.db.rewards.filter((r) => dbItem(r.id)).length);
  console.log(named + ' of 293 reward names from the item library');
  await p.screenshot({ path: SP + '/shots/rw-0.png', fullPage: true });
  // pick one expedition with something missing and unlock just that one
  const { target, elsewhere } = await p.evaluate(() => { const k = new Set(acctList('UnlockedSeasonRewards').map(str)); const t = S.db.rewards.find((r) => !k.has(r.id)).season; return { target: t, elsewhere: S.db.rewards.filter((r) => r.season !== t && !k.has(r.id)).length }; });
  await p.click(`.ed-list [data-k="${target}"]`); await p.waitForSelector('#rwExp');
  await p.screenshot({ path: SP + '/shots/rw-1-expedition.png', fullPage: true });
  await p.click('#rwExp');
  const one = await p.evaluate((n) => { const k = new Set(acctList('UnlockedSeasonRewards').map(str)); return { exp: S.db.rewards.filter((r) => r.season === n).every((r) => k.has(r.id)), others: S.db.rewards.filter((r) => !k.has(r.id)).length, dirty: S.acct.dirty, status: $('#status').textContent }; }, target);
  console.log(JSON.stringify(one));
  ok('unlock one expedition only', one.exp && one.others === elsewhere && one.dirty && /Rewards not saved/.test(one.status));
  const first = await p.$eval('#rwRows input', (c) => c.dataset.id);
  await p.click('#rwRows input');
  ok('a single reward can be locked again', await p.evaluate((id) => !acctList('UnlockedSeasonRewards').map(str).includes(id), first));
  await p.click('#rwRows input');
  await p.click('.ed-tabs [data-t="twitch"]'); await p.waitForSelector('#rwKind');
  await p.screenshot({ path: SP + '/shots/rw-2-twitch.png', fullPage: true });
  await p.click('#rwAll');
  const all = await p.evaluate(() => ({ s: acctList('UnlockedSeasonRewards').length, t: acctList('UnlockedTwitchRewards').length, pl: acctList('UnlockedPlatformRewards').length }));
  console.log(JSON.stringify(all));
  ok('unlock all rewards', all.s >= 293 && all.t >= 435 && all.pl === 3);
  await p.click('#rwSave'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary');
  await p.waitForFunction(() => !S.acct.dirty, null, { timeout: 30000 });
  const back = C.readSave(new Uint8Array(fs.readFileSync(path.join(acctDir, 'accountdata.hg'))), new Uint8Array(fs.readFileSync(path.join(acctDir, 'mf_accountdata.hg'))), 'accountdata.hg');
  const u = [...back.json.values()].find((v) => v instanceof Map), M = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vendor/libnom/mapping_mbincompiler.json'))).Mapping;
  const obf = (n) => (M.find((x) => x.Value === n) || {}).Key;
  ok('saved to the account file and it reads back', u.get(obf('UnlockedSeasonRewards')).length === all.s && u.get(obf('UnlockedTwitchRewards')).length === all.t && u.get(obf('UnlockedPlatformRewards')).length === 3);
  ok('the file stays uncompressed with no terminator, like the game writes it', !back.compressed && back.noNull && back.meta.info.sizeDisk === fs.statSync(path.join(acctDir, 'accountdata.hg')).size + 1);
  ok('the save itself was not touched', await p.evaluate(() => !S.dirty));

  // supercharged slots: steady until hovered
  await p.evaluate(() => go('exosuit')); await p.waitForTimeout(400);
  const calm = await p.evaluate(() => { const c = document.querySelector('.cell.charged'); if (!c) return null; const a = c.querySelector('.arcs'); return { op: getComputedStyle(a).opacity, play: getComputedStyle(a.querySelector('path')).animationPlayState }; });
  console.log(JSON.stringify(calm));
  ok('charged slots are calm until hovered', calm && calm.op === '0' && calm.play === 'paused');
  await p.hover('.cell.charged'); await p.waitForTimeout(400);
  ok('and crackle on hover', await p.evaluate(() => { const a = document.querySelector('.cell.charged:hover .arcs'); return a && getComputedStyle(a).opacity === '1'; }));
  await p.screenshot({ path: SP + '/shots/rw-3-charged.png' });
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
