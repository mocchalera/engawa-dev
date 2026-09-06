# M1 pilot setup and authority boundary

## State

A limited Access-protected pilot was deployed after separate user approvals. Real authentication, same-owner two-PC collaboration, distinct-account authorization, isolation, expiry and same-source deployment recovery have bounded live evidence. Temporary grants and Access admission were removed after testing; the pilot was restored to owner-only access. `VERIFICATION-PILOT.md` records the observation scope and remaining final acceptance. `VERIFICATION-M1.md` is the historical pre-deployment implementation record, not the current deployment status.

Past approvals are not standing authority for new invitations, deployments or billing/resource changes. Node demo and remote entry are separate; do not migrate fictional demo notes or identities into a real tenant. LiveKit, recording, transcription and AI remain unconfigured.

## Reproduce without an account

Node 22+ and the checked-in lockfile:

```sh
npm ci
npm run check
npx wrangler deploy --dry-run --outdir .remote-build
npm run dev:remote
```

The final command binds to loopback. Without Access configuration, even `/api/bootstrap` fails closed with 503 `auth_unconfigured`. This is expected, not a reason to add a bypass. `npm test` builds remote assets automatically. workerd tests generate ephemeral RSA keys, mock the configured issuer's JWKS, and exercise the actual verifier and SQLite/WS runtime. The test-only SQLite failure trigger is not shipped.

Optional real-browser **fictional identity fixture**, also strictly loopback:

```sh
npm run build:remote
node scripts/preview-remote.mjs
```

Open `http://127.0.0.1:14174/__fixture/login/owner` and `/__fixture/login/editor` in separate browser profiles (`viewer` is also available). This models Access's signed identity header, not a real provider login. Generated signing keys/tokens live only in the fixture process. Restarting the fixture starts new disposable work. Never expose, tunnel, reverse-proxy or deploy it. `wrangler.jsonc` points only to `remote/worker.ts`; a regression test excludes fixture endpoints and demo identities from that bundle. Stop the fixture with Ctrl-C.

## External preparation — separately authorized work

1. Confirm the target Cloudflare account, supported SQLite DO plan and domain. Account/billing/resource creation and deployment need explicit authorization; do not run a real deploy as part of local setup.
2. Configure a self-hosted Access application for the complete pilot origin, including assets and WebSocket upgrades, with a real identity provider or limited-pilot email one-time PIN. Use a short session lifetime and an explicit invitee policy. Do not use a bypass or service-token policy as human authentication.
3. Set server-side `ACCESS_ISSUER` to the exact `https://TEAM.cloudflareaccess.com` origin (no trailing slash), `ACCESS_AUD` to that application's audience, and `ADMIN_SUBJECTS` to a comma-separated list of verified Access subject IDs. Read subjects from verified provider identity, never client-selected names. These values must remain out of public fixtures; store local values in ignored `.dev.vars` and production values through the separately authorized secret/configuration workflow. Never paste tokens or private subject rosters into GitHub/chat.
4. Configure the authorized custom route/domain. `workers_dev: false`, `preview_urls: false`, `run_worker_first: true` are deliberate. Protect every alternate route; do not weaken the Node demo's host guard.
5. After a separately authorized deployment, initialize the empty app policy as the verified administrator. Access authentication alone does not grant any workbench access.

## Policy and safe revocation

Admin-only `GET /api/policy` returns `{ revision, members, benches }`. Admin-only `PUT /api/policy` replaces it atomically using the current revision. Send same-origin JSON with `X-Engawa-Client: remote-ui`; the JWT is supplied by Access, not a browser actor picker. Body maximum is 16 KiB; at most 30 benches and 50 members per tenant. Example **schema placeholders**, not a runnable identity fixture:

```json
{
  "revision": 0,
  "members": { "pilot": ["VERIFIED_OWNER_SUBJECT", "VERIFIED_EDITOR_SUBJECT"] },
  "benches": [{
    "id": "shared-work", "tenantId": "pilot", "title": "Shared work", "goal": "Resume selected work",
    "grants": { "VERIFIED_OWNER_SUBJECT": "owner", "VERIFIED_EDITOR_SUBJECT": "editor" }
  }]
}
```

Before any policy update, read and retain the previous policy in private operator storage; inspect the exact diff and preserve unrelated tenants, members and grants. Missing entries are revoked. Membership removal must also remove that subject's grants in the tenant. Every remaining bench needs an owner. A bench ID cannot move to another tenant, even through deletion/recreation. Removal does not delete work.

PUT returns the new revision only after affected existing sockets close. Remaining users must rejoin; the revision guard rejects stale policy writes. If a response is lost or 503 occurs, do not assume rollback or blindly resend: inspect GET with the admin session, compare revision/content and explicitly rejoin. To roll back a policy mistake, use the reviewed prior content with the freshly read current revision, not an old revision or a database reset. This does not undo notes saved in the meantime.

Removing Access access alone does not revoke an already validated JWT in memory before its expiry. For immediate application revocation, remove the app grant/membership and verify an existing connection closes, reads/writes return 404 and reconnect fails. Idle JWT expiry is checked on a five-second sweep; every message/delivery is also checked. Provider-side revocation/introspection, invite UI and automated user provisioning are out of scope.

## Operational and rollback limits

- Standard non-hibernating WebSockets: presence disappears on restart/eviction and is never a history. At most 50 connections per bench. Pilot limits are not production scale/cost guarantees.
- Notes: 200 per bench, 3,000 characters per note. Receipt keys: 16–80 alphanumeric/hyphen characters; retained for 24 hours with a 1,000-per-bench cap. Retry the exact failed save with the same key; never reuse it for edited content.
- Policy and work are distinct SQLite DOs. Policy authorization is checked before each operation; already-authorized concurrent operations may finish during revocation. No cross-object transaction or provider-session introspection is claimed.
- Config/CI baseline is preserved by Git (`f0528a7da34fe5ae53945c139c8e52e02613f780`); use an isolated worktree at that revision for the prior local-only implementation. Do not reset the canonical checkout or delete remote SQLite to roll back an app build. A cloud rollback needs its own authorization and reviewed migration compatibility.
- Dependency versions are fixed by `package-lock.json`; this Wrangler release brings Miniflare 5 alpha. Tests use its exported v4 option converter with explicit persistence root. Recheck runtime/persistence on upgrades.

## Post-deployment acceptance (partially verified)

Do not repeat the entire live suite merely because the original checklist predates deployment. Use `VERIFICATION-PILOT.md` to identify the remaining checks. Same-owner two-PC evidence and separate browser-profile account tests do not prove a distinct-account two-physical-PC workflow. Finish that workflow and live ambiguous-save retry with explicit, bounded permission; preserve all existing notes and owner grants, use new fictional verification content only, and restore temporary access afterward. Keep private identity evidence private. Only after this gate consider a separately scoped LiveKit task.

## Official specifications consulted (2026-09-05)

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
