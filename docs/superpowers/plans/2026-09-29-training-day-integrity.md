# Training day integrity and balance verification
Owner build-go: 2026-09-29, current chat, package 1. Owner additionally requires fatigue, form and development volume to be verified in this delivery.
SSOT: docs/TRAINING_RULES.md; docs/PROGRESSION_RULES.md; docs/YOUTH_RULES.md; docs/CALENDAR_RULES.md; docs/RACE_ENGINE_RULES.md.
Scope: correct existing race-day activity and recovery accounting; measure balance without silently changing constants. Refs #5888 #5881 #5884 #5907 #5912.
Approved design directions (not all implemented in this bugfix): appropriate racing/training mix competitive with training alone; form is trained readiness, not freshness; assistant changes require acceptance for listed sessions only; DNS resumes program; DNF frees later game days, with actual effort determining yield. New DNF proportional yield, form model, matching and assistant UX need later numerical/design validation.
## Implementation
- [x] Red tests: real one-day gc-only result recognized by game-day lookup and stage-on-date lookup; senior and youth, no stage-race GC double-count.
- [x] Minimal result-type-aware fix; test current junior stage lookup.
- [x] Red tests: saved entries excluded from actual stage-one field must not retain a training-blocking tour binding. Use actual immutable run snapshot, preserve real entrants and unresolved races; queries must fail closed on unknown data. Cover manual/sweep parity, injury, final stage, duplicate calls.
- [x] Red tests: when race-day training owns recovery, old gap-rest writer must not award extra recovery. Preserve legacy flag-off behavior and distinguish real rest dates from free training slots.
- [x] Implement deterministic measurement harness using production training functions and fixed dates: daily/season development with legacy versus five ticks, pure training/rest/mixed schedules, relevant age/recovery cohorts; no prod writes. Separate approved targets from regression floors; never label balance green without a target.
- [x] Update SSOT only for corrected contracts, add bug postmortem and qualitative audit evidence. No private constants or private distribution data in public docs.
- [ ] Targeted regression tests, required FULL checks under verify-lock. Orchestrator owns full e2e.
- [ ] Independent read-only review; draft PR, no merge or production writes. Patch notes provided before release.
## Review focus
Single-race gc versus final-stage gc; participants versus finishers; pending/stalled stages; retries and flag-off paths; partial roster movement and retired teams.


## Execution evidence
- Core red/green runs completed. Independent review caught a normal-DNF regression in an added validation; it was removed, then 109 affected tests passed. Final independent scoped review approved with eight additional focused tests passing.
- Full backend passed (three skipped), frontend 4,152/4,152 passed, production frontend build passed, preflight passed. Full browser suite is running.
- CodeRabbit: one major finding (the same DNF regression, fixed), one minor help-consolidation request (tracked in #5885).
- Ruling: this draft is the safe first part of package 1. DNS training continuation is fixed; persistent selection bindings and later-day DNF release remain follow-up work requiring the shared JS/SQL contract. No production change or balance target is claimed complete.
