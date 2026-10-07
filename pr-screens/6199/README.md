# #6199: measured design probes after #6327

SSOT: `docs/RACE_ENGINE_RULES.md`, especially the approved time-model targets,
finish-pool semantics, physical regrouping and future-race revision binding.
This evidence changes no rule, engine parameter, default, flag or player text.

`before-after.png` is one annotated decision image. `measurements.json` contains
its rounded/displayed values at full measured precision, plus ranks 10/30/50.
Before is the inactive `official_times_v1` candidate on commit
`2e0bf27fc590b35aa4ffc29ddb4dbe5f46ab5eee`, including #6284/#6327.
After P1/P2 are input-only diagnostic variants of that same candidate, not a
proposed complete model or authorized production configuration.

Five same actual stage profiles and present-day fields, saved orders/prior GC,
five paired seeds each. 100 runs include v2 control; the picture summarizes the
75 candidate/P1/P2 runs. Historical salted seed and complete historical state
are unavailable, so these are not exact replays. No production writes.

Last-rider gaps, ranks and group counts are outputs, not published calibration
coefficients. The largest group among the last half of finishers measures
cohesion; no approved numerical group-count target exists. The mountain rank-10
owner target is retained, but this all-runs summary is not its official gate:
the SSOT's breakaway-win partition and broader corpus still have to be checked.
P1/P2 do not establish readiness or authorize activation.

Owner choice B on #6284 remains: activate raw times and descent correction only
together with an approved #6199 model, for new races only, after separate go.
No patch notes are required for a private diagnostic/public evidence artifact.
