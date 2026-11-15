-- =============================================================================
-- #8188 · Genberegn baseline paa aktive monument_podium-bonusmaal
-- =============================================================================
--
-- Fejlen: baselinen der gemmes naar et bonustilbud accepteres, talte holdets
-- monument-podier fra ALLE saesoner (det genbrugte 1yr-boards snapshots fra
-- tidligere saesoner kom med), mens visning og evaluering kun taeller
-- indevaerende plan-cyklus. Fremdrift = saesonens podier minus en for hoej
-- baseline, saa maalet staar fast paa 0. Kodefixet (boardBonusGoal.js) retter
-- nye accepter; dette script retter de allerede gemte maal.
--
-- KOERES IKKE af lanen. Orkestratoren koerer BLOK 1 (ren laesning), viser
-- ejeren tallene, og koerer BLOK 2 foerst efter ejerens ord.
--
-- Korrekt baseline = holdets senior-monument-podier (gc, rank <= 3,
-- race_class 'Monuments', races.squad NULL eller 'senior') i plan-cyklusvinduet,
-- importeret FOER tilbuddet blev accepteret (board_consequences.resolved_at).
-- Plan-cyklusvinduet er det samme som koden bruger: den aktive saeson plus
-- 1yr-boardets snapshots med season_number >= plan_start_season_number
-- (mangler plan-start: den aktive saesons nummer).
--
-- Begge lagre repareres: board_mandates.goals (jsonb-array, det Boardroom
-- viser) og board_profiles.current_goals (jsonb; skrives af koden som en
-- JSON-STRENG, saa begge former haandteres og formen bevares ved skrivning).
--
-- Omfang: kun AKTIVE maal: mandater med status 'active' for den aktive saeson,
-- og holdets 'completed' 1yr-plan. Kun elementer med source 'bonus_offer' og
-- type 'monument_podium'.
--
-- KUN SAENKNING: scriptet retter et maal, naar den gemte baseline findes, er
-- et heltal, og den korrekte baseline er MINDRE end den gemte. Det haever
-- aldrig en baseline og tilfoejer aldrig en baseline til et maal uden en.
--
-- MATCH PAA TILBUD (kolonnen match_kind):
--   'offer_id' = maalet har bonus_offer_id, og tilbuddet findes paa det id.
--   'fallback' = aeldre maal uden id; matches paa holdets seneste accepterede
--                monument-tilbud (lag 6) med resolved_at >= den aktive saesons
--                start_date (tilbud fra tidligere saesoner tages ikke med).
-- BLOK 1 viser begge slags. BLOK 2 skriver KUN raekker med match_kind
-- 'offer_id'; fallback-raekker vurderes manuelt ud fra BLOK 1.
-- Findes intet accepteret tilbud, er correct_baseline NULL og elementet roeres
-- ikke (vises i BLOK 1 til manuel vurdering).
--
-- BLOK 1b taeller afsluttede 1yr-boards med aktivt monument-bonusmaal og
-- plan_start_season_number NULL (opfoelgning, intet rettes her).
--
-- HOLD BLOK 1 OG BLOK 2'S BEREGNING ENS. De to CTE-kaeder er bevidst
-- identiske; en aendring i den ene skal ogsaa i den anden.
-- =============================================================================


-- =============================================================================
-- BLOK 1 · REN SELECT (ingen skrivning). Lister beroerte aktive bonusmaal med
-- gemt og korrekt baseline. needs_repair = true er de rækker BLOK 2 retter
-- (would_lower OG match_kind = 'offer_id').
-- =============================================================================

