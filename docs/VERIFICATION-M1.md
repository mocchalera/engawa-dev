# Issue #1 verification — 2026-09-05

## Provenance

- Source main matched local HEAD before implementation: `f0528a7da34fe5ae53945c139c8e52e02613f780`.
- Original checkout was clean and remains untouched. Work is isolated in `feat/issue-1-remote-pilot`.
- Cockpit task `c4213858`: effective `gpt-6-astra`, `medium`, `standard`, Codex normal implementation. Read back from task settings; no fallback or duplicate task created.
- Original baseline: `npm run check`, 12 passing tests. Local HTTP/SSE milestone: `f3a3974`.

## Automated checks

- `npm run check`: syntax, strict remote TypeScript, remote asset generation and Node tests. Current final counts are reported with the PR/CI run rather than inferred from historical baseline.
- Real local Node process + HTTP/SSE: login cookies, owner/editor join, focus knock denial, delivered knock/change events, viewer write denial, other workbench/tenant refusal, draft/confirmation separation, stale revision, non-authoritative handoff, process restart and no persisted presence.
- Actual workerd + SQLite DOs: cryptographic signed JWT verification; wrong signature/issuer/audience/expiry/not-before; identity-header spoofing; admin policy and revision; membership-only denial; viewer/other-workbench/tenant boundaries; real WebSocket presence/knock/notifications; mutation idempotency; explicit confirmation; SQLite trigger-injected rollback; grant/membership/expiry closure and denied reconnect; persisted work/policy across runtime restart; static auth and production fixture exclusion.
- Provider JWKS and the ASSETS fetch binding are mocked in runtime tests; signature verification, app authorization, WS handling, SQLite transactions and restart storage are real. This is not real Cloudflare Access login or deployed infrastructure evidence.
- `wrangler deploy --dry-run --outdir .remote-build`: bundle and asset binding validation only, no upload/deployment. Production bundle inspected for demo identities and test-only routes.
- Fresh `wrangler dev` session on loopback: unconfigured `/api/bootstrap` returned 503 `auth_unconfigured`, with no-store and media-denial headers. No authentication bypass added.

## Actual browser observations

Two isolated Cockpit browser identities (`engawa-c4213858-owner` and `engawa-c4213858-editor`), not two tabs sharing cookies:

1. Node demo: owner/editor joined simultaneously; editor focus disabled the owner's knock control; editor returned to knock mode, knocked, saved a decision draft; owner confirmed and opened context-only handoff (`executionAuthorized: false`). Presence remained present beyond the old 45-second timeout.
2. Node process restarted with the same disposable JSON store. Fresh browser login restored the confirmed Japanese test note at revision 3 and zero presence.
3. Separate signed-identity remote fixture: owner/editor joined over real browser WebSockets; editor saved a draft; owner received it, confirmed and inspected handoff at revision 2. Focus disabled knock. Reload/rejoin retained the work. No actor chooser was present. A screenshot inspection caught overlapping identity labels; bounded labels and spaced avatars were applied and recaptured.

Screenshots are local task artifacts, not private/customer fixtures: `/tmp/engawa-c4213858-local-restored.png` and `/tmp/engawa-c4213858-remote-verified.png`. They are not required inputs for automated tests. Browser and API evidence use fictional identities only.

## Not verified / not authorized

Real IdP/Access account login/logout, deployed domain/alternate ingress, two physical PCs, production durability/backups, load/cost, native accessibility/assistive hardware. No claim is made that these gates passed. No main merge, Cloudflare deployment/resource creation, billing change, audio, recording, transcription or AI connection occurred. Feature branch publication and review PR are the authorized delivery boundary.

## Failures resolved during local implementation

- Current Node presence expired while a connected SSE client was idle: refresh the in-memory TTL on its heartbeat; retain no history. Old-stream close cleanup now cannot delete a new stream set.
- New Miniflare 5 requires converted options rather than the v4 constructor shape. A file-path module configuration produced an internal startup error; the named bundled-module manifest worked. Explicit `resourcePersistencePath` was needed because the v4 converter did not carry the old persistence option. The restart test initially failed and then passed with persistent SQLite restored.
- An initial patch referenced a nonexistent CI filename; the existing `.github/workflows/ci.yml` was identified and updated without creating a second workflow. Tests were not represented as green while these issues remained.
