# Town rollout and operating boundary

**STOP: this candidate has not been deployed or accepted for organization-wide use.**

## Source and deployment boundary

Built additively over PR #5 head `912eb5ec916c84407f0a39328bc05e4026775003`. PR #5 itself is unmerged at inspection. Keep its review independent; use a stacked feature PR until the base is accepted. Do not change the existing pilot, policy, membership, data or recording configuration by implication.

The new worker name is `engawa-town`, not `engawa-pilot`. Keep `workers_dev=false`, `preview_urls=false`, authenticated assets via `run_worker_first=true`. The new namespace starts empty. Never copy real company/member/customer identifiers into this public repository.

## Before exposing a URL

An authorized operator needs the intended account and hostname; a Cloudflare Access application and exact issuer/audience; named application admins by verified subject; a reviewed membership/grant policy; a backup destination and retention owner; and an agreed pilot group. The current conversation had no usable Cloudflare control tool. No account, URL, deployment, DNS, invitation, billing or Access change was made.

Use the existing repository toolchain. The production bundle must exclude `local-login.*`, `server.mjs`, all test harnesses and fictional users. Validate all bindings/classes against the separate worker. The optional `GUEST_SUBJECTS` setting only decorates authenticated guests; it grants no access. An empty or missing policy must remain closed.

Access must protect the hostname before deployment. Configure `ACCESS_ISSUER`, `ACCESS_AUD`, `ADMIN_SUBJECTS`, and only then deploy `wrangler deploy --config town/wrangler.jsonc` from an authorized environment. Use approved secrets/configuration handling; do not paste credentials into chat or commit them. A publish command succeeding is not successful authentication or authorized multi-user use.

## Provisioning shape (no real identities in source)

The existing Directory API remains the authority. `GET /api/policy` and revision-conditional `PUT /api/policy` are admin-only. The current candidate does not provide self-service invitations or an admin UI. A policy has `{revision, members, benches}`; a bench has `{id,tenantId,title,goal,grants}`. A member requires both tenant membership and a per-place `owner/editor/viewer` grant. Removing a grant cuts active Town streams and invalidates transient text/presence, but preserves stored work. Public space is still a grant, not anonymous access.

Administrative writes need same-origin, `X-Engawa-Client: town-ui` and `X-Engawa-Actor` matching the verified Access subject. Read back after writes. After an ambiguous policy update, inspect the current revision before any retry. Membership IDs must be verified, not guessed from email addresses. Keep guest badges consistent with approved roles. Do not remove an employee's workplace access merely to simulate an alumnus in production.

## Release acceptance

1. Candidate unit/HTTP/storage/UI tests pass at the exact source revision. Existing repository checks also pass. Cloud adapter typecheck and local workerd tests pass separately.
2. Two distinct real users authenticate, join the same room, see movement and text, save privately, share deliberately, update tasks, reconnect and retrieve records after a controlled restart/redeploy. Real-browser network observation is distinct from mocked browser tests.
3. A guest sees only granted places. Member-without-grant, cross-tenant requests, forged identity, viewer writes, permission removal and session expiry fail closed. A revocation closes existing streams and clears both panels and open dialogs. A page suspended by the OS cannot promise immediate visual clearing.
4. Suppress a save response, continue typing, navigate, reauthenticate and resolve the same request. No silent duplication or input loss. Own-input JSON restores only to the same origin/person and never sends by importing. Lost/expired receipts retain the original revision precondition; user inspection precedes a new intent.
5. A backup is captured and restored into a separate test instance and compared. This code has not verified the provider's real backup/restore path. No in-place destructive restore as a test.
6. Test desktop keyboard, actual WebGL and low-GPU fallback, screen reader/list mode, real mobile devices, tab suspension, slow networks and the expected concurrent participant count. Record latency, resource usage and provider costs; do not infer them from a cap.
7. Agree the text-buffer policy, visibility of personal captures and sharing, retention, incident response, who manages access, and how people opt out. Finish invitations/admin operation before sustained rollout.
8. Run a limited voluntary group, measure usefulness/interruption, retain existing communication as fallback, then decide migration. Do not delete or cancel existing Slack based on a local demonstration.

## Capacity and persistence

This candidate uses one Town Durable Object, not a production-sharded architecture. It stores normalized SQLite rows, but currently loads/clones aggregate state for durable operations. A hard **4 MiB aggregate serialized-state guard** fails writes closed without dropping existing work. It is an explicit pilot safety cap, not sufficient long-term storage for an organization. Plan per-place storage and a per-user memory index, paged reads/exports and receipts before raising the cap. Do not simply remove it.

Additional caps: Directory up to 30 places/50 members per tenant; Town streams up to 100 total and 3 per subject; transient buffer up to 3,000 messages; posts 10,000/place, tasks 3,000/place, objects 36/place, memories 1,000/person, with the aggregate guard often reached first. Idempotency receipts retain exact request content for up to 24 hours (pruned on writes), capped at 20,000. Deleting a post replaces its body with a tombstone; receipts/backups may retain prior content until their lifecycle completes. Do not claim immediate erasure of every copy.

SSE is used instead of a new media/WebSocket provider. Normal active connections and timers have provider cost. In-memory positions/text are lost on object restart; that is intentional. Received-text history cannot be reconstructed after loss. Presence is one location per authenticated subject; the most recent device controls that location. No per-device attendance history is collected.

## Unconnected or incomplete

Voice, screen sharing, recording/rewind audio, AI/Fumiori/Organization Agent, offline notifications, external task sync, Slack migration, general file attachments, self-service access management, backup/export administration and stable administrator-designed town layout are not finished. Ambient sound is generated locally with a shared room selection/time phase; it is not a streaming-music subscription. Seasonal scene changes and unrestricted avatar asset uploads are not implemented.

## Next authorized engineering work

Complete cloud adapter verification at the exact candidate source, then close the operating gaps above. A tool/session with authorized Cloudflare controls can prepare a separate Access-protected environment after inspecting existing account settings. Do not route through another host to bypass a blocked connector. No unattended implementation agent was started by this conversation.
