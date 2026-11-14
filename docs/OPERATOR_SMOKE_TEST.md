# v0.3 — isolated operator smoke-test checklist

**No credentials, live accounts or production services have been configured by this repo change.** Use a dedicated test Google account and isolated Cloudflare Worker/D1 database after explicit owner approval. Never reuse `mabrig-agentos` sessions or database.

1. Verify `npm run check` succeeds and `dist/` contains only the frontend allowlist. Confirm `src/worker.mjs`, D1 SQL and secrets are absent from `dist/`.
2. Verify sign-in uses Google with identity-only scopes. Calendar connection should separately ask for events.readonly.
3. Sign in as test user A, connect Google Calendar, check connection health, prepare a seven-day agenda. Compare event counts with Calendar; confirm no event was changed.
4. Sign in as test user B in another browser profile. Verify A's recipes, diagnostics and events are unavailable to B.
5. Export each account; verify goals/agent names exist but `access_token`, `refresh_token`, `encrypted_tokens`, `google_sub`, `token_hash` and Calendar event details do not.
6. Save and delete one recipe: it should vanish only for that user. Confirm a missing or other-user recipe returns 404.
7. On A, test a failed or revoked Google credential; diagnostics should show reconnect-needed, never a fabricated healthy state.
8. Test bad confirmation, wrong signed-in email and missing/cross-origin request; account deletion must be rejected.
9. With A's session less than 30 minutes old, type `DELETE MY ACCOUNT`; verify A cannot reuse old session and A's D1 rows are gone. B's rows must remain.
10. Where Google token revocation fails, warn clearly about manual removal at the Google account permissions screen. Check browser-local sample data separately.
11. Check deploy preview health/consent callback, logs without secrets/PII, domain/TLS, rollback and migration restoration. Record evidence and get owner approval before any production release.

**Stop conditions:** any tenant leak, token in response/client code, permission escalation, unauthorized write, failed deletion atomicity, missing user-facing notice, or failed CI check. No merge or deploy until resolved.