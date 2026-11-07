-- #7824: mestertrøjer ved rytternavne. Verdensmester, U23-verdensmester,
-- kontinentmestre og nationale mestre, regnet ud fra sidste sæsons rangliste.
--
-- Applies af auto-migrate.yml ved merge (#2642). Claude post-verificerer.
-- To additive dele, begge idempotente:
--   1. Beta-kontakten champion_jerseys_7824 (startstadie off). Off = intet synligt,
--      og beregningen kører ikke. Ejeren flytter den fra admin-fladen.
--   2. Tabellen rider_champion_titles: titlerne pr. sæson, én række pr. titel og
--      område. Skrives af backend/lib/championTitles7824.js (service-rollen), én
--      gang pr. sæson: kørslen tjekker hver time, om sæsonen efter den seneste
--      afsluttede sæson har sine titler, og regner dem ellers. Første kørsel efter
--      at kontakten er tændt er engangsberegningen for den igangværende sæson.
--
-- Kun visning. Motoren, værdien, bestyrelsen og økonomien læser ikke tabellen.
-- Titlerne bygger kun på ranglisten, som alle managere allerede kan se.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.rider_champion_titles;
--   DELETE FROM public.app_config WHERE key = 'champion_jerseys_7824';

-- ── 1) Beta-kontakten ────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description)
VALUES (
  'champion_jerseys_7824',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for champion jerseys beside rider names (#7824): world, U23 world, continental and national champion from last season''s ranking. Display only. Off = nothing visible and the season calculation does not run.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2) Titlerne pr. sæson ────────────────────────────────────────────────────
-- Læses af alle indloggede: titlen er offentlig og bygger kun på ranglisten.
-- Kun service-rollen skriver (docs/DATA_API_GRANTS.md, database/templates/new-public-table.sql).
-- data-api-access: {"table":"public.rider_champion_titles","roles":{"anon":[],"authenticated":["SELECT"],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Public champion jerseys beside rider names; the backend writes them once per season"}
BEGIN;
CREATE TABLE IF NOT EXISTS public.rider_champion_titles (
  season_number    INTEGER NOT NULL,          -- sæsonen titlen bæres i
  title            TEXT NOT NULL CHECK (title IN ('world', 'u23_world', 'continent', 'national')),
  scope            TEXT NOT NULL DEFAULT '',  -- '' for verden/U23, countries.continent, eller iso2
  rider_id         UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  source_season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  points           NUMERIC NOT NULL DEFAULT 0, -- ranglistepoint i kildesæsonen
  basis            TEXT CHECK (basis IS NULL OR basis IN ('u23_ranking', 'world_ranking')),
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_number, title, scope)
);

CREATE INDEX IF NOT EXISTS rider_champion_titles_rider_idx
  ON public.rider_champion_titles (rider_id);

COMMENT ON TABLE public.rider_champion_titles IS
  '#7824: mestertitler pr. sæson (world | u23_world | continent | national), regnet ud fra '
  'den forrige sæsons rangliste af backend/lib/championTitles7824.js, når champion_jerseys_7824 '
  'ikke er off. Kun visning.';

ALTER TABLE public.rider_champion_titles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_champion_titles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.rider_champion_titles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rider_champion_titles TO service_role;
DROP POLICY IF EXISTS rider_champion_titles_select_authenticated ON public.rider_champion_titles;
CREATE POLICY rider_champion_titles_select_authenticated
  ON public.rider_champion_titles FOR SELECT TO authenticated USING (true);
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Post-merge verifikation (read-only, køres af Claude efter auto-migrate) ──
-- V1. Kontakten står off:
--   SELECT value FROM public.app_config WHERE key = 'champion_jerseys_7824';
-- V2. Grants (forvent authenticated=r og ingen anon):
--   SELECT array_to_string(c.relacl, '|') FROM pg_class c
--   WHERE c.oid = 'public.rider_champion_titles'::regclass;
-- V3. Tom tabel indtil kontakten tændes: SELECT count(*) FROM public.rider_champion_titles;
-- V4. get_advisors(type: 'security'): ingen nye fund.
