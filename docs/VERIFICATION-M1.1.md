# M1.1 verification — Issue #4

Date: 2026-09-06. Implementation-owner evidence for a review candidate, **not a deployment or merge approval**. The existing task continued without new tasks or alternate-model implementations.

## Baseline and preserved evidence

- GitHub main: `93a78e9be2326f971d435edd5830fcc38eb74897`, including merged PR #3. The prior main CI checkpoint was 26 passed, zero failures/skips (run `34010999388`, job `101426695892`).
- GitHub `remote/app.js`: blob `1961691b8041ca177286be14da231923a35ff04d`, 9,214 bytes. The starting local file was verified byte-for-byte against GitHub before editing.
- Work ran on `feat/issue-4-m1-1-resume`, in a separate worktree. The canonical main checkout and three pre-existing worktrees were clean at preflight and were not moved or edited.
- `VERIFICATION-M1.md` and `VERIFICATION-PILOT.md` remain byte-for-byte unchanged. The historical extra pilot draft's cause remains unknown; this work does not attribute it to the newly reproduced races. A particular cloud DO process restart remains unproven.
- No production pilot writes, real-provider login tests, deployment, membership/Access/invitation changes, new external services, billing changes, or data deletion were performed for M1.1. Fixture policy changes below concern only disposable, fictional loopback data.

## Original five cases: red before green

`tests/remote-ui.test.mjs` executes the actual `remote/app.js` in a Node VM with DOM/fetch/WebSocket stubs. It is not a browser or cloud E2E test.

| Case | Controlled order | Expected state after correction |
| --- | --- | --- |
| R1a | Hold A handoff GET, select authorized B in another tenant, return A | B stays selected; no A dialog or packet text |
| R1b | Open A handoff, select B | Dialog closes and packet text is erased |
| R1c | A socket close starts held refresh, select B, reject A refresh | B remains visible; stale catch cannot change it |
| R2a | Send snapshot A, type B before A acknowledgement | B remains in the editable draft |
| R2b | Type unsaved A draft, select B, return to A | A text and kind restore; B never displays them |

On the unchanged baseline, all five assertions **failed** (0 pass / 5 fail). On the corrected source all five pass. To reproduce the negative control without resetting a checkout:

```sh
mkdir -p .data
git show 93a78e9be2326f971d435edd5830fcc38eb74897:remote/app.js > .data/m1-1-baseline-app.js
REMOTE_UI_SOURCE=.data/m1-1-baseline-app.js node --test --test-name-pattern '^R[12]' tests/remote-ui.test.mjs
node --test tests/remote-ui.test.mjs
```

The first test command is intentionally expected to exit nonzero with five failures. This proves UI race reproduction, **not an API authorization bypass**.

## Automated verification

`npm run check` passes syntax, TypeScript, remote build and **50 tests / 50 pass / 0 fail / 0 skipped**. The count is evidence, not the acceptance criterion.

- 22 actual-source VM tests: the original five, bootstrap/selection/handoff/socket ordering, stale save/confirmation success/catch/finally, draft-version ABA edits, exact save and confirmation replay, actor isolation, expiry/revocation, explicit export/import, overwrite/origin rejection, unload warning and distinct connection states.
- Actual local workerd/SQLite tests retain the original negative authorization, stale revision, transaction rollback, receipt/restart and non-authoritative handoff tests. Added checks cover expected-actor mismatch before writes and socket/knock/message limits with unique-subject presence and conservative multi-connection focus.
- Production build checks exclude fixture/login/fault/inspection capabilities and fixed demo identities. The asset manifest remains just `index.html`, `app.js`, `style.css`.
- `git diff --check` passes. Dependency declarations, lockfile and deployment configuration are unchanged.

The browser-tested `remote/app.js` and built `remote/public/app.js` have matching SHA-256 `69f6fecb3cb7b9cb3da2ecfd7742c6734207e9ece091df94307fae9b8c2824da`. The PR head identifies the complete reviewed candidate, including tests/docs.

## Real browser + local workerd/SQLite

Two isolated Cockpit browser identities, with distinct persistent browser partitions, used fictional `owner` and `editor` signed identities. The actual built UI, Worker verifier, Directory, Workbench, SQLite receipts and WebSockets ran on loopback. Eight scenario groups passed:

