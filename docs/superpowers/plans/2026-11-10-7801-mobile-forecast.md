# #7801 mobile forecast recovery

- Design-go: https://github.com/NicolaiDolmer/CyclingZone/issues/7801#issuecomment-6691841988; owner follow-up 10 November authorizes the missing mobile wiring.
- SSOT: `docs/TRAINING_RULES.md`, “Flader og assistent under fatigue_now_7801”: current fatigue plus the estimate for the next stage only. Existing API field presence owns eligibility; no calculation or flag change.
- Baseline: `TrainingPage.renderRiderCard` passes current fatigue but drops `fatigue_at_start`; desktop `todayRowsFor` already forwards it. Existing visual evidence: https://github.com/NicolaiDolmer/CyclingZone/issues/7801#issuecomment-6753880003.
- Add a focused rendering regression first: numeric forecast, valid zero, absent/null and invalid forecast, unchanged current fatigue; assert the phone call site forwards the API field.
- Pass an optional prop to the existing mobile card and reuse `FatigueAtStartLine` inside its existing fatigue display. Preserve desktop expansion by forwarding only for `phoneTodayView`.
- Assigned verification: focused Node tests, focused lint and frontend typecheck behind `verify-lock.ps1 -Max 2 -Runtime codex`. Parent owns browser mobile/desktop before/after, broader checks and independent review.
- No player copy, locale, layout recipe, flag, production or calculation changes. Claude owns patch notes at activation; no patch note text is authored here.
