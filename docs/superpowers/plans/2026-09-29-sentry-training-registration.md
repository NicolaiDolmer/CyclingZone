# Sentry training registration fix

Owner approved trying the proposed training fixes in chat, 29 September. SSOT:
[TRAINING_RULES.md](../../TRAINING_RULES.md), with youth eligibility from
[YOUTH_RULES.md](../../YOUTH_RULES.md). No training rates or squad rules change.

1. Reproduce the legacy sweep entering normalized training, and missing opening
   conditions for an owned rider with no `rider_condition`. Tests first.
2. Gate `trainingSweep.js` with the strict condition ownership reader; preserve
   legacy flag-off behavior and reject failed flag reads.
3. Replace `register_training_date_work` in an idempotent service-only migration.
   A first registration on its logical Copenhagen date may materialize the
   established neutral fallback for an owned, non-retired rider with no previous
   persisted condition effects. Freeze the opening and roster atomically. Never
   overwrite a live condition or reopen existing/historical work implicitly.
4. Report reconciliation generically and serialize bounded evidence in the
   training alarm; preserve durable delivery retries.
5. Run focused tests including actual PostgreSQL semantics with PGlite, migration
   reapplication, existing injuries, foreign/retired riders, midnight retry,
   invalid contracts, historical evidence and service-role authorization. Run
   TIER FULL verification, preflight, CodeRabbit and independent read-only review.
6. Patch notes describe the forward fix only. Update training SSOT and bug
   learning. Registry unchanged: no new feature, retirement or flag flip.
7. Existing quarantined riders require a separately reviewed recovery proposal
   using measured receipts, load evidence and verified openings. The forward
   migration does not change them. Merge/migration and prod recovery retain the
   owner's gates; show concrete results before requesting approval.
