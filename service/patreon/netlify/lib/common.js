// Shared by patreon-start and patreon-callback. Settings (Netlify: Site configuration, Environment variables):
//   PATREON_CLIENT_ID, PATREON_CLIENT_SECRET  the Patreon app (patreon.com/portal/registration/register-clients)
//   PATREON_CAMPAIGN_ID                       your campaign; leave it out once and sign in yourself to see it
//   PASS_PRIVATE_KEY                          the Ed25519 key the editor trusts (base64 PKCS8)
//   MIN_CENTS (optional)                      the smallest pledge that counts, in cents (default: any active pledge)
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const env = (k) => (process.env[k] || '').trim();
const privateKey = () => crypto.createPrivateKey({ key: Buffer.from(env('PASS_PRIVATE_KEY'), 'base64'), format: 'der', type: 'pkcs8' });
// the OAuth state carries the editor's port and its one-time code, signed so nobody can swap them
const stateKey = () => crypto.createHash('sha256').update('state|' + env('PASS_PRIVATE_KEY')).digest();
function makeState(port, nonce) {
  const body = b64u(JSON.stringify({ port, nonce, t: Date.now() }));
  return body + '.' + b64u(crypto.createHmac('sha256', stateKey()).update(body).digest());
}
function readState(s) {
  const [body, mac] = String(s || '').split('.');
  if (!body || !mac) return null;
  const want = b64u(crypto.createHmac('sha256', stateKey()).update(body).digest());
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const o = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (Date.now() - o.t > 30 * 60 * 1000) return null;
  return o;
}
// the pass the editor keeps: what Patreon said, for 35 days, signed
function makePass(p) {
  const body = b64u(JSON.stringify({ v: 1, ...p, exp: Math.floor(Date.now() / 1000) + 35 * 86400 }));
  return body + '.' + b64u(crypto.sign(null, Buffer.from(body), privateKey()));
}
const redirectUri = () => (env('URL') || 'http://localhost:8888') + '/.netlify/functions/patreon-callback';
const page = (title, text, status = 200) => ({ statusCode: status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Harmonious DryDock</title><body style="font-family:Segoe UI,system-ui,sans-serif;background:#07131a;color:#fff;display:grid;place-items:center;min-height:90vh;margin:0"><div style="max-width:520px;padding:24px;text-align:center"><h1 style="font-weight:300;letter-spacing:.12em;text-transform:uppercase;font-size:22px">${title}</h1><p style="line-height:1.5;color:#cfe3ea">${text}</p></div></body>` });
module.exports = { env, makeState, readState, makePass, redirectUri, page };
