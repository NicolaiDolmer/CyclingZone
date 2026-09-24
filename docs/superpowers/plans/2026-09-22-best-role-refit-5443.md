# Best-role refit 5443: implementation plan

**Goal:** Produce a read-only, reproducible decision basis for task 1b.
**Spec:** Owner request 22 September and docs/ECONOMY_RULES.md section 1.1.
**Architecture:** Extract requested development tools from #5444. Keep production modules/model selection unchanged. Evaluate best-role candidates through a development-only adapter to the existing NPV function. Derive roles using the exact 1a function and fit offsets from fresh season simulation.

- [ ] Split development, fit and scorecard files; remove embedded player names and obsolete unsupported model paths.
- [ ] Test that the candidate uses the rounded best-role tie rule and display recipes; fit offsets by best role rather than natural type.
- [ ] Simulate the active season, record sample coverage, fit candidate offsets with the existing v5 curve fixed.
- [ ] Measure stored-to-candidate values, role-transition jumps, all one-point training perturbations and losses over half. Report cash separately from rider values.
- [ ] Calibration target requires owner clarification. Do not treat a historical sum or the current sum as approved.
- [ ] Verify unit tests, scorecard and required preflight. Private raw outputs only under balance-internals; no names, coefficients or thresholds in public handoff.
- [ ] Push a reviewable PR with status on #5443/#5435. No merge, apply, flag flip or subsequent task.

Review focus: missing abilities; rounded-rating ties; role-switch discontinuities; unsampled roles; production-model parity. No patch note until activation because this task changes development tooling only.

Owner update during the session: market influence must be included from first activation and increase over time. Ability-led valuation rather than a direct type price is being discussed. No new production design approved. Preflight passed; full verification stopped on the unchanged training-route guard tracked by #5488 (backend: 10,482 passed, 1 failed, 3 skipped, after the separate economy suite passed). Token hygiene has only the acknowledged FEATURE_STATUS failure.
