# Town verification — 2026-09-07

Status: **local implementation candidate; no deploy; not organization-wide acceptance**.

Base inspected: main `93a78e9be2326f971d435edd5830fcc38eb74897`; open PR #5 head `912eb5ec916c84407f0a39328bc05e4026775003`. Existing tests reported by PR #5 were not rerun in this sandbox. Do not add those counts to the candidate counts below.

## Executed locally

Node v22.16.0 on Linux. `npm --prefix town run check`: **39 tests passed, 0 failed, 0 skipped**. No dependency install required for these tests.

Coverage includes domain authorization/role/recipient exposure, no late-join history, text expiry versus durable memory, private capture, same-source sharing, stale revisions and idempotency, prepare/commit separation, absence of persisted presence, revocation, session expiry, task scope/claim, guest metadata, invalid/prototype input, thread/pinned-history retention, game turns, bounded plants/photos, compact movement snapshots, capacity failure without deletion, actual SQLite row codec/transaction rollback/restart, actual Node HTTP/cookies/SSE/CSRF, and explicit own-input recovery collision/site/actor checks.

## Browser observation

Actual Chromium DOM/CSS/app/domain code was rendered on an offline document with mocked fetch/SSE and fictional people. Task creation, profile selection, recipient capture, panel switching, mobile layout and a delayed-save regression were exercised. Newer form input remained after the old save acknowledgement. Revocation while a native dialog was open closed and cleared that dialog and all fetched work. No page exceptions were observed. A 390px viewport had no horizontal overflow.

The screenshot is an **actual implementation render with fictional fixture state**, not a live deployment or a screenshot of actual organization members. WebGL was unavailable in this environment; the software-rendered 3D fallback was inspected. GPU/WebGL rendering itself has not been validated here.

The sandbox browser refused localhost network navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. This was not bypassed. Real HTTP was tested separately in Node, but that does **not** constitute end-to-end browser-network acceptance.

## Not executed locally

Root dependency install, the existing main/M1.1 suite, full Cloudflare TypeScript integration, Miniflare/workerd integration, real Access provider/actual distinct accounts, two physical devices, Cloudflare deployment or database restore, measured scale/cost, production WebGL and accessibility certification. The cloud integration test and CI workflow are provided to run these code-level checks in the repository environment. Passing that future workflow still will not establish real-provider/deployment acceptance.

## Connection result

GitHub reads succeeded. Fumiori `list_workspaces` was refused with `FORBIDDEN: This conversation does not support developer MCPs`. Cloudflare control actions were not discoverable in this conversation. No attempt was made to bypass either boundary. No company data, live recording, real users, infrastructure configuration or previous pilot state was changed.
