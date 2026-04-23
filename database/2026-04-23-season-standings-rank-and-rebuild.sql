ALTER TABLE public.season_standings
  ADD COLUMN IF NOT EXISTS rank_in_division INTEGER;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY season_id, division
      ORDER BY total_points DESC, id ASC
    ) AS rank_in_division
  FROM public.season_standings
)
UPDATE public.season_standings AS standings
SET rank_in_division = ranked.rank_in_division
FROM ranked
WHERE ranked.id = standings.id;
