# #6490 — measurement first, 12 October 2026

SSOT: [TRAINING_RULES](../../TRAINING_RULES.md). The owner's latest instruction
stops M3 and requires measurement before further implementation or stack cleanup.

**Revised owner scope, 12 October:** retain completed baseline-1; run only
fastupdate-off-1 and no-gin-1 with the same sealed inputs. Restore staging and
remove measurement extensions/cache, publish one result comment, then stop this
build track. Claude/Fable own the design decision. No new product PR, M3, merge
or PR closure. Owner goals: evening close below two minutes after the final stage,
and no settlement above two seconds. This replay does not measure whole-close time.
Decision: https://github.com/NicolaiDolmer/CyclingZone/issues/6490#issuecomment-6124995038

## Observed prerequisites, not a performance result

- Existing isolation wrapper returned `ISOLATED`; direct PostgreSQL connection
  through that wrapper succeeded on 12 October. See `staging-preflight.json`.
- Staging is PostgreSQL 17.6, approximately 3.44 GB. Its report GIN index is
  450,117,632 bytes, valid and ready; its exact definition/options are saved.
- Read-only production check at 09:24:46 UTC: PostgreSQL 17.6, report GIN
  887,185,408 bytes, valid, default options. Shared buffers are 1 GiB in production
  and 512 MiB in staging. No production setting or data was changed.
- Current production writer hash is `<private fingerprint>`;
  staging writer hash is `<private fingerprint>`.
  These hashes normalize CRLF in `pg_get_functiondef` before MD5.
- Staging's latest registered training date is 5 October. Its prior full date
  has 262 registered teams and 8,314 roster entries. This is not yet a validated
  replay workload, and cannot silently stand in for production on 11 October.
- Initial statement tracking was top-level only. Catalog privilege checks returned
  false, but an actual rolled-back session probe subsequently proved nested tracking
  works. Do not mistake these managed-service catalog checks for runtime proof.
- The owner approved temporary `pg_walinspect` and `pgstattuple` on staging with
  cleanup. Both creation probes passed and rolled back; later preparation installed
  both temporarily. Reading real WAL records was positively verified.
- A OneDrive data export was rejected by automatic approval review. A safer local,
  transient rollback copy inside the worktree was accepted; no cloud export ran.
- CodeRabbit CLI `auth status --agent` now positively reports authenticated.

**No comparative performance result yet.** Untimed real-engine capture completed:
262 teams, 1,310 writer calls, 41,450 applied rider slots, 24 quarantined riders,
251 complete teams and 11 requiring reconciliation; no failed/pending/partial teams.
See `capture-coverage.json`. All 2,620 captured RPC inputs are sealed privately with
SHA-256 `<private fingerprint>`.
Preparation reconstructs 4 October conditions/receipts from the 5 October snapshot;
abilities/plans remain from that snapshot. This is a comparative staging workload,
not a historical outcome reconstruction or a current-production capacity proof.
Original staging restoration is required between trials and at completion.

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
2. Replay identical input with separately committed calls for each arm, one
   trial each under the revised scope: original GIN options, fastupdate off, GIN absent. Restore and
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

## Owner decision after measurement

The latest owner instruction requires one Danish results comment, then a stop.
Claude and an independent Fable review take over the design and build.
Do not continue M3, close drafts, implement stack cleanup or merge.
The daily training experience A/B card is separate. A serial writer replay does not support a
credible whole-evening duration forecast; disclose that missing evidence.

Measurement references: [PostgreSQL statement WAL statistics](https://www.postgresql.org/docs/17/pgstatstatements.html),
[PostgreSQL WAL inspection](https://www.postgresql.org/docs/17/pgwalinspect.html).
