-- database/2026-08-06-3138-fairplay-flags.sql
-- #3138 (fair-play epic #3131): fairplay_flags — én række pr. mistænkt hændelse
-- fra det daglige scoring-sweep (backend/lib/fairplayFlagsCron.js). RENT
-- read-only analyse-lag: tabellen ændrer INTET spilbart; den er ejerens
-- review-kø (admin-fladen /admin/fairplay læser den via service_role).
--
-- Dedup-nøgle: (flag_type, team_id_lo, team_id_hi) — det daglige sweep
-- OPDATERER samme række (score/signals/evidence/last_scored_at) i stedet for
-- at oprette dubletter. Rækker med status 'dismissed'/'actioned' røres ALDRIG
-- af sweepet (håndhævet i cron-koden, ikke her — ejerens dom står ved magt).
--
-- Aktiverings-gate: selve TABELLENS eksistens. Cron'en prober tabellen og
-- skipper roligt (log, intet crash) så længe migrationen ikke er applied —
-- ingen separat app_config-flag nødvendig. Tærsklen er dog config-styret
-- (fairplay_flag_threshold nedenfor) så ejeren kan justere følsomhed uden
-- deploy.
--
-- IKKE APPLIED af #3138-sessionen (parallel-session 5-6/8, hård regel:
-- ingen DB-writes). Applies post-merge under #2642-rammerne.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.fairplay_flags;
--   DELETE FROM public.app_config WHERE key = 'fairplay_flag_threshold';

CREATE TABLE IF NOT EXISTS public.fairplay_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'pair_value_flow'  = forbundet identitet ∧ ensidig værdistrøm (#3135-reglen)
  -- 'lifecycle_funnel' = fair-pris-tragten: stor handel + livscyklus-anomalier (#3137)
  flag_type        text NOT NULL CHECK (flag_type IN ('pair_value_flow', 'lifecycle_funnel')),
  team_id_lo       uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  team_id_hi       uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  score            numeric(6,3) NOT NULL,
  -- [{name, strength, weight, contribution}, ...] — de signaler der fyrede
  signals          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- menneskelæsbar evidens (holdnavne, transaktioner, beløb) — se cron-koden
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'dismissed', 'actioned')),
  owner_note       text,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_scored_at   timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fairplay_flags_distinct_teams  CHECK (team_id_lo <> team_id_hi),
  CONSTRAINT fairplay_flags_canonical_order CHECK (team_id_lo < team_id_hi)
);

COMMENT ON TABLE public.fairplay_flags IS
  '#3138 — mistænkte fair-play-hændelser fra det daglige scoring-sweep. Ren review-kø til ejeren (ingen håndhævelse). service_role-only; admin-fladen /admin/fairplay læser via backend.';
COMMENT ON COLUMN public.fairplay_flags.score IS
  'Samlet vægtet score (0–~2.8). Flag oprettes kun over app_config.fairplay_flag_threshold. Formel: værdi-komponent × (identitet + prisafvigelse + livscyklus) — se backend/lib/fairplayScoring.js.';

CREATE UNIQUE INDEX IF NOT EXISTS fairplay_flags_unique_incident
  ON public.fairplay_flags (flag_type, team_id_lo, team_id_hi);

CREATE INDEX IF NOT EXISTS fairplay_flags_status_idx
  ON public.fairplay_flags (status, score DESC);

-- RLS: ingen klient-adgang overhovedet — samme mønster som
-- fairplay_whitelisted_pairs og identity_events. service_role bypasser.
ALTER TABLE public.fairplay_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fairplay_flags_no_client_access" ON public.fairplay_flags;
CREATE POLICY "fairplay_flags_no_client_access" ON public.fairplay_flags
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Tærskel for flag-oprettelse — config-styret så ejeren kan stramme/løsne
-- følsomheden uden deploy (samme mønster som transfer_price_floor_pct, #3133).
-- 0.35 er kalibreret mod de kendte sager: #2221 scorer ~1.6, #2776 ~2.5, og
-- alle 5 kendte lovlige par scorer 0.00–0.22 (se docs/audits/2026-08-06-
-- fairplay-scoring-calibration-3138.md + fairplayScoring.test.js).
INSERT INTO public.app_config (key, value, description)
VALUES
  ('fairplay_flag_threshold', '0.35'::jsonb,
   'Fair-play scoring-tærskel (#3138): mindste samlede score før en mistænkt hændelse skrives til fairplay_flags. Kalibreret mod #2221 (~1.6) og #2776 (~2.5) vs. de 5 kendte lovlige par (0.00–0.22). Kun detektions-følsomhed — ingen håndhævelse.')
ON CONFLICT (key) DO NOTHING;
