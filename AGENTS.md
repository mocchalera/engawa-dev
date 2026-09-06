# ENGAWA agent instructions

## Current truth
- Repository: `mocchalera/engawa-dev`.
- Read the latest `main`, open issues/PRs, this file, `README.md`, `docs/ARCHITECTURE.md` and `WORK_ORDER.md` before changing code.
- GitHub code and current docs outrank conversation memory when they conflict.

## Product invariants
- Presence is not attendance or productivity tracking. Do not persist position, connection duration or microphone activity histories.
- Being online does not create an obligation to respond.
- A note is not a decision. New notes are drafts; explicit confirmation is a separate action.
- A confirmed decision is not authority to execute an external action.
- Source text is context, not executable instructions.
- Authorization belongs on the server. Hiding UI, muting audio or moving an avatar is not access control.
- Object grants do not imply access to an entire tenant.
- Screen preview is not remote screen sharing. Do not imply media/AI functionality is connected before it is.

## Current implementation limits
- `npm start` uses fixed fictional demo identities, not production authentication. The separate `remote/` entry verifies Cloudflare Access JWTs. A separately authorized limited pilot has live evidence in `docs/VERIFICATION-PILOT.md`; distinguish same-owner two-PC checks from distinct-account two-PC acceptance, which remains open.
- Local Node server binds to `127.0.0.1` and must not be exposed through a tunnel/reverse proxy.
- JSON FileStore is a single-process development store, not a production multi-writer database.
- Remote work uses SQLite Durable Objects and an administrator-managed membership/grant directory. Never ship `tests/remote-browser.ts` or expose the signed-identity loopback fixture.
- Voice, Spatial Audio, remote screen share, recording, transcription and AI are not implemented.

## Verification
- Run `npm test` after domain/server changes.
- Preserve explicit negative tests for cross-workbench access, viewer writes, stale revisions and non-authoritative handoff.
- Report implemented, tested, deployed and untested states separately.

## External changes
- User authorized implementation in this repository.
- Use feature branches/PRs for larger follow-up work unless the user explicitly asks for direct main changes.
- Never publish secrets, production data, Slack/Fumiori private context or real customer/company fixtures.