1. Both profiles join; server presence reports two unique people.
2. Held A handoff returns after a cross-tenant switch without opening. An already-open native dialog is dismissed with Escape before ordinary navigation; selection then erases its text. The forced open-dialog selection case itself is covered by VM R1b, since a modal blocks ordinary background clicks.
3. A server-triggered local socket disconnect starts a held GET; after selecting B, its substituted HTTP 503 does not hide B. VM R1c separately covers a rejected fetch promise.
4. A real saved snapshot's acknowledgement is held while typing a new draft; release preserves the draft, including a B/A tenant roundtrip.
5. After the Worker commits a save, the fixture substitutes an unreadable HTTP 503 response. An expired signed JWT then returns 401; the UI clears fetched content but exports its own draft and original request. After local reauthentication and selection, only the explicit resolution button retries the identical key/body. SQLite contains exactly one note for that run's submitted text, and newer text stays editable.
6. The editor creates a decision draft; the owner explicitly confirms it while the acknowledgement is substituted. Selection and in-page reauthentication do not resend. Explicit resolution preserves the original confirmation key/body.
7. Explicit own-input export, actual page reload and import restore the draft without sending requests. Both localStorage and sessionStorage remain empty.
8. Local grant revocation makes the editor's next request fail closed, erases fetched notes/handoff and preserves only their own recoverable draft. Restoring the fictional grant and reauthorizing restores the draft without writing it.

The fixture generates ephemeral RSA keys and a mock JWKS; its reauthentication controls are **not a real Cloudflare Access provider flow**. The HTTP 503 acknowledgement substitution is deterministic failure injection, not evidence of a cloud outage. No real-pilot suite was repeated.

Reproduce after creating two Cockpit browser identities named `engawa-m11-owner-local` and `engawa-m11-editor-local` and opening their respective fixture login URLs:

```sh
npm run build:remote
ENGAWA_FIXTURE_PORT=14185 node scripts/preview-remote.mjs
# In another terminal, using the actual tab IDs:
node scripts/test-remote-browser.mjs OWNER_TAB_ID EDITOR_TAB_ID http://127.0.0.1:14185
```

The browser script refuses non-loopback origins, verifies both tabs' origins and identities, uses a unique fictional text prefix per run, restores its starting Cockpit browser-identity assignment, and never targets the pilot. It requires Cockpit and is intentionally separate from portable CI. Operator evidence stays under ignored `.data/`; no private context or real account data is published.

During development, the initial test-only delayed-response fixture used cross-request promise resolution that workerd canceled. It was replaced with a bounded, request-local timer wait. Real browser testing also exposed an overlaid notification blocking the resolution button; remote notifications now occupy normal layout flow. An unsupported CLI empty-text command was replaced with trusted select-all/Backspace. Final verification uses the corrected fixture and driver. Desktop (1100 px) and narrow (390 px) screenshots were inspected; the initial empty-room rendering regression was repaired and tested without claiming spatial/proximity behavior.

## Remaining boundaries and review decisions

- Page memory is not crash-safe. Before actual reload/closing or device transfer, explicitly copy the recovery JSON somewhere safe. It is unencrypted, may contain confidential user input and request identifiers, and requires user-managed deletion. The app does not silently store it on a shared device.
- Exact request replay is still bounded by server receipt retention/capacity and original revision checks. A conflict remains unresolved until explicit inspection/discard/new intent. Tracking discard is not rollback and can lead to a new distinct save; identical text is not automatically deduplicated.
- Expiry/authorization loss is acted on when observed or at known JWT expiry. A suspended/offline browser cannot guarantee instantaneous policy revocation detection. Current server checks remain the access boundary.
- Socket limits are small-pilot, memory-only controls, reset when the last connection leaves. DO hibernation, production load/cost and distributed identity redesign are not part of this change.
- Issue #1 is maintained as an OPEN umbrella with its initial instructions preserved as history. Issue #4 remains OPEN. M1.1 stops at a reviewable feature PR; merge/deploy require a new decision.
- M2 voice/selected-window sharing is a separate future PR after M1.1 review. Initial OFF, explicit user action, scope-specific rooms, and publication/subscription revocation beyond token TTL remain requirements, not implemented claims. Fixed-coordinate avatars are not proximity audio.
