# Patreon check for Harmonious Save Editor

Patrons can take the watermark off the Traveller page's pictures. The editor can't keep Patreon's app secret (anyone
could read it out of the exe), so this small service on Netlify does the check: it signs the member in with Patreon,
looks at their pledge to your campaign and hands the editor a pass signed with a key only this service has. The
editor checks the signature with the public half (`patronPublicKey` in `desktop/patron.go`) and keeps the pass for 35
days, then asks the patron to sign in again (so someone who stops pledging loses it within about a month).

## Setting it up (once)

1. **Patreon app**: go to https://www.patreon.com/portal/registration/register-clients and create a client.
   - App name: Harmonious Save Editor. Description: anything.
   - Redirect URIs: `https://harmonious-patrons.netlify.app/.netlify/functions/patreon-callback`
   - Client API version: 2.
   Keep the **Client ID** and **Client Secret** it shows.
2. **Netlify site**: Add new site, Import an existing project, pick GitHub and this repository.
   - Base directory: `service/patreon` (Netlify then finds `netlify.toml` there). Build command: leave empty.
   - Site name (Site configuration, Change site name): `harmonious-patrons`, so the address is
     `https://harmonious-patrons.netlify.app`. If that name is taken, pick another, use it in the redirect URI above,
     and tell the developer so the editor points at it (`patreonService` in the app's settings).
3. **Environment variables** (Site configuration, Environment variables):
   - `PATREON_CLIENT_ID` and `PATREON_CLIENT_SECRET`: from step 1.
   - `PASS_PRIVATE_KEY`: the key file the developer gave you (one long line). Never put it in GitHub or share it.
   - `MIN_CENTS` (optional): the smallest monthly pledge that counts, in cents, e.g. `300` for $3. Leave it out for any active pledge.
   Then Deploys, Trigger deploy.
4. **Campaign ID**: in the editor, Traveller page, untick Watermark, Sign in with Patreon, and sign in with *your*
   creator account. The page that opens shows your campaign ID. Add it as `PATREON_CAMPAIGN_ID` and deploy again.
5. Sign in once more: as the creator you count as a patron, so the watermark comes off. Patrons do the same.

## Notes

- Nothing is stored here: no database, no logs of who signed in. The pass lives on the patron's PC
  (`%LOCALAPPDATA%\HarmoniousSaveEditor\patron.json`).
- A new key pair means a new editor release (the public key is built into the exe) and everyone signs in again.
- `test/e2e/test_patron.js` runs these functions against a stand-in for Patreon.
