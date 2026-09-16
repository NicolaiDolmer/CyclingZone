-- database/2026-09-14-4346-fairplay-trade-report.sql
-- #4346 — spilleren har ingen rigtig indgang til at anmelde en handel.
--
-- Ejer-løfte 27/8 (knud_r_flink) + ejer-direktiv 10/9 (bobby2106,
-- #feedback-from-dolmer): "Der skal være en rapporterings funktion på
-- transfers mellem hold ... sådan spillere kan rapportere, hvis de føler der
-- var noget der var udenfor financial fairplay". Denne PR dækker trin 1+2 af
-- issuet — transfers mellem hold (auktion/direkte handel/bytte). Afsluttede
-- auktioner som selvstændigt rapporterbart objekt (10/9-udvidelsen) er IKKE
-- del af dette scope — se PR-body for hvorfor.
--
-- HVAD:
--   1. Ny kategori 'fairplay' på player_feedback (CHECK-constraint udvidet) —
--      bruges BÅDE af kontaktformularens kategori-dropdown (generisk "jeg vil
--      anmelde noget" uden en bestemt handel) OG af den nye strukturerede
--      handel-rapport nedenfor. Samme kategori = admin-indbakken kan filtrere
--      begge typer under ét (#2842).
--   2. Ny kolonne player_feedback.metadata (JSONB, nullable) — bærer
--      strukturerede felter for en rapport der PEGER på noget konkret:
--      { transfer_type, transfer_id, reporting_team_id, team_a_id, team_b_id }
--      for en handel-rapport. NULL for almindelig kontaktformular-feedback.
--      Formålet (#4346's egen ordlyd): "så fair-play-review (#3138) faar
--      id'et gratis" — en admin der læser rækken behøver ikke rekonstruere
--      hvilken handel en fritekst-rapport handler om.
--
-- HVORFOR EN GENERISK JSONB-KOLONNE, IKKE EGNE transfer_type/transfer_id-
-- KOLONNER: player_feedback er i forvejen den fælles indbakke for tre
-- ureleterede kategorier (feedback/bug/idea, #2602) og nu en fjerde. Kun
-- 'fairplay'-rækker fra handel-rapporter bruger metadata — dedikerede
-- kolonner ville stå NULL for de andre 99% af rækkerne. Tabellen har enkeltcifrede
-- rækketal i prod (jf. 2026-07-18-player-feedback.sql's egne kommentarer), så
-- der er ingen forespørgsels-performance at vinde ved et separat skema endnu.
--
-- DEDUPE ("maks 1 rapport pr. handel pr. hold", #4346): håndhæves i
-- backend (submitTradeReport, backend/lib/feedbackInbox.js) ved at læse
-- eksisterende 'fairplay'-rækker for det rapporterende hold og sammenligne
-- metadata->>transfer_type/transfer_id i JS — IKKE en DB-unique-constraint.
-- Tabellen er lille nok til at det er billigt, og en unik constraint på et
-- JSONB-udtryk kræver et funktionelt indeks der er overkill for volumen her.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-
--    agenten mod prod. EJEREN merger PR'en (database/*.sql) og applier
--    migrationen som et SEPARAT manuelt post-merge-skridt (apply sker IKKE
--    automatisk ved merge, jf. #2642).
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD, ADD COLUMN IF NOT EXISTS.
-- Ingen eksisterende rækker muteres. Re-run = no-op.
--
-- Rollback:
--   ALTER TABLE player_feedback DROP CONSTRAINT IF EXISTS player_feedback_category_check;
--   ALTER TABLE player_feedback ADD CONSTRAINT player_feedback_category_check
--     CHECK (category IN ('feedback', 'bug', 'idea'));
--   (Kun sikkert hvis ingen rækker ligger i 'fairplay' endnu.)
--   ALTER TABLE player_feedback DROP COLUMN IF EXISTS metadata;
--
-- POST-VERIFY (kør efter merge):
--   -- 1) constraint indeholder fairplay:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'player_feedback'::regclass
--       AND conname = 'player_feedback_category_check';
--   -- forventet: CHECK ((category = ANY (ARRAY['feedback'...,'fairplay'...])))
--
--   -- 2) metadata-kolonnen findes:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'player_feedback' AND column_name = 'metadata';
--   -- forventet: metadata | jsonb

ALTER TABLE player_feedback DROP CONSTRAINT IF EXISTS player_feedback_category_check;

ALTER TABLE player_feedback
  ADD CONSTRAINT player_feedback_category_check
    CHECK (category IN ('feedback', 'bug', 'idea', 'fairplay'));

ALTER TABLE player_feedback
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN player_feedback.category IS
  '#2602/#4346: feedback | bug | idea | fairplay. Gyldige værdier styres af player_feedback_category_check, som SKAL matche FEEDBACK_CATEGORIES i backend/routes/api.js + frontend/src/lib/feedbackForm.js — udvid alle tre sammen. "fairplay" bruges både af kontaktformularens dropdown og af den strukturerede handel-rapport (submitTradeReport).';

COMMENT ON COLUMN player_feedback.metadata IS
  '#4346: strukturerede felter for en rapport der peger på et konkret objekt. For en handel-rapport (category=fairplay via POST /api/transfers/:type/:id/report): { transfer_type, transfer_id, reporting_team_id, team_a_id, team_b_id }. NULL for almindelig kontaktformular-feedback (feedback/bug/idea, og fairplay uden en bestemt handel).';
