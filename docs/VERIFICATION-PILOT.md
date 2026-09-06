# M1 limited pilot: evidence and remaining acceptance

## Scope and provenance

This is a sanitized account of observations through 2026-09-06, not a live status monitor or a declaration that the whole product is complete. The deployed implementation is merged source `882f289049abaa4af2fb1d6e867a400c3b2ed016` from PR #2. Later user approvals covered merge, a limited owner pilot, temporary admission of one test account, bounded verification and same-source redeployment. Those approvals are completed scopes, not standing permission for future external changes.

The original local implementation record, `VERIFICATION-M1.md`, remains unchanged. Its pre-deployment statements describe that earlier stage. Private operator evidence was inspected for this account; it is not copied into the public tree or required by automated tests. No real email, subject ID, account/domain identifier, note text, token or policy backup is included here.

## Evidence matrix

| Claim | Evidence observed | Boundary |
| --- | --- | --- |
| Real identity and protected ingress | Real Access login and authenticated bootstrap; unauthenticated API/assets redirect to Access; alternate worker/preview ingress disabled in provider settings. | Limited pilot, not a production authentication audit. |
| Two-PC synchronization | Same owner account on the Cockpit PC and a separate Linux PC: bidirectional updates, reload retention, stale conflict with input retained, successful retry and reconnect. | Linux-PC observations are user-reported; Cockpit DOM and server state were inspected. Not two different accounts. |
| Separate-account authorization | Actual second account in an isolated browser Identity: ungranted bootstrap empty; viewer read allowed and direct write denied; editor draft save allowed and confirmation denied. | Separate accounts/profiles, not a distinct-account two-physical-PC workflow. |
| Existing-session revocation | Membership/grant removal closes an existing socket with 1008; a still-authenticated user then sees no workbenches, receives 404 on reads/writes and cannot reconnect. | Application revocation is not introspection of provider JWT revocation. |
| Populated cross-tenant/workbench isolation | Allowed workbench remains usable; populated private workbench reads, valid writes, handoff and subscription admission are denied. | A bounded scenario, not every possible membership/grant combination. |
| Update-notification isolation | Private update yields no additional changed event on the allowed socket for 10,341 ms; a subsequent allowed save produces the expected changed revision on that same socket. | Finite observation with a positive control. |
| Natural session expiry | Existing 30-minute application-token duration retained. Idle socket closes 1008 / Authorization expired, 2,009 ms after token expiry. | Measured observation, not a hard real-time guarantee. No raw JWT retained. |
| Expired session and new authentication | After expiry, cookie absent, manual-redirect GET/POST refused and new socket fails; explicit top-level reauthentication obtains a later expiry and reconnect succeeds. | Redirect refusal is not a claim that an expired raw JWT reached the Worker. New authentication is not acceptance of the old token. |
| Deployment recovery | Same reviewed source redeployed with configuration preservation; old socket closes 1006, new connection succeeds, policy and all note fields/revisions match predeploy snapshots. | Specific Durable Object process restart not directly identifiable. |
| Data preservation and cleanup | Original seven drafts unchanged; one authorized notification-control draft retained. Two fictional private drafts retained without published policy entries. App policy and Access admission restored to the original owner; guest logout confirmed. | No stored notes deleted or confirmed during that batch. |
| Provider admission cleanup | Fresh policy readback shows owner only; policy tester puts the temporary account in the blocked set and owner in the allowed set. | No new OTP delivery/rejection attempt after removal. |
| Confirmation, focus/knock and storage fault handling | Real local HTTP/SSE, signed-identity browser fixture and workerd/SQLite tests cover these paths. | Not yet a complete live distinct-account two-PC workflow. |

Owner-only means explicit application membership/grant and Access admission, not merely hidden UI. The final observed owner workbench had eight drafts at revision 8, and handoff still had `executionAuthorized: false`. These are observation snapshots, not values that later operations should force back onto a changing store.

## Local finalization regression

The additional `tests/remote.test.mjs` case exercises persisted receipts after disposing and recreating the actual local runtime with the same SQLite persistence directory. A revoked editor cannot replay a receipt; another subject cannot borrow it; after explicit regrant, exact note and confirmation retries retain the latest work/revision and unchanged durable receipts, while changed content with the same key is rejected. This strengthens local restart/idempotency evidence without modifying the deployed Worker or adding a production test endpoint. Record actual check results with the candidate commit; do not infer a fresh pass from this description.

Finalization checks on 2026-09-06: `npm run test:remote` passed 12 tests; `npm run check` passed syntax/TypeScript/build checks and all 26 tests, with no failures or skips. The candidate also passed a private-identifier scan and diff whitespace check. The historical local report is byte-for-byte unchanged, and production source, dependency declarations/lockfile and deployment configuration are unchanged from the deployed source. This is implementation-owner verification, not independent review or new live deployment evidence.

## Remaining final live workflow

Before another live run, obtain one bounded approval for temporary admission, fictional note creation/confirmation and the intended test operations. Verify the actual account, deployment and fresh policy before mutations; retain a private baseline and preserve unrelated state. No new tenant, deployment, timeout change or plan change is needed for the following workflow:

1. Use two physical PCs with different verified real accounts: existing owner on one, the approved temporary editor on the other. Both open only the explicitly granted workbench. Record which observations are direct and which are human reports.
2. Join both; verify focus blocks knock, returning to knock mode allows a knock, and leaving removes the temporary presence. Do not record a presence or connection-duration history.
3. Create one new, unmistakably fictional decision draft. Verify live delivery and reload on the other PC. Owner confirmation must be an explicit authorized action on that new note only; never confirm an existing user draft as test setup. Confirmed/unresolved handoff separation must retain no external execution authority.
4. Exercise an ambiguous successful save: keep the original request ID/body and suppress only the test client's acknowledgement after server commitment. Replay the exact request and require exactly one stored note with unchanged revision; changed content under that ID must conflict. Do not disrupt unrelated networking, inject a production storage fault or call a stale-revision retry equivalent to a lost-response retry.
5. Remove only temporary permissions using the freshly read revision. Verify effective denial, original owner access and retained existing notes, then log out the temporary browser. Do not delete stored verification notes as cleanup.

Update the evidence against the exact tested source and then request the applicable review/merge or completion decision. Issue closure and Gate 3 media work are not implied by local green checks or this runbook.

## Explicit exclusions

- Cloud Durable Object instance restart remains unproven. The observed deployment-related connection transition and state retention must not be relabeled as a directly observed process restart. Any requirement for stronger instrumentation needs a separate scoped decision; it is not a reason to reset production storage.
- Japanese paste corruption in the special Linux/VPS environment was excluded as a blocker by the user. Its cause was not diagnosed and it is not described as fixed.
- Load/cost characterization, disaster recovery/backups, native assistive-hardware acceptance, unrestricted multi-tenant operation and self-service invitations are not certified by this limited pilot.
- Voice, spatial audio, screen sharing, recording, transcription and AI remain unimplemented/unconfigured. M1 completion is not permission to start them.
