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

- Same-type stages in this race (#7880): owner decision pending on preserving versus replacing already saved exceptions. Destination plans must use each stage's route and roles; no blind copying of KOM indices. Save/conflict behavior must retain failed drafts and report partial success accurately. Not implemented yet.
- Earlier attacks (#7884): read-only trace and paired unchanged-engine runs establish selectable triggers and task transitions, but not an independent earlier attack. Special climb and late-attack mechanics have their own phase gates. Exact intended behavior and its acceptance criteria must be settled before changing engine mechanics. Measurements remain private and are not balance approval.
- Hard/Normal/Easy: private counterfactual measurement only, no controls.

No merge, flag activation or production writes. #7737, #2176, #6181 and #7971 are outside this slice. Missing player copy goes in the PR body for Claude; the five preset names/descriptions and price words reuse the approved EN/DA strings. Other locales currently fall back to that approved English, not claimed translations.
