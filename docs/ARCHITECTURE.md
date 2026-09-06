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

Operational limits and provider preparation are in `PILOT.md`. `VERIFICATION-PILOT.md` separates completed live verification, the disclosed extra-draft deviation and pending review/merge acceptance; `VERIFICATION-M1.md` preserves the initial local implementation history.
