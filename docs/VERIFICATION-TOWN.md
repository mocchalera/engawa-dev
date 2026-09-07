# Town verification — 2026-09-07

Status: **implementation candidate with passing repository CI; no deploy; not organization-wide acceptance**.

Base inspected: main `93a78e9be2326f971d435edd5830fcc38eb74897`; open PR #5 head `912eb5ec916c84407f0a39328bc05e4026775003`. Town source is PR #7, branch `feat/town-community-20260907`. Keep #5 review separate. Issue #6 tracks the wider organization-use goal and remains open.

## Executed locally

Node v22.16.0 on Linux. `npm --prefix town run check`: **39 tests passed, 0 failed, 0 skipped**. No dependency install required for these tests. These same tests were rerun successfully by GitHub Actions; do not count reruns as extra test coverage.

Coverage includes domain authorization/role/recipient exposure, no late-join history, text expiry versus durable memory, private capture, same-source sharing, stale revisions and idempotency, prepare/commit separation, absence of persisted presence, revocation, session expiry, task scope/claim, guest metadata, invalid/prototype input, thread/pinned-history retention, game turns, bounded plants/photos, compact movement snapshots, capacity failure without deletion, actual SQLite row codec/transaction rollback/restart, actual Node HTTP/cookies/SSE/CSRF, and explicit own-input recovery collision/site/actor checks.

## Repository CI observed after the timer-type fix

Candidate code head: `78093874e591585043274b4a456442c607cac580`.

- Town PR run `34131504247`, job `101772477328`: **SUCCESS**. The PR job checked synthetic merge `eb14617e1048143a7fe94359f9ef346b2b34b867`, combining this candidate with #5 head `912eb5ec916c84407f0a39328bc05e4026775003`.
- `npm ci`: SUCCESS.
- `npm --prefix town run check`: **39 pass / 0 fail / 0 skipped**.
- `npx tsc --project town/tsconfig.json`: SUCCESS.
- `node --test town/tests/cloud.integration.mjs`: **6 child scenarios plus their parent test; TAP totals 7 pass / 0 fail / 0 skipped**.
- Existing repository `checks` PR run `34131504154`: **SUCCESS**. This was not rerun in the sandbox; the result was read from GitHub.

The cloud integration executes the real bundled Worker and local workerd/SQLite under Miniflare. Its six scenarios cover signed JWT verification and spoofing/CSRF rejection; explicit membership/grants and guest isolation; revision/idempotency and SQLite; recipient-only rewind/private capture; active SSE revocation; and restart persistence without transient presence/text.

Identity provider/JWKS, users and asset service are fictional test fixtures. This is **not real Cloudflare Access provider acceptance, deployed infrastructure, actual human-device validation or a backup restore**.

An earlier Town PR run `34131329694` failed the worker typecheck: optional timer handles were passed directly to Cloudflare's clearTimeout/clearInterval types. Guarding undefined handles in `7809387` fixed that failure. The subsequent successful run above also executed the previously skipped cloud test. Do not erase the failed run from the verification history.

Source transfer: the 26 generated text files were SHA256-verified before import. Source-import run `34131202718`, job `101771492706`, verified the packet and reran the 39 local checks. The transfer fragments and one-shot write workflow are absent from the current PR diff. No secrets or organization data were used.

## Browser observation

Actual Chromium DOM/CSS/app/domain code was rendered on an offline document with mocked fetch/SSE and fictional people. Task creation, profile selection, recipient capture, panel switching, mobile layout and a delayed-save regression were exercised. Newer form input remained after the old save acknowledgement. Revocation while a native dialog was open closed and cleared that dialog and all fetched work. No page exceptions were observed. A 390px viewport had no horizontal overflow.

The screenshot is an **actual implementation render with fictional fixture state**, not a live deployment or a screenshot of actual organization members. WebGL was unavailable in this environment; the software-rendered 3D fallback was inspected. GPU/WebGL rendering itself has not been validated here.

The sandbox browser refused localhost network navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. This was not bypassed. Real HTTP was tested separately in Node and the Cloudflare adapter separately in local workerd on GitHub CI, but neither constitutes end-to-end browser-network acceptance.

## Still unverified / unfinished

Real Access provider/actual distinct accounts, two physical devices, Cloudflare deployment and backup restore, measured scale/cost, production WebGL and accessibility validation, invitations/admin operation, durable-storage scaling and paging, voice/screen sharing, external task sync and Slack migration. The single Town aggregate 4MiB safety guard is a pilot limit, not organization-wide storage capacity. See `TOWN-ROLLOUT.md` for the remaining gates.

## Connection result

GitHub source writes, Issue #6 and draft PR #7 creation, and CI reads succeeded. Fumiori `list_workspaces` was refused with `FORBIDDEN: This conversation does not support developer MCPs`. Cloudflare control actions were not discoverable in this conversation. No attempt was made to bypass either boundary. No company data, live recording, real users, infrastructure configuration or previous pilot state was changed. Main and PR #5 have not been merged by this work.
