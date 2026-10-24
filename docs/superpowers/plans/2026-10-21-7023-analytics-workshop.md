# Analyseværksted v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after explicit owner build approval. Review follows AGENTS.md; no parallel build is required.

**Goal:** Give the owner one responsive table of current-season net ability changes for their own current roster, with a sum and individual abilities, using TanStack Table.

**Architecture:** One owner-gated batch endpoint, one pure typed projection contract, and a lazy-loaded React page. TanStack controls table state; the existing DataTable primitive renders it, including mobile D-047. No schema migration or historical backfill in v1.

**Tech Stack:** Existing React/Vite/TypeScript, Node backend, Supabase read-only access, `@tanstack/react-table` pinned to a verified stable version at implementation time.

**Spec:** `docs/superpowers/specs/2026-10-21-7023-analytics-workshop-design.md`.

## Global constraints and start gate

- **Not approved to build.** Owner requested investigation, plan and online handoff only. Record explicit Design-go on #7023 and implementation PR before code.
- Resolve the spec's single completeness decision with a visual A/B card; fix the allowed ability set against the runtime registry and the current product SSOT, including the stale aggression contradiction. Do not invent missing history or use zero for null.
- Own isolated worktree; dependency installation only with `scripts/new-worktree.ps1 -OwnNodeModules`. Never install through shared node_modules junctions.
- New frontend files are `.ts`/`.tsx`. No player-copy authored by Codex. Owner/Claude supplies reviewed EN/DA labels, help and patch notes.
- Never publish raw player evidence, owner ids, secrets or private balance material. No production writes, activation, merge or release without the applicable mandate.
- Read PROGRESSION_RULES, CALENDAR_RULES, PAGE_TEMPLATES T2, TASTE, API ownership and this spec first. Do not edit NOW/MASTERPLAN.
- All observation times are explicit inputs to pure code/tests. No wall-clock-based test fixtures.
- No arbitrary performance target is already approved. Measure and present actual results against an owner-approved goal before claiming speed success.

## Task 1: Data contract, startpoint selection and measured read path

**Create:** `backend/lib/analyticsRosterDevelopment.js`, `backend/lib/analyticsRosterDevelopment.test.js`, `frontend/src/types/analytics.ts`.

**Read/reuse:** `backend/lib/riderDevelopmentReceipt.js`, `backend/lib/proRiderHistory.js`, `backend/lib/abilityRegistry.js`, `backend/lib/supabasePagination.js`, `backend/lib/squads.js`. Do not modify existing history writers.

**Interfaces:** `buildRosterDevelopment({ season, roster, baselines, currentAbilities, abilityKeys, observedAt })` returns the following JSON-compatible shape; route owns the IO.

```ts
type DevelopmentRow = {
  riderId: string; firstname: string; lastname: string;
  squad: 'senior' | 'u23' | 'junior';
  baselineDate: string | null;
  status: 'complete' | 'partial' | 'missing_baseline' | 'missing_current';
  deltas: Record<string, number | null>;
  totalDelta: number | null;
  knownAbilityCount: number; expectedAbilityCount: number;
};
type RosterDevelopment = {
  season: { id: string; number: number; startDate: string };
  observedAt: string;
  abilityKeys: string[];
  rows: DevelopmentRow[];
};
```

`totalDelta` is null unless all agreed ability keys have finite numeric endpoints. If owner approves a partial sum, add a separately named `partialDelta` and a fixed comparable-key cohort contract before implementation; never silently change totalDelta semantics.

- [ ] Write failing fixture tests: explicit season 4 with transition on previous calendar date; oldest exact transition beats a later first-gain snapshot; numeric 10 to 12 is +2; null/missing/empty string/NaN are null; 12 to 10 remains -2; a newly introduced ability has no invented start; complete zeros sum to 0; incomplete vector has null total.
- [ ] Implement only allowlisted public ability fields and current-roster membership. Exclude hidden_potential/caps/progress and arbitrary JSON keys. Test malicious extra keys are omitted and returned abilityKeys contains only allowed columns.
- [ ] Assert source-order independence, deterministic rider-id/name ordering, current season selection, explicit observedAt, and no Date reads in the projection tests.
- [ ] Run `node --test backend/lib/analyticsRosterDevelopment.test.js` and existing receipt/pro-history tests. Do not reuse positive-only `seasonAbilityGains` as the full-net projection.
- [ ] Before first implementation PR, create isolated local PG17 fixtures with current-roster/startpoint/current-ability tables and >1,000 history rows. Measure deterministic paginated queries and EXPLAIN (ANALYZE, BUFFERS); private report records row counts, query count, plans and repeated elapsed times. Stop for owner decision if the desired latency is unclear; no new index is presumed.

## Task 2: Owner-only batch endpoint

**Create:** `backend/routes/analyticsRoutes.js`, `backend/routes/analyticsRoutes.test.js`.
**Modify:** `backend/routes/api.js` at the router factory mounting points, using the existing `requireOwner`, read limiter and authenticated `req.team`.

**Consumes:** pure function above; **produces:** `GET /api/analytics/roster-development` with the RosterDevelopment payload, no rider-id list supplied by the browser.

