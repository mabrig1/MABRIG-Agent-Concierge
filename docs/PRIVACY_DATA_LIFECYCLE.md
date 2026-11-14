# Concierge pilot: privacy and data lifecycle (engineering note)

**Not a customer-facing privacy policy.** This is a factual summary of the isolated v0.3 prototype, not a legal attestation or public production approval.

## Stored per customer (in a separate D1 instance, once owner configures it)

- Google account internal subject identifier and verified email to associate logins.
- Hashed 7-day session tokens (never stored raw), OAuth PKCE challenge state (10 minutes), and one-time callback records.
- Encrypted Google Calendar access/refresh tokens in D1, using a 32-byte server-only AES-GCM key and per-user authenticated context.
- Manually configured agent recipes (name, goal, template, state), minimal activity event types/timestamps.
- Throttle records keyed by a hash of the connecting IP and server-side key; not associated with user identity.
- Calendar event titles, dates and locations are fetched only on explicit read-only requests and returned to that signed-in browser. The Worker does **not** persist them or send them to an LLM provider.

## Access/export

`GET /api/account/export` returns the signed-in user's verified email, account-created timestamp, saved recipes, recent activity types and connection metadata as downloadable JSON. It omits refresh/access tokens, session hashes, Google account subject, OAuth state and actual event details.

## Delete one recipe

`DELETE /api/agents/:id` is strictly owner-scoped. The deleted agent remains inaccessible. It does not touch Google Calendar.

## Delete Concierge account

`POST /api/account/delete` requires a same-origin request, the signed-in email, exact `DELETE MY ACCOUNT` confirmation and Google sign-in within the last 30 minutes. It transactionally deletes the user's OAuth state records, stored connections, saved agents, activity history, sessions and account. The session cookie is cleared. On D1 transaction failure, the response is an error and deletion should be rolled back.

**Google-side revocation caveat:** after local deletion, the Worker attempts token revocation. Google may be unreachable or reject revocation. The response indicates whether that request succeeded. In that case, users must review and remove app permissions from Google Account settings. Google Calendar events are never deleted. Browser-local demo records are separately cleared in Settings; account deletion does not silently erase those local records.

## Still required before launch

Publish an appropriate privacy notice, retention schedule and backup deletion process; cover data exports, support inquiries and withdrawal of consent; define cross-border data processing and vendor terms, breach procedures and secure key rotation. Test live Google consent and deletion on test accounts. Obtain appropriate legal review, including Nigerian data protection requirements and Google API user data rules. Production audits, WAF, monitoring and account-recovery practices remain open requirements.