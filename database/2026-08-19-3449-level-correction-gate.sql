-- #3449/#3750 · Niveau-korrektionens SØNDAGS-GATE — måle-log + konfiguration.
--
-- DENNE MIGRATION ER MÅLE-INFRASTRUKTUR, IKKE SELVE KORREKTIONEN. Den opretter
-- kun tabeller/nøgler til at PERSISTERE + VISE gate-status; den mutation der
-- flytter riders.market_value er en separat, ejer-gated engangs-kørsel
-- (backend/scripts/marketValueLevelCorrectionApply.js), tidligst 30/8. Denne
-- fil ændrer INTET i spillet ved merge.
--
-- ⚠️ LIVSCYKLUS — LÆS FØR MERGE: denne fil ligger i database/2026-*.sql og
--    KØRER AUTOMATISK mod prod ved merge til main (.github/workflows/
--    auto-migrate.yml, ~3 min efter push; AGENTS.md hard rule 9). Den anvendes
--    IKKE manuelt af implementerings-agenten under PR'en. Migrationen er
--    ikke-destruktiv (CREATE ... IF NOT EXISTS, INSERT ... ON CONFLICT DO
--    NOTHING) og INERT (seeder kun nøgler + tomme tabeller) — den kræver
--    derfor ikke ejer-manuel-merge på samme måde som 2026-08-06-3448 gjorde,
--    men PR'en her forbliver draft indtil ejeren har set gate-maskineriet.
--
-- Ejer-beslutning 19/8 (kontrakten): gaten kræver (a) mindst
-- market_value_level_correction_min_qualified_trades kvalificerede forhandlede
-- handler i et 90-dages-vindue, OG (b) at de seneste 3 ugentlige rullende
-- 30-dages-medianer af pris/anker ligger parvis inden for
-- ±market_value_level_correction_stability_band af hinanden. Seedet
-- KONSERVATIVT (40 / 0,15) — målingen 19/8 viser kanalen IKKE stabil endnu
-- (rullende median 0,665 → 0,775 → 0,908 over de seneste 3 uger, spænd 0,243 >
-- 0,15), så gaten skal stå RØD første gang den kører. Se
-- backend/lib/marketValueLevelCorrectionConfig.js + docs/audits/
-- 2026-08-17-vaerdimodel-refit-scorecard.md for de fulde tal.
--
-- Neutralitets-bundtets to nøgler (youth-rate-override + wage-anchor-a) seedes
-- NULL — "ingen korrektion har kørt endnu", fail-safe = uændret adfærd. Se
-- backend/lib/youthMarket.js (rate-override er allerede live-kodet, læses
-- hver gang en ungdomsauktion oprettes) og
-- backend/lib/marketValueLevelCorrectionNeutrality.js.
--
-- Rollback:
--   DELETE FROM public.app_config WHERE key IN (
--     'market_value_level_correction_min_qualified_trades',
--     'market_value_level_correction_stability_band',
--     'market_value_level_correction_youth_auction_start_rate',
--     'market_value_level_correction_wage_anchor_a');
--   DROP TABLE IF EXISTS public.market_value_level_correction_rider_receipts;
--   DROP TABLE IF EXISTS public.market_value_level_correction_apply_log;
--   DROP TABLE IF EXISTS public.market_value_level_correction_gate_log;

INSERT INTO public.app_config (key, value, description)
VALUES
  ('market_value_level_correction_min_qualified_trades', '40'::jsonb,
   '#3449: minimum antal kvalificerede forhandlede handler (transfer_offers, #3750-filteret indsnævret til kun kilde transfer) i det 90-dages-vindue søndags-gaten måler. Ejer-seedet 40 (19/8) — målingen 19/8 fandt n=74, så tærsklen alene ville have gjort gaten grøn; den binder ikke i praksis endnu, men stabilitets-kravet (næste nøgle) gør.'),
  ('market_value_level_correction_stability_band', '0.15'::jsonb,
   '#3449: maks. parvis afstand mellem de seneste 3 ugentlige rullende 30-dages-medianer af pris/anker for den forhandlede kanal. Ejer-seedet ±0,15 (19/8). Målingen 19/8 var 0,665 → 0,775 → 0,908 (spænd 0,243) — over båndet, så gaten står RØD ved seed. Se backend/lib/marketValueLevelCorrectionGate.js.'),
  ('market_value_level_correction_youth_auction_start_rate', 'null'::jsonb,
   '#3449 neutralitets-bundt (a): dræn-neutral override af YOUTH_AUCTION_START_RATE (backend/lib/youthMarket.js). NULL = ingen niveau-korrektion har kørt endnu, banken bruger den hardcodede 0,25 uændret. Skrives KUN af marketValueLevelCorrectionApply.js --confirm-apply, til rate_gammel/c, så bankens kronepriser står stille når riders.market_value skaleres med c.'),
  ('market_value_level_correction_wage_anchor_a', 'null'::jsonb,
   '#3449 neutralitets-bundt (b): løn-neutral A for den anker-baserede lønformel (løn = A × (anker/100.000)^0,55, #3393-reformen — IKKE shippet på denne branch endnu). NULL indtil #3393 lander sin egen A-konfiguration; indtil da er dette ben af neutralitets-bundtet en dokumenteret no-op (se marketValueLevelCorrectionApply.js).')
