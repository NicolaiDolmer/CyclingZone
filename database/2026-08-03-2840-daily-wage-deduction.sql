-- database/2026-08-03-2840-daily-wage-deduction.sql
-- #2840: dagsbaseret løntræk, config-gated. I dag trækkes en hel sæsons løn
-- som ét engangsbeløb ved sæson-start — en rytter købt sent i sæsonen er
-- reelt gratis resten af sæsonen, og en rytter solgt sent giver ingen
-- refusion (se docs/audits/2026-08-03-economy-audit-3198.md fund #3).
-- Ejer-beslutning 30/7 (issue-kommentar): model A — dagligt løntræk pr.
-- rigtig dag. Håndhævelsen bor i backend/lib/wageDeductionSweep.js +
-- backend/lib/wageDeductionConfig.js.
--
-- DEFAULT = "season_upfront": denne migration ændrer INTET spilbart. Flip
-- til "daily" er ejer-only, tidligst ved S3-skiftet 23/8, og KUN efter
-- dry-run-simulering mod ægte population (simulér-før-ship-disciplinen).
--
-- ADVARSEL (dobbelttræks-fare): flip MÅ KUN ske ved en sæson-grænse (før
-- processTeamSeasonPayroll kører for den nye sæson). Et midt-sæson-flip vil
-- dobbelttrække hold der allerede har betalt den fulde sæsonløn upfront —
-- se kommentaren i wageDeductionConfig.js for detaljer.
--
-- Flip til live (efter dry-run + ejer-go, ved en sæson-grænse):
--   UPDATE public.app_config SET value = '"daily"'::jsonb WHERE key = 'wage_deduction_mode';
-- Slå fra igen (også ved en sæson-grænse):
--   UPDATE public.app_config SET value = '"season_upfront"'::jsonb WHERE key = 'wage_deduction_mode';
--
-- Idempotent (ON CONFLICT DO NOTHING / CREATE TABLE IF NOT EXISTS) — sikker
-- at køre flere gange. Ingen seeds/data.

INSERT INTO public.app_config (key, value, description)
VALUES
  ('wage_deduction_mode', '"season_upfront"'::jsonb,
   'Løntræk-model (#2840): "season_upfront" (default, nuværende adfærd — ét engangstræk ved sæson-start) | "daily" (dagligt træk pr. rigtig dag, pro-rata via aktuel roster). Håndhæves i wageDeductionSweep.js + economyEngine.processTeamSeasonPayroll. Flip KUN ved sæson-grænse — se migrations-header for dobbelttræks-faren.')
ON CONFLICT (key) DO NOTHING;

-- ── wage_daily_runs ────────────────────────────────────────────────────────
-- Én løn-eksekvering pr. hold pr. dag (dansk dato) i "daily"-mode. Idempotens-
-- anker for cron-sweepen (5-min-poll-sikker), mirror af training_day_runs
-- (database/2026-06-12-daily-training.sql). Den PRIMÆRE dobbelttræks-
-- beskyttelse er finance_transactions.idempotency_key (unik pr.
-- team+tick_date via `wage_daily:<team_id>:<tick_date>`); denne tabel er en
-- effektivitets-optimering (undgår gentagne riders-forespørgsler for hold
-- der allerede er trukket i dag).
CREATE TABLE IF NOT EXISTS public.wage_daily_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tick_date      DATE NOT NULL,
  riders_charged INTEGER NOT NULL DEFAULT 0,
  amount         BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, tick_date)
);

CREATE INDEX IF NOT EXISTS idx_wage_daily_runs_team_date
  ON public.wage_daily_runs (team_id, tick_date DESC);

ALTER TABLE public.wage_daily_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wage_daily_runs_select" ON public.wage_daily_runs;
CREATE POLICY "wage_daily_runs_select" ON public.wage_daily_runs
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));
-- Skrivning: kun service-role (ingen authenticated-policy for INSERT/UPDATE/DELETE).

COMMENT ON TABLE public.wage_daily_runs IS
  '#2840 dagsbaseret løntræk: idempotens-anker — UNIQUE(team_id, tick_date) '
  'sikrer at hvert hold kun trækkes én gang pr. dansk kalenderdag i "daily"-'
  'mode. Tom/uaktiv når wage_deduction_mode=season_upfront (default).';
