# MABRIG Agent Concierge

**Your AI, ready to work.** Mobile-first assistant setup for non-technical users. Version **0.3.0** adds an isolated Cloudflare Worker backend and a limited, consent-based Google Calendar integration. It is **packaged for independent deployment but is not a deployed or production-approved customer service**.

## What is actually implemented

### Zero-configuration interactive sample (works now without accounts)
- Describe goals in plain English and choose from four assistant templates.
- Create locally saved assistant configurations with enforced approval-first demonstration rules.
- Test realistic *fictional* email, meetings, customer follow-up and daily planner scenarios.
- Review and acknowledge fictional drafts; pause/resume demo agents; export/clear browser-local demo data.

### Optional live foundation (requires owner setup and Google consent)
- Cloudflare Worker API and a **separate D1 database** for individual Google users.
- Google OAuth web-server sign-in and separate opt-in Google Calendar **events.readonly** connection; CSRF state, PKCE and one-time callback state.
- Session cookies are HttpOnly, SameSite=Lax, Secure on HTTPS; hashed session tokens with 7-day expiry.
- AES-GCM-encrypted OAuth credentials in D1 with per-user associated data; server-only provider secrets.
- Basic OAuth-start throttling, signed-in-only agent recipe storage and per-user database isolation.
- One-click disconnect: immediately deletes locally stored credentials and attempts Google token revocation.
- Read-only upcoming seven-day Calendar brief and read-only `meetings`/`personal` agent preparation on explicit request.
- Private activity trail recording event names only, not meeting titles or email contents.
- Fail-closed unconfigured mode: the demo remains available, live actions show clear setup messaging.

### v0.3 privacy and recovery controls
- Signed-in users can export **their own** private agent recipes, account email, minimal activity event types and connected-provider metadata as JSON. OAuth credentials, Google subject IDs, sessions and live events are excluded.
- Users can delete individual saved recipes, or permanently delete the Concierge account with exact typed confirmation and recent login. D1 deletes are transactional, and provider token revocation is attempted afterward.
- Connection Health checks a tiny Google Calendar events API response without retrieving any event details. UI gives safe `healthy`, `needs_reconnect`, `not_connected`, and `temporarily_unavailable` outcomes.
- Account deletion cannot delete calendar events or revoke Google permissions with a guarantee if Google refuses the revocation request; users are directed to their Google account's third-party permission page when needed.
- All new operations are user-scoped and protected against cross-origin destructive calls.

### Explicitly **not** implemented
- **No Gmail access**, email drafts from live inboxes, sending messages, or access to Google Drive.
- No LLM/API calls, AI-written live messages, unattended execution, cron workflows, billing or marketplace.
- No hosted live deployment, verified Google OAuth app, DNS connection, email/calendar credentials or Cloudflare provisioning has been performed.
- Account export/deletion endpoints exist, but published privacy terms, defined retention policy, independent data access review, vendor audit and production penetration test are still required before accepting real customers.

## Run the local sample

```bash
git clone https://github.com/mabrig1/MABRIG-Agent-Concierge.git
cd MABRIG-Agent-Concierge
python3 -m http.server 4173
# Open http://localhost:4173
```

## Automated tests and static build

Node.js 22+ required. Tests use built-in `node:sqlite` only as a local D1 substitute; the server relies on Cloudflare D1 in hosted use.

```bash
npm run check
# 20 automated tests covering demo logic, OAuth state, sessions,
# encryption, tenancy, Calendar scope and reads, audit, throttle, connection health, private export and transactional deletion.
```

`npm run build` copies **only** public frontend files to `dist/`. Worker source, SQL migrations, tests and secrets are never copied into the publicly accessible assets directory.

## Real Calendar pilot setup — owner-controlled, not executed automatically

Start with [DEPLOYMENT.md](DEPLOYMENT.md), then read [PRIVACY_DATA_LIFECYCLE.md](docs/PRIVACY_DATA_LIFECYCLE.md), [OPERATOR_SMOKE_TEST.md](docs/OPERATOR_SMOKE_TEST.md) and [PILOT_SETUP.md](docs/PILOT_SETUP.md), [PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) and [SECURITY_MODEL.md](docs/SECURITY_MODEL.md). At a high level:

1. Create a **new** Cloudflare D1 database exclusively for Concierge and replace the placeholder D1 ID in `wrangler.jsonc`.
2. Register a Google OAuth web app and exact callback, enable the Calendar API, and keep the app limited to test users until required verification is complete.
3. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CREDENTIALS_KEY` and `PUBLIC_BASE_URL` as **Worker secrets**, never as frontend variables.
4. Apply the D1 migration, build and validate in an isolated preview. Do not change the existing AgentOS Worker, secrets, users or domains.
5. Only after explicit review of security, privacy and consent requirements should real-user access be considered.

## API boundaries

| Path | Access | Behavior |
|---|---|---|
| `/api/health` | Public | Minimal health response |
| `/api/status` | Public | Availability and caller's own connection status |
| `/api/auth/google/start` | Google sign-in redirect | Identity scopes only |
| `/api/calendar/connect/start` | Signed in | Additional read-only Calendar consent |
| `/api/oauth/google/callback` | State + PKCE | Google authorization callback |
| `/api/auth/logout` | Signed in + same-origin POST | Revokes the local session |
| `/api/account/export` | Signed in | Own account and agent recipe export, excluding credentials |
| `/api/account/delete` | Signed in + recent sign-in + same-origin POST | Transactionally erase Concierge account; attempt Google revocation |
| `/api/connections/google-calendar/health` | Signed in | Consent-bound credential check without reading event data |
| `/api/agents/:id` | Signed in + same-origin DELETE | Delete own saved recipe |
| `/api/connections` | Signed in | Own connected-provider flags |
| `/api/connections/google-calendar/disconnect` | Signed in + same-origin POST | Remove credential + attempt revocation |
| `/api/calendar/brief` | Signed in + consent | Next seven-day read-only brief |
| `/api/agents` | Signed in | List/save private agent recipes (initially paused) |
| `/api/agents/:id/status` | Signed in + same-origin POST | Pause or mark ready; no autonomous execution |
| `/api/agents/:id/prepare` | Signed in + same-origin POST | Read Calendar for an explicitly ready meeting/personal assistant |
| `/api/activity` | Signed in | Audit events for own account only |

`/api/*` requests never return static frontend fallbacks. No live API exists while the Worker is unconfigured.

## Existing AgentOS relationship

This standalone project is published in **`mabrig1/MABRIG-Agent-Concierge`**. Its source originated from an isolated development branch in private `mabrig1/MABRIG-AgentOS`. It must **never** reuse the original single-operator AgentOS admin password, session cookies, Durable Object, OpenRouter key, or Google tokens. Its Cloudflare Worker name and D1 namespace must remain separate. A GitHub source push does not imply a live deployment, consent configuration, or domain change.

© 2026 MABRIG Technologies — https://www.mabrigkorie.org