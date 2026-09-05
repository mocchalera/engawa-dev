# ENGAWA next work order

## Goal
Turn the local vertical slice into a two-person remote pilot without losing ENGAWA's core rules: optional presence, resumable work, explicit decisions and hard tenant/workbench boundaries.

## Gate 1 — prove the current slice
- Run `npm test` in CI.
- Run `npm start` in a real browser with two separate browser profiles.
- Verify join, presence mode, knock, note save, explicit confirm, handoff and restart recovery.
- Verify viewer and cross-workbench negative cases.

M1 local evidence (2026-09-05): completed in the isolated Issue #1 feature branch. Real HTTP/SSE integration, two separate Cockpit browser identities, explicit confirmation/handoff and server restart recovery passed. See `docs/VERIFICATION-M1.md`; this does not certify remote PCs or a real identity provider.

## Gate 2 — Cloudflare state/auth vertical slice
Replace the fixed demo identity boundary before any public deployment.

Target architecture:
- Workers Static Assets / API
- real identity verification
- application membership + workbench grant
- SQLite-backed Durable Object per workbench for selected durable state/revision
- WebSocket or hibernatable connection for ephemeral presence

Acceptance:
- fixture actor picker is absent from remote build
- tenant/workbench grant is checked server-side on connect and mutation
- stale revision is rejected
- presence is not written to durable history
- reconnect and revocation have negative tests

M1 implementation: the separate remote entry, signed JWT verification, policy directory, SQLite work and memory-only WebSockets are implemented and tested locally. Real SQLite rollback injection, expiry/revocation and reconnect tests pass. A signed fictional identity fixture was also operated in two real browser profiles. **Gate 2 external acceptance remains open**: configure the actual Access app and subjects, obtain deployment authorization, then run a two-PC test. No deployment, main merge or billing/resource changes were performed. Setup and retained boundaries: `docs/PILOT.md`.

## Gate 3 — LiveKit media
Only after Gate 2 authorization works.

- backend issues short-lived room tokens after workbench authorization
- microphone and selected-window screen share start OFF
- leaving/focus/permission revocation stops publication
- separate authorization scopes become separate media rooms/subscriptions
- never distribute private media to unauthorized clients and rely on volume=0
- recording/transcription/AI remain OFF

## Later
- Fumiori/Organization Agent adapter for context retrieval
- AI-generated handoff proposal with human confirmation
- multi-tenant invitation lifecycle
- non-spatial/list accessibility mode
- product instrumentation based on voluntary actions, not surveillance
