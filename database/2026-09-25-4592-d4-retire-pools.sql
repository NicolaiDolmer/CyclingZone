-- #5642 (epik #4592) · S4-struktur spor A2: D4 fra 8 til 4 puljer.
-- Spec: docs/drafts/spec-s4-struktur-2026-09-24.md afsnit A2. Ejer 24/9: pyramide
-- 1/2/4/4, D4 med AI fra dag ét.
--
-- HVAD DEN GØR (additivt og idempotent, ingen række mutteres)
--   1) league_divisions.retired_at TIMESTAMPTZ NULL. En pensioneret pulje kan ikke
--      slettes (teams, season_standings og races peger på den med FK, også
--      historisk), så den markeres i stedet. NULL = aktiv pulje.
--   2) plan_ai_pool_retirements (fra 2026-09-09-4753-ai-pool-retirement.sql) får to
--      nye regler for puljens mål-størrelse:
--        • pensioneret pulje (retired_at IS NOT NULL) → mål 0: alle AI-hold i den
--          er overskud og kan nedlægges med retire_ai_pool_team.
--        • aktiv tier 4-pulje → mål 24 (= 24 minus menneskehold i AI-pladser), også
--          uden ægte managers. D4 er bunden, hvor nye managers og comebacks lander,
--          og den skal have løb fra dag ét. Før var målet 0 uden ægte managers.
--      Tier 1/2 og tier 3 er uændrede. Samme politik som
--      backend/lib/aiTeamGenerator.js targetAiCountForPool.
--
-- HVAD DEN BEVIDST IKKE GØR
--   • Pensionerer INGEN puljer. At sætte retired_at på D4 E-H er ejer-gated og sker
--     i backend/scripts/retireD4PoolsS4.js (--apply --owner-go), EFTER at AI-holdene
--     er flyttet til D4 A-D. Efter denne migration har ingen pulje retired_at, så
--     planen giver samme resultat som før for alle puljer med ægte managers.
--   • Ændrer ingen grants: CREATE OR REPLACE bevarer dem; de gentages nedenfor, så
--     filen også er korrekt på en database hvor funktionen oprettes første gang.
BEGIN;

ALTER TABLE public.league_divisions ADD COLUMN IF NOT EXISTS retired_at timestamptz NULL;

COMMENT ON COLUMN public.league_divisions.retired_at IS
  'Tidspunkt hvor puljen blev pensioneret (#5642, S4: D4 E-H). NULL = aktiv. En pensioneret pulje får ingen AI, ingen nye hold og ingen kalender; historikken peger stadig på den.';

CREATE OR REPLACE FUNCTION public.plan_ai_pool_retirements(p_pool_id bigint, p_now timestamptz DEFAULT now())
RETURNS TABLE(team_id uuid, team_name text, pool_id bigint, pool_label text,
  teams_now bigint, target_size int, reason text, pending_since timestamptz, blocked_since timestamptz,
  riders_count bigint, offers_preserved bigint, future_entries_removed bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH population AS (
    SELECT d.id,d.label,
      count(t.id) FILTER (WHERE NOT coalesce(t.is_bank,false)) AS n,
      -- #5642: pensioneret → 0; aktiv tier 4 → altid fyld (som tier 1/2);
      -- tier 3 kun med mindst én ægte manager (uændret, #1688).
      CASE WHEN d.retired_at IS NOT NULL THEN 0
        WHEN d.tier<=2 OR d.tier=4 OR count(t.id) FILTER (WHERE t.is_ai=false
        AND NOT coalesce(t.is_bank,false) AND NOT coalesce(t.is_frozen,false)
        AND NOT coalesce(t.is_test_account,false))>0 THEN 24 ELSE 0 END AS target
    FROM public.league_divisions d LEFT JOIN public.teams t ON t.league_division_id=d.id
    WHERE d.id=p_pool_id GROUP BY d.id,d.label,d.tier,d.retired_at
  ), candidates AS (
    SELECT t.*,public.ai_team_retirement_reason(t.id) AS block_reason
    FROM public.teams t WHERE t.league_division_id=p_pool_id AND t.is_ai=true
      AND NOT coalesce(t.is_bank,false) AND NOT coalesce(t.is_frozen,false)
      AND NOT coalesce(t.is_test_account,false) AND t.user_id IS NULL AND t.retired_at IS NULL
  )
  SELECT t.id,t.name,p.id,p.label,p.n,p.target,t.block_reason,t.pending_removal_at,t.pending_removal_blocked_since,
    (SELECT count(*) FROM public.riders WHERE team_id=t.id),
    (SELECT count(*) FROM public.transfer_offers o WHERE o.seller_team_id=t.id OR o.buyer_team_id=t.id
      OR o.rider_id IN (SELECT id FROM public.riders WHERE team_id=t.id)),
    (SELECT count(*) FROM public.race_entries e JOIN public.races r ON r.id=e.race_id
      WHERE (e.team_id=t.id OR e.rider_id IN (SELECT id FROM public.riders WHERE team_id=t.id))
      AND r.status='scheduled' AND r.stages_completed=0
      AND NOT EXISTS (SELECT 1 FROM public.race_stage_claims c WHERE c.race_id=r.id))
  FROM candidates t CROSS JOIN population p
  -- Owner 9/9: preserve normal reservations; after 120h of the SAME blocker,
  -- an unblocked candidate may replace it. Never rotate one blocked team for
  -- another, or inherit an old blocker's clock for a newly changed obligation.
  ORDER BY (t.pending_removal_at IS NOT NULL AND NOT
    (t.block_reason IS NOT NULL AND t.pending_removal_blocked_reason IS NOT DISTINCT FROM t.block_reason
      AND coalesce(t.pending_removal_blocked_since,t.pending_removal_at)<=p_now-interval '120 hours')) DESC,
    (t.block_reason IS NOT NULL),(t.pending_removal_at IS NULL),t.pending_removal_at,t.id
  LIMIT (SELECT greatest(0,n-target) FROM population);
$$;

REVOKE ALL ON FUNCTION public.plan_ai_pool_retirements(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.plan_ai_pool_retirements(bigint,timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
