# Approved auto-accept screens and counter boundary

**Goal:** implement only the two screens approved on 9 November and prevent direct counteroffers at or above the auto-price, behind the existing disabled flag.

**Design-go:** https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6752452233. Later decisions supersede the original issue body's proposed removal of direct transfers.

**Architecture:** keep the existing listing, offer, auction-start and notification paths. The seller form consumes the current listing boundary; the buyer dialog calls the existing auto-accept route. All money, ownership and boundary checks remain authoritative on the server and in the database transaction.

**Tech stack:** existing Express/Supabase/PostgreSQL backend, React with shared UI primitives, TypeScript for new frontend files, node:test and existing Playwright fixtures.

**Execution:** sequential worker, no subagents. Parent owns independent review, FULL verification, actual desktop/mobile before/after images, PR/CI and release decisions. No worker commit, push or PR before parent review.

## Contracts and measured baseline

- SSOT: `docs/TRANSFER_MARKET_RULES.md` section 5.1 and section 2; `docs/ECONOMY_RULES.md`; `docs/design/PAGE_TEMPLATES.md`; `docs/design/TASTE.md`; `docs/i18n/README.md`.
- Existing work: PR #7878 supplies the start API and atomic M2 RPC; PR #7937 supplies prerequisite enforcement, swap locking and watcher notification parity. Both are merged. Do not rebuild those features.
- Source baseline: `0537bbabec55cb1344e624ad34850075fd8bae08`.
- Measured: `node --test backend/lib/autoAccept2176.test.js backend/lib/transferExecution.test.js`: 93 passed, zero failed/skipped.
- These tests are a regression floor, not achievement of the approved screen/boundary goal. `TransfersPage.jsx` has no auto-accept UI. The seller `counter` branch in `backend/routes/api.js` updates `transfer_offers` without the auto-price guard. The current start handler accepts only `expected_price`; the SQL derives the opening bid from the listing auto-price.
- Historical first attempt (resolved in recovery): PG17 baseline was blocked: `AUTO_ACCEPT_PG_BIN` is unset; PATH resolves to PostgreSQL 18.4, and no PG17 binary was found in the checked standard tool locations. No backend/money implementation or migration has been changed. Obtain an existing PG17 bin path before proceeding; do not substitute PG18 or a skipped test as evidence.

## Global constraints

- `auto_accept_enabled` remains off. No production writes, flag flips, apply, merge, deployment or external messages.
- Below-boundary direct negotiations and the complete flag-off path remain unchanged. Only the buyer starts an auction.
- Use the exact approved EN/DA copy and shared CZ$/date formatters. Do not invent player prose. Other languages follow the documented translation pipeline; missing approved translations are a release gate, not permission to publish raw keys.
- New frontend files are `.ts`/`.tsx`. Existing `node_modules` is shared: no install commands in this worktree.
- Test clocks are explicit. Temporary files and local PostgreSQL data stay in the assigned scratch directory.
- No patch-note file edit in this wave; parent collects approved player text at close-out. Do not author new patch-note prose without approval.

## Review focus

1. Old counteroffers and confirmations must not bypass the boundary after a listing price changes; define the applicable current-listing check at each mutation and at final execution.
2. An editable opening bid must actually reserve the submitted amount, while `expected_price` independently detects a changed listing price.
3. Preview and server ends must agree across night, exact closing time, weekday/weekend and Copenhagen DST transitions.
4. Two rapid submissions and stale price conflicts must never double-start or silently accept an unseen price.
5. A flag/config read failure must not expose an unlocked money path or display invented opening hours.

## Task 1: authoritative counter boundary and opening bid

**Owned files:** `backend/lib/autoAccept2176.js`, its node/PGlite/PG17 tests, `backend/lib/transferExecution.js` and test, `backend/routes/api.js`, `database/2026-11-09-2176-counter-auction-boundary.sql`.

**Existing interfaces:** `getOfferAutoAcceptIssue(supabase, { riderId, listing, offerAmount })` returns null or `{ status, body }`; `getOfferAutoAcceptConflict(listing, amount)` is the pure boundary rule. `makeStartAutoAcceptHandler(deps)` takes `expected_rider_id`, `expected_price`, `duration_minutes`. `autoAcceptAuctionEnd(now, cfg, minutes)` delegates to `calculateAuctionEnd`.

