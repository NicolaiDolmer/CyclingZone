# Auto-accept beta with scoped M3: implementation plan

> Execute inline in the separate beta worktree, using test-driven development and one independent whole-diff review. Refs #2176.

**Goal:** implement the five approved beta rules and approved A scope, without merge, production apply or activation.
**Owner's revised night mandate, 11/11:** investigate the scouting/facility FULL failure, push a draft PR, post status on #2176 and stop. At most one heavy verification at a time. Unfinished FULL/E2E/visual/release items below are a handoff, not authorization to keep running after draft/status.
**Spec/build-go:** [five rules](https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6773218237), [A decision card](https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6774810345), [owner's direct build-go recorded 10/11](https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6778060269).
**SSOT:** `docs/TRANSFER_MARKET_RULES.md` sections 5.1/8.1, `docs/ECONOMY_RULES.md`; preserve existing PAGE_TEMPLATES/TASTE components and approved copy.
**Architecture:** fresh server/database cohort checks; per-listing price projection; a shared transaction envelope for M3 beta with financial restrictions applied to the effective cohort/auction/standing obligations under the existing ordered team locks. No flag/config value is changed by the migration.
**Baseline:** origin/main `500999c77`; native PG17.11 baseline passed 800 concurrent attempts, no overbooking/deadlocks; `pg_ctl status` confirmed shutdown. #7981 is not touched; integrate its result only from origin/main after observed owner merge.

## Constraints and scope

- Auto-accept beta requires a beta seller and beta starting buyer. Canonical beta semantics include administrators, matching existing `isViewerBetaTester` and `evaluateFlagStage`.
- Other viewers receive no auto-price; their offers/counteroffers/confirmation at or above that price remain ordinary negotiations. Enforce the pair rule again in SQL.
- Started `origin='auto_accept'` auctions stay public. Any bidder/proxy holder is protected irrespective of cohort; seller's outgoing commitment also persists if beta membership is revoked.
- M3 `on`/true retains its global contract; off/missing retains legacy behavior. M3 `beta` protects beta teams, the current auto-auction operation, and teams with standing obligations in active auto-auctions. Other non-beta interactions retain their existing financial rules.
- First participation can race with another transaction before a JS scope read. In beta mode the shared team transaction envelope must therefore cover writers even when currently outside the effective scope; re-evaluate the financial scope under the lock. This is serialization, not a global financial rollout.
- Existing generic available-balance checks already count auction commitments. Keep their rules; add a beta-only, typed discretionary-finance safeguard under the shared balance lock. Mandatory wages/upkeep and existing unrelated overdraft policies are unchanged.
- Scouting currently creates an assignment before debiting it. Make that beta transaction atomic to prevent a free assignment when the final finance guard refuses. Staff hiring has no upfront debit: do not invent a hiring charge. Facility purchase/severance already debit before changing the asset.
- Direct transfer, cash swap and release-with-fee must not move a rider and then fail payment after the lock is released. Reuse canonical audit/escrow/restoration contracts in the beta transaction paths. Existing raw on/off paths are preserved.
- Never author new player copy, update NOW/MASTERPLAN, raise compiler/guard budgets, expose private balances/identities or touch #7981. New frontend files are TypeScript.

## Review focus

First non-beta public bid versus ordinary bid/proxy/transfer/spend; cohort revocation during an existing auction; seller/starting buyer mismatch; price leakage through HTTP/in-memory cache; rejected finance leaving a free rider/assignment; duplicated audit/payment; on/off compatibility and SQL/client execution privileges.

## Tasks

### 1. Cohort and visibility primitives
Files: new `backend/lib/marketBeta2176.ts` + backend tests; `stageFlagCatalog.js`, `featureFlagsApi.js`, `autoAccept2176.js`, GET/listing/offer sites in `routes/api.js`.
Interfaces: fresh `isTeamBeta2176(client, teamId)` / `isUserBeta2176(client, userId)`; `isAutoAcceptPairEnabled(client,{sellerTeamId,buyerTeamId})`; actor-aware `isAutoAcceptEnabled`; projection omits `auto_accept_price` unless authorized. `teams.user_id` joins `users.id`; role admin or is_beta_tester.
- [x] Write/run failing unit/route tests for four cohort pairs, server-set price, every negotiation boundary, on/off and failed reads. Implement and make them pass.
- [x] Preserve existing boolean feature-flag API; remove auto-accept from the binary-only override and recognize beta in the preview adapter without changing defaults.

### 2. SQL cohort boundary and scoped transaction envelope
File: new idempotent migration `database/2026-11-10-2176-transfer-payment-beta-scope.sql` (sorts after A7); new actual-SQL regression fixture/tests.
Interfaces: service-only team-beta/pair/transport/effective-scope functions; existing M3 RPC signatures preserved. Scope accepts team and auction identity and is evaluated under the existing shared lock. Normal price/tie behavior and legacy wrappers remain compatible.
- [x] RED tests: beta pair versus ordinary negotiations at/above price; public non-beta bid/proxy; unrelated non-beta budget/fee unaffected; flag on/off; admin and revoked membership.
- [x] Replace M3 transaction entry points/triggers and pair-sensitive auto-price/offer/claim checks in the new migration. No update to deployed migration files or app_config values.
- [x] Preserve grants/search_path and PostgREST reload; test repeated application and denied anon/authenticated execution.

### 3. Financial safety for approved A participants
Files: `marketCommitment6181.js`, `releaseFeeGate6181.js`, `autoAccept2176.js`, `transferExecution.js`, `availableBalance.js`, `scoutAssignmentService.js`, `facilityService.js`, `academyIntake.js`, release routes, migration/tests.
Interfaces: separate raw beta transaction transport from effective protection. Existing finance payloads/keys remain canonical. New service-only atomic scouting, cash-swap and release-with-fee RPCs return explicit handled receipts; the A7 paid-transfer receipt is reused after its main integration. A beta-only finance insert guard rechecks discretionary spending under the balance/team lock and returns the existing insufficient-available-balance error.
- [x] RED tests for final guard refusal and rollback after real mutations, first-public-bid races, fees versus holds, refund/graduation restoration, ordinary non-beta parity and unchanged on/off.
- [x] Implement atomic beta operations where ownership/assignment previously preceded payment. Map refusals to existing errors; do not introduce asset mutations after rejected payment or new charges.
- [x] Apply seller/buyer seat and outgoing-floor scope independently; keep public auction extension bounds based on the specific auction/participants, not a global beta switch.

### 4. Client cache and existing UI behavior
Files: affected transfer-listing cache usage, `preview/betaAccessMock.js`, existing `auto-accept2176.spec.ts`; only change page TSX/JSX if server projection alone cannot enforce existing markup conditions.
- [x] RED tests for account/cache changes and all buyer/seller combinations. Keep cache identity per viewer and invalidate affected entries after beta-status changes.
- [x] Verify existing seller price editing, buyer row/button and Help visibility, including off/on. Preserve templates and reuse existing approved strings.

### 5. Native PG17 evidence
File: new beta PG17 harness reusing actual schemas/migrations and independent connections, explicit timestamps, same shared semaphore.
- [x] Prove both deterministic orderings and concurrent starts/bids/proxies versus transfers, cash swaps, release fees and discretionary purchases, including first non-beta participation. Assert final commitment <= balance for protected operations, no free assets, no duplicate finance, no overbooking/deadlocks.
- [x] Exercise real old/unscoped negative controls, public non-beta participation, subsequent ordinary spend refusal, outbid/proxy release, cohort revocation, and unrelated non-beta legacy scenarios.
- [x] Run pg_ctl stop and positively assert status=3; preserve any evidence if stopping fails.

### 6. Verification, visuals and handoff
- [x] Update market/economy SSOT where contracts change, flag registry metadata without a state/flag flip, generate FEATURE_STATUS and add technical learning. Help/patch note player copy remains Claude-owned (#7978).
- [ ] Required FULL, full frontend E2E (all projects), unit/lint/type budgets and foreground preflight under verify semaphore. Isolate the known EMAIL_UNSUB_SECRET test-environment issue without changing email code; never report partial passes as a full green run.
- [ ] Synthetic browser screenshots of cohort on/off states on desktop/mobile; no HTTP fetching of dev/preview modules and no production writes. Check TASTE with the existing components.
- [ ] Independent whole-diff reviewer, fix/retest findings, guarded commit + immediate push, separate reviewable PR `Refs #2176`, follow real CI and review, private log archive and <=15-line issue handoff. No merge/apply/activation; Claude owns NOW/MASTERPLAN and Fable/release.
