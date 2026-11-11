// Patreon sends the member back here with a code; we ask Patreon who they are and whether they pledge to the
// campaign, then send the browser to the editor (http://127.0.0.1:<port>/patron) with a signed pass.
const { env, readState, makePass, redirectUri, page } = require('../lib/common');

const API = process.env.PATREON_API || 'https://www.patreon.com';   // tests point this at a stand-in

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const st = readState(q.state);
  if (!st) return page('Start again', 'This sign-in has expired. Press Sign in with Patreon in the editor again.', 400);
  if (q.error || !q.code) return page('Not signed in', 'Patreon didn\'t sign you in. Press Sign in with Patreon in the editor to try again.', 400);
  const tok = await fetch(API + '/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.code, grant_type: 'authorization_code', client_id: env('PATREON_CLIENT_ID'), client_secret: env('PATREON_CLIENT_SECRET'), redirect_uri: redirectUri() }) });
  if (!tok.ok) return page('Patreon said no', 'Patreon didn\'t accept the sign-in (' + tok.status + '). Please try again.', 502);
  const { access_token } = await tok.json();
  const me = await fetch(API + '/api/oauth2/v2/identity?include=memberships.campaign,campaign&fields%5Buser%5D=full_name&fields%5Bmember%5D=patron_status,currently_entitled_amount_cents', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!me.ok) return page('Patreon said no', 'Patreon didn\'t say who you are (' + me.status + '). Please try again.', 502);
  const doc = await me.json(), user = doc.data || {}, inc = doc.included || [];
  const name = (user.attributes && user.attributes.full_name) || 'traveller';
  const own = user.relationships && user.relationships.campaign && user.relationships.campaign.data && user.relationships.campaign.data.id;
  const campaign = env('PATREON_CAMPAIGN_ID');
  if (!campaign) return page('Your campaign ID', own ? `Put <b>${own}</b> in the PATREON_CAMPAIGN_ID setting on Netlify, then deploy again.` : 'This account has no campaign of its own. Sign in with the creator account to see the campaign ID.');
  const min = parseInt(env('MIN_CENTS') || '0', 10) || 0;
  const member = inc.find((x) => x.type === 'member' && x.relationships && x.relationships.campaign && x.relationships.campaign.data && x.relationships.campaign.data.id === campaign);
  const a = (member && member.attributes) || {};
  const active = own === campaign || (a.patron_status === 'active_patron' && (a.currently_entitled_amount_cents || 0) >= min);
  const reason = active ? '' : !member ? 'Patreon doesn\'t show this account as a patron of Pastullio the Harmonious.' : a.patron_status === 'declined_payment' ? 'Patreon says the last payment didn\'t go through.' : a.patron_status === 'former_patron' ? 'Patreon shows this account as a former patron.' : 'This pledge doesn\'t include the editor\'s thank-you.';
  const pass = makePass({ uid: String(user.id || ''), name, active, nonce: st.nonce, reason });
  const back = `http://127.0.0.1:${st.port}/patron?nonce=${st.nonce}&pass=${encodeURIComponent(pass)}`;
  return { statusCode: 302, headers: { Location: back, 'Cache-Control': 'no-store' }, body: '' };
};
