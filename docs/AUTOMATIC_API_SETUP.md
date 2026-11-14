# Agent Concierge v0.4 — Automatic API setup, without unsafe auto-authorization

## What is automatic
1. `GET /api/setup/readiness` checks non-sensitive runtime bindings and whether Concierge's D1 tables exist. No credentials or private events are returned.
2. `POST /api/setup/plan` accepts a plain-English goal (8–500 characters) and returns a deterministic, no-model, no-network agent recommendation plus a service-by-service permission checklist.
3. The frontend's **Auto API setup** view displays readiness, provider capability labels, the next concrete step, and a shortcut to the existing Google Calendar consent flow when it is available.
4. Calendar diagnostics remain protected by sign-in; the official Google OAuth screen still grants individual user consent.

## What is NOT automatic
- Creating Google OAuth client credentials
- Connecting an individual's private account without their explicit permission
- Sending Gmail, WhatsApp or transactional emails
- Deploying a new Worker, changing DNS, provisioning databases or migrating remote D1 automatically
- Invoking OpenRouter, charging model tokens, or exposing server secrets

Real provider integrations are enabled only when separately implemented, reviewed, and appropriately authorized. Readiness `consent_ready` means the **software prerequisites appear present**, not that Google has approved the app or that live sign-in has been externally tested.

## Domain: concierge.mabrigkorie.org
This release DOES NOT automatically attach the Custom Domain in `wrangler.jsonc`, because on a Git-connected Worker that change would modify live DNS on the next deploy. First check that the zone is active on the same Cloudflare account and the hostname has no existing CNAME, then use **Workers & Pages → mabrig-agent-concierge-pilot → Settings → Domains & Routes → Add → Custom Domain**. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

After verifying HTTPS, set `PUBLIC_BASE_URL` to the **exact HTTPS origin** `https://concierge.mabrigkorie.org/` using a Worker Secret or variable on the dedicated Worker. Register this exact callback in the Google OAuth web client:
`https://concierge.mabrigkorie.org/api/oauth/google/callback`

Ensure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `CREDENTIALS_KEY` are set as secrets (never in GitHub or browser code). Google sign-in and calendar reading stay disabled until both Google setup and D1 migration are complete.

## D1
The dedicated binding is `DB`, database `mabrig-concierge-pilot`. The database ID is in `wrangler.jsonc`. From an authenticated, trusted CLI:
```sh
npx wrangler d1 migrations list mabrig-concierge-pilot --remote
npx wrangler d1 migrations apply mabrig-concierge-pilot --remote
```
This modifies the named remote D1 database; check database ownership and backup policies before applying.

## Safeguards
- Public setup endpoints never accept secrets, tokens or passwords.
- API planning is deterministic and does not make external API calls.
- Authorization always requires signed-in user consent through the provider.
- No model invocation, unsupervised background execution or side-effecting third-party API calls.
- The frontend must label demonstrative examples clearly.
- Public readiness status never returns client IDs, secret values or private account data.

## Verification
`npm run check` includes setup planner, readiness, hostname-mismatch, no-credential, and cross-origin API tests. Validate live /api/setup/readiness separately after D1 migrations and configuring secrets. Do not infer provider health from CI alone.
