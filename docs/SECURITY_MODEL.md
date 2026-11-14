# v0.3 security and threat model

## Data and trust boundaries

- **Browser demo:** sample agent goals/drafts in localStorage on the current device only; browser export includes user-input demo goal data. Do not enter sensitive data into demo forms.
- **Live service:** isolated Cloudflare Worker/D1. Sessions are random bearer secrets sent via HttpOnly, Secure-on-HTTPS, SameSite=Lax cookies; only SHA-256 hashes stored in D1.
- **Google authorization:** state matches a host-scoped HttpOnly cookie, server-side one-time state and PKCE S256 code verifier; 10-minute state expiration. Calendar connection checks both initial session hash and Google user identity.
- **Google Calendar scope:** `calendar.events.readonly` only. The provider API is called from the Worker, never the browser. No Google access tokens are returned to frontend routes.
- **Token vault:** refresh/access tokens encrypted via AES-GCM under per-connection user-associated data. 32-byte `CREDENTIALS_KEY` stays in Worker secrets.
- **Tenant isolation:** every connection, saved agent and audit event is scoped to the authenticated Google user id. Cross-tenant agent action returns 404.
- **Read-only output:** Calendar brief exposes title/time/location for up to 20 upcoming events (7-day window) to that user's authenticated browser. It does not include description, attendee emails or meeting links.
- **Audit trail:** only event types and timestamps, not message contents, meeting subjects, user prompts, bearer tokens or credentials.

## Defenses implemented

- Explicit JSON/content-length checks on POST bodies, allowed-origin check for mutations, host-to-`PUBLIC_BASE_URL` match, no wildcard CORS.
- No browser-managed API credentials, no public OpenRouter calls or autonomous actions.
- OAuth start is throttled at 20 starts / 10 minutes per hashed Cloudflare IP, with separate WAF protection required for public access.
- Calendar tokens deleted locally before the best-effort provider revocation call; the UI truthfully reports incomplete provider revocation.
- OAuth stored state consumed before token exchange; replay and identity mismatch rejected.
- Separate static build allowlist prevents accidental publication of SQL, Worker secrets and server code.
- `ready` saved-agent status is a preparation control, **not** a permission to send messages, modify events or execute in the background.

## Deferred before production

- Real Google OAuth app and external verification; provider consent/access testing.
- Cloudflare WAF, abuse budgets, IP/data privacy review, rate limits beyond login starts.
- Account deletion and export are implemented but require a real-provider smoke test; formal privacy terms, retention policy, backups, log retention, audit review and consent terms are still needed.
- Account recovery, session inventory/revocation, key rotation and encryption-key custody process.
- Safe Google refresh expiry/revocation recovery tests against a real provider in a dedicated test account.
- Full WCAG accessibility test, privacy/legal review and independent security assessment.

**Never represent a local/mock OAuth test as evidence that a real user successfully connected Google Calendar.**