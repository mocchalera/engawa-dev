# Architecture

## v0.1 actual

```text
Browser DOM + SVG 2.5D room
  -> same-origin HTTP mutations
  -> SSE change/presence notifications
  -> local Node adapter
  -> domain rules
  -> atomic JSON replacement

PresenceHub
  -> memory only / TTL
```

The demo identity chooser is deliberately obvious and is not authentication. The server binds only to loopback and rejects forwarded/public host usage as a second line of defense.

## Durable vs ephemeral

Durable:
- workbench title/goal
- explicit object grants
- selected notes
- draft/confirmed status
- revision

Ephemeral:
- current position
- presence mode
- connection/session id
- knocks

No attendance history is derived from ephemeral state.

## Authority model

A workbench grant is required for every read/mutation. Tenant membership alone is insufficient. Unknown and unauthorized workbenches return the same not-found response.

New records enter as `draft`. Owners may confirm decision/constraint/task records. Hypotheses/questions remain unresolved context. Handoff export includes `executionAuthorized: false`.

## M1 remote boundary — implemented and deployed as a limited pilot

```text
Browser
  -> Workers: static assets + real authenticated API
  -> Directory Durable Object (SQLite): tenant membership + object grants
  -> workbench-bound Durable Object (SQLite)
       durable selected work + revision + bounded idempotency receipts
       memory-only WebSocket presence
  -X-> LiveKit / recording / AI (not configured)
```

Do not relay audio/video through the Durable Object. Do not issue media tokens until the server can prove identity plus workbench grant.

The Worker verifies Access RS256 signatures against the configured team's JWKS, exact issuer/audience, subject, issued-at and expiry. Only user application tokens with an email are accepted. Header names alone are not authentication. The Worker overwrites internal identity headers, removes cookies/JWTs before forwarding, and authenticates static assets too (`run_worker_first`). Remote output contains no demo chooser or session-minting endpoint.

The Directory starts empty. Only explicitly configured administrator subjects can read/replace its policy, using a revision precondition. Tenant membership alone is insufficient; every read/mutation/connect requires a matching workbench grant. IDs have immutable tenant bindings, including after removal/re-addition. Policy changes preserve saved notes; they do not imply an external execution grant. A successful policy update disconnects existing connections on affected workbenches, including still-authorized peers, who explicitly rejoin. Updates that lose their response must be inspected via admin GET before retrying.

Workbench reads/mutations reauthorize through the Directory. Policy lookup is the authorization decision point; an operation already authorized concurrently with a policy update may finish. Successful revocation response is sent after affected sockets close. Every socket message and outgoing delivery rechecks authorization; a five-second sweep also closes expired/unauthorized idle sockets (timers are not a hard real-time guarantee). Provider logout/revocation is not introspected for previously issued JWTs: use application policy revocation immediately, and short Access sessions. A failed policy lookup fails closed.

Each workbench uses a synchronous SQLite transaction for revision, selected note and request receipt. Failed receipt insertion rolls back the note too. No cached durable snapshot is published before commit. Receipts bind subject + request ID to exact request content, retained for 24 hours, capped at 1,000 per workbench; retries return the latest authorized snapshot rather than the historical response. Clients keep the request ID after an ambiguous save failure. After receipt expiry, the original base revision still conflicts rather than duplicating a committed note. Confirmation and handoff retain existing domain rules.

WebSockets use the standard, non-hibernating API deliberately: no socket attachment, presence, position or token is written to storage. Eviction/restart drops presence and requires reconnect; reconnect always fetches the current durable revision. Presence is optional and does not grant access. This keeps a small pilot simple, but active sockets/timers have runtime cost; no production cost or scale claim is made. The Directory is a small-pilot shared authority, not a sharded production identity system.

Live observations include real Access authentication, scoped authorization, idle expiry and preserved work/policy after a same-source deployment. The final distinct-account two-PC workflow additionally covers focus rejection, return-to-knock delivery, draft/confirmed handoff separation and exact replay after a deliberately suppressed save acknowledgement. Second-PC screen observations are human reports, separate from directly inspected owner UI and server state. Deployment-related disconnection and reconnection do not identify a particular Durable Object process restart. The pilot was restored to owner-only access after testing; this is not unrestricted publication or production-scale certification.

Operational limits and provider preparation are in `PILOT.md`. `VERIFICATION-PILOT.md` preserves completed live verification, the disclosed extra-draft deviation and the then-pending merge decision; PR #3 subsequently merged at `93a78e9be2326f971d435edd5830fcc38eb74897`. `VERIFICATION-M1.md` preserves the initial local implementation history. Neither historical report is rewritten by M1.1.

## M1.1 client lifecycle — review candidate, not deployed

Every selected operation carries actor ID, session epoch, tenant ID, workbench ID and selection generation. Bootstrap has its own epoch guard. Success, catch, finally, socket callbacks and handoff opening cannot mutate a later selection. Workbench and handoff payloads must match the selected tenant/workbench. Selection or detected authorization loss clears fetched DOM and handoff text. A bootstrap-provided JWT expiry also clears cached data while the user is not participating; suspended/offline browsers cannot promise immediate remote-revocation detection. Server authorization remains mandatory on every request/delivery.

Authenticated HTTP operations carry an expected-actor precondition. The Worker compares it to the verified JWT subject, never uses it as identity. WebSocket frames carry the verified recipient subject and the UI checks it before enabling participation or displaying data. This prevents accidentally using a newly logged-in different account with the previous account's pending intent.

Page-memory records are keyed by author/tenant/workbench, not selection. Editable drafts have a version, sent snapshots are separate, and one unresolved mutation per workbench retains the original request ID and body for both save and confirmation. Only an acknowledgement of the current draft's exact version/text/kind clears input. Leaving an in-flight request makes it unresolved; neither leaving nor aborting means server rollback. Later responses cannot silently settle it in another selection. Explicit resolution rechecks authorization and reuses the exact body/key. Conflicts and unknown failures preserve the request until resolution or explicit tracking discard; discarding tracking does not undo server work. Identical text with a new explicit intent gets a new ID.

No localStorage/sessionStorage draft persistence is used. The page offers explicit JSON copy/import containing only the user's own draft/sent text and mutation identifiers, never fetched note bodies, grants or credentials. Import checks origin, author, shape and collisions and never sends requests. The JSON is not encrypted and may be sensitive: the user must choose a safe temporary destination and remove their copy when no longer needed. Native reload/closing needs this explicit backup; beforeunload is a best-effort warning, not crash recovery. Reauthentication in another tab plus in-page permission refresh preserves memory. A different authenticated author cannot restore/replay the previous author's records. This is not protection against someone controlling the same physical browser/devtools.

Presence is counted by unique subject, not sockets. Maximum three connections per subject per workbench (global 50 remains). Any of a subject's active connections in focus/away prevents knocks to all of that subject's connections; otherwise a knock reaches the authorized connections. Effective displayed mode is the most restrictive: focus, away, knock, available. A sender-target cooldown is three seconds, shared across that sender's active connections. A subject gets ten messages per one-second window, with an over-budget socket closed. Limits are memory-only and cleared when the subject's last socket leaves; they are bounded pilot protection, not persistent abuse prevention or measured production capacity. Standard non-hibernating WebSockets and five-second reauthorization are retained.