WITH active_season AS (
  SELECT id, number, start_date
  FROM seasons
  WHERE status = 'active'
  ORDER BY number DESC
  LIMIT 1
),
one_yr AS (
  SELECT bp.id AS board_id,
         bp.team_id,
         COALESCE(bp.plan_start_season_number, s.number) AS window_start
  FROM board_profiles bp
  CROSS JOIN active_season s
  WHERE bp.plan_type = '1yr'
    AND bp.negotiation_status = 'completed'
),
profile_goals AS (
  SELECT bp.id,
         bp.team_id,
         CASE jsonb_typeof(bp.current_goals)
           WHEN 'array'  THEN bp.current_goals
           WHEN 'string' THEN (bp.current_goals #>> '{}')::jsonb
           ELSE '[]'::jsonb
         END AS goals
  FROM board_profiles bp
  WHERE bp.plan_type = '1yr'
    AND bp.negotiation_status = 'completed'
    AND bp.current_goals::text LIKE '%monument_podium%'
),
goal_rows AS (
  SELECT 'board_mandates'::text AS store, m.id::text AS row_id, m.team_id, g.ord, g.goal
  FROM board_mandates m
  CROSS JOIN active_season s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(m.goals) = 'array' THEN m.goals ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS g(goal, ord)
  WHERE m.status = 'active'
    AND m.season_number = s.number
    AND g.goal->>'source' = 'bonus_offer'
    AND g.goal->>'type' = 'monument_podium'
  UNION ALL
  SELECT 'board_profiles'::text, p.id::text, p.team_id, g.ord, g.goal
  FROM profile_goals p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.goals) = 'array' THEN p.goals ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS g(goal, ord)
  WHERE g.goal->>'source' = 'bonus_offer'
    AND g.goal->>'type' = 'monument_podium'
),
with_offer AS (
  SELECT gr.*,
         CASE WHEN gr.goal->>'bonus_offer_id' IS NOT NULL THEN 'offer_id' ELSE 'fallback' END AS match_kind,
         o.offer_id,
         o.resolved_at
  FROM goal_rows gr
  LEFT JOIN LATERAL (
    SELECT c.id AS offer_id, c.resolved_at
    FROM board_consequences c
    CROSS JOIN active_season s
    WHERE c.team_id = gr.team_id
      AND c.layer = 6
      AND c.status = 'accepted'
      AND (
        (gr.goal->>'bonus_offer_id' IS NOT NULL AND c.id::text = gr.goal->>'bonus_offer_id')
        -- Fallback (maal uden id): kun et tilbud accepteret i DEN AKTIVE saeson.
        OR (gr.goal->>'bonus_offer_id' IS NULL
            AND c.payload->>'extra_goal_type' = 'monument_podium'
            AND s.start_date IS NOT NULL
            AND c.resolved_at >= s.start_date)
      )
    ORDER BY c.resolved_at DESC NULLS LAST
    LIMIT 1
  ) o ON true
),
teams_in_scope AS (
  SELECT DISTINCT team_id FROM goal_rows
),
window_seasons AS (
  SELECT t.team_id, s.id AS season_id
  FROM teams_in_scope t
  CROSS JOIN active_season s
  UNION
  SELECT y.team_id, ps.season_id
  FROM one_yr y
  JOIN teams_in_scope t ON t.team_id = y.team_id
  JOIN board_plan_snapshots ps
    ON ps.board_id = y.board_id
   AND ps.season_number >= y.window_start
  WHERE ps.season_id IS NOT NULL
),
corrected AS (
  SELECT w.*,
         -- Sikker cast: kun et rent ikke-negativt heltal; alt andet = NULL (roeres ikke).
         CASE WHEN (w.goal->>'baseline') ~ '^[0-9]{1,9}$'
              THEN (w.goal->>'baseline')::int
         END AS stored_baseline_int,
         CASE WHEN w.resolved_at IS NULL THEN NULL ELSE (
           SELECT count(*)::int
           FROM race_results rr
           JOIN races r ON r.id = rr.race_id
           JOIN window_seasons ws ON ws.team_id = w.team_id AND ws.season_id = r.season_id
           WHERE rr.team_id = w.team_id
             AND rr.result_type = 'gc'
             AND rr.rank <= 3
             AND r.race_class = 'Monuments'
             AND (r.squad IS NULL OR r.squad = 'senior')
             AND COALESCE(rr.imported_at, r.finalize_updated_at, r.created_at) < w.resolved_at
         ) END AS correct_baseline
  FROM with_offer w
)
SELECT store,
       row_id,
       team_id,
       ord                         AS goal_position,
       match_kind,
       offer_id,
       resolved_at                 AS accepted_at,
       goal->>'baseline'           AS stored_baseline,
       correct_baseline,
       -- Kun SAENKNING taeller: gemt baseline findes, er et heltal og er for hoej.
       (correct_baseline IS NOT NULL
         AND stored_baseline_int IS NOT NULL
         AND correct_baseline < stored_baseline_int) AS would_lower,
       -- Hoerer maalet til den aktive saesons mandat (eller er profilens spejling af det)?
       (c.store = 'board_mandates'
         OR EXISTS (
           SELECT 1 FROM goal_rows gm
           WHERE gm.store = 'board_mandates'
             AND gm.team_id = c.team_id
             AND gm.goal->>'bonus_offer_id' = c.goal->>'bonus_offer_id'
         )) AS in_active_mandate,
       -- BLOK 2 skriver KUN would_lower-raekker med match paa tilbuds-id i den aktive saesons mandat.
       (match_kind = 'offer_id'
         AND correct_baseline IS NOT NULL
         AND stored_baseline_int IS NOT NULL
         AND correct_baseline < stored_baseline_int
         AND (c.store = 'board_mandates'
              OR EXISTS (
                SELECT 1 FROM goal_rows gm
                WHERE gm.store = 'board_mandates'
                  AND gm.team_id = c.team_id
                  AND gm.goal->>'bonus_offer_id' = c.goal->>'bonus_offer_id'
              ))) AS needs_repair
