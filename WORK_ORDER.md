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

M1 implementation is merged at `882f289049abaa4af2fb1d6e867a400c3b2ed016`. The separate remote entry, signed JWT verification, policy directory, SQLite work and memory-only WebSockets are implemented. Local runtime and fictional-identity browser checks remain distinct from live evidence.

After separate user approvals, a limited Access-protected pilot was deployed and exercised: same-owner two-PC synchronization/conflict/reconnect; distinct-account viewer/editor/revocation; populated cross-tenant isolation and update-notification isolation; natural idle authorization expiry; and preserved work/policy after same-source redeployment. Temporary permissions were removed and owner-only access restored. These later approvals do not authorize future deployments, invitations or billing changes.

The final approved live workflow was verified on 2026-09-06: distinct-account two-physical-PC collaboration, focus rejection and return-to-knock delivery, explicit confirmation and non-authoritative handoff, reload/leave, and exact replay after a controlled lost save acknowledgement. Actual second-PC receipt/reload/logout observations are human reports; owner DOM, WebSocket responses, note state and cleanup were inspected directly. One additional guest-authored draft beyond the planned note budget was retained unconfirmed and disclosed; all pre-run notes were unchanged. Temporary permissions were removed and owner-only access was verified again.

**M1 implementation and evidence through PR #3 are merged at `93a78e9be2326f971d435edd5830fcc38eb74897` (2026-09-06).** The approved final live run is finished. Keep its evidence and the disclosed extra-draft deviation rather than repeating the live suite automatically. The extra draft's cause remains unknown. A specific cloud Durable Object instance restart is not directly proven; do not turn local restart tests or a deployment upload into that claim. `docs/VERIFICATION-PILOT.md` and `docs/VERIFICATION-M1.md` remain unchanged historical records. Setup and retained boundaries: `docs/PILOT.md`. Issue #1 remains OPEN; M1 integration does not approve M1.1 merge, new deployment or Gate 3 work.

## M1.1 — Issue #4, before media

Goal: preserve the user's input and the correct workbench across saving, selection, network loss and reauthentication, without replacing the foundation.

- Fence async success, failure and cleanup by actor/session epoch/tenant/workbench/selection.
- Separate editable draft, immutable sent snapshot and unresolved save/confirm request. Resolve the original ID/body explicitly after reauthorization; no automatic resubmission or content-only deduplication.
- Keep drafts in page memory, scoped to their author and workbench. Provide explicit own-input/request export/import for page navigation; never silently persist confidential work in localStorage.
- Clear fetched information on detected authorization loss and known session expiry. Distinguish disconnected, login-required, voluntary nonparticipation and absent peers.
- Bound socket count/message rate/knock frequency without a hibernation or auth-platform rewrite.
- Verify the five original failures, extended VM regressions, local workerd/SQLite and two isolated real-browser profiles. Keep fixtures out of the production bundle.

Evidence and limitations: `docs/VERIFICATION-M1.1.md`. Stop at a feature PR with exact SHA, checks and residual risks. Keep Issues #1/#4 OPEN, main unchanged, the existing pilot untouched and historical approvals closed. No new deploy, Access/policy/invite/billing changes or production writes.

## Gate 3 — LiveKit media
Only after M1.1 review and separate authorization, in a distinct LiveKit PR.

Product goal: two people intentionally begin a conversation and selected-window sharing, leave one explicit decision, exit, and later resume. Current avatar placement follows array order and transmitted coordinates are fixed; proximity interaction is not implemented.

- backend issues short-lived room tokens after workbench authorization
- microphone and selected-window screen share start OFF
- leaving/focus/tenant switch/permission revocation stops publication and subscription
- short token TTL alone does not revoke existing media; plan provider participant removal/permission updates plus blocked token reissuance
- separate authorization scopes become separate media rooms/subscriptions
- never distribute private media to unauthorized clients and rely on volume=0
- recording/transcription/AI remain OFF
- no simultaneous React/Three.js migration or large 3D redesign

## Later
- Fumiori/Organization Agent adapter for context retrieval
- AI-generated handoff proposal with human confirmation
- multi-tenant invitation lifecycle
- non-spatial/list accessibility mode
- product instrumentation based on voluntary actions, not surveillance
