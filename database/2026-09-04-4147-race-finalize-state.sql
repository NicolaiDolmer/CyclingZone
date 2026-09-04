-- [#4147] Genoptagelig løbs-afslutning — trin-markering på races.
--
-- Baggrund: afslutningen af en etape er en kæde af skrivninger (write → standings →
-- matview → enrichment → fatigue → rest-day → board → notify → status-flush), ikke én
-- handling. Dræbes processen midtvejs (SIGTERM ved deploy, OOM, statement timeout) er
-- de trin der nåede at køre committet, og resten sker aldrig — uden at nogen opdager
-- det. Målt i prod 4/9: 34 etaper med skrevne race_results men INGEN
-- race_simulation_runs-række (enrichment-trinnet nåede aldrig at køre).
--
-- races.finalize_state (jsonb): hvilke trin der er FÆRDIGE for præcis den etape der
--   afsluttes lige nu. NULL = ingen igangværende afslutning (den eneste tilstand et
--   sundt løb hviler i — både før første etape og efter sidste). Form:
--     { "stage_index": 4, "stage_number": 5, "final": true,
--       "started_at": "2026-09-04T18:00:00.000Z",
--       "done": ["write","standings","matview"] }
--   Kontrakten (hvilke trin, og hvorfor nogle markeres efter FORSØG frem for succes)
--   står i backend/lib/raceFinalizeState.js.
--
-- races.finalize_updated_at (timestamptz): hvornår markeringen sidst blev flyttet.
--   Egen kolonne (ikke et felt inde i jsonb'en) netop så vagten kan spørge indekseret:
--   "findes der et løb der har stået stille midt i afslutningen i over 10 minutter?"
--
-- Additiv og idempotent: ingen eksisterende kolonne røres, ingen data flyttes, ingen
-- default på eksisterende rækker (NULL = ingen igangværende afslutning, hvilket er
-- sandt for hvert eneste løb i dag). Skrivningen er desuden gated bag app_config-
-- flaget race_finalize_resumable_enabled, som denne migration IKKE tænder.
--
-- Applies af CI (auto-migrate.yml) ved merge. Post-verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'races' AND column_name IN ('finalize_state','finalize_updated_at');
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_races_finalize_in_progress';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS finalize_state jsonb;

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS finalize_updated_at timestamptz;

COMMENT ON COLUMN public.races.finalize_state IS
  '#4147: hvilke afslutnings-trin der er færdige for den etape der finaliseres nu. NULL = ingen igangværende afslutning. Kontrakt: backend/lib/raceFinalizeState.js';
COMMENT ON COLUMN public.races.finalize_updated_at IS
  '#4147: hvornår finalize_state sidst blev flyttet. Driver halv-finaliserings-vagten (backend/lib/raceFinalizeWatch.js).';

-- Partial index: vagten kører hvert 15. minut og spørger KUN efter løb med en
-- igangværende afslutning. Uden prædikatet ville den scanne hele races-tabellen for
-- at finde de 0-2 rækker der typisk er non-null; med det er indekset nærmest tomt.
CREATE INDEX IF NOT EXISTS idx_races_finalize_in_progress
  ON public.races (finalize_updated_at)
  WHERE finalize_state IS NOT NULL;
