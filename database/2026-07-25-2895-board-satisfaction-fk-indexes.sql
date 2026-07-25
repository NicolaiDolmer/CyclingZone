-- #2895 — board_satisfaction_events: 3 uindekserede fremmenøgler + 44 % ugentlig vækst.
--
-- FUNDET (driftsaudit 25/7): 137.253 rækker / ~45 MB ved audit-tidspunkt, 60.879
-- nye rækker på 7 dage (44 % vækst/uge) — næststørst tabel efter race_results.
-- Verificeret på ny mod live 25/7 (denne migration, read-only pg_indexes +
-- information_schema): 140.091 rækker / 48 MB — væksten fortsætter som ventet.
-- `team_id`, `season_id` og `race_id` er alle fremmednøgler UDEN dækkende index
-- (kun `board_id` er indekseret, via board_satisfaction_events_board_race_uniq
-- og _board_created_idx — begge lister board_id som ledende kolonne).
-- EXPLAIN på FK-check-formen: 1.910 ms for at finde 258 rækker. `DELETE FROM
-- teams` har mean 884 ms i pg_stat_statements — hver holdsletning tvinger en
-- sekventiel scan af hele denne tabel for at verificere FK-cascaden.
--
-- KONSEKVENS: ikke spillervendt (tabellen serveres kun via /board/status,
-- service-role), men holdsletning, admin-oprydning (fx reset-division-3.mjs,
-- der cascader races → board_satisfaction_events.race_id SET NULL) og rollback
-- bliver gradvist ubrugelig. lock_timeout er 8 s, så FK-cascade-scanningen kan
-- på et tidspunkt time out MIDT i en transaktion — netop den slags operation
-- man får brug for hvis noget går skævt i et cutover-vindue.
--
-- SAMMENSAT vs. 3 SEPARATE INDEXES (analyse, backend-grep 25/7 mod board_satis-
-- faction_events-callsites i backend/routes/api.js + backend/lib/board
-- WeekendFinalization.js + backend/scripts/*): ingen query filtrerer på 2+ af
-- disse kolonner samtidig. Den ENESTE læsning (api.js:10807) filtrerer kun på
-- board_id (allerede indekseret). team_id/season_id/race_id rammes hver for
-- sig og UAFHÆNGIGT af hinanden — som FK-cascade-mål fra tre forskellige
-- forældretabeller (teams CASCADE, seasons CASCADE, races SET NULL via
-- reset-division-3.mjs). Et sammensat index ville kun dække det først-listede
-- kolonne-præfiks effektivt for de to øvrige — derfor 3 separate enkelt-
-- kolonne-indexes, præcis som issuet foreslår. Skriveveje (boardWeekend
-- Finalization.js) er upserts med onConflict "board_id,race_id", allerede
-- dækket af den eksisterende unique index.
--
-- CONCURRENTLY vs. almindelig: issuet foreslår CREATE INDEX CONCURRENTLY (af
-- hensyn til DELETE FROM teams' 884 ms mean + 8 s lock_timeout). Denne
-- migration bruger BEVIDST almindelig CREATE INDEX IF NOT EXISTS i stedet, for
-- at følge den etablerede konvention i HELE database/2026-*.sql-korpusset:
-- ingen eksisterende migration (grep 25/7, 0 hits på "CONCURRENTLY") bruger
-- CONCURRENTLY. Præcedensen dækker større tabeller end denne — fx
-- 2026-07-23-2764-prize-preview-index.sql byggede et index på race_results
-- (415.892 rækker på det tidspunkt, ~3x denne tabel) med almindelig CREATE
-- INDEX og begrundede det eksplicit med "et kort SHARE-lock under index-byg
-- er uden praktisk driftspåvirkning". Denne tabel (140.091 rækker / 48 MB) er
-- væsentligt mindre end den præcedens. CONCURRENTLY kan desuden ikke køre
-- inde i en transaktionsblok (se 2026-07-04-ranking-matviews.sql) — auto-
-- migrate.yml's `psql -f` autocommitter statement-for-statement uden BEGIN,
-- så det ville formentlig virke teknisk, men ved en fejlet CONCURRENTLY-build
-- efterlades et INVALID index, som auto-migrate.yml's fejlhåndtering (manuel
-- hot-fix, ingen automatisk DROP INDEX-cleanup) ikke er bygget til at rydde
-- op i. ÅBENT SPØRGSMÅL TIL EJER: hvis den målte DELETE FROM teams-kontention
-- (884 ms mean) er akut nok til at retfærdiggøre den ekstra operationelle
-- kompleksitet, bør denne migration erstattes med en CONCURRENTLY-variant
-- kørt manuelt (uden for auto-migrate.yml's autocommit-antagelse) i stedet.
--
-- IDEMPOTENT: CREATE INDEX IF NOT EXISTS. Ingen data ændres — kun 3 nye indexes.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_board_satisfaction_events_team_id;
--   DROP INDEX IF EXISTS idx_board_satisfaction_events_season_id;
--   DROP INDEX IF EXISTS idx_board_satisfaction_events_race_id;
--
-- Refs #2895.

CREATE INDEX IF NOT EXISTS idx_board_satisfaction_events_team_id
  ON public.board_satisfaction_events (team_id);

CREATE INDEX IF NOT EXISTS idx_board_satisfaction_events_season_id
  ON public.board_satisfaction_events (season_id);

CREATE INDEX IF NOT EXISTS idx_board_satisfaction_events_race_id
  ON public.board_satisfaction_events (race_id);

-- =============================================================================
-- Post-verify (kør manuelt eller lad CI's db-health-tjek dække det)
-- =============================================================================
--
-- 1) Alle 3 indexes findes:
--    SELECT indexname FROM pg_indexes WHERE tablename = 'board_satisfaction_events'
--      AND indexname IN (
--        'idx_board_satisfaction_events_team_id',
--        'idx_board_satisfaction_events_season_id',
--        'idx_board_satisfaction_events_race_id'
--      );
--    → forventet: 3 rækker.
--
-- 2) FK-cascade-planlæggeren bruger nu et index-scan i stedet for seq scan
--    (erstat <team_id> med et reelt hold-uuid):
--    EXPLAIN SELECT 1 FROM board_satisfaction_events WHERE team_id = '<team_id>';
--    → forventet: "Index Scan using idx_board_satisfaction_events_team_id"
--      (ikke "Seq Scan on board_satisfaction_events").
--
-- 3) Ingen regression i rækketal (indexes ændrer kun access-path, aldrig data):
--    SELECT count(*) FROM board_satisfaction_events;
--    → forventet: uændret fra før migration (~140.091, vokser ~44 %/uge).
