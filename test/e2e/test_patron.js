// Patrons take the watermark off (owner, 2026-11-11): the editor opens the Patreon check (service/patreon, run here
// in-process) in the browser, a stand-in for Patreon answers, and the signed pass comes back to the app's /patron.
// Usage: node test/e2e/test_patron.js <scratch dir with dbroot/NMS>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
const [SP] = process.argv.slice(2);
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
(async () => {
  const T = path.join(SP, 'patrontest'); fs.rmSync(T, { recursive: true, force: true });
  const home = path.join(T, 'home'), root = path.join(T, 'root'), cfg = path.join(T, 'cfg'), openLog = path.join(T, 'opened.txt');
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true }); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true });
  // a key pair for this test (the real one's private half lives only on Netlify)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  // a stand-in for Patreon: the code says who signs in
  const people = {
    patron: { id: '101', name: 'Patty Patron', member: { patron_status: 'active_patron', currently_entitled_amount_cents: 500 }, campaign: '999' },
    former: { id: '102', name: 'Fred Former', member: { patron_status: 'former_patron', currently_entitled_amount_cents: 0 }, campaign: '999' },
    small: { id: '103', name: 'Sam Small', member: { patron_status: 'active_patron', currently_entitled_amount_cents: 100 }, campaign: '999' },
    creator: { id: '1', name: 'Pastullio', own: '999' },
    other: { id: '104', name: 'Olga Other', member: { patron_status: 'active_patron', currently_entitled_amount_cents: 900 }, campaign: '555' },
  };
  const patreon = await listen((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      if (req.url === '/api/oauth2/token') { const code = new URLSearchParams(body).get('code'); res.end(JSON.stringify({ access_token: 'tok-' + code })); return; }
      if (req.url.startsWith('/api/oauth2/v2/identity')) {
        const who = people[(req.headers.authorization || '').replace('Bearer tok-', '')]; if (!who) { res.statusCode = 401; res.end('{}'); return; }
        const doc = { data: { id: who.id, type: 'user', attributes: { full_name: who.name }, relationships: { memberships: { data: who.member ? [{ id: 'm' + who.id, type: 'member' }] : [] }, ...(who.own ? { campaign: { data: { id: who.own, type: 'campaign' } } } : {}) } }, included: [] };
        if (who.member) doc.included.push({ id: 'm' + who.id, type: 'member', attributes: who.member, relationships: { campaign: { data: { id: who.campaign, type: 'campaign' } } } });
        res.end(JSON.stringify(doc)); return;
      }
      res.statusCode = 404; res.end();
    });
  });
  // the Netlify functions, run here
  const fnServer = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x'), name = u.pathname.replace('/.netlify/functions/', '');
    if (!/^patreon-(start|callback)$/.test(name)) { res.statusCode = 404; res.end(); return; }
    const out = await require(path.join(__dirname, '../../service/patreon/netlify/functions', name + '.js')).handler({ queryStringParameters: Object.fromEntries(u.searchParams) });
    res.writeHead(out.statusCode, out.headers); res.end(out.body);
  });
  const FN = 'http://127.0.0.1:' + fnServer.address().port;
  Object.assign(process.env, { URL: FN, PATREON_API: 'http://127.0.0.1:' + patreon.address().port, PATREON_CLIENT_ID: 'cid', PATREON_CLIENT_SECRET: 'secret', PATREON_CAMPAIGN_ID: '999', MIN_CENTS: '300',
    PASS_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: cfg, HSE_BLENDER: '/nonexistent', HSE_PATREON_URL: FN, HSE_OPEN_LOG: openLog, HSE_PATRON_PUBKEY: pub };
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '48171'], { env });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] }); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcCanvas'); await p.waitForTimeout(800);
  ok('not a patron: the watermark is on', await p.evaluate(() => !tcPatron() && $('#tcWm').checked));
  // one sign-in, as `who`: the editor opens the check, Patreon answers, the browser lands on the app's /patron
  const reopen = async () => { await p.click('nav button[data-s="exosuit"]'); await p.click('nav button[data-s="traveller"]'); await p.waitForSelector('#tcWm'); await p.waitForTimeout(500); };
  const signIn = async (who) => {
    await reopen();
    fs.rmSync(openLog, { force: true });
    await p.uncheck('#tcWm').catch(() => {}); await p.waitForSelector('#dlg[open]');
    await p.click('#dlg button:has-text("Sign in with Patreon")');
    for (let k = 0; k < 50 && !fs.existsSync(openLog); k++) await p.waitForTimeout(100);
    const start = fs.existsSync(openLog) ? fs.readFileSync(openLog, 'utf8') : '';
    const r1 = await fetch(start, { redirect: 'manual' }), auth = new URL(r1.headers.get('location') || 'http://x/');
    const r2 = await fetch(FN + '/.netlify/functions/patreon-callback?code=' + who + '&state=' + encodeURIComponent(auth.searchParams.get('state') || ''), { redirect: 'manual' });
    const back = r2.headers.get('location') || '';
    const tab = await ctx.newPage(); await tab.goto(back); const text = await tab.textContent('body'); await tab.close();
    return { start, auth, back, text };
  };
  const s1 = await signIn('patron');
  ok('Sign in with Patreon opens the check in the browser, with this editor\'s port and a one-time code', /patreon-start\?port=48171&nonce=[0-9a-f]{32}$/.test(s1.start));
  ok('…which sends you to Patreon to allow identity and memberships', s1.auth.host === 'www.patreon.com' && s1.auth.searchParams.get('scope') === 'identity identity.memberships' && s1.auth.searchParams.get('client_id') === 'cid');
  ok('…and Patreon\'s answer comes back to the app with a signed pass', /^http:\/\/127\.0\.0\.1:48171\/patron\?nonce=/.test(s1.back) && /Thank you/.test(s1.text) && /Patty Patron/.test(s1.text));
  await p.waitForFunction(() => tcPatron(), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
  ok('the page sees the patron and takes the watermark off', await p.evaluate(() => tcPatron() && TC.patron.name === 'Patty Patron' && !$('#tcWm').checked && TC.state.watermark === false));
  ok('…kept for about a month', await p.evaluate(() => TC.patron.until > Date.now() / 1000 + 30 * 86400 && TC.patron.until < Date.now() / 1000 + 40 * 86400));
  const wmPixels = () => p.evaluate(() => { const c = $('#tcCanvas'), d = c.getContext('2d').getImageData(c.width - 400, c.height - 60, 380, 40).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 140 && d[i + 1] > 140 && d[i + 2] > 140) n++; return n; });
  const w0 = await wmPixels();
  ok('…so the picture has no watermark', w0 < 15);
  await p.check('#tcWm'); await p.waitForTimeout(300);
  ok('a patron can put it back on', (await wmPixels()) > 30);
  // a former patron, too small a pledge, another creator's patron: no
  for (const [who, want] of [['former', /former patron/], ['small', /thank-you/], ['other', /isn't a patron|doesn't show/]]) {
    await p.evaluate(() => api('/api/patron', { method: 'DELETE' })); await p.evaluate(() => tcPatronLoad());
    const s = await signIn(who); await p.waitForTimeout(500); await p.evaluate(() => tcPatronLoad());
    ok(`${who}: not a patron, and the browser says why`, /Not a patron yet/.test(s.text) && want.test(s.text) && await p.evaluate(() => !tcPatron()));
    await p.click('#dlgX').catch(() => {});
  }
  // the creator counts as a patron
  await p.evaluate(() => api('/api/patron', { method: 'DELETE' })); await p.evaluate(() => tcPatronLoad());
  const sc = await signIn('creator'); await p.waitForTimeout(500);
  ok('the creator signs in as a patron', /Thank you/.test(sc.text) && await p.evaluate(async () => (await tcPatronLoad()).patron));
  // the same answer can't be used twice, nor a pass that wasn't signed by the check
  const again = await (await fetch(sc.back)).text();
  ok('a used sign-in link is refused', /Sign in again/.test(again));
  const forged = await p.evaluate(() => api('/api/patron/signin', { method: 'POST' }).then((r) => r.json()));
  const nonce = new URL(fs.readFileSync(openLog, 'utf8')).searchParams.get('nonce');
  const other = crypto.generateKeyPairSync('ed25519').privateKey, body = Buffer.from(JSON.stringify({ v: 1, uid: '9', name: 'Forger', active: true, exp: Math.floor(Date.now() / 1000) + 9e5, nonce })).toString('base64url');
  const fake = body + '.' + crypto.sign(null, Buffer.from(body), other).toString('base64url');
  const fr = await (await fetch(`http://127.0.0.1:48171/patron?nonce=${nonce}&pass=${encodeURIComponent(fake)}`)).text();
  ok('a pass not signed by the check is refused', forged.ok && /went wrong/.test(fr) && await p.evaluate(async () => (await tcPatronLoad()).name === 'Pastullio'));
  // after a month the patron signs in again
  const exp = Buffer.from(JSON.stringify({ v: 1, uid: '101', name: 'Patty Patron', active: true, exp: Math.floor(Date.now() / 1000) - 60, nonce: 'x' })).toString('base64url');
  fs.writeFileSync(path.join(cfg, 'HarmoniousSaveEditor', 'patron.json'), JSON.stringify({ pass: exp + '.' + crypto.sign(null, Buffer.from(exp), privateKey).toString('base64url') }));
  const st = await p.evaluate(() => tcPatronLoad());
  ok('an old pass asks to sign in again', !st.patron && /Sign in again/.test(st.reason));
  // the creator's first sign-in, before the campaign is set, shows the campaign ID to put in Netlify
  delete process.env.PATREON_CAMPAIGN_ID;
  const st0 = await (await fetch(FN + '/.netlify/functions/patreon-start?port=48171&nonce=' + 'ab'.repeat(16), { redirect: 'manual' })).headers.get('location');
  const setupPage = await (await fetch(FN + '/.netlify/functions/patreon-callback?code=creator&state=' + encodeURIComponent(new URL(st0).searchParams.get('state')))).text();
  ok('without a campaign set, signing in as the creator shows the campaign ID', /PATREON_CAMPAIGN_ID/.test(setupPage) && /999/.test(setupPage));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill(); patreon.close(); fnServer.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
