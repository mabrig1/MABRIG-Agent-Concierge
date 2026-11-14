# Deploy MABRIG Agent Concierge (standalone Cloudflare Worker)

**Status:** The GitHub repository contains buildable v0.4 source, tests, static assets, a Worker entrypoint and D1 migrations. This is a **limited read-only Calendar pilot**, not a public production SaaS. Deploy only to a dedicated pilot environment after consent/privacy review; there is no automatic deploy from GitHub.

## 0. Automatic API discovery and custom domain

The new **Auto API setup** dashboard checks service readiness and recommends integrations from a plain-language goal. It does **not** create OAuth clients, grant private permissions, or attach DNS automatically.

After confirming the hostname is available and owned, connect `concierge.mabrigkorie.org` to the dedicated Worker, set `PUBLIC_BASE_URL` to `https://concierge.mabrigkorie.org/`, and register Google's exact callback URI `https://concierge.mabrigkorie.org/api/oauth/google/callback`.

Do not add a live `routes` entry to a Git-connected Worker until the zone and hostname have been checked. See [Automatic API setup](docs/AUTOMATIC_API_SETUP.md).

## 1. Verify code on a trusted machine

```bash
git clone https://github.com/mabrig1/MABRIG-Agent-Concierge.git
cd MABRIG-Agent-Concierge
npm install
npm run check
npm run preflight
```

A local demo with fictional data can be viewed with `python3 -m http.server 4173`; avoid `file://` because the frontend uses ES modules. The Google connection is intentionally disabled when prerequisites are missing.

## 2. Create **a new** Cloudflare D1 database

```bash
npx wrangler login
npx wrangler d1 create mabrig-concierge-pilot
```

Copy the **new** `database_id` from Wrangler into `wrangler.jsonc` in place of `REPLACE_WITH_SEPARATE_D1_DATABASE_ID`. Do **not** reuse an AgentOS database or Worker. Leave the D1 binding name as `DB`.

Apply the SQL migration locally first, then to the new empty remote database **only when you are ready to launch the pilot**:

```bash
npx wrangler d1 migrations apply mabrig-concierge-pilot --local
npx wrangler d1 migrations apply mabrig-concierge-pilot --remote
```

The remote step changes the selected Cloudflare database. Confirm the account and database name before executing.

## 3. Configure separate Google OAuth consent

Use a new Google Cloud project for Concierge. Enable the Google Calendar API and OAuth consent screen. Create a **web** OAuth client and authorize exactly `https://YOUR-PILOT-HOST/api/oauth/google/callback` (localhost callback can be added separately for local testing). Identity sign-in uses `openid email profile`; `calendar.events.readonly` is requested separately when the user connects Calendar.

Keep Google OAuth in test-user mode until verification and data handling approval are completed. **No Gmail permission is requested in v0.3.**

## 4. Add secrets to the new Worker only

Never place secret values in GitHub, app code or Wrangler configuration:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put CREDENTIALS_KEY
npx wrangler secret put PUBLIC_BASE_URL
```

`CREDENTIALS_KEY`: a **unique 32-byte base64url key**, generated locally, e.g. `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. `PUBLIC_BASE_URL`: exact externally accessible origin, e.g. `https://YOUR-PILOT-HOST` (not a wildcard). Configure this origin consistently with the Google OAuth callback, including the correct HTTPS hostname.

You may need to initially deploy **demo-only** to learn the Workers.dev hostname, then configure that host and secrets before beginning live sign-in. An initial demo-only deployment must not be advertised as a functioning Google-connected service.

## 5. Build and deploy after approval

```bash
npm run check
npm run build
npx wrangler deploy
```

The Worker serves public files from `dist` while all `/api/*` requests are routed to the Worker. `dist` is an explicit allowlist; Worker code, SQL and secrets are not published as static files. GitHub CI only tests/builds; it does **not** deploy or require Cloudflare credentials.

Verify `GET /api/health`, `GET /api/status`, Google identity sign-in, Calendar-only consent, read-only brief, cross-account isolation, reconnect, disconnect, export and test-account deletion. See [Operator smoke test](docs/OPERATOR_SMOKE_TEST.md).

## 6. Before enabling real customers

Provide a published privacy policy/terms, retention and support procedures, Cloudflare abuse protections, token rotation and backup safeguards, Google app verification as needed, and independent security tests. See [production gates](docs/PRODUCTION_READINESS.md). No autonomous actions, inbox access, payments, or message sending are implemented.

## Rollback

Keep the last verified Worker deployment for rollback using Cloudflare's rollback controls. Revert application code or roll back the deployment separately from the D1 database; **do not delete the database or run destructive SQL as a rollback**. If connections are compromised, revoke access and rotate affected keys through secure operator procedures.
## Safe readiness verification

`GET /api/setup/readiness` checks whether D1's user schema exists, whether the hostname matches the configured canonical origin, and whether OAuth prerequisites are present. It does not return secret values or verify provider approval. `POST /api/setup/plan` accepts an 8–500-character goal and returns a deterministic no-network setup recommendation. The web app offers both operations.
