# Unescaped apostrof i SQL string-literal → partial migration + bookkeeping drift

**Dato:** 2026-05-25
**Issue:** [#635](https://github.com/NicolaiDolmer/CyclingZone/issues/635) (audit-finding) + [#606](https://github.com/NicolaiDolmer/CyclingZone/issues/606) (original migration)
**Fix:** commit `cce1d5b` + manuel reconciliation via Supabase MCP
**Follow-up:** [#639](https://github.com/NicolaiDolmer/CyclingZone/issues/639) forward-guard

## Hvad skete

`database/2026-05-24-squad-enforcement-started-at.sql` blev pushed til main 2026-05-24 i 2 commits (`63fbb40`, `2e41c20`). Auto-migrate fejlede begge gange med:

```
psql:database/2026-05-24-squad-enforcement-started-at.sql:55: ERROR: syntax error at or near "et"
```

Linje 63 indeholdt:
```sql
'Completed_at kræver started_at — ... uden at have claim'et.';
                                            ^
                          lukker SQL-string-literal'en for tidligt
```

psql parsede `et` som identifier → `ON_ERROR_STOP=1` abortede → resten af migrationen kørte ikke + `INSERT INTO schema_migrations` skete aldrig.

Migration var partial-applied:
- ✅ Kolonne `transfer_windows.squad_enforcement_started_at` (ADD COLUMN IF NOT EXISTS, linje 34)
- ✅ Backfill UPDATE
- ✅ CHECK constraint `started_requires_closed` + COMMENT
- ✅ CHECK constraint `completed_requires_started` (DDL kørte)
- ❌ COMMENT på `completed_requires_started` (linje 62-63, failed)
- ❌ Row i `public.schema_migrations`

Fejlen blev IKKE fanget i 24 timer fordi:
- Auto-migrate workflow har korrekt error-output, men der er ingen alerting på `failure`-status
- Manuel verifikation efter push blev sprunget over
- Først weekly feature-liveness audit-cron 2026-05-25 04:00 UTC fangede missing `schema_migrations`-row

## Rod-årsag

**Direkte:** `claim'et` skulle være `claim''et` (PostgreSQL standard double-single-quote escape inside string-literals).

**Indirekte:** Ingen pre-commit lint på SQL string-literals. Pattern er etableret i kodebasen — fx `database/2026-05-05-board-club-dna.sql:107` har korrekt `Manageren''s` — men ikke håndhævet. Single point of failure.

**Observabilitets-gap:** Auto-migrate failure efterlod prod-DB i inkonsistent state (partial DDL applied + ingen bookkeeping). Ingen alert. Detect-time = 24 timer.

## Fix

1. **Fil-fix:** `claim'et` → `claim''et` (commit `cce1d5b`)
2. **Reconciliation via Supabase MCP `execute_sql`:**
   ```sql
   COMMENT ON CONSTRAINT transfer_windows_squad_enforcement_completed_requires_started ON transfer_windows IS '...claim''et.';
   INSERT INTO schema_migrations (filename, applied_at) VALUES ('database/2026-05-24-squad-enforcement-started-at.sql', '2026-05-24 19:58:00+00') ON CONFLICT DO NOTHING;
   ```
   Backdated `applied_at` for accuracy (matcher første auto-migrate-forsøg).
3. **Push fix → næste auto-migrate-run ser filename allerede i schema_migrations → skip → success.**

## Backwards-check

`Grep '[a-zA-Z]''[a-zA-Z]' database/*.sql` viste 2 match'es:
1. `2026-05-05-board-club-dna.sql:107` — **KORREKT** escape (`Manageren''s`)
2. `2026-05-24-squad-enforcement-started-at.sql:63` — **DEN BUGGY** (vores fix)

Pattern matching alle 87 `database/2026-*.sql` filer: kun 1 sted med problemet. **Ikke systemisk drift.**

## Forward-guard

Åbnet [#639](https://github.com/NicolaiDolmer/CyclingZone/issues/639) med 4 muligheder. Anbefaling: A+D.
- **A:** Pre-commit script der tokeniserer SQL string-literals og fejler på unescaped `'` (30 min impl)
- **D:** Audit-script kører ved push (ikke kun cron) → mean-time-to-detect 5 min vs 7 dage (15 min impl)

Ikke implementeret i denne session (separat task, prioritet:med).

## Læringer

1. **`ON_ERROR_STOP=1` + partial DDL = bookkeeping drift.** psql aborter midt i en migration efterlader prod-DB i inkonsistent state. Kun det første DDL-statement i en transaktion er rollback-safe; senere statements (specielt COMMENT) failer separat. Brug `BEGIN; ... COMMIT;` wrapper rundt om kritiske multi-statement migrations.

2. **Audit-cron som detection-net er for langsom.** 24 timer detect-time er acceptabelt for non-critical drift, men ikke for failed migrations. Auto-migrate workflow burde poste failure til Discord eller åbne issue direkte.

3. **Single point of failure i pattern.** Andre filer havde korrekt escape — etableret konvention, men ikke håndhævet. Konventioner uden enforcement degraderer over tid. Pre-commit lint er den billigste forsvar.

4. **Supabase MCP `execute_sql` er fed til reconciliation.** Manuel SQL kan køres uden roundtrip via Supabase Dashboard eller psql-shell. Specielt nyttigt når man skal restore bookkeeping efter partial failures.

5. **Bug var i NY migration, ikke i workflow.** Audit-finding pegede præcist på rod-årsagen — Detector C (migration-drift) er værd at beholde.