- [ ] Write real router tests for anonymous 401, ordinary/beta/admin-incorrect-owner 403, allowed owner 200, unavailable allowlist fail-closed, and a supplied foreign teamId never broadening scope. `requireOwner` must run before any service-role data query.
- [ ] Load active season, own non-retired roster, current allowed ability columns and exact current-season transition startpoints in bounded batches. Use fetchAllRows with a stable unique order; handle `.in()` chunks and >1,000 history results. Never send N per-rider HTTP requests or `select('*')` ability objects.
- [ ] Test upstream failure produces a visible retriable error, not fabricated empty rows; a missing active season is an explicit non-success state, not season inferred from date. Do not leak raw DB errors or identities.
- [ ] Confirm access using an owner-session fixture; OWNER_USER_IDS runtime was not verified in this investigation. No allowance for every admin or Pro user.
- [ ] Run new route tests plus existing ownerGate and receipt tests. Confirm number of client requests is one page-level batch request and no query scales as one per rider.

## Task 3: TanStack adapter and responsive page

**Create:** `frontend/src/pages/AnalyticsPage.tsx`, `frontend/src/components/analytics/RosterDevelopmentTable.tsx`, `frontend/src/lib/analyticsTable.ts`, `frontend/src/lib/analyticsTable.test.ts`, `frontend/src/hooks/useRosterDevelopment.ts`.
**Modify:** `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`, `frontend/package.json`, `frontend/package-lock.json`.
**Reuse without changing global behavior:** `frontend/src/components/ui/DataTable.jsx`, `frontend/src/lib/abilities.js`, `frontend/src/lib/apiFetch.ts`, existing owner-check and loading/error primitives.

- [ ] In an own-node-modules worktree, verify the current stable React-compatible TanStack version and pin the exact version in package/lock. Install only `@tanstack/react-table`; no Router/Query/Virtual adoption in this task.
- [ ] Use `useReactTable`, `getCoreRowModel`, and `getSortedRowModel`; adapt visible rows/column metadata to DataTable `columns`, `rows`, `rowKey`, `sort`, `sortDir`, `onSort`. Keep DataTable as the sole mobile column-state owner to avoid two diverging states.
- [ ] Define pure tested sort/accessor helpers: null last ascending and descending, signed numeric values, sum independent of visible columns, stable equal-value ties. Test current version's TanStack undefined/null ordering rather than relying on a default comparator.
- [ ] Lazy-load the page and register its existing T2 wide-container handling. Owner-check only reveals the nav item to the owner; API refusal remains authoritative when visiting a direct URL. No second standalone dashboard or catalogue.
- [ ] Render owner/Claude supplied EN/DA labels, period, provenance/coverage, status, and rider links. Missing baseline appears distinctly from measured zero. Preserve the agreed incomplete-sum behavior from the start gate.
- [ ] Use DataTable dense layout and mobileDefaults with sum and two existing ability columns. Reuse all D-047 interactions; no new page-specific table renderer or global refactor. Long names wrap at 320/375/390; Fuld tabel keeps the name block separate from the scrollable data block.
- [ ] Run TypeScript, targeted projection/sort tests, existing DataTable mobile tests and ESLint. Check no other table has changed behavior and TanStack stays in the lazy analytics chunk.

## Task 4: Private owner preview, review and staged rollout handoff

**Create:** `frontend/tests/e2e/analytics-workshop.spec.ts`.
**Modify:** `docs/FEATURE_REGISTRY.yml`, relevant product SSOT, owner/Claude supplied patch notes/help according to the final approved scope.

- [ ] E2E covers owner route success, non-owner direct route/API refusal, initial sum sort, skill sort, mobile column swapping, full table, unknown baseline, partial newer ability, zero and negative fixtures, loading/error retry, season rollover and numeric locale formatting.
- [ ] Supply explicit dates and season data to all fixtures; no wall-clock defaults or time mocking of production credentials.
- [ ] Parent runs required FULL tier and all three Playwright projects under `scripts/verify-lock.ps1 -Max 2 -- <command>`. Worker does not take the full E2E slot. Run frontend lint separately; run preflight before push.
- [ ] Capture actual desktop 1440 and mobile 390 plus 375/320 layout checks in private pr-shots/OneDrive. Source fixtures/mockups are not release evidence. Owner compares selected cells and totals with private source data on staging; record expected/observed and agreed performance goal.
- [ ] Independent reviewer covers exact diff, access isolation and full data path; repair findings and report remaining gates. Guard every commit and auto-push after successful preflight. No code handoff merely at draft-ready status.
- [ ] V1 is only owner. There is no beta/on seed or migration in this task. Later beta/alle uses the existing off|beta|on mechanism after separate owner approval; Pro remains undecided.
- [ ] Release/merge remains owner-gated; Claude owns NOW/masterplan and player text. Follow required post-merge checks and deploy observation if and only if a release is authorized.

## Completion criteria for the implementation

Owner can open the view and immediately compare current-season ability deltas. Every shown number is traceable to two documented endpoints and the agreed ability set. Unknown is not zero, partial sums are not full sums, hidden columns do not change totals, other users cannot obtain data, and mobile works with existing controls. Evidence includes private source reconciliation, measured latency against the approved goal, independent review and the required test results.

## Pc1 continuation

Read [the compact handoff](../../sessions/2026-10-21-7023-analytics-pc1.md), then spec and audit. This documentation phase does not install TanStack, change runtime or grant build approval.
