# Tactics ready, part 1

Refs #7864. Design-go: [owner afternoon mandate](https://github.com/NicolaiDolmer/CyclingZone/issues/7911#issuecomment-6768042148), [v5 decision](https://github.com/NicolaiDolmer/CyclingZone/issues/7864#issuecomment-6739187349), [literal EN/DA copy](https://github.com/NicolaiDolmer/CyclingZone/issues/7864#issuecomment-6769122867). The [v5 artifact](https://claude.ai/artifact/GNbiMwmSD3QFwrtUVp1Jry) was inspected in the browser, including each team plan and the order menus. Design/plan was posted on the issue before product edits.

Expanded mandate: [11/11-12/11 plan](https://github.com/NicolaiDolmer/CyclingZone/issues/7911#issuecomment-6770932258), [updated design/test plan](https://github.com/NicolaiDolmer/CyclingZone/issues/7864#issuecomment-6773163595). This work is based on PR #7979 so its special-role capability is retained.

SSOT: RACE_ENGINE_RULES stage-plan/role contracts; backend/lib/stagePlan.ts and its frontend parity model; PAGE_TEMPLATES and TASTE. The existing race-page container, profile, stage selection and manual plan editor remain.

## Slice and contracts

- Add five team-plan choices above the current plan board. Only the active, editable road stage changes. Apply creates a draft; the existing save/conflict/partial-save flow remains authoritative. Completed/locked stages, abandoned riders and time trials are excluded.
- GC uses the current captain/shared captain and existing route-aware support suggestions. Stage win chooses the best known route match (stable rider-id tiebreak), uses the existing captain assignment on this stage only, and supplies valid finale/support tasks. Sprint uses the selected sprint captain and legal finale leadouts. Break chooses two non-leader eligible riders, with route match as the ordering; the rest save. Save supplies sheltered/riding-in tasks. Missing required roles or route-match data disables a choice rather than inventing a recommendation.
- Generated tasks are validated against the existing role/route model before anything changes. Stage win reuses the existing suggestion's decisive named trigger, falling back to the existing finale trigger. GC/Stage win remove a competing sprint-captain assignment so the actual engine protects the named leader; switching presets retains the original role basis until a manual role edit. No new role or legal order is introduced.
- The tactics profile reuses StageProfileCard in full under the same OFF gate, as agreed in the 7/11 design and v5. Named climb buttons show the existing waypoint detail and support keyboard/touch input. Long names wrap on mobile. The team/other profile consumers retain their current rendering.
- Qualitative cost appears on plan tasks and every option in their editor. Use v5 categories and existing approved price words; never expose formulas or internal values. It describes the order, not a promised final fatigue result.
- New player-visible stage flag `tactics_ready_7864`: missing/off/read failure remains off. UI also requires the existing stage-plan gate. No database seed/application or activation in this slice; the admin catalog exposes the new key for a later owner-approved rollout.
- Hard/Normal/Easy and its per-rider editing layer are not built. Offline counterfactuals measure actual plan efforts and load against unchanged plans before any later design/activation decision. No new engine mechanics or season standards.
- Reuse literal owner/Claude copy. Additional missing player copy is listed as an EN proposal under `Claude-tekst mangler` in the PR; Claude owns DA and release text.

## Implementation

1. Add failing pure tests for presets, role legality, stable selection, missing evidence and current-stage-only role changes. Implement a frontend TS model using existing plan validation and order setters.
2. Add the new OFF flag to the existing public stage-flag catalog and test off/beta/on/read failure. Wire the existing flag fetch in the board.
3. Add typed preset UI, approved translations and qualitative prices; preserve the existing save action and manual editor. Update registry, generated status and SSOT in the same PR.
4. Measure offline Hard/Normal/Easy candidates with deterministic engine fixtures, fixed seeds and explicit dates. Keep numerical results in balance-internals, report limitations rather than an unapproved balance pass.
5. Run focused tests, lint, FULL/build, full E2E (all projects) through verify-lock Max 2, independent review and preflight. Capture real rendered before/after at desktop and 375 px with clearly marked fixture data. Owner sees pictures before merge; staging tester round and Claude patch notes/help precede release.

## Remaining expanded scope

- Same-type stages in this race (#7880): owner chose on 10/11 to preserve manually saved plans as exceptions, renewed in the 11/11 day mandate and visual choice A. Implemented as route-specific drafts and atomic fill; no copied KOM indices. Confirmed and local manual exceptions, including new empty resets, are preserved. Current verification and review receipts are recorded in PR #7980.
- Earlier attacks (#7884) are a separate track after #7980. [Owner choice A, 11/11](https://github.com/NicolaiDolmer/CyclingZone/issues/7884#issuecomment-6796069497): a real long attack for all roles, selected by climb name. That track requires its own technical design and measured baseline before implementation; no attack-engine change belongs in this PR.
- Hard/Normal/Easy: private counterfactual measurement only, no controls.

No merge, flag activation or production writes. #7737, #2176, #6181 and #7971 are outside this slice. Missing player copy goes in the PR body for Claude; the five preset names/descriptions and price words reuse the approved EN/DA strings. Other locales currently fall back to that approved English, not claimed translations.

## Multi-stage technical design, 11/11

Owner visual checkpoint 1/3, 11/11: chose A, concrete destination stage numbers next to the existing profile label. Manually saved exceptions remain protected.

Owner mandate: the 11/11 day plan and the existing #7880 choice preserve manually saved plans. SSOT: `RACE_ENGINE_RULES.md`, stage-plan/role contracts; `stagePlan.ts`; `DATA_API_GRANTS.md`. This extends the approved draft-then-confirm interaction, without adding attack mechanics or changing engine defaults.

Current owning sources: `raceStageRolesApi.saveStageRoleOverrides` deletes and inserts in separate Data API transactions; `raceTeamOrdersApi.saveTeamOrder` unconditionally upserts. `stageRolesWriteScope.stageVersions` compares role content before those writes, and an empty reset has the same `empty` version as an untouched stage. A client-side filter alone cannot preserve a concurrent manual save. Native PG17 characterization precedes implementation; private evidence is recorded in the shared handoff rather than public operational logs.

1. Add a backend-only stage-save marker keyed by team/race/stage. A marker records a confirmed save, including a reset to zero overrides, without creating an engine order overlay. RLS and explicit service-role-only grants follow the new-table template. Check both legacy role/order rows as well as markers when deciding whether a destination is already saved. Historical zero-row saves have no recoverable provenance; do not pretend they can be reconstructed.
2. Use one stable transaction lock per team/race/stage, acquired in sorted stage order. Both existing manual writers and the new batch transaction participate. Manual roles compare their captured canonical override snapshot again inside the lock, then replace roles and mark the save atomically. Manual orders retain their existing replacement semantics under that lock. Production explicitly requests the database clock after lock waits; tests supply an exact `now`.
3. Batch confirmation fills only destinations still unplanned at commit time. Existing saved stages win, including a save made after the client read; returned receipts distinguish applied, preserved and newly locked stages. Role and order writes for applied stages share one transaction. Invalid payloads or storage errors roll back the batch. Check race completion, stage schedule, current membership and abandoned riders at the write boundary. No polling or global lock.
4. Validate each destination against its own route and effective roles before writing. Generate a fresh selected team preset per destination; never copy a named-climb index from the source route. Same-type means the exact existing profile type within this race. Exclude time trials, completed/locked stages, missing route evidence and abandoned riders. Preserve local manual drafts as well as server-saved exceptions.
5. The UI requires the existing OFF gate, stage-plan support and installed atomic-save capability. Use existing approved stage/copy/save strings with the concrete destination numbers and profile label. Applying changes drafts only. Confirmation sends the selected destinations; successful receipts advance only their baselines. Failed or concurrently preserved drafts remain visible and unsaved, using the existing conflict/partial-save presentation. Do not claim a saved destination when the receipt says it was preserved.
6. Deployment compatibility fails closed for bulk when capability is absent. Manual legacy fallback is allowed only with the new capability explicitly disabled and the precise missing-function response, never on permission, network, validation or unknown receipt failures. No migration apply, flag seed or activation here.

Verification: RED unit coverage for fresh route-specific generation, exact-type filtering, stored/empty/local exceptions, receipts/retry and partial/conflict preservation; local native PG17 for rollback, both concurrent manual/bulk orderings, empty reset markers, sorted locks and actual service/client ACLs. Then FULL, complete E2E in all three projects and independent Codex diff review. The session began with `verify-lock.ps1 -Max 2`; the later owner capacity decision, verified in S1, requires `-Max 1` and explicit handoffs between heavy stages. Capture synthetic desktop/mobile before/after, including multiple eligible stages and saved exceptions. Claude owns pending release/help copy; staging tester round and owner visual review precede any later release.

## Final continuation, 11/11 (Dolmer PC)

- Resumed pushed checkpoint `16d3266c3` in the same worktree. Three legacy source-contract failures reproduced; corrected checks retain primary-save, fog-of-war and scoped-write invariants. All 21 contract tests pass.
- Integrated current main to resolve PR conflicts: generated status rebuilt from registry, tactics SSOT retained, bundle budgets combine the existing recorded increments. Lockfile caches relinked through setup-worktree. No main checkout edits.
- Independent continuation and conflict-resolution reviews found no actionable P0/P1; 56 focused tests and all 21 source contracts passed. Native PG17, FULL/build and lint passed. The first complete local E2E run and its focused baseline recheck are recorded separately in PR #7980; final HEAD CI/review receipts belong there.
- Fresh synthetic desktop/mobile viewport comparisons and numbered callouts are in `pr-screens/7864`; the visual re-review found no new mismatch. A stale academy Scouting test selector now targets its dedicated existing forecast component; no academy behavior changes.
- The current Review-gate contract (#6654) makes CodeRabbit optional. Codex review must match final HEAD; Claude owns the subsequent high-risk review.
- Patch notes/help remain Claude-owned before release. All feature gates remain unseeded/off; no merge, production apply or activation.

## Claude follow-up, 11/11

Owner prioritizes the blocking marker 6803820273 before the separate #7884 design.
- OFF selects legacy manual writes before marker access, including after migration; beta/on retains shared atomic writes.
- All three write handlers capture server failures with a neutral error code; expected client conflicts remain unchanged.
- GET team-orders degrades only optional new metadata and retains existing orders/defaults.
- Migration DDL has transaction-local lock_timeout; native PG17 checks eight riders, UUID snapshots and an actual held DDL lock.
- The three P1 regressions were observed RED; focused/native checks pass. Current FULL/preflight and final HEAD CI/review receipts are recorded in PR #7980.
- Other P2s are deferred to #8013. Claude's blocking marker is retained; no merge, apply or activation. #7884 remains design-only after this handoff.
