# Independent ranking shadow pass

Refs #6765. Scope: first PR agreed in issue comment 6655002664; owner night mandate on #7911, comment 6748409421. SSOT: `docs/GAME_INVARIANTS.md`, Durable ranking events. No readers, planner settings, existing refresh RPCs, acknowledgement protocol or production configuration change.

## Design and failure modes before implementation

- A fresh, separately seeded OFF control selects independence. Missing row, invalid value, thrown query or query error selects the existing path; query failures are captured. No successful ON cache survives a failed lookup.
- With a coordinator claim, attempt shadow maintenance before legacy RPCs, retaining owner token, target version, renewals and the existing bounded version drain. Legacy failure/timeout therefore cannot prevent this attempt.
- Without a claim (cooldown, clean, deferred, admission failure), attempt the existing bounded shadow pass without a coordinator token/version. SQL remains authoritative for writer contention and shadow enablement. Do not invent or acknowledge a legacy version.
- Each admitted pass attempts shadow once. A fallback is used only if the callback did not attempt it. Avoid a second heavy drain after legacy failure. Multiple callers retain the existing local queue; SQL retains cross-process serialization.
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
