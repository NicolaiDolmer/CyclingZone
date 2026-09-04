-- KOERES IKKE AUTOMATISK (manual-only): registrerer tre allerede-anvendte
-- forslag i schema_migrations, saa auto-migrate.yml springer dem over efter
-- forfremmelsen i #3777.
--
-- #3777 · "Security grants audit" (scripts/proposals-reconcile.mjs, koert af
-- .github/workflows/security-grants-audit.yml hver 6. time) er roed hver nat
-- paa tre filer i database/proposals/ hvis objekter lever i prod, men som
-- aldrig blev forfremmet til database/-topniveau + registreret. PR'en for
-- #3777 flytter filerne (git mv, samme filnavn); DENNE fil er det stykke af
-- opgaven der SKRIVER til prod og derfor er ejer-gated (ikke en del af PR'en).
--
-- ═══ RAEKKEFOELGE-ADVARSEL (kritisk) ════════════════════════════════════════
-- KOER DENNE FIL FOER PR'en for #3777 merges. auto-migrate.yml's pending-logik
-- er "lokale filnavne MINUS registrerede filnavne" (comm -23) — merges PR'en
-- FOERST, ser workflowet de tre filer paa database/-topniveau uden en
-- schema_migrations-raekke og koerer dem PAA NY. Se idempotens-verdikt per fil
-- nedenfor: alle tre er maalt harmloese at gen-koere (0 raekker ville blive
-- ramt), saa en forkert raekkefoelge her er IKKE destruktiv i praksis — men
-- den er ogsaa unoedvendig arbejde + stoej i migrations-loggen. Koer alligevel
-- i den rigtige raekkefoelge.
--
-- ═══ Effekt-verifikation (read-only, koert 3/9 via Supabase MCP execute_sql) ═
-- Alle tre reparationer koerte FAERDIG i prod (UPDATE'en committede, ikke kun
-- backup-tabellen):
--
--   2026-07-25-2881-academy-promotion-contract-repair.sql
--     backup_academy_promotion_contract_fix_20260725: 22 raekker (matcher
--     filens egen 5/8-gen-kvantificering). Post-verify-forespoerslen fra filen
--     ("0 tilbage med 2/2-signaturen") gav 0 -- UPDATE'en er fuldt gennemfoert.
--     Faktisk koert 2026-08-05 ~06:09:25 UTC (ikke 25/7 -- filens dato er
--     forfatter-dato, ikke koersels-dato).
--
--   2026-07-31-3095-italiensk-klassiker-monument-goal-repair.sql
--     backup_italiensk_klassiker_monument_goal_fix_20260731: 5 raekker for de
--     5 boards filen navngiver (praecis, 5/5), koert 2026-07-31 11:52:36 UTC.
--     Post-verify: alle 5 boards har nu 5 maal tilbage (var 6). 0 tilbage med
--     bug-signaturen. (Bemaerk: samme backup-tabel har en 6. raekke, indsat 43
--     sekunder senere, for et board UDEN for denne fils IN-liste -- en
--     separat, senere haandkoersel af samme reparationsmoenster paa et 6.
--     ramt hold. Uden for scope for #3777 og roeres ikke her.)
--
--   2026-08-05-2881-academy-graduation-promote-contract-repair.sql
--     backup_academy_graduation_promote_contract_fix_20260805: 10 raekker
--     (filens 5/8-vurdering forventede 12 -- 2 havde selv-korrigeret i
--     mellemtiden, hvilket filens egen WHERE-praedikat allerede tager hoejde
--     for). Koert 2026-08-05 ~06:09:52 UTC, 27 sekunder efter den foerste fil
--     samme dag. Post-verify: 0 tilbage med den reparerbare bug-signatur.
--
-- ═══ Idempotens-verdikt (ville en gen-koersel via auto-migrate goere skade?) ═
--   Alle tre: NEJ, harmloest. Hver fils WHERE-praedikat (kombinationen af
--   kontrakt-felter og en EXISTS mod et audit-spor) matcher i dag 0 raekker,
--   fordi reparationen allerede har flyttet alle ramte raekker vaek fra
--   bug-signaturen. CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO
--   NOTHING for backup-tabellerne er ligeledes no-ops. En util­sigtet
--   gen-koersel ville altsaa spilde en CI-koersel, ikke beskadige data.
--
-- ═══ Hvorfor filnavnet matcher praecis ═══════════════════════════════════════
-- auto-migrate.yml udleder "lokalt filnavn" fra
--   find database -maxdepth 1 -type f -name '2026-*.sql'
-- koert fra repo-roden, dvs. STIEN inkluderer 'database/'-praefikset. Det er
-- praecis den streng der skal staa i schema_migrations.filename for at
-- comm -23 regner filen for allerede anvendt.

INSERT INTO schema_migrations (filename) VALUES
  ('database/2026-07-25-2881-academy-promotion-contract-repair.sql'),
  ('database/2026-07-31-3095-italiensk-klassiker-monument-goal-repair.sql'),
  ('database/2026-08-05-2881-academy-graduation-promote-contract-repair.sql')
ON CONFLICT (filename) DO NOTHING;

-- ── Verifikation (ren laesning) ──────────────────────────────────────────────
-- Forventet: 3 raekker efter INSERT'en ovenfor.
SELECT filename, applied_at
FROM schema_migrations
WHERE filename IN (
  'database/2026-07-25-2881-academy-promotion-contract-repair.sql',
  'database/2026-07-31-3095-italiensk-klassiker-monument-goal-repair.sql',
  'database/2026-08-05-2881-academy-graduation-promote-contract-repair.sql'
)
ORDER BY filename;
