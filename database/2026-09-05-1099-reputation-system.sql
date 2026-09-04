-- #1099 · Omdømme-system: hændelsesbog + rytter-/klub-kolonner.
-- Spec: docs/superpowers/specs/2026-09-04-reputation-system-design.md §5.
--
-- HVORFOR EGEN TABEL og ikke rider_career_events (#3398/#2490):
--   rider_career_events er en MILEPÆLS-krønike — "første sejr", "50. sejr i
--   klubfarver" — med én række pr. rytter pr. milepæl og en significance-score
--   der driver notifikationer og krønike-flader. Omdømmet skriver en række pr.
--   top-10-placering, per etape: en afspilning af de tre nuværende sæsoner
--   giver ~42.000 rækker, og en fuld sæson lægger ~15.000 til. At blande dem
--   ind i krøniken ville drukne milepælene og gøre enhver krønike-forespørgsel
--   dyrere for evigt. To tabeller, to formål.
--
-- HVORFOR EN BOG og ikke bare et tal på riders:
--   Omdømmet skal kunne FORKLARES ("hvorfor-liste" på profilen, spec §7.3) og
--   halveres pr. sæsonskifte uden at tabe karriere-gulvet. Begge dele kræver de
--   enkelte hændelser; et akkumuleret tal kan hverken forklares eller
--   genberegnes efter en kalibrering.
--
-- Idempotent (IF NOT EXISTS overalt). INGEN data-skrivning: tabellen fyldes af
-- backend/scripts/reputation-backfill.js (--apply --owner-go, ejer-gated) og af
-- løbsafslutningen når app_config.rider_reputation_enabled står på
-- 'shadow'/'on'. Default er 'off', så denne migration ændrer INTET spilbart i
-- sig selv. Ingen destruktiv klasse. Applies af CI ved merge (auto-migrate.yml).
--
-- Post-verify:
--   SELECT count(*) FROM public.rider_reputation_events;          -- forventet 0
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'riders' AND column_name LIKE 'reputation%';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'teams' AND column_name LIKE 'reputation%';
--   SELECT value FROM public.app_config WHERE key = 'rider_reputation_enabled';

-- ── Hændelsesbog ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rider_reputation_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  race_id       UUID REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number  INTEGER,
  season_id     UUID REFERENCES public.seasons(id) ON DELETE SET NULL,
  event_kind    TEXT NOT NULL,
  race_class    TEXT,
  form_points   NUMERIC NOT NULL DEFAULT 0,
  floor_credit  NUMERIC NOT NULL DEFAULT 0,
  occurred_at   TIMESTAMPTZ,
  dedupe_key    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotens-ankeret: en gen-finalisering af samme etape må ALDRIG dublere
-- point. dedupe_key = rider:<rider_id>:race:<race_id>:stage:<n>:<event_kind>.
-- Skriveren (reputationPersist.js) behandler 23505 som "allerede registreret".
CREATE UNIQUE INDEX IF NOT EXISTS idx_rider_reputation_events_dedupe
  ON public.rider_reputation_events (dedupe_key);

-- "Hele denne rytters bog" — den eneste læsesti i genberegningen og i
-- profilens hvorfor-liste.
CREATE INDEX IF NOT EXISTS idx_rider_reputation_events_rider
  ON public.rider_reputation_events (rider_id);

-- "Alle hændelser i sæson N" — natlig shadow-audit (PR 2) og
-- kalibrerings-rapporten.
CREATE INDEX IF NOT EXISTS idx_rider_reputation_events_season
  ON public.rider_reputation_events (season_id);

COMMENT ON TABLE public.rider_reputation_events IS
  '#1099 omdoemme-haendelsesbog: en raekke pr. (rytter, loeb, etape, haendelsestype). form_points falmer pr. saeson, floor_credit gaar i karriere-gulvet og falder aldrig.';

-- ── RLS: bogen er offentligt LÆSBAR, kun service_role skriver ───────────────
-- Samme forhold som race_results: hændelserne ER offentlige resultater set fra
-- en anden vinkel. Ingen spiller-skrivning: kun løbsafslutningen (service_role)
-- og backfill-scriptet må skrive.
ALTER TABLE public.rider_reputation_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rider_reputation_events'
      AND policyname = 'rider_reputation_events_read'
  ) THEN
    CREATE POLICY rider_reputation_events_read
      ON public.rider_reputation_events
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── riders: rytterens tal (spec §3) ─────────────────────────────────────────
-- Additive, nullable kolonner. NULL betyder "aldrig beregnet" — bevidst
-- forskelligt fra 0 ("beregnet, ingen omdømme"), så shadow-fasens dækning kan
-- måles. popularity røres IKKE: den bevares som "ry ved ankomst" (seedFloor).
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS reputation NUMERIC,
  ADD COLUMN IF NOT EXISTS reputation_floor NUMERIC,
  ADD COLUMN IF NOT EXISTS reputation_form NUMERIC,
  ADD COLUMN IF NOT EXISTS reputation_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.riders.reputation IS
  '#1099: clamp(reputation_floor + reputation_form, 0, 100). NULL = endnu ikke beregnet.';
COMMENT ON COLUMN public.riders.reputation_floor IS
  '#1099 karriere-gulv: clamp(seedFloor + sum(floor_credit), 0, 60). Falder aldrig.';
COMMENT ON COLUMN public.riders.reputation_form IS
  '#1099 form: sum(form_points * 0.5^saesoner-siden). Halveres ved hvert saesonskifte.';

-- Marked, auktion og bestyrelse sorterer/filtrerer paa tallet (PR 3+).
CREATE INDEX IF NOT EXISTS idx_riders_reputation
  ON public.riders (reputation)
  WHERE reputation IS NOT NULL;

-- ── teams: klub-omdømme (spec §6, fyldes først i PR 4) ──────────────────────
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS reputation NUMERIC,
  ADD COLUMN IF NOT EXISTS reputation_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.teams.reputation IS
  '#1099 klub-omdoemme: 0.7*mean(top-8 rytter-omdoemme) + 0.3*resultsScore*100. Fyldes af soendags-sweepet i PR 4; sponsor-multiplieren laeser fortsat renown-proxy''en.';

-- ── Flag (spec §8): off → shadow → on. Default off. ─────────────────────────
INSERT INTO public.app_config (key, value, description)
VALUES (
  'rider_reputation_enabled',
  to_jsonb('off'::text),
  '#1099 omdoemme: off = intet beregnes/skrives; shadow = beregnes + skrives ved loebsafslutning, ingen forbruger laeser; on = forbrugerne laeser tallet.'
)
ON CONFLICT (key) DO NOTHING;
