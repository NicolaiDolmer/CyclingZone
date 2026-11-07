-- #7879 (del af #7824): talentmærker ved rytternavne, Toptalent og Næste generation.
--
-- Tre additive dele, alle idempotente:
--   1. Beta-kontakten talent_marks_7879 (startstadie off). Off = intet synligt, og
--      den daglige beregning kører ikke. Ejeren flytter den fra admin-fladen.
--   2. Tabellen rider_talent_marks: dagens mærker, én række pr. rytter der har et.
--      Kun visning. Motoren, værdien, bestyrelsen og økonomien læser den ikke.
--   3. Funktionen talent_marks_junior_gains: summen af juniorernes daglige
--      fremgang i de synlige evnebjælker over et vindue. Den daglige beregning
--      (backend/lib/talentMarks7879.js) kalder den med service-rollen.
--
-- Mærkerne bygger kun på tal, andre managere allerede kan se: rating og de synlige
-- evner. Aldrig potentiale, aldrig skjult talent. Funktionen læser kun de synlige
-- evner, som historikken gemmer (dailyTrainingEngine skriver kun VISIBLE_ABILITIES).

-- ── 1) Beta-kontakten ────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description)
VALUES (
  'talent_marks_7879',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for talent marks beside rider names (#7879): Top Talent (best rating per rider type, under 23) and Next Gen (most progress in the ability bars among juniors, last 30 days). Display only. Off = nothing visible and the daily calculation does not run.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2) Dagens mærker ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rider_talent_marks (
  rider_id      UUID PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  mark          TEXT NOT NULL CHECK (mark IN ('top_talent', 'next_gen')),
  rider_type    TEXT,                        -- ryttertypen Toptalent er målt inden for
  season_number INTEGER,
  computed_on   DATE NOT NULL,               -- dansk kalenderdag for beregningen
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rider_talent_marks IS
  '#7879: dagens talentmærker (top_talent | next_gen), højst ét pr. rytter. Skrives dagligt af '
  'backend/lib/talentMarks7879.js, når talent_marks_7879 ikke er off. Kun visning.';

-- Læses af alle indloggede: mærket er offentligt og bygger kun på offentlige tal.
-- Kun service-rollen skriver.
ALTER TABLE public.rider_talent_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_talent_marks_select_authenticated" ON public.rider_talent_marks;
CREATE POLICY "rider_talent_marks_select_authenticated"
  ON public.rider_talent_marks FOR SELECT TO authenticated USING (true);

BEGIN;
REVOKE ALL ON public.rider_talent_marks FROM anon, authenticated;
GRANT SELECT ON public.rider_talent_marks TO authenticated;
COMMIT;

-- ── 3) Juniorernes fremgang i et vindue ──────────────────────────────────────
-- En historik-række er evnevektoren EFTER dagens gevinst. Dagens fremgang er derfor
-- forskellen til rytterens forrige række, uanset kilde, så et sæsonskifte eller en
-- baseline aldrig tæller som fremgang. Kun nøgler med tal i begge rækker tæller.
-- Ved samme dato sorteres kilderne som i proRiderHistory.compareHistoryRows.
CREATE OR REPLACE FUNCTION public.talent_marks_junior_gains(
  p_rider_ids     UUID[],
  p_window_start  DATE,
  p_recent_start  DATE
)
RETURNS TABLE (rider_id UUID, gain_window NUMERIC, gain_recent NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH h AS (
    SELECT x.rider_id, x.snapshot_date, x.source, x.abilities,
           LAG(x.abilities) OVER (
             PARTITION BY x.rider_id
             ORDER BY x.snapshot_date,
                      CASE x.source WHEN 'baseline' THEN 1 WHEN 'season_transition' THEN 2 ELSE 3 END,
                      x.id
           ) AS prev
    FROM public.rider_derived_ability_history x
    WHERE x.rider_id = ANY (p_rider_ids)
  ),
  g AS (
    SELECT h.rider_id, h.snapshot_date,
           (SELECT COALESCE(SUM((e.value)::NUMERIC - (h.prev ->> e.key)::NUMERIC), 0)
              FROM jsonb_each_text(h.abilities) e
             WHERE jsonb_typeof(h.abilities -> e.key) = 'number'
               AND jsonb_typeof(h.prev -> e.key) = 'number') AS gain
    FROM h
    WHERE h.source = 'daily_training'
      AND h.prev IS NOT NULL
      AND h.snapshot_date >= p_window_start
  )
  SELECT g.rider_id,
         SUM(g.gain) AS gain_window,
         COALESCE(SUM(g.gain) FILTER (WHERE g.snapshot_date >= p_recent_start), 0) AS gain_recent
  FROM g
  GROUP BY g.rider_id;
$$;

COMMENT ON FUNCTION public.talent_marks_junior_gains(UUID[], DATE, DATE) IS
  '#7879: juniorernes summerede fremgang i de synlige evner fra p_window_start og fra '
  'p_recent_start. Kaldes kun af service-rollen (historikken er RLS-lukket).';

-- Historikken er service-only, så funktionen er det også.
BEGIN;
REVOKE ALL ON FUNCTION public.talent_marks_junior_gains(UUID[], DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.talent_marks_junior_gains(UUID[], DATE, DATE) TO service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';