FROM corrected c
ORDER BY team_id, store, ord;


-- =============================================================================
-- BLOK 1b · REN SELECT (ingen skrivning). Afsluttede 1yr-boards med et aktivt
-- monument-bonusmaal, hvor plan_start_season_number er NULL. Baseline-stien
-- falder tilbage til den aktive saeson; weekend-/saesonslut-evalueringen
-- (boardWeekendFinalization.js, economyEngine.js) sender plan-start UDEN
-- fallback. Tallet er grundlag for opfoelgning; scriptet retter det ikke.
-- =============================================================================

WITH active_season AS (
  SELECT id, number
  FROM seasons
  WHERE status = 'active'
  ORDER BY number DESC
  LIMIT 1
),
one_yr_null_start AS (
  SELECT bp.id,
         bp.team_id,
         CASE jsonb_typeof(bp.current_goals)
           WHEN 'array'  THEN bp.current_goals
           WHEN 'string' THEN (bp.current_goals #>> '{}')::jsonb
           ELSE '[]'::jsonb
         END AS goals
  FROM board_profiles bp
  WHERE bp.plan_type = '1yr'
    AND bp.negotiation_status = 'completed'
    AND bp.plan_start_season_number IS NULL
)
SELECT count(*) AS boards_with_null_plan_start
FROM one_yr_null_start b
WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(b.goals) = 'array' THEN b.goals ELSE '[]'::jsonb END
        ) g(goal)
        WHERE g.goal->>'source' = 'bonus_offer'
          AND g.goal->>'type' = 'monument_podium'
      )
   OR EXISTS (
        SELECT 1
        FROM board_mandates m
        CROSS JOIN active_season s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(m.goals) = 'array' THEN m.goals ELSE '[]'::jsonb END
        ) g(goal)
        WHERE m.team_id = b.team_id
          AND m.status = 'active'
          AND m.season_number = s.number
          AND g.goal->>'source' = 'bonus_offer'
          AND g.goal->>'type' = 'monument_podium'
      );


