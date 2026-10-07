# Daily receipt contract after legacy renderer removal

Sentry CYCLINGZONE-96, event e5b77447b6b74c5aa224bb46f8a4bf62,
release 11da65db1cebb2c5cbd5a4417fc91dbd0c39b274, identified
DailyTrainingReceipt.tsx:85 (run.game_days.length). Breadcrumbs show successful
training/me and training_day_runs reads before the error. Response bodies and
component props were not captured; the exact incident flag value is unknown.
The flag was on in a fresh read-only lookup, not proof of its earlier response.

#6030 removed the legacy renderer but the hooks could still return raw ticks
when the old API flag was false/missing. The manual run path also published a
raw POST report before its refresh. Raw rows do not have receipt metadata.
False/missing-flag fixtures reproduced the error screen; rendering the actual
component with absent game_days reproduced the exact TypeError.

Fix: stable read-only API arrays, unconditional date projection for the remaining
renderer, no raw optimistic POST state, and a defensive game_days array check.
Missing evidence stays unknown. No training computation, data repair or flag flip.
Regression coverage uses a fixed date and real component rendering plus browser
navigation; normal complete/pending/reconciliation receipts remain covered.

Lesson: retiring a renderer also requires retiring its producer shape-switches.
An API flag being on today is not a type guarantee at an asynchronous boundary.
No player text was added. Patch-note wording belongs to Claude under the owner's
explicit no-player-text instruction for this session.
