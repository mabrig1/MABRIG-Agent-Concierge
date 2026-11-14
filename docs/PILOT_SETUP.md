# Isolated Calendar pilot setup (operator only)

> **Not yet performed.** This document lists the manual verification and provisioning steps. Do not deploy to the production AgentOS Worker or invite unverified public customers.

## 1. Google consent configuration

1. Create a Google Cloud project dedicated to **MABRIG Agent Concierge pilot**.
2. Enable the **Google Calendar API**.
3. Configure OAuth consent screen branding, authorized domains, support email, links to privacy policy/terms, and only permitted test users while in testing mode.
4. Create an OAuth Client ID of type **Web application**. Register exact HTTPS callback `https://YOUR_CONCIERGE_HOST/api/oauth/google/callback` (or `http://localhost:8787/api/oauth/google/callback` during local testing).
5. Required scopes: `openid`, `email`, `profile` for login. Additional scope requested **only on Connect Calendar**: `https://www.googleapis.com/auth/calendar.events.readonly`.
6. Google verification can be required before public use. Do **not** add Gmail scopes without a separate permission review and restricted-scope compliance process.

Source: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/workspace/calendar/api/auth

## 2. Separate Cloudflare D1

Never use AgentOS's existing Durable Object database or session tables.

```bash
cd MABRIG-Agent-Concierge
npm install
npx wrangler d1 create mabrig-concierge-pilot
# Replace REPLACE_WITH_SEPARATE_D1_DATABASE_ID in wrangler.jsonc
npx wrangler d1 migrations apply mabrig-concierge-pilot --local
# After review and BEFORE a pilot deployment, separately authorize:
# npx wrangler d1 migrations apply mabrig-concierge-pilot --remote
```

D1 binding `DB` is defined by `wrangler.jsonc`. All data must remain isolated from AgentOS.

## 3. Server-side secrets only

The following are deliberately **not** in the repository. Configure them for the *concierge pilot Worker only*:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Generate a unique, private 32-byte base64url key and insert the result securely.
# Example generation on the operator's trusted computer:
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
npx wrangler secret put CREDENTIALS_KEY
# Exact public origin with /, no path/query; e.g. https://concierge.example.com/
npx wrangler secret put PUBLIC_BASE_URL
```

Do not paste these values into chat, client code, GitHub Issues/Actions logs, screenshots, or a `.env` committed to Git.

## 4. Check and preview

```bash
npm run check
npm run dev
# After real credentials/D1 are supplied, verify:
# GET /api/health and /api/status
# Login > Calendar connect > read-only brief > health check > export > delete agent > account delete (test user only)
```

Local sign-in requires matching Google OAuth authorized redirect URI and a real D1 database/migration. For a preview environment, use an isolated Worker hostname and a separate OAuth client. Never test against actual client inboxes or sensitive calendars.

## 5. Release gates

- Document privacy terms, data retention/deletion, support process and incident response. Comply with applicable Nigerian data protection obligations and Google user-data requirements.
- Verify implemented account deletion/export, audit review and connection diagnostics on a real test user. Add WAF/abuse controls, quotas, backups, encryption-key rotation plan and accessible consent screens.
- Independently test SSRF protections, OAuth CSRF/session fixation, encrypted token recovery, tenant isolation and provider revocation.
- Validate D1 migration/dry-run and actual Cloudflare deployment only in explicitly approved environments.
- Obtain Google OAuth app verification as needed and run real-user consent tests before considering public onboarding.

The built-in Google Calendar integration never changes calendar events and never sends their contents to OpenRouter or another LLM provider.