-- =============================================================================
-- BLOK 2 · UPDATE (SKRIVER TIL PROD). KUN EFTER EJERENS ORD.
--
-- Koeres som EEN samlet koersel. Idempotent: kun elementer med match paa
-- tilbuds-id, hvor gemt baseline er et heltal STOERRE end den korrekte,
-- skrives (aldrig haevning, aldrig ny baseline), og hver skrivning er compare-and-swap paa
-- den gemte vaerdi, saa en anden koersel (eller en samtidig skriver) rammer 0
-- rækker. Foer-vaerdierne arkiveres i backup_8188_bonus_baseline (rule 38).
-- Mandatets updated_at rykkes altid frem, saa appens optimistiske laas
-- (boardBonusGoal.js, nextMandateLockToken) laeser raekken igen.
-- Proevekoersel: skift COMMIT ud med ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE fix_8188 ON COMMIT DROP AS
WITH active_season AS (
  SELECT id, number, start_date
  FROM seasons
  WHERE status = 'active'
  ORDER BY number DESC
  LIMIT 1
),
one_yr AS (
  SELECT bp.id AS board_id,
         bp.team_id,
         COALESCE(bp.plan_start_season_number, s.number) AS window_start
  FROM board_profiles bp
  CROSS JOIN active_season s
  WHERE bp.plan_type = '1yr'
    AND bp.negotiation_status = 'completed'
),
profile_goals AS (
  SELECT bp.id,
         bp.team_id,
         CASE jsonb_typeof(bp.current_goals)
           WHEN 'array'  THEN bp.current_goals
           WHEN 'string' THEN (bp.current_goals #>> '{}')::jsonb
           ELSE '[]'::jsonb
         END AS goals
  FROM board_profiles bp
  WHERE bp.plan_type = '1yr'
    AND bp.negotiation_status = 'completed'
    AND bp.current_goals::text LIKE '%monument_podium%'
),
goal_rows AS (
  SELECT 'board_mandates'::text AS store, m.id::text AS row_id, m.team_id, g.ord, g.goal
  FROM board_mandates m
  CROSS JOIN active_season s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(m.goals) = 'array' THEN m.goals ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS g(goal, ord)
  WHERE m.status = 'active'
    AND m.season_number = s.number
    AND g.goal->>'source' = 'bonus_offer'
    AND g.goal->>'type' = 'monument_podium'
  UNION ALL
  SELECT 'board_profiles'::text, p.id::text, p.team_id, g.ord, g.goal
  FROM profile_goals p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.goals) = 'array' THEN p.goals ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS g(goal, ord)
  WHERE g.goal->>'source' = 'bonus_offer'
    AND g.goal->>'type' = 'monument_podium'
),
with_offer AS (
  SELECT gr.*,
         CASE WHEN gr.goal->>'bonus_offer_id' IS NOT NULL THEN 'offer_id' ELSE 'fallback' END AS match_kind,
         o.offer_id,
         o.resolved_at
  FROM goal_rows gr
  LEFT JOIN LATERAL (
    SELECT c.id AS offer_id, c.resolved_at
    FROM board_consequences c
    CROSS JOIN active_season s
    WHERE c.team_id = gr.team_id
      AND c.layer = 6
      AND c.status = 'accepted'
      AND (
        (gr.goal->>'bonus_offer_id' IS NOT NULL AND c.id::text = gr.goal->>'bonus_offer_id')
        -- Fallback (maal uden id): kun et tilbud accepteret i DEN AKTIVE saeson.
        OR (gr.goal->>'bonus_offer_id' IS NULL
            AND c.payload->>'extra_goal_type' = 'monument_podium'
            AND s.start_date IS NOT NULL
            AND c.resolved_at >= s.start_date)
      )
    ORDER BY c.resolved_at DESC NULLS LAST
    LIMIT 1
  ) o ON true
),
teams_in_scope AS (
  SELECT DISTINCT team_id FROM goal_rows
),
window_seasons AS (
  SELECT t.team_id, s.id AS season_id
  FROM teams_in_scope t
  CROSS JOIN active_season s
  UNION
  SELECT y.team_id, ps.season_id
  FROM one_yr y
  JOIN teams_in_scope t ON t.team_id = y.team_id
  JOIN board_plan_snapshots ps
    ON ps.board_id = y.board_id
   AND ps.season_number >= y.window_start
  WHERE ps.season_id IS NOT NULL
),
corrected AS (
  SELECT w.*,
         -- Sikker cast: kun et rent ikke-negativt heltal; alt andet = NULL (roeres ikke).
         CASE WHEN (w.goal->>'baseline') ~ '^[0-9]{1,9}$'
              THEN (w.goal->>'baseline')::int
         END AS stored_baseline_int,
         CASE WHEN w.resolved_at IS NULL THEN NULL ELSE (
           SELECT count(*)::int
           FROM race_results rr
           JOIN races r ON r.id = rr.race_id
           JOIN window_seasons ws ON ws.team_id = w.team_id AND ws.season_id = r.season_id
           WHERE rr.team_id = w.team_id
             AND rr.result_type = 'gc'
             AND rr.rank <= 3
             AND r.race_class = 'Monuments'
             AND (r.squad IS NULL OR r.squad = 'senior')
             AND COALESCE(rr.imported_at, r.finalize_updated_at, r.created_at) < w.resolved_at
         ) END AS correct_baseline
  FROM with_offer w
)
SELECT store, row_id, team_id, ord, match_kind, offer_id,
       goal->>'baseline' AS stored_baseline,
       correct_baseline
