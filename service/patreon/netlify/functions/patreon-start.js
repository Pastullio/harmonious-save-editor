// The editor opens this in the browser: /.netlify/functions/patreon-start?port=47821&nonce=<hex>
const { env, makeState, redirectUri, page } = require('../lib/common');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (!/^\d{2,5}$/.test(q.port || '') || !/^[0-9a-f]{16,64}$/.test(q.nonce || '')) return page('Start from the editor', 'Open the Traveller page in Harmonious Save Editor and press Sign in with Patreon.', 400);
  if (!env('PATREON_CLIENT_ID') || !env('PASS_PRIVATE_KEY')) return page('Not set up yet', 'The Patreon check is missing its settings. (For the owner: see service/patreon/README.md.)', 500);
  const u = new URL('https://www.patreon.com/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env('PATREON_CLIENT_ID'));
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', 'identity identity.memberships');
  u.searchParams.set('state', makeState(q.port, q.nonce));
  return { statusCode: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' }, body: '' };
};