- [ ] Obtain PG17 and run the existing real-PG17 suite through `scripts/verify-lock.ps1 -Max 2 -Runtime codex`, with TEMP/TMP set to the lane scratch. Inspect the test's positive server-stop diagnostic. Preserve baseline results before implementation.
- [ ] Add failing behavioral regressions for seller counter below/equal/above the current auto-price, old counter acceptance/confirmation and flag-off/no-price/stale-owner cases. Exercise the actual database mutation for concurrent price changes, not only a pre-read helper.
- [ ] Add a failing start-handler/database regression where the editable opening bid exceeds the auto-price: returned price, auction current price and commitment must use that bid; stale expected auto-price still conflicts without creating an auction.
- [ ] Extend the existing request with an optional `bid_amount` (legacy omission means the expected auto-price), keeping `expected_price` solely as the optimistic listing version. Validate whole CZ$ amounts and the lower bound before using the submitted amount for signing, price-band checks, money commitment and atomic start. Extend the service-only RPC without ambiguous overload resolution; preserve legacy argument shapes safely.
- [ ] Enforce the counter boundary in the seller mutation and acceptance/execution paths, with an atomic database check sharing the listing/ownership synchronization. Return an existing translated error contract where possible; any genuinely missing player error translation remains a reported gate.
- [ ] Migration must be idempotent, service-only and independently tested twice against PG17 with the existing escrow/M2 migrations in both established orders. No apply outside the temporary local test database.
- [ ] Keep `notifyAutoAcceptWatchers` and `announceAutoAcceptAuction` behavior; existing parity tests cover actor exclusion, keyed in-app notification and Discord DM. Add only a regression needed for the new submitted-bid amount.

## Task 2: approved seller screen and buyer dialog

**Owned files:** `frontend/src/pages/TransfersPage.jsx`, `frontend/src/components/transfers/AutoAcceptAuctionDialog.tsx` and `.test.ts`, `frontend/src/lib/autoAccept2176.ts` and `.test.ts`, `frontend/tests/e2e/auto-accept2176.spec.ts`, the five assigned `transfers.json` files; backend flag API and test.

**Existing interfaces:** `MarketOfferForm({ listing, onOffer, seasonYear })`; `ReceivedOfferCard({ offer, onAction, showArchive })`; `apiFetch`; `fetchPlayerFeatureFlags`; shared `Modal`, `AmountInput`, `Button`, `Flag`, `RiderLink`, `formatCz`, `formatDate`.

**New owned interface:** `AutoAcceptAuctionDialog({ listing, timingConfig, now, onCancel, onSubmit, onRefresh })`; `onSubmit({ expected_rider_id, expected_price, bid_amount, duration_minutes })` resolves only after the server response. `now` is explicit. Pure `autoAccept2176.ts` helpers validate numeric hour/minute parts and the combined active duration and calculate the end from supplied config/time.

- [ ] Add failing pure tests for invalid/blank/fractional duration parts, bounds, auto-price comparison, and timing parity against backend `calculateAuctionEnd` with fixed dates, including exact close and DST.
- [ ] Expose the binary flag through an owned backend interface without editing unowned training/catalog files. The public feature-flags reader currently does not allowlist this key, so either obtain parent ownership for the catalog extension or provide a narrowly gated market configuration read in the owned route/helper. Return only required public auction timing fields and the effective boolean, never arbitrary `app_config` values.
- [ ] Read live `auction_timing_config` for preview; preserve the backend weekday/weekend active-window algorithm. Never hardcode the opening/closing hours shown in copy or compute active duration as simple wall time.
- [ ] Feed current listing price/auto-price into the received offer form only when enabled. Show the three approved money rows and exact label. At/above auto-price apply danger hairline, `aria-invalid`, associated approved explanation, and disable Send counter. Keep Accept/Reject behavior below the boundary.
- [ ] Use the shared modal focus/Escape/portal recipe and custom approved title typography. Render linked rider name plus flag, opening-bid input prefilled with the auto-price, minimum line, separate free hours/min fields, dynamic hours guidance, immediate weekday/date/time end, exact binding-money sentence, Cancel and one gold Start auction.
- [ ] Protect submit with an immediate ref latch as well as disabled pending controls. Block dismiss while pending. On price conflict refresh current listing, update the shown minimum/bid deliberately, keep the dialog open with the existing translated conflict message, and require another explicit submit.
- [ ] Add browser tests for OFF path, seller boundary UI, dialog keyboard/form behavior, invalid duration, new price conflict and rapid double submit. Parent runs actual browser/e2e verification and screenshot evidence; worker does not start full E2E or a surviving server.
- [ ] Add exact approved EN first and DA second. ES/FR/NL require the existing delta translation pipeline and approved review; do not fabricate translations or copy English into those locale files as though translated.