FROM corrected c
WHERE match_kind = 'offer_id'
  AND correct_baseline IS NOT NULL
  AND stored_baseline_int IS NOT NULL
  AND correct_baseline < stored_baseline_int
  -- Kun den aktive saesons maal: mandatets egne maal, og profilens spejling af netop dem.
  -- Bonusmaal fra tidligere saesoner, der stadig staar i board_profiles.current_goals,
  -- roeres ikke (de vises i BLOK 1 med in_active_mandate = false).
  AND (c.store = 'board_mandates'
       OR EXISTS (
         SELECT 1 FROM goal_rows gm
         WHERE gm.store = 'board_mandates'
           AND gm.team_id = c.team_id
           AND gm.goal->>'bonus_offer_id' = c.goal->>'bonus_offer_id'
       ));

-- Arkiv af foer-vaerdier (hele raekkens maal-array), en raekke pr. lager+raekke.
CREATE TABLE IF NOT EXISTS backup_8188_bonus_baseline (
  store        text        NOT NULL,
  row_id       text        NOT NULL,
  team_id      uuid,
  goals_before jsonb,
  fix_rows     jsonb,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store, row_id)
);
-- Kun backend: arkivet rummer holds private bestyrelsesmaal. RLS uden policies og ingen
-- klient-grants, FOER der indsaettes noget (AGENTS regel 31, docs/DATA_API_GRANTS.md).
-- data-api-access: {"table":"public.backup_8188_bonus_baseline","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT"]},"reason":"Ops-arkiv af foer-vaerdier; kun backend"}
ALTER TABLE backup_8188_bonus_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE backup_8188_bonus_baseline FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE backup_8188_bonus_baseline TO service_role;

INSERT INTO backup_8188_bonus_baseline (store, row_id, team_id, goals_before, fix_rows)
SELECT 'board_mandates', m.id::text, m.team_id, m.goals,
       (SELECT jsonb_agg(to_jsonb(f)) FROM fix_8188 f WHERE f.store = 'board_mandates' AND f.row_id = m.id::text)
FROM board_mandates m
WHERE m.id::text IN (SELECT row_id FROM fix_8188 WHERE store = 'board_mandates')
UNION ALL
SELECT 'board_profiles', bp.id::text, bp.team_id, bp.current_goals,
       (SELECT jsonb_agg(to_jsonb(f)) FROM fix_8188 f WHERE f.store = 'board_profiles' AND f.row_id = bp.id::text)
FROM board_profiles bp
WHERE bp.id::text IN (SELECT row_id FROM fix_8188 WHERE store = 'board_profiles')
ON CONFLICT (store, row_id) DO NOTHING;

