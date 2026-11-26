-- #7471 (owner decisions 2026-11-26): the youth calendars become MINI EDITIONS of the
-- senior races. One U23 and one junior row per active senior race in the Division 1
-- classes (Grand Tours, Monuments, World Tour A/B/C).
--
-- Each mini row keeps the senior race's name with the level appended, its class, type,
-- terrain, race identity, signature and authored route. Stage counts follow the owner's
-- rule (mini Grand Tours: U23 7, junior 4; other stage races shortened; one-day races 1).
-- The shorter distance is applied when the stages are generated (youthMiniEditions7471.js),
-- so the stored route stays the senior's and no JSON is rewritten here.
--
-- Idempotent: stable ids (md5 of '7471:<squad>:<senior id>') and ON CONFLICT (external_id)
-- DO NOTHING. Additive only: no senior row and no existing youth row is touched.
-- The rules are mirrored in backend/lib/youthMiniEditions7471.js; its test keeps them equal.
-- Applied post-merge (auto-migrate.yml). Writing the S6 youth calendar is a separate,
-- owner-gated step (buildSeasonCalendar --squad u23|junior --apply).

BEGIN;

INSERT INTO public.race_pool (
  id, external_id, name, race_class, race_type, stages, date_text, country,
  terrain_archetype, race_identity_type, signature, authored_route, retired_at, squad
)
SELECT
  md5('7471:' || lvl.squad || ':' || rp.id::text)::uuid,
  lvl.prefix || rp.external_id,
  rp.name || ' ' || lvl.label,
  rp.race_class,
  rp.race_type,
  CASE
    WHEN rp.race_type <> 'stage_race' THEN 1
    WHEN rp.race_class IN ('TourFrance', 'GiroVuelta') OR rp.terrain_archetype = 'grand_tour' THEN lvl.gt_stages
    ELSE LEAST(GREATEST(COALESCE(rp.stages, 2), 2),
               GREATEST(3, CEIL(GREATEST(COALESCE(rp.stages, 2), 2)::numeric / lvl.divisor)::int))
  END,
  rp.date_text,
  rp.country,
  rp.terrain_archetype,
  rp.race_identity_type,
  rp.signature,
  rp.authored_route,
  NULL,
  lvl.squad
FROM public.race_pool rp
CROSS JOIN (VALUES
  ('u23',    'u23-mini-', 'U23',    7, 2),
  ('junior', 'jun-mini-', 'Junior', 4, 3)
) AS lvl(squad, prefix, label, gt_stages, divisor)
WHERE COALESCE(rp.squad, 'senior') = 'senior'
  AND rp.retired_at IS NULL
  AND rp.external_id IS NOT NULL
  AND rp.race_class IN ('TourFrance', 'GiroVuelta', 'Monuments', 'OtherWorldTourA', 'OtherWorldTourB', 'OtherWorldTourC')
ON CONFLICT (external_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
