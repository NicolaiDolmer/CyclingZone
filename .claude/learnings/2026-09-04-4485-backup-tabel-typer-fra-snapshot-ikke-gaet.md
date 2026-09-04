# Backup-tabel med forkert kolonnetype stoppede en godkendt prod-reparation (4/9 2026)

**Symptom:** `repair-4485-young-classification.js --apply` fejlede i trin 0 (backup) med `invalid input syntax for type uuid: "1"`, efter ejeren havde givet go. Intet var skrevet til live-tabeller (backup kører før alt andet), men kørslen måtte gentages og ejeren vente.

**Rod-årsag:** Backup-DDL'en (`database/2026-09-04-4485-young-classification-backup-tables.sql`) blev skrevet med `league_division_id uuid`, fordi navnet lignede et uuid-felt. I prod er `season_standings.league_division_id` `integer` (og `penalty_points` er `bigint`). `database/schema-snapshot.json` indeholder kolonnenavne men ikke typer, så snapshot-opslaget fangede det ikke; ingen dry-run rammer backup-skrivningen, så fejlen viste sig først ved apply.

**Fix:** `ALTER COLUMN ... TYPE integer` på den tomme backup-tabel i prod + `database/2026-09-04-4485-backup-standings-type-fix.sql` i repoet. Apply kørt igen: grøn, post-verify 0 fejl.

**Regel fremover:**
1. Backup-/skygge-tabeller der spejler en prod-tabel laves som `CREATE TABLE ... (LIKE public.<tabel> INCLUDING DEFAULTS)` plus `captured_at`, aldrig håndskrevne kolonner.
2. Kan det ikke (delvis spejling), så slå typerne op i prod FØR DDL: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='<tabel>'`. Snapshot-filen har kun navne.
3. Dry-run bør skrive én test-række til hver backup-tabel i en transaktion der rulles tilbage, så typefejl fanges før ejer-go. Ikke implementeret endnu; tag det med i næste reparationsscript.