## Task 3: verification and handoff

**Owned files:** `docs/TRANSFER_MARKET_RULES.md`, `docs/FEATURE_REGISTRY.yml`, generated `docs/FEATURE_STATUS.md`, `.claude/learnings/2026-11-09-2176-auto-accept-ui.md`.

- [ ] Update section 5.1 to describe the implemented seller boundary, buyer request and screen. Preserve off/building state. Generate feature status only if registry metadata changes.
- [ ] Record the reproduced bypass, root cause and meaningful regression evidence in the learning file after there is an actual fix.
- [ ] Run targeted auto-accept/transfer tests, new frontend node tests, lint and `verify-affected.mjs`; heavy runs use `verify-lock.ps1 -Max 2 -Runtime codex`. Inspect outputs, do not infer success from shell exit alone.
- [ ] Parent completes whole-package/typecheck/ratchet/preflight, independent review, full E2E and real desktop/mobile before/after. No worker commit/push/PR or fabricated ready status.
- [ ] Return exact changed files, measured checks, remaining translation/PG17/review gates and patch-note approval requirement. No public private-data logs, no NOW/MASTERPLAN edits, no external message.

## Investigation handoff (9 November)

Implementation has not started because the required PG17 baseline tool is unavailable in the checked environment. The existing 93-test regression floor is green, but the owner-approved target remains unmet. Next action: supply an existing local PostgreSQL 17 bin directory, run the baseline in scratch, then start Task 1 with a failing regression. No code, flag, data, migration, commit or PR was changed by this investigation.


## Recovery implementation handoff (10 November)

- Native permission probe: `2176-native-permissions.json` reports matching worktree/branch and `ok=true`.
- Recovered existing PostgreSQL 17.11 bin with per-command AUTO_ACCEPT_PG_BIN; no installation/global change. Baseline PASS, both migration orders, 800 concurrent attempts, zero overbooking/deadlocks; `temporary_pg17_server_stopped=true`.
- Branch fast-forwarded to `6c52c88f2`; no lockfile change. Exact ownership extension approved by parent: auto_accept_enabled allowlist only in stageFlagCatalog.js, required delta metadata in frontend/i18n-state.json.
- Implemented separate editable bid RPC, authoritative offer-write trigger and price-aware final claim; legacy start/claim signatures remain intact. Expanded native PG17 PASS with six migrations applied twice in both orders, editable bid persisted and insufficient funds refused. Final concurrent price-change run PASS: native PG17 17.11, six migrations applied twice in two orders, 800 attempts, zero overbooking/deadlocks, `temporary_pg17_server_stopped=true` (182.24 s).
- Focused node suite: 126 passed, zero failed/skipped. TypeScript compiler: clean. TransfersPage changed-file lint: clean. verify-affected classifies FULL; parent owns FULL/e2e/build/preflight.
- Five browser specs authored for OFF, seller threshold, free duration/end/Escape, stale-price refresh and rapid double-submit/pending-dismiss; not executed by worker.
- Current UI has no seller auto-price editor: approved scope only covers counter screen and buyer dialog. OwnListingActions edits asking_price. Separate gap left untouched per parent instruction.
- Copy resolved 10 November by owner-supplied table: https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6754209822. EN row labels are List price / Auto price / Buyer's offer. DA remains unchanged. Existing Send wording is reused in EN/ES/FR/NL; DA enhanced form retains approved Send modbud.
- ES/FR/NL now contain the complete approved delta verbatim. Existing terminology matches the supplied subasta / enchère / veiling. All sixteen autoAccept keys exist in EN/DA/ES/FR/NL; approved target strings have reviewed source hashes computed with the documented pipeline helper.
- Flag remains OFF/building. No commit/push/PR, merge, production write/apply, notification to real users or deployment. Parent owns patch notes/help, screenshots, independent review and full verification before any commit.


### Final worker verification

