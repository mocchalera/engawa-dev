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

## Target cloud boundary — not implemented yet

```text
Browser
  -> Workers: static assets + real authenticated API
  -> workbench-bound Durable Object (SQLite)
       durable selected work + revision/grant binding
       ephemeral presence connection state
  -> LiveKit token endpoint after authorization
  -> LiveKit media room
```

Do not relay audio/video through the Durable Object. Do not issue media tokens until the server can prove identity plus workbench grant.
