# Verification contracts need the owning source

Refs #7864, PR #7980. These were verification findings before release.

The complete local E2E run found eight failures outside the 33 passing tactics
cases. Scouting already rendered its dedicated academy forecast correctly; the
test queried the old compact-cell identifier. It now queries the report's own
forecast, preserving range, count, progression and hidden-data assertions.
All eight failures passed a focused rerun without retries, with two workers and
the repository's existing CI time budgets. This is recorded separately from the
original full-suite result; a focused pass is not a clean full-suite receipt.

An older AI_OPS_REFERENCE paragraph incorrectly made CodeRabbit CLI mandatory.
The current rule 35 and GITHUB_WORKFLOW review-gate make it optional and require
Codex on current HEAD, plus Claude for high risk. The stale paragraph was aligned
with that contract; the unnecessary login question was withdrawn. No account
settings, production data, migrations or feature flags were changed.