ON CONFLICT (key) DO NOTHING;

-- Søndags-gate-målingens log — samme claim-FØR-skriv-mønster som
-- market_value_sunday_sweep_log (UNIQUE measured_date forhindrer dobbelt-måling
-- samme danske søndag på tværs af proces-genstarter).
CREATE TABLE IF NOT EXISTS public.market_value_level_correction_gate_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measured_date TEXT NOT NULL,
  n_qualified_90d INT,
  median_price_over_anchor_90d NUMERIC,
  rolling_medians JSONB,
  min_qualified_trades INT,
  stability_band NUMERIC,
  gate_status TEXT,
  gate_reason TEXT,
  gate_reason_text TEXT,
  c_candidate NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (measured_date)
);

ALTER TABLE public.market_value_level_correction_gate_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_value_level_correction_gate_log FROM anon, authenticated;
GRANT ALL ON public.market_value_level_correction_gate_log TO service_role;

COMMENT ON TABLE public.market_value_level_correction_gate_log IS
  '#3449: søndags-måling af niveau-korrektionens gate (forhandlet kanal stabil?). Ren måling — skriver ALDRIG riders.market_value. UNIQUE(measured_date) er dedup-claim mod dobbelt-kørsel samme søndag. gate_status IN (green,red); c_candidate er kun sat når status=green (90-dages-medianen af kvalificeret pris/anker). service-role only.';

-- Apply-log — ÉN række pr. faktisk korrektions-kørsel (dry-run skriver INTET
-- her; kun --confirm-apply gør). Bærer c + begge neutralitets-ben, så "hvad
-- skete der" altid kan slås op uden at grave i Railway-logs.
CREATE TABLE IF NOT EXISTS public.market_value_level_correction_apply_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  c NUMERIC NOT NULL,
  gate_measured_date TEXT,
  population_size INT NOT NULL,
  riders_changed INT NOT NULL,
  total_value_before NUMERIC,
  total_value_after NUMERIC,
  bank_rate_before NUMERIC,
  bank_rate_after NUMERIC,
  wage_a_before NUMERIC,
  wage_a_after NUMERIC,
  wage_leg_applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_by TEXT,
  notes TEXT
);

ALTER TABLE public.market_value_level_correction_apply_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_value_level_correction_apply_log FROM anon, authenticated;
GRANT ALL ON public.market_value_level_correction_apply_log TO service_role;

COMMENT ON TABLE public.market_value_level_correction_apply_log IS
  '#3449: log over faktisk anvendte niveau-korrektioner (kun --confirm-apply-kørsler, aldrig dry-run). wage_leg_applied=false betyder A-benet var en no-op (formel ikke shippet endnu, se wage_a-nøglens app_config-kommentar). service-role only.';

-- Per-rytter-kvittering — grundlaget for #3733 trin 1's to-linje-split på
-- rytterprofilens værdi-sektion. Én række pr. rytter pr. apply-kørsel.
CREATE TABLE IF NOT EXISTS public.market_value_level_correction_rider_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apply_log_id UUID NOT NULL REFERENCES public.market_value_level_correction_apply_log(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  old_value NUMERIC NOT NULL,
  new_value NUMERIC NOT NULL,
  c NUMERIC NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (apply_log_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_market_value_level_correction_rider_receipts_rider
  ON public.market_value_level_correction_rider_receipts (rider_id, applied_at DESC);

ALTER TABLE public.market_value_level_correction_rider_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_value_level_correction_rider_receipts FROM anon;
GRANT ALL ON public.market_value_level_correction_rider_receipts TO service_role;
-- Ejeren af rytteren (nuværende hold) må læse SIN EGEN rytters kvittering —
-- samme "authenticated læser via RLS, service-role skriver" mønster som resten
-- af spillet. Ryttere uden team_id (fri agent/akademi) har ingen manager-læser.
DROP POLICY IF EXISTS market_value_level_correction_rider_receipts_owner_read
  ON public.market_value_level_correction_rider_receipts;
CREATE POLICY market_value_level_correction_rider_receipts_owner_read
  ON public.market_value_level_correction_rider_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      JOIN public.teams t ON t.id = r.team_id
      WHERE r.id = market_value_level_correction_rider_receipts.rider_id
        AND t.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.market_value_level_correction_rider_receipts IS
  '#3733 trin 1: per-rytter kvittering for den globale niveau-korrektion (engangs). Læses af GET /api/riders/:id/level-correction-receipt til rytterprofilens to-linje-split. Kun den seneste række pr. rytter er relevant for UI (frontend henter nyeste via applied_at DESC).';
