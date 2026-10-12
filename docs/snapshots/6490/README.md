# #6490 — measurement first, 12 October 2026

SSOT: [TRAINING_RULES](../../TRAINING_RULES.md). The owner's latest instruction
stops M3 and requires measurement before further implementation or stack cleanup.

## Observed prerequisites, not a performance result

- Existing isolation wrapper returned `ISOLATED`; direct PostgreSQL connection
  through that wrapper succeeded on 12 October. See `staging-preflight.json`.
- Staging is PostgreSQL 17.6, approximately 3.44 GB. Its report GIN index is
  450,117,632 bytes, valid and ready; its exact definition/options are saved.
- Read-only production check at 09:24:46 UTC: PostgreSQL 17.6, report GIN
  887,185,408 bytes, valid, default options. Shared buffers are 1 GiB in production
  and 512 MiB in staging. No production setting or data was changed.
- Current production writer hash is `8b18fdfc29e0ea02fc62ab7847d45130`;
  staging writer hash is `7d3829c5eaaeb266675b6d261c5f6fbd`.
  These hashes normalize CRLF in `pg_get_functiondef` before MD5.
- Staging's latest registered training date is 5 October. Its prior full date
  has 262 registered teams and 8,314 roster entries. This is not yet a validated
  replay workload, and cannot silently stand in for production on 11 October.
- Statement tracking is top-level only. Catalog checks report no permission
  to enable nested statement tracking, nested auto-explain, or explicit checkpoint.
- `pg_walinspect` and `pgstattuple` are available but not installed. Automatic
  approval review rejected even a rolled-back extension creation probe as an
  unrequested staging schema mutation. It never ran. Owner permission is pending.
- CodeRabbit CLI `auth status --agent` now positively reports authenticated.

**No performance experiment has run.** There is no new WAL saving, percentile,
GIN attribution, or reproduction of the historical 45-second maximum to report.
The GIN index has not been altered or dropped, including in staging.

## Authorized staging-only index experiment

The owner explicitly authorized temporary GIN removal and reconstruction **only**
in isolated loadtest staging, through the existing isolation wrapper. Preserve
the exact saved definition and original options; verify `indisvalid`, `indisready`
and definition/options equality after reconstruction before declaring completion.
Production writes, production index/settings changes and all merges require a
separate owner go. No M1/M2/M3 SQL is part of this experiment.

## Measurement contract

1. Establish one valid, fixed snapshot and writer version. Capture real engine
   RPC inputs for one complete eligible staging date, including registration and
   all ordered slots per team. Record actual teams/riders/slots and exclusions.
2. Replay identical input with separately committed calls for each arm, three
   repeats each: original GIN options, fastupdate off, GIN absent. Restore and
   hash-check all affected before-images before every repeat. Already-applied
   no-op calls do not count as successful workload.
3. Control and record starting index/pending-list state, cache/checkpoint policy,
   concurrency and other writers. A logical restore/rebuild is not a physical
   clone and cannot prove reproduction of production's fragmented index.
4. Report each repeat, each team-date, successful calls, WAL/call, WAL/team-date,
   p50/p95/max duration and failures. Separate preparation, reset, rebuild and
   pending-list cleanup from the measured writer window.
5. Attribute report/TOAST, GIN, rider receipts, training scores, both histories
   and residual writes without double-counting inclusive parent/child statistics.
   Mark any inferred attribution explicitly. Current top-level tracking alone
   does not provide the requested table/index split.
6. Independent read-only method review completed: real captured inputs and
   committed replay recommended; reject fabricated report-only payloads and
   rollback-only/no-op replay as a claimed 1× experiment.
7. If GIN accounts for less than approximately half, the next decision card
   addresses the other writes. It does not resume M3 automatically.

## Next work after measurement

Consolidate M1/M2 from clean main without counter SQL; preserve old deadlock proof
as README/JSON only. Supersede #6507–#6509 with a reference, trim the new training
SSOT contract to 3–5 lines, and omit premature changes to the pagination helper,
shared guardrails and staging refresh. The daily training owner card remains part
of #6490. Nothing is merge-approved.

Measurement references: [PostgreSQL statement WAL statistics](https://www.postgresql.org/docs/17/pgstatstatements.html),
[PostgreSQL WAL inspection](https://www.postgresql.org/docs/17/pgwalinspect.html).
