# #7801 missing mobile next-stage fatigue forecast

The condition response already supplied `fatigue_at_start`, and the desktop table forwarded it. The shared expanded rider card accepted only current fatigue, so the phone omitted the approved next-stage estimate.

Forward the existing field on the phone and render the shared `FatigueAtStartLine` beside current condition. Its existing finite/null handling preserves zero and hides absent estimates. Do not calculate a second forecast or duplicate translations in the mobile presentation.

Regression: server-render the real card for forecast, zero, missing/null and non-finite input, and check page-to-card wiring. No wall-clock input is needed for this presentation path. Parent owns mobile/desktop visual evidence, full checks and release gates. Patch notes remain with Claude at activation.
