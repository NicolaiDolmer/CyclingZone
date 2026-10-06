# Applied proposal reconciliation, 6 October 2026

Refs #6219. SSOT: [MIGRATIONS.md](../MIGRATIONS.md),
[TRAINING_RULES.md](../TRAINING_RULES.md), [proposal contract](../../database/proposals/README.md).

Read-only `proposals-reconcile.mjs` against production found one WARN:
`2026-10-03-6061-apply-compensation.sql`, all three declared objects present.
The other proposals produced no applied-object warning; four data/grant-only
files remain explicitly uncheckable by that detector. Their effects are not
certified by this cleanup.

The compensation proposal contains DDL, not an executed compensation batch.
Its table and trigger already have the registered migration
`database/2026-10-05-6061-compensation-ledger.sql`. Its original writer was
replaced by the registered
`database/2026-10-05-6129-compensation-slim-source.sql`.

Production catalog observations on 6 October:

- Both exact filenames are present in `public.schema_migrations`.
- The receipt table, rejection trigger function and compensation writer exist.
- Both functions are SECURITY INVOKER, callable by service_role and not by
  anon/authenticated. The current writer calls
  `training_compensation_6061_source_hashes`.

Promoting the old proposal verbatim would replace that current writer with
the superseded implementation. Instead, remove the obsolete proposal and
use the actual registered ledger and writer migrations in the integration
test. Git history retains the original proposal. No new migration is added,
so auto-migrate has no new SQL to execute and no history row is written.

The integration test applies ledger, writer, ledger and writer again, then
exercises actual compensation and duplicate protection in isolated PostgreSQL.
No production compensation is invoked or certified here. After merge Claude
should rerun the read-only proposal reconciliation: the compensation warning
must disappear; uncheckable data-only proposals remain visible.
