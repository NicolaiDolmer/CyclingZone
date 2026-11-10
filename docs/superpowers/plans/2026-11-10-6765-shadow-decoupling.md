# Independent ranking shadow pass

Refs #6765. Scope: first PR agreed in issue comment 6655002664; owner night mandate on #7911, comment 6748409421. SSOT: `docs/GAME_INVARIANTS.md`, Durable ranking events. No readers, planner settings, existing refresh RPCs, acknowledgement protocol or production configuration change.

## Design and failure modes before implementation

- A fresh, separately seeded OFF control selects independence. Missing row, invalid value, thrown query or query error selects the existing path; query failures are captured. No successful ON cache survives a failed lookup.
- Owner correction 10 November: finish legacy publication and its acknowledgement first, then attempt shadow maintenance even after legacy failure/timeout. Never reuse the released token/version. The existing unleased budget leaves remaining shadow work queued; no reader switch is included.
- Without a claim (cooldown, clean, deferred, admission failure), attempt the existing bounded shadow pass without a coordinator token/version. SQL remains authoritative for writer contention and shadow enablement. Do not invent or acknowledge a legacy version.
- The wrapper attempts shadow once after legacy settles; overlapping callers reuse a maintenance attempt observed since admission. Existing local legacy queue and SQL cross-process serialization remain. Clean ticks may check parity; dirty/failure paths defer it.
- Return values continue to describe legacy publication. Shadow failure is captured/logged separately and cannot mark a failed legacy refresh complete; shadow success cannot advance legacy heartbeat. Legacy success does not conceal shadow failure in its diagnostics.
- Independent dirty work postpones legacy parity until a clean tick. Shared follow-up callers reuse an attempt observed since their admission rather than each falling back to another heavy drain.
- OFF retains the old shadow position and return values, including missing migration/config lookup errors. No SQL planner configuration is added; #7697 rollback remains intact.

## Sequential implementation and verification

1. Run existing native PG17 baseline on the full synthetic fixture before product edits. Preserve cluster files, stop with bounded timeout, observe pg_ctl status 3 and no matching postgres processes.
2. Add failing explicit-clock regressions for legacy RPC error/timeout, cooldown, deferred and training-deferred paths, lease loss, separate failures and no repeated batch. Freeze the original entry-point source for OFF trace comparison.
3. Add fresh fail-closed flag helper plus idempotent OFF seed; minimally connect the entry points and existing shadow pass. No registry edits: provide parent the new entry.
4. Run targeted coordinator/shadow tests, targeted lint/type checks and native PG17 exact-source before/after verification with identical data, flags and explicit clock. Check all four source/shadow/legacy pairs and bounded drain semantics.
5. Record measurements and limits in the investigation, update SSOT and bug learning, and hand off uncommitted work for independent parent review. Parent owns FULL/e2e, commit/push/PR/CI and close-out. No player text or patch note applies to this invisible OFF change.

## Limits

Synthetic timings are a local before/after observation, not a production SLA or a 10x capacity claim. No staging/prod writes, migration apply, flag activation, merge or deploy. Targeted tests do not replace the parent's complete verification and independent review.

## Inline execution ledger, owner continuation 10 November

- Runtime failure is out of scope; owner explicitly authorized sequential execution in existing worktrees.
- Ruling: after-publication maintenance cannot retain the released legacy lease. Use the existing unleased budget; do not invent a second coordinator or change SQL acknowledgement. This permits temporary shadow backlog after public ranking completion.
- Frozen PR HEAD 5f94da8498a85f563ecff535873132ec9887a25b; fresh PG17 baseline, 2,304,000 synthetic rows: 5295.73 / 2765.62 / 2631.09 ms (median 2765.62).
- RED: four regressions failed on the frozen behavior. GREEN: all ten targeted 6765 tests pass, including blocked-shadow publication for Safe/Gated/training, failed legacy, cooldown/deferred and bounded backlog.
- Full measured results and verification are recorded in the investigation report; no production improvement is inferred from local timing.

- Review fix: post-publication shadow retains the local queue slot until complete. A blocked-shadow follow-up regression was observed RED then GREEN; independent re-review found no remaining P0/P1. Final paired PG17 publication median 7291.17 -> 4185.07 ms, four-output parity zero.

- Clean-tick follow-up of the same review finding: route ON clean state through queued coordinator admission; parity only after an authoritative clean claim. Regression RED then GREEN, 90 targeted tests pass and independent focused re-review is clean.
