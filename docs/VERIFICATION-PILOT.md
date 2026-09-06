# M1 limited pilot: verified live workflow and pending acceptance

## Scope and provenance

This is a sanitized account of observations through 2026-09-06, not a live status monitor or a declaration that the whole product is complete. The deployed implementation is merged source `882f289049abaa4af2fb1d6e867a400c3b2ed016` from PR #2. Later user approvals covered merge, a limited owner pilot, temporary admission of one test account, bounded verification and same-source redeployment. Those approvals are completed scopes, not standing permission for future external changes.

The original local implementation record, `VERIFICATION-M1.md`, remains unchanged. Its pre-deployment statements describe that earlier stage. Private operator evidence was inspected for this account; it is not copied into the public tree or required by automated tests. No real email, subject ID, account/domain identifier, note text, token or policy backup is included here.

## Earlier bounded live batches

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
| Confirmation, focus/knock and storage fault handling | Real local HTTP/SSE, signed-identity browser fixture and workerd/SQLite tests cover these paths. | At that earlier stage, not yet a complete live distinct-account two-PC workflow; the final live run is recorded separately below. |

Owner-only means explicit application membership/grant and Access admission, not merely hidden UI. At the end of those earlier batches, the owner workbench had eight drafts at revision 8, and handoff still had `executionAuthorized: false`. These are historical observation snapshots, not values that later operations should force back onto a changing store.

## Local finalization regression

The additional `tests/remote.test.mjs` case exercises persisted receipts after disposing and recreating the actual local runtime with the same SQLite persistence directory. A revoked editor cannot replay a receipt; another subject cannot borrow it; after explicit regrant, exact note and confirmation retries retain the latest work/revision and unchanged durable receipts, while changed content with the same key is rejected. This strengthens local restart/idempotency evidence without modifying the deployed Worker or adding a production test endpoint. Record actual check results with the candidate commit; do not infer a fresh pass from this description.

At regression checkpoint `41d9ca90ecf90e8bbcd02099cd67893370e94d6f` on 2026-09-06, `npm run test:remote` passed 12 tests; `npm run check` passed syntax/TypeScript/build checks and all 26 tests, with no failures or skips. That checkpoint also passed GitHub CI, a private-identifier scan and diff whitespace checks. The final evidence follow-up is documentation-only; exact-head CI outcomes are recorded on PR #3. The historical local report is byte-for-byte unchanged, and production source, dependency declarations/lockfile and deployment configuration are unchanged from the deployed source. This is implementation-owner verification, not independent review or new live deployment evidence.

## Final live workflow — 2026-09-06

An additional user approval covered temporary admission of the same test editor, two planned new fictional notes, one owner confirmation, bounded live checks, cleanup and PR publication. The deployed source remained `882f289049abaa4af2fb1d6e867a400c3b2ed016`; this run made no deployment, tenant, session-duration or plan change. No new production test endpoint was introduced.

| Claim | Directly inspected evidence | Human report / limit |
| --- | --- | --- |
| Distinct-account two-PC participation | Owner identity matched the retained baseline; the other participant matched the verified guest subject and saved-note author. Both were present on the same workbench before focus testing. | The user operated the actual second PC; its screen was not independently automated or inspected. |
| Draft save and live delivery | Before any explicit owner fetch/reload, owner DOM advanced from revision 9 to 11 and displayed two new guest-authored `decision` / `draft` notes. All nine prior notes were unchanged. | The user reported the guest save. Two same-text drafts were observed, not the one planned draft; the deviation is recorded below. |
| Explicit confirmation and handoff | Exactly the earlier new guest decision was confirmed through its UUID-specific owner UI control. Revision became 12 with 11 notes: one confirmed, ten unresolved, and `executionAuthorized: false`. The other ten notes were unchanged. | The user saw the confirmed status on the second PC and again after the final reload. `draft` is not a failed save or a different note kind. |
| Focus rejection | Verified guest focus and its disabled knock button. A temporary bypass of only that button sent one knock through the existing owner UI socket; the raw server error refused the focused target. The temporary send observer and button state were restored. | The receiver's lack of a notification was not directly inspected. This is a server rejection observation, not merely a disabled-UI claim. |
| Return to knock and departure | A ten-minute, one-shot browser observer waited for that guest's `knock` presence, then the normal owner UI sent exactly one knock. No error was observed; subsequent guest departure was observed, and all temporary instrumentation was restored. | The user reported receiving the no-response-obligation notification, explicitly leaving, reloading with the confirmed note retained, and logging out. |
| Ambiguous successful save | The designated owner request committed once, then only its client acknowledgement was deliberately suppressed. Exact ID/body replay retained the one note and revision 9; altered content with that ID conflicted. All eight pre-run notes were unchanged. | A controlled lost acknowledgement after success, not a naturally occurring outage or a production storage failure. Local storage-failure and restart tests remain separate evidence. |
| Owner-only restoration | Fresh-revision app cleanup removed only the temporary member/editor grant. Fresh Access editor readback matched the original owner-only settings, and the provider policy tester placed owner in allowed and guest in blocked. Fresh owner navigation retained all 11 notes and the non-authoritative handoff. | Second-PC logout was user-reported. No new authenticated guest API request or OTP attempt was made after logout/removal; the earlier live application-revocation test remains separate evidence. |

**Note-budget deviation:** the plan allowed two new notes, but the observed total was three: one designated retry-test note and two guest-authored decision drafts rather than one. The cause of the extra draft was not established; identical text with distinct note IDs does not prove replay of the same request ID. No further notes were created by the agent, and the extra candidate was retained unconfirmed rather than deleted. Exactly one newly created decision was confirmed; all eight notes present before the run were preserved unchanged. The final shared-work snapshot contains 11 notes at revision 12, with one confirmed and ten unresolved. This is disclosed as a deviation, not described as compliance with the original two-note limit.

During coordination, a fresh inspection found the owner's session expired and participation absent. Normal reauthentication and explicit rejoin restored two participants before the successful focus check. Earlier reports of a focused guest without concurrent owner presence were not counted as a passing test. No application-code repair or longer session lifetime was inferred from the transient display.

## Repeat-run boundary and pending decision

The approved final live run is finished and owner-only access is restored. Review/merge acceptance remains pending; the extra retained draft and exclusions must remain visible to that decision. Do not automatically rerun the suite or reopen temporary access. For any separately approved rerun, verify the actual account, deployment and fresh policy before mutations, retain a private baseline and preserve unrelated state. No new tenant, deployment, timeout change or plan change is needed for this retained procedure:

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
