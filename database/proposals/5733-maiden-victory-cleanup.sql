-- #5733 cleanup PROPOSAL — "Maiden victory" fejlagtigt registreret for en
-- rytter der allerede havde en tidligere professionel sejr (fx et monument)
-- i en ANDEN, kronologisk tidligere afvikling.
--
-- BAGGRUND: en TEORETISK bounded, uordnet 30-rækkers hentning i
-- backend/lib/careerFirsts.js's riderHasPriorResult (rettet i samme PR som
-- denne fil, Refs #5733) kunne i teorien lade en ægte tidligere sejr i et
-- ANDET løb falde uden for et uordnet 30-rækkers vindue for en rytter med
-- mange af SIN EGEN afviklings kvalificerende rækker (fx en sweep af mange
-- etaper i samme grand tour) — men dette er IKKE bekræftet som rodårsagen
-- for #5733's konkrete spillerrapport (reviewer-fund 26/9): trin 1 herunder,
-- kørt mod HELE prod 26/9, gav 0 mistænkelige maiden_win-events, og
-- spillerens eget hold (cybersimon) har kun to maiden_win-events nogensinde,
-- ingen af dem mistænkelige. Denne fil er derfor et FOREBYGGENDE
-- sikkerhedsnet for den teoretiske fejlklasse, ikke en bekræftet oprydning —
-- kør trin 1 igen før evt. brug af trin 3, forvent 0.
--
-- IDEMPOTENT + KUN-FORSLAG (ejer-politik, #2642-rammerne): denne fil
-- auto-applies IKKE. Ejeren kører selv, trin for trin, efter at have set
-- optællingen. `race_id`/`rider_id`/`event_type` er interne UUID'er/enums —
-- ingen holdnavne, brugernavne eller balance-tal (hard rule 17,
-- anonymiserings-reglen).
--
-- Kolonnenavne slået op i database/schema-snapshot.json FØR denne fil blev
-- skrevet (relations.race_results.columns / relations.races.columns /
-- relations.rider_career_events.columns) — ingen gæt.
--
-- ── Trin 1 (KØR FØRST, kun læsning): optæl mistænkelige 'maiden_win'-events ──
-- Et 'maiden_win'-event er mistænkeligt hvis rytteren HAR en anden
-- kvalificerende sejr (result_type IN ('stage','gc'), rank=1) i et ANDET løb
-- der ifølge løbets scheduled_for (fallback created_at, hvis en race mangler
-- scheduled_for) ligger FØR det løb 'maiden_win'-eventet selv peger på.
WITH maiden_events AS (
  SELECT rce.id, rce.rider_id, rce.race_id AS maiden_race_id
  FROM public.rider_career_events rce
  WHERE rce.event_type = 'maiden_win'
),
maiden_race_time AS (
  SELECT
    me.id,
    me.rider_id,
    me.maiden_race_id,
    COALESCE(r.scheduled_for, r.created_at) AS maiden_occurred_at
  FROM maiden_events me
  LEFT JOIN public.races r ON r.id = me.maiden_race_id
),
suspect_maiden_events AS (
  SELECT DISTINCT mrt.id AS maiden_event_id
  FROM maiden_race_time mrt
  JOIN public.race_results rr
    ON rr.rider_id = mrt.rider_id
   AND rr.result_type IN ('stage', 'gc')
   AND rr.rank = 1
   AND rr.race_id IS DISTINCT FROM mrt.maiden_race_id
  JOIN public.races r2 ON r2.id = rr.race_id
  WHERE mrt.maiden_occurred_at IS NOT NULL
    AND COALESCE(r2.scheduled_for, r2.created_at) < mrt.maiden_occurred_at
)
SELECT count(*) AS suspect_maiden_win_event_count
FROM suspect_maiden_events;

-- ── Trin 2 (kun læsning, til ejerens gennemsyn — INGEN rytternavne/holdnavne,
-- kun interne id'er): listen af de faktiske event-id'er trin 1 tæller, så
-- ejeren kan stikprøve-tjekke FØR sletning.
-- SELECT maiden_event_id FROM (
--   <samme CTE-kæde som ovenfor, erstat SELECT count(*) ... med
--    SELECT maiden_event_id FROM suspect_maiden_events>
-- ) x;

-- ── Trin 3 (EJER-GATED, IKKE auto-apply) — idempotent sletning ──
-- Kør KUN efter at have set optællingen (og evt. trin 2's stikprøve) og
-- besluttet at rydde op. Idempotent: en allerede-slettet række matcher
-- simpelthen ikke igen ved en gentagen kørsel (0 rows deleted, ingen fejl).
-- Slettes IKKE automatisk af denne fil eller af CI/auto-migrate.yml — en
-- destruktiv operation kræver eksplicit ejer-kørsel (samme regel som enhver
-- anden destruktiv migration i dette repo).
--
-- DELETE FROM public.rider_career_events
-- WHERE event_type = 'maiden_win'
--   AND id IN (
--     WITH maiden_events AS (
--       SELECT rce.id, rce.rider_id, rce.race_id AS maiden_race_id
--       FROM public.rider_career_events rce
--       WHERE rce.event_type = 'maiden_win'
--     ),
--     maiden_race_time AS (
--       SELECT
--         me.id,
--         me.rider_id,
--         me.maiden_race_id,
--         COALESCE(r.scheduled_for, r.created_at) AS maiden_occurred_at
--       FROM maiden_events me
--       LEFT JOIN public.races r ON r.id = me.maiden_race_id
--     )
--     SELECT DISTINCT mrt.id
--     FROM maiden_race_time mrt
--     JOIN public.race_results rr
--       ON rr.rider_id = mrt.rider_id
--      AND rr.result_type IN ('stage', 'gc')
--      AND rr.rank = 1
--      AND rr.race_id IS DISTINCT FROM mrt.maiden_race_id
--     JOIN public.races r2 ON r2.id = rr.race_id
--     WHERE mrt.maiden_occurred_at IS NOT NULL
--       AND COALESCE(r2.scheduled_for, r2.created_at) < mrt.maiden_occurred_at
--   );
--
-- NB (CodeRabbit-rettet, #5733): denne sletning fjerner KUN det forkerte
-- 'maiden_win'-event selv. En allerede LEVERET celebration-notifikation kan
-- forblive synlig i `notifications`, fordi detectCareerFirsts gemmer
-- `related_id = race.id` (IKKE career-event-id'et) — denne sletning
-- identificerer/rører derfor ikke den notifikation. Kræves den også fjernet,
-- er det et SEPARAT, selvstændigt gennemgået oprydningstrin (ikke del af
-- dette forslag). Denne sletning rører IKKE race_results, standings eller
-- point — ingen økonomisk konsekvens. En rytter hvis 'maiden_win' slettes her
-- vil ved NÆSTE finalisering af et løb ikke automatisk få et nyt (korrekt)
-- event, fordi hans REELLE første sejr allerede er registreret som "prior"
-- af den rettede detektion — det er hverken et problem eller noget der
-- kræver en efterfølgende re-kørsel.
