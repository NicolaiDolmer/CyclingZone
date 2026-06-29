# Disk-IO budget drain: view-temp-eksplosion + last_seen write-amplification

**Dato:** 2026-06-29
**Issue/PR:** #2020 / PR #2021
**Symptom:** Supabase-advarsel "Your project is about to deplete its Disk IO Budget".

## Hvad skete der

Supabase advarede om opbrugt disk-IO-budget. Den intuitive mistanke (manglende
indexes → store reads fra disk) var **forkert**: DB'en er 91 MB, cache-hit 100%,
`blks_read` ~5k siden 30/3. Budgettet blev drænet af **disk-WRITES**:

1. **Temp-file-spills — 930 GB / 164k filer siden 30/3.** Værste synder: viewet
   `ai_active_season_status` spillede ~1,5 GB temp **pr. kald**. Årsag: fire
   uafhængige 1:mange `LEFT JOIN`s (races, race_results, season_standings,
   finance_transactions) ganges til et kartesisk mellemresultat
   (263 × 3.513 × 168 × 584 ≈ 90 mia. rækker) før `count(DISTINCT)` reducerer.
   Et enkelt kald kunne løbe tør for temp-diskplads (`No space left on device`).
2. **`users.last_seen` — 281k UPDATEs.** Presence-heartbeatet (`/api/presence`)
   skrev `last_seen` ved *hvert* kald (+ WAL + dead tuple hver gang).

## Rod-årsag

- **Fan-out-antipattern:** `count(DISTINCT child.id)` over flere samtidige
  1:mange-joins er semantisk korrekt men eksploderer mellemresultatet. Det er
  matematisk ækvivalent med — men katastrofalt dyrere end — en uafhængig
  `(SELECT count(*) FROM child WHERE fk = parent.id)` pr. tælling.
- **Write-amplification:** ubetinget UPDATE i en høj-frekvens heartbeat. Hvert
  kald = en row-write selv når værdien reelt ikke behøver opdateres.

## Fix

- Omskrev viewet med præ-aggregerede scalar-subqueries → 3,8 ms, **0 temp**
  (Index Only Scans), identiske tal. Samme kolonner/`security_invoker`/grants.
- Ny `touch_user_presence(uuid)`-RPC: betinget UPDATE der kun skriver hvis
  `last_seen` er >60s gammelt. 5-min-features (online-prik, /online-count,
  "sidst set") uændrede fordi 60s ≪ 5 min.
- **Forward-guard:** `scripts/db-health.sql` + ugentlig `db-health.yml` der åbner
  et issue ved disk-IO/performance tærskel-brud (per-call temp >50 MB, cache-hit
  <99%, slow+frequent queries, vacuum-kandidater).

## Lessons

1. **Ved disk-IO-pres: kig på WRITES før reads.** Cache-hit 100% udelukker ikke
   et IO-problem — temp-spills og WAL er disk-writes. `pg_stat_database.temp_bytes`
   + `pg_stat_statements.temp_blks_written`/`wal_bytes` er de første steder at se.
2. **`count(DISTINCT)` over multi-join = rødt flag.** Mistænk fan-out; foretræk
   uafhængige subqueries/`LATERAL` der lader hver child-tælling bruge sit eget index.
3. **Verificér view-omskrivning uden at kunne køre originalen.** Den gamle query
   kunne ikke køres til ende (no space). Matematisk ækvivalens-argument + faktiske
   tal fra den nye + `EXPLAIN (ANALYZE, BUFFERS)` gav beviset uden at materialisere
   eksplosionen.
4. **Etablér en stående gate, ikke kun et engangs-fix** (ejer-feedback, [[feedback_proactive_infra_health_monitoring]]).
