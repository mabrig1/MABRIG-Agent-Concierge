# MABRIG Agent Concierge — release gates

## Current posture

**v0.3 is not released.** The sample demo can be served statically. The new Cloudflare Worker/D1 service is a bounded, read-only Google Calendar **pilot design** requiring separate deployment and provider authorization.

### Implemented and locally tested

- Sample-data onboarding, templates, sample drafts, pause and review.
- Standalone Cloudflare Worker with user-specific Google OAuth and Calendar connection paths.
- D1 tables for users, sessions, OAuth state, encrypted connections, saved recipes, audit events and throttling.
- Read-only Calendar events and meeting agent brief, with server-side scope enforcement and explicit user start.
- Local integration tests using mocked Google network responses and an in-memory SQLite D1 substitute.
- User-owned account export and transactional erasure (with explicit typed confirmation, recent login, token revocation attempt); private recipe deletion and Calendar connection health diagnostics.
- Built frontend allowlist and mobile UI smoke tests in an isolated renderer.

### Still required before a real pilot

- [ ] Owner-provisioned *separate* Worker, D1 database, Google project, OAuth callback and dedicated test-domain origin.
- [ ] Verified live provider end-to-end sign-in, refresh, revoked-token and calendar scenario with test users.
- [ ] Publish legal/privacy notice, retention schedule, backup-purge/deletion policy and risk assessment for personal event titles.
- [ ] Cloudflare WAF and abuse controls, budget alerts, secrets rotation and backup/restore checks.
- [ ] Test Google OAuth client and consent/branding requirements before inviting users.
- [ ] Staging release plan, rollback instructions, incident alerts, independent security review.

### Future phases

1. v0.4: consent-reviewed inbox feature via Google's approved API scopes; no Gmail use until restricted-scope verification is resolved.
2. v0.5: approval queue for write actions and optional LLM generation, with an explicit third-party data consent switch.
3. v0.6: jobs/queues, retry schedules, self-healing with safe limits, quotas and billing.
4. v1: public customer onboarding with identity/recovery, tenant safeguards, support, privacy commitments and monitored operations.

No GitHub branch merge, Cloudflare deploy, production DNS edit or secret change is part of this release gate.