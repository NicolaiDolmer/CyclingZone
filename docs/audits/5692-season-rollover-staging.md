# Season rollover reader evidence, 7 October 2026

Refs #5692. SSOT: [GAME_INVARIANTS.md](../GAME_INVARIANTS.md#durable-ranking-events-5692-ejer-210--prioritet-610).
The rollover fix already shipped in #6277. This PR adds the missing isolated
staging evidence, without changing the function, engine, player copy or production.

Staging `pywxpnynzmbukdvoiazp`: PostgreSQL 17.6; 1,889,644 race results;
isolation wrapper returned ISOLATED. Branch metadata still says MIGRATIONS_FAILED;
the project is ACTIVE_HEALTHY. Neither label is substituted for the measured gate.

The harness substitutes only the old plain-refresh publication statement inside
a transaction, calls the real season-rollover function and captures fingerprints.
It holds that transaction open while a separate connection reads global_rank_mv
with a 500 ms lock timeout. It then rolls back, verifies the original fingerprints,
and repeats with the installed concurrent function. Holding the transaction open
makes retained reader-blocking locks observable even for a short refresh.
This is a lock-compatibility probe, not an estimate of natural timeout frequency.

| Observation | Old plain refresh | Installed concurrent refresh |
|---|---:|---:|
| Rollover plus connection/probe overhead | 770.78 ms | 1,027.13 ms |
| Reader SQLSTATE | 55P03 | success |
| Ranking rows | 268 | 268 |
| Points, ranking and season-start fingerprints | identical | identical |
| Original data restored by rollback | yes | yes |

One sample per version; no claim of a latency improvement. Raw rows and amounts
are never written to the report. [Machine evidence](5692-season-rollover-staging.json).
The harness fails if the old version does not block, the new reader fails,
fingerprints differ, or rollback changes the original fingerprints.

Run from this worktree using one shared verify-lock slot:
`pwsh -File scripts/staging/with-loadtest-staging.ps1 -Cwd . -Command @('node','backend/scripts/staging/measureRankingRollover5692.mjs','docs/audits/5692-season-rollover-staging.json')`.
Use explicit `-Command`: a bare `--` is ambiguous in this wrapper's parameter binding.

No migration, commit to staging, prod write, merge or deployment is performed.
The broader #5692 history-scan/RSS limits and #5904 full race-day evidence remain
separate. Patch notes and feature registry are unnecessary for this test-only change.