-- board_mandates.goals (jsonb-array).
UPDATE board_mandates m
SET goals = (
      SELECT jsonb_agg(
               CASE WHEN f.ord IS NOT NULL
                    THEN jsonb_set(g.goal, '{baseline}', to_jsonb(f.correct_baseline))
                    ELSE g.goal
               END
               ORDER BY g.ord)
      FROM jsonb_array_elements(m.goals) WITH ORDINALITY AS g(goal, ord)
      LEFT JOIN fix_8188 f
        ON f.store = 'board_mandates'
       AND f.row_id = m.id::text
       AND f.ord = g.ord
       AND g.goal->>'source' = 'bonus_offer'
       AND g.goal->>'type' = 'monument_podium'
       AND (g.goal->>'baseline') IS NOT DISTINCT FROM f.stored_baseline
    ),
    updated_at = GREATEST(now(), m.updated_at + interval '1 millisecond')
WHERE m.status = 'active'
  AND jsonb_typeof(m.goals) = 'array'
  AND EXISTS (
    SELECT 1
    FROM fix_8188 f
    CROSS JOIN LATERAL (SELECT m.goals -> (f.ord::int - 1) AS goal) cur
    WHERE f.store = 'board_mandates'
      AND f.row_id = m.id::text
      AND cur.goal->>'source' = 'bonus_offer'
      AND cur.goal->>'type' = 'monument_podium'
      AND (cur.goal->>'baseline') IS NOT DISTINCT FROM f.stored_baseline
  );

-- board_profiles.current_goals (jsonb-array ELLER jsonb-streng med JSON; formen bevares).
UPDATE board_profiles bp
SET current_goals = (
      SELECT CASE WHEN jsonb_typeof(bp.current_goals) = 'string'
                  THEN to_jsonb(fixed.arr::text)
                  ELSE fixed.arr
             END
      FROM (
        SELECT jsonb_agg(
                 CASE WHEN f.ord IS NOT NULL
                      THEN jsonb_set(g.goal, '{baseline}', to_jsonb(f.correct_baseline))
                      ELSE g.goal
                 END
                 ORDER BY g.ord) AS arr
        FROM jsonb_array_elements(
               CASE jsonb_typeof(bp.current_goals)
                 WHEN 'array'  THEN bp.current_goals
                 WHEN 'string' THEN (bp.current_goals #>> '{}')::jsonb
               END
             ) WITH ORDINALITY AS g(goal, ord)
        LEFT JOIN fix_8188 f
          ON f.store = 'board_profiles'
         AND f.row_id = bp.id::text
         AND f.ord = g.ord
         AND g.goal->>'source' = 'bonus_offer'
         AND g.goal->>'type' = 'monument_podium'
         AND (g.goal->>'baseline') IS NOT DISTINCT FROM f.stored_baseline
      ) fixed
    ),
    updated_at = now()
WHERE bp.plan_type = '1yr'
  AND bp.negotiation_status = 'completed'
  AND jsonb_typeof(bp.current_goals) IN ('array', 'string')
  AND EXISTS (
    SELECT 1
    FROM fix_8188 f
    CROSS JOIN LATERAL (
      SELECT (CASE jsonb_typeof(bp.current_goals)
                WHEN 'array'  THEN bp.current_goals
                WHEN 'string' THEN (bp.current_goals #>> '{}')::jsonb
              END) -> (f.ord::int - 1) AS goal
    ) cur
    WHERE f.store = 'board_profiles'
      AND f.row_id = bp.id::text
      AND cur.goal->>'source' = 'bonus_offer'
      AND cur.goal->>'type' = 'monument_podium'
      AND (cur.goal->>'baseline') IS NOT DISTINCT FROM f.stored_baseline
  );

-- Kvittering: hvad blev rettet i denne koersel.
SELECT store, row_id, team_id, ord AS goal_position, offer_id, stored_baseline, correct_baseline
FROM fix_8188
ORDER BY team_id, store, ord;

COMMIT;

-- =============================================================================
-- Post-verify (koer efter BLOK 2):
--   1) Koer BLOK 1 igen: forventet needs_repair = false paa alle raekker.
--   2) Koer BLOK 2 igen: kvitteringen er tom (idempotens).
--   3) Arkivet: SELECT store, count(*) FROM backup_8188_bonus_baseline GROUP BY store;
-- Rollback af en raekke: skriv goals_before tilbage fra backup_8188_bonus_baseline.
-- =============================================================================
