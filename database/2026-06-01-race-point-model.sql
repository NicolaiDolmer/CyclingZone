-- R2 (#894 / epic #893): Sammenkædet/relativ point-model med master-kategori.
-- Design: docs/slices/prize-money-audit-r2-design.md
--
-- Model-lag OVENPÅ race_points (som forbliver den materialiserede output-tabel —
-- læse-/import-stien røres ikke). Tre tabeller:
--   race_point_template — per (class,result_type,rank): normaliseret kurveform (weight = points/rank1).
--   race_point_master   — per result_type: master-kategori + rank-1-anker. (ratio_ref/ratio = v1.1 akse-1.)
--   race_point_cascade  — per (class,result_type): faktor vs master (Option B). Master-rækker har factor=1.
--
-- generate: race_points.points = round(factor × anchor × weight) via regenerate_race_points().
-- Seedet fra nuværende race_points reproducerer dagens værdier BIT-FOR-BIT (bevist read-only: 900/900).
--
-- To-master (domæne-bestemt): Klassiker/KlassikerHold → Monuments (endags); resten → TourFrance (etape).
-- Idempotent + transaktionel. ON CONFLICT DO NOTHING bevarer admin-edits ved re-run.

BEGIN;

-- ── Tabeller ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_point_template (
  race_class  TEXT    NOT NULL,
  result_type TEXT    NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank > 0),
  weight      NUMERIC NOT NULL CHECK (weight >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_class, result_type, rank)
);

CREATE TABLE IF NOT EXISTS public.race_point_master (
  result_type  TEXT    PRIMARY KEY,
  master_class TEXT    NOT NULL,
  anchor       NUMERIC NOT NULL CHECK (anchor >= 0),
  ratio_ref    TEXT,             -- v1.1 (akse-1): bind anker til en anden result_type
  ratio        NUMERIC,          -- v1.1: anchor = ratio × master_anchor[ratio_ref]
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.race_point_cascade (
  race_class  TEXT    NOT NULL,
  result_type TEXT    NOT NULL,
  factor      NUMERIC NOT NULL CHECK (factor >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_class, result_type)
);

-- ── RLS: public read, admin-only write (samme mønster som race_points) ───────
ALTER TABLE public.race_point_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_point_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_point_cascade  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read race_point_template" ON public.race_point_template FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read race_point_master" ON public.race_point_master FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Public read race_point_cascade" ON public.race_point_cascade FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Writes går via backend service-role (bypasser RLS) — ingen write-policy for anon/auth.

-- ── Seed fra nuværende race_points (back-compute) ───────────────────────────
-- 1) Templates: weight = points / rank1[class,result_type]
INSERT INTO public.race_point_template (race_class, result_type, rank, weight)
SELECT rp.race_class, rp.result_type, rp.rank, rp.points::numeric / r1.r1
FROM public.race_points rp
JOIN (
  SELECT race_class, result_type, points AS r1
  FROM public.race_points WHERE rank = 1
) r1 ON r1.race_class = rp.race_class AND r1.result_type = rp.result_type
WHERE r1.r1 > 0
ON CONFLICT (race_class, result_type, rank) DO NOTHING;

-- 2) Master-ankre: anchor = master-kategoriens rank-1 for hver result_type
INSERT INTO public.race_point_master (result_type, master_class, anchor)
SELECT DISTINCT rp.result_type,
       CASE WHEN rp.result_type IN ('Klassiker','KlassikerHold') THEN 'Monuments' ELSE 'TourFrance' END AS master_class,
       mr1.points AS anchor
FROM public.race_points rp
JOIN public.race_points mr1
  ON mr1.result_type = rp.result_type
 AND mr1.rank = 1
 AND mr1.race_class = CASE WHEN rp.result_type IN ('Klassiker','KlassikerHold') THEN 'Monuments' ELSE 'TourFrance' END
ON CONFLICT (result_type) DO NOTHING;

-- 3) Kaskade-faktorer: factor = rank1[class,result_type] / master_anchor (master selv = 1)
INSERT INTO public.race_point_cascade (race_class, result_type, factor)
SELECT r1.race_class, r1.result_type, r1.points::numeric / ma.anchor
FROM (
  SELECT race_class, result_type, points
  FROM public.race_points WHERE rank = 1
) r1
JOIN public.race_point_master ma ON ma.result_type = r1.result_type
WHERE ma.anchor > 0
ON CONFLICT (race_class, result_type) DO NOTHING;

-- ── generate(): kaskadér model → race_points, returnér antal ændrede rækker ──
CREATE OR REPLACE FUNCTION public.regenerate_race_points()
RETURNS integer
LANGUAGE plpgsql
-- Forward-guard (#927): hold search_path sat så et re-run ikke regrederer
-- advisor 0011-hærdningen fra phase-b.
SET search_path = public, pg_catalog
AS $$
DECLARE
  changed_count integer;
BEGIN
  WITH computed AS (
    SELECT t.race_class, t.result_type, t.rank,
           round(c.factor * m.anchor * t.weight)::int AS new_points
    FROM public.race_point_template t
    JOIN public.race_point_cascade c
      ON c.race_class = t.race_class AND c.result_type = t.result_type
    JOIN public.race_point_master m ON m.result_type = t.result_type
  ),
  upd AS (
    UPDATE public.race_points rp
    SET points = computed.new_points, updated_at = NOW()
    FROM computed
    WHERE rp.race_class = computed.race_class
      AND rp.result_type = computed.result_type
      AND rp.rank = computed.rank
      AND rp.points <> computed.new_points
    RETURNING 1
  )
  SELECT count(*) INTO changed_count FROM upd;
  RETURN changed_count;
END;
$$;

COMMIT;
