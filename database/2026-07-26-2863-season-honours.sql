-- #2863 — Sæsonens bedste ryttere: flest point + flest sejre.
--
-- BAGGRUND
--   Spiller-ønske i #questions-and-answers 23/7, ejer-bekræftet med hans egen
--   model: "'in the old days' the rider with the most points became world
--   champion. And the rider with the most victories became European champion."
--
-- NAVNGIVNING — EJER-BESLUTNING 26/7: fladen hedder "flest point" / "flest
--   sejre", IKKE verdensmester/europamester. #934 (landshold + internationale
--   mesterskaber) og #266 (mestertrøjer) bygger VM og EM som rigtige løb, og
--   bruger vi navnene her, står vi den dag med to forskellige "verdensmestre" i
--   samme sæson. Retningen er asymmetrisk: en beskrivende label kan opgraderes
--   til en titel senere, men en titel kan ikke tages tilbage fra sæson 1's
--   vinder efter spillerne har set den. Funktionen returnerer derfor rå tal og
--   navngiver ingenting; al copy bor i seasonEnd-namespacet.
--
-- DETTE ER EN VISNING, IKKE ET MOTOR-TRIN.
--   Optællingen sker udelukkende ud fra data der allerede findes efter
--   sæsonslut. Intet i seasonTransition.js / economyEngine.js / processSeasonEnd
--   er rørt, og funktionen kaldes ikke af nogen cron eller sweep. Den kan
--   applies FØR eller EFTER cutoveren uden at ændre hvad cutoveren gør.
--
-- APPLY-REKKEFØLGE — EJER-BESLUTNING 26/7: ejeren kører selv denne migration
--   EFTER merge OG EFTER cutoveren søndag aften. Det er bevidst, ikke en
--   forglemmelse: listerne giver først mening når sæsonen er lukket og sidste
--   løbsdag er talt med. Kør den ikke i forvejen. Indtil den er kørt svarer
--   PostgREST PGRST202, og /seasons udelader blokken helt (se
--   frontend/src/lib/seasonHonours.js: isMissingFunctionError).
--
-- HVOR TALLENE KOMMER FRA
--   rider_rankings_mv (#2175) — det samme færdig-aggregerede matview som
--   /rider-rankings har vist spilleren hele sæsonen. Det er hele pointen med at
--   læse derfra og ikke fra race_results: optællingen SKAL matche den rangliste
--   spillerne har fulgt, ellers ser tallene ud til at komme fra et andet
--   regnestykke end det de kunne se.
--     · points = SUM(points_earned) over sæsonens race_results
--     · wins   = stage + gc + classic + pts + mtn + young  (#925's total_wins,
--                samme seks kategorier som "Sejre i alt"-kolonnen på
--                ranglisten — se frontend/src/hooks/useRiderRankings.js:20)
--
-- TIE-BREAK (ikke teoretisk: sæson 1 HAR en 28-28-deling på sejre)
--   points-listen: points DESC, lastname ASC, rider_id ASC
--   wins-listen:   wins DESC, points DESC, lastname ASC, rider_id ASC
--   rider_id som sidste led gør rækkefølgen deterministisk, så to kald i træk
--   ikke kan bytte om på to ellers identiske ryttere.
--
-- INGEN is_ai-FILTER — EJER-BESLUTNING 26/7, truffet på de faktiske sæson-1-tal.
--   AI-ejede ryttere tæller med på lige fod, samme valg som stage-king-kortet på
--   samme side traf i #2891 ("det ville være en gameplay-ændring forklædt som
--   noget andet"). En rytter er en rytter. Konsekvensen er kendt og accepteret:
--   sæson 1's pointliste toppes af en AI-ejet rytter (Cooper Doyle, 8.844 mod
--   4.595). Klienten får is_ai med, så UI'et sætter AI-badget på og læseren ser
--   det med det samme.
--   Tilføj IKKE et is_ai-filter her uden en ny ejer-beslutning: det ville
--   tavst ændre hvem der står øverst på en flade spillerne allerede har set.
--   Pensionerede ryttere falder ud (join'et på is_retired IS NOT TRUE) —
--   præcis som ranglisten allerede gør.
--
-- YDELSE (EXPLAIN ANALYZE mod prod 26/7, sæson 1, read-only)
--   Execution Time: 17,3 ms · Planning Time: 2,3 ms · Buffers: 463 shared hit,
--   0 read. Payload 2.575 bytes. To top-N heapsorts over 5.736 mv-rækker, ingen
--   OFFSET-paginering, ingen N+1, ét round-trip. Til sammenligning kostede den
--   klient-side vej (fetchAllRows over rider_rankings_mv + hele riders-tabellen,
--   som /rider-rankings bruger) 6+11 sider a 1000 rækker.
--
-- SECURITY INVOKER (default) er valgt bevidst: rider_rankings_mv, riders og
--   teams har alle simple "Public read"-policies, så funktionen kan køre med
--   kalderens egne rettigheder. Ingen ny SECURITY DEFINER-flade at forsvare —
--   samme valg som get_season_recap (#2891), jf. advisor 0028/0029 og #2858.
--
-- IDEMPOTENT: CREATE OR REPLACE + REVOKE/GRANT kan køres igen uden effekt.
-- Rollback: DROP FUNCTION IF EXISTS public.get_season_honours(uuid);

CREATE OR REPLACE FUNCTION public.get_season_honours(p_season_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH ranked AS (
    SELECT
      m.rider_id,
      m.points::bigint AS points,
      (m.stage_wins + m.gc_wins + m.classic_wins
        + m.pts_wins + m.mtn_wins + m.young_wins)::bigint AS wins,
      ri.firstname,
      ri.lastname,
      ri.nationality_code,
      ri.team_id,
      t.name AS team_name,
      COALESCE(t.is_ai, false) AS is_ai
    FROM rider_rankings_mv m
    JOIN riders ri
      ON ri.id = m.rider_id
     AND ri.is_retired IS NOT TRUE
    LEFT JOIN teams t
      ON t.id = ri.team_id
    WHERE m.season_id = p_season_id
  ),
  by_points AS (
    SELECT * FROM ranked
    ORDER BY points DESC, lastname ASC, rider_id ASC
    LIMIT 5
  ),
  by_wins AS (
    SELECT * FROM ranked
    ORDER BY wins DESC, points DESC, lastname ASC, rider_id ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'points', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.points DESC, p.lastname ASC, p.rider_id ASC)
      FROM by_points p
    ), '[]'::jsonb),
    'wins', COALESCE((
      SELECT jsonb_agg(to_jsonb(w) ORDER BY w.wins DESC, w.points DESC, w.lastname ASC, w.rider_id ASC)
      FROM by_wins w
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.get_season_honours(uuid) IS
  '#2863 · Sæsonens bedste ryttere på /seasons. Top 5 efter point og top 5 '
  'efter sejre, læst fra rider_rankings_mv så tallene matcher rytter-ranglisten '
  '1:1. AI-ejede ryttere tæller med (ejer-beslutning 26/7). Ren visning: ingen '
  'del af sæsonskiftet kalder den. ~17 ms mod sæson 1 i prod.';

-- Samme grant-form som get_season_recap: siden kalder RPC'en direkte fra
-- browseren med anon/authenticated-nøglen.
REVOKE ALL ON FUNCTION public.get_season_honours(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_honours(uuid) TO anon, authenticated, service_role;

-- PostgREST schema-cache reload, så RPC'en er kaldbar umiddelbart efter apply.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Post-verify (kør manuelt efter apply)
-- =============================================================================
--
-- 1) Funktionen findes og er SECURITY INVOKER (prosecdef = false):
--    SELECT proname, prosecdef, provolatile
--    FROM pg_proc WHERE proname = 'get_season_honours';
--    → forventet: get_season_honours | false | s
--
-- 2) Begge lister kommer med, og hver har højst 5 rækker:
--    WITH v AS (SELECT public.get_season_honours(
--                 (SELECT id FROM seasons WHERE number = 1)) AS j)
--    SELECT jsonb_array_length(j->'points') AS n_points,
--           jsonb_array_length(j->'wins')   AS n_wins
--    FROM v;
--    → forventet: 5 | 5
--
-- 3) Paritet mod ranglistens egen definition (samme mv, samme seks
--    sejrs-kategorier). Vinderne skal være identiske med:
--    SELECT ri.firstname, ri.lastname, m.points
--    FROM rider_rankings_mv m
--    JOIN riders ri ON ri.id = m.rider_id AND ri.is_retired IS NOT TRUE
--    WHERE m.season_id = (SELECT id FROM seasons WHERE number = 1)
--    ORDER BY m.points DESC, ri.lastname ASC, m.rider_id ASC LIMIT 1;
--    Kørt read-only mod prod 26/7 (sæson 1, 27 af 28 løbsdage afviklet):
--      flest point = Cooper Doyle, 8.844 (AI Threshold Squad)
--      flest sejre = Jakub Adamczyk, 28 (LEGO-Vestas Cycling Team)
--
-- 4) rider_rankings_mv skal være refreshet EFTER sæsonens sidste løbsdag, ellers
--    kårer siden på forældede tal. refresh_ranking_matviews() kaldes ved hver
--    race-finalization + af cron (backend/cron.js), men verificér efter cutover:
--    SELECT SUM(points) FROM rider_rankings_mv
--    WHERE season_id = (SELECT id FROM seasons WHERE number = 1);
--    → skal matche
--    SELECT SUM(rr.points_earned) FROM race_results rr
--    JOIN races r ON r.id = rr.race_id
--    WHERE r.season_id = (SELECT id FROM seasons WHERE number = 1)
--      AND rr.rider_id IS NOT NULL;