- `node --test backend/lib/autoAccept2176.test.js backend/lib/transferExecution.test.js backend/api/featureFlagsApi.test.js frontend/src/lib/autoAccept2176.test.ts`: 126 passed, zero failed/skipped.
- `verify-lock.ps1 -Max 2 -Runtime codex -- node --test --test-name-pattern='approved UI boundary' backend/lib/autoAccept2176.pglite.test.js`: 2 passed, zero failed/skipped.
- `AUTO_ACCEPT_PG_BIN=C:/Users/Nicolai/scoop/apps/postgresql17/current/bin` with lane scratch TEMP/TMP; `verify-lock.ps1 -Max 2 -Runtime codex -- node --test backend/lib/autoAccept2176.pg17.test.js`: final PASS, positive server stop diagnostic. One preceding run completed every SQL scenario but failed its 30-second shutdown timeout; pg_ctl status then positively reported no server running and its log showed a 37-second checkpoint. Stop wait now 120 seconds, same graceful stop, no deletion of a running cluster. Preserved prior scratch cluster remains as evidence.
- `verify-lock.ps1 -Max 2 -Runtime codex -- npm --prefix frontend run lint`: PASS, including apiFetch forward guard.
- `verify-lock.ps1 -Max 2 -Runtime codex -- node frontend/node_modules/typescript/bin/tsc -p frontend/tsconfig.json --pretty false`: PASS.
- Playwright `auto-accept2176.spec.ts --list`: compiles 15 cases; browser execution remains parent-owned.
- `node scripts/verify-affected.mjs`: FULL classification, parent assigned FULL. `git --no-pager diff --check`: PASS.
- Translation dry-run after approved copy insertion: zero new/changed/removed ES/FR/NL keys; no missing autoAccept keys in any language. Four unrelated existing DA deltas remain untouched.
- Cross-PC forensic audit of this exact worktree: zero errors, four warnings (three local links plus intentionally uncommitted diff). No autofix or unrelated file edits.
- All worker command sessions have returned terminal exit codes. Final native cluster reports stopped; no browser/dev server was started. No commit/push/PR was made. Parent owns independent review and all remaining release/copy gates.


### Bounded approved-copy follow-up (10 November)

Source: owner comment https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6754209822. Inserted only the supplied EN row labels and ES/FR/NL table; reused each locale's existing offerCard.buttons.send in the matching autoAccept key. DA JSON was not changed in this follow-up. No new player wording, seller editor or product behavior added.

Fresh permission proof `2176-native-permissions-copy-20261110.json`: matching ok=true. The prior filename is intentionally preserved because the native probe uses exclusive-create output; no security setting or marker was bypassed.

Bounded checks, both through verify-lock.ps1 -Max 2 -Runtime codex: autoAccept2176.test.ts 4/4 PASS, including all-five-language key parity, ICU rendering/parameters and reviewed hashes; TypeScript compiler PASS. Translation dry-run and diff-check PASS. No E2E, full verification, server or production action started. Both command sessions observed exit 0. Copy gates are resolved; parent review, full verification, screenshots and release gates remain.


### Bounded first-review corrections

- P1 confirmation recovery: real confirmTransferOffer regression reproduced the permanent awaiting_confirmation/both-confirmed state. A single conditional UPDATE transaction withdraws only the exact rejected confirmed offer, matching status, both bits, rider/parties and both money fields. Concurrent changed negotiations are preserved; retry returns not_awaiting_confirmation and the existing terminal UI supports archiving/new negotiation. No rider/money movement occurs.
- P2 pending navigation: rider name becomes a non-link while pending; capture guard closes the immediate ref-latch/render gap. Existing pending browser regression asserts no internal link remains.
- P2 stale end: getNow is explicit; before any binding request the dialog recomputes the end and compares displayed minute precision. A changed end updates Ends and returns without request, requiring another click. Explicit-clock regression covers 23:29:45 +30 minutes versus submit20 seconds later rolling to08:00; no new text.
- Targeted transfer/frontend node suite:63 passed. Compiler, changed-page lint and diff hygiene:PASS. Browser --list:18 cases compile (six specs across three projects), not executed. No SQL/migration changes in this follow-up, no native/full/E2E/server run, no commit/push/prod action. Fresh same-worktree proof2176-native-permissions-review-fix.json reports ok=true. All command sessions returned terminal exit codes; parent owns new-delta review and browser/full verification.
