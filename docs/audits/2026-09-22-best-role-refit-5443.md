# Task 1b measurement handoff, 22 September

Source of truth: [ECONOMY_RULES.md](../ECONOMY_RULES.md), section 1.1; owner decisions on #5443 and #5435. This is a development measurement, not a completed model release.

The requested #5444 development tools are extracted onto a fresh main-based branch. Live model files and runtime dispatch are untouched. Hardcoded player examples were removed. The new best-role report fits offsets using the existing displayed-rating tie rule and evaluates them through the existing NPV implementation.

Reproduce from backend, with read-only production credentials injected by Infisical:

1. Run `pwsh -File ../scripts/verify-lock.ps1 -Max 2 -- infisical run --env=prod --silent -- node --max-old-space-size=7168 scripts/simulateSeasonProduction.js --k=30 --seed=5443 --v3 --free-agents --out=../balance-internals/2026-09-22-best-role-refit/simulation.json`.
2. Run `pwsh -File ../scripts/verify-lock.ps1 -Max 2 -- infisical run --env=prod --silent -- node scripts/dev/bestRoleRefitReport5443.mjs`.
3. Read `summary.json`, `top20_role_switches.json`, `top20_training_gains.json`, `losses_over_half.json` and `teams.json` in that private output directory. No output names or precise economic calibration values belong in public issues or PRs.

The simulation uses the active S3 calendar and existing v3 engine. Riders without a race assignment are not fitted; the report also values academy riders outside that simulation sample. One role has sparse fit support. These are limitations, not a claim of full-population fit quality.

Findings: the uncalibrated best-role variant materially increases aggregate rider valuations and has large discontinuities when an ability point changes the selected role. Cash is unchanged. The measured legacy scale and elite regression checks fail. A full release scorecard and owner-approved calibration remain outstanding. Neither current aggregate value nor a historical total is an approved target.

Owner discussion: explained that candidate means a trial calculation, and that rider value is separate from cash. The proposed investigation of a continuous relationship between displayed rating and value awaits the owner's answer. Do not infer approval from the clarification questions. Do not merge or continue to 1c/1d.

Patch notes and feature registry: unchanged because no player behavior or flag changes. #5444 stays open until its replacement is merged. No issue is completed by this handoff.

Owner update during the session: market influence must be included from first activation and increase over time. Ability-led valuation rather than a direct type price is being discussed. No new production design approved. Preflight passed; full verification stopped on the unchanged training-route guard tracked by #5488 (backend: 10,482 passed, 1 failed, 3 skipped, after the separate economy suite passed). Token hygiene has only the acknowledged FEATURE_STATUS failure.

Owner clarification: direct price determination by rider type is rejected. Equal abilities, age and other inputs must have the same foundation irrespective of the type label. The old refit is diagnostic only. Proposed replacement: docs/superpowers/specs/2026-09-22-ability-market-valuation-proposal.md (not approved for build).

Fresh read-only market diagnostic also completed using marketV3AndEvent5443.mjs; private output is market-evidence/marked-v3.json below the same output directory. This legacy experiment still uses type terms and current rider features for historical sales, so its predictive errors are not approval evidence for the new model. It demonstrates that nominal and effective market influence differ and contains abuse probes. Rebuild and validate the market model before choosing activation weights. NOW changes in this WIP branch must be split into a docs(now) sidecar before opening the code PR (#5093).
