-- Sæsondokumentaren (#3402, bølge 1 af verdensklasse-planen #3395) — narrativ
-- årbog pr. menneskehold oven på #2752-recappen (SeasonRecapHero + SeasonHonours
-- på /seasons/:id): dine signings, dit største resultat, dit vendepunkt (bedste
-- løbsdag) og din tætteste rival (point-nabo i slutstillingen), flettet med
-- nøgletal. Mål: klar til S2-afslutningen 23/8.
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp / #2642-rammerne). Ingen
-- apply_migration/execute_sql er kørt af agenten — kun READ-ONLY SELECT mod
-- prod er brugt til at validere facts-forespørgslen nedenfor (dry-run mod
-- sæson 1, se PR-body for eksempel-output). Idempotent (CREATE TABLE IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS + genskab, INSERT
-- ... ON CONFLICT DO NOTHING).
--
-- ── TO-LAGS GENERERING (issue-AC) ──
--   (a) DETERMINISTISK fundament (backend/lib/seasonDocumentaryGrammar.js) —
--       en template-grammatik over de rækker denne funktion returnerer.
--       ALTID til stede, dette er fallbacken og skal være godt nok alene.
--   (b) LLM-forbedring bag env-gate (ANTHROPIC_API_KEY + app_config-flag
--       'season_documentary_llm_enabled', default OFF, se INSERT nederst) —
--       omskriver den deterministiske kladde til flydende prosa. LLM'en får
--       KUN kladden + fakta at omformulere, digter intet nyt (backend/lib/
--       seasonDocumentaryLLM.js).
--
-- CACHET/PERSISTERET: genereres ÉN gang pr. (season_id, team_id) af den
-- natlige sweep (backend/lib/seasonDocumentarySweep.js, kørt via cron.js) —
-- alle der besøger /seasons/:id ser SAMME tekst. Genkørsel er idempotent
-- (UPSERT på PRIMARY KEY, generate-funktionen er en ren funktion af allerede-
-- persisterede rækker).
--
-- get_season_documentary_facts SPEJLER get_season_recap (#2891) / get_season_
-- honours (#2863)'s mønster 1:1: STABLE SQL, SECURITY INVOKER (alle kildetabeller
-- har allerede "Public read"-policies, jf. samme advisor 0028/0029-begrundelse),
-- server-side aggregering så klienten/sweepen ikke selv skal joine race_results.
--
-- FAKTA-DEFINITIONER (dokumenteret her fordi de er domænevalg, ikke kun SQL):
--   · signings   — finance_transactions type='transfer_out' AND related_entity_
--                   type IN ('auction','transfer') for holdet denne sæson,
--                   sorteret efter beløb (størst spend først). Dækker BEGGE
--                   erhvervelses-veje (auktion + transfermarked), som issuets
--                   AC eksplicit nævner. riderName læses fra metadata.params
--                   (samme strukturerede felt backendMessage.js allerede
--                   renderer transaktioner fra), ikke fra den frietekst-
--                   description-kolonne.
--   · biggestResult — bedste ENKELT-rytter-resultat: en scoring-heuristik
--                   (sejr=stort tillæg, klassifikations-vægt, points_earned)
--                   over race_results, begrænset til de resultat-typer der ER
--                   endelige resultater (stage/gc/points/mountain/young/team) —
--                   IKKE de løbende etape-for-etape trøje-snapshots (leader/
--                   mountain_day/points_day/young_day), som ville forurene
--                   "biggest result" med midlertidige mellemstillinger.
--   · bestRaceDay — det enkelte løb hvor holdets ryttere TILSAMMEN scorede
--                   flest points_earned (holdets bedste dag, adskilt fra
--                   biggestResult's individuelle vinkel — "vendepunktet").
--   · rival      — nærmeste menneskehold i SAMME division efter |points-gap|
--                   i slutstillingen (samme is_ai/is_bank/is_test_account-
--                   diskriminator som resten af kodebasen bruger til "rigtige
--                   hold", jf. discordRaceDigestSweep.js).
-- Alle fire kan være NULL/tom (nyt hold uden signings, ingen kvalificerende
-- resultat-type, alene i sin division) — grammatikken (JS-laget) har en
-- fallback-sætning for hvert felt, så dokumentaren ALTID renderer noget.
--
-- Post-verify (kør manuelt efter apply):
--   1) SELECT proname, prosecdef FROM pg_proc WHERE proname = 'get_season_documentary_facts';
--      → forventet: get_season_documentary_facts | false
--   2) SELECT public.get_season_documentary_facts(
--        (SELECT id FROM seasons WHERE number = 1),
--        (SELECT team_id FROM season_standings WHERE season_id = (SELECT id FROM seasons WHERE number=1)
--         AND division = 3 ORDER BY total_points DESC LIMIT 1));
--      → forventet: jsonb med nøglerne signings/biggestResult/bestRaceDay/rival/myStanding
--   3) SELECT count(*) FROM public.season_documentaries; → forventet: 0 lige efter apply
--      (ingen backfill i migrationen selv — sweepen fylder tabellen op løbende).

BEGIN;

CREATE TABLE IF NOT EXISTS public.season_documentaries (
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,          -- rå output af get_season_documentary_facts (auditerbar kilde)
  deterministic_en jsonb NOT NULL DEFAULT '[]'::jsonb, -- string[] paragraffer, altid udfyldt (fallback-laget)
  deterministic_da jsonb NOT NULL DEFAULT '[]'::jsonb,
  llm_en text,                                        -- NULL indtil LLM-laget er slået til og lykkes
  llm_da text,
  llm_model text,                                      -- fx "claude-sonnet-4-5-...", NULL for ren deterministisk række
  source text NOT NULL DEFAULT 'deterministic' CHECK (source IN ('deterministic', 'llm')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_season_documentaries_season
  ON public.season_documentaries(season_id);

ALTER TABLE public.season_documentaries ENABLE ROW LEVEL SECURITY;

-- Public read (mirror season_standings/race_results, schema.sql:638/641) — en
-- sæsondokumentar er lige så offentlig som selve slutstillingen den bygger på;
-- team-profilsider viser allerede andre holds offentlige sæson-data.
DROP POLICY IF EXISTS "season_documentaries_read" ON public.season_documentaries;
CREATE POLICY "season_documentaries_read"
  ON public.season_documentaries FOR SELECT
  USING (true);

-- Write = service_role (sweepen bruger service-role-klienten, samme som alle
-- andre cron-sweeps i backend/cron.js) + admin, aldrig anon/authenticated
-- direkte — dokumentaren er en genereret, cachet artefakt, ikke spiller-input.
DROP POLICY IF EXISTS "season_documentaries_admin_write" ON public.season_documentaries;
CREATE POLICY "season_documentaries_admin_write"
  ON public.season_documentaries FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.season_documentaries IS
  '#3402 · Sæsondokumentaren: narrativ årbog pr. (season_id, team_id), genereret ÉN gang af backend/lib/seasonDocumentarySweep.js efter sæsonslut. deterministic_en/da er ALTID udfyldt (fallback-laget); llm_en/da er NULL indtil season_documentary_llm_enabled=on OG ANTHROPIC_API_KEY er sat. source afgør hvilket par frontend viser.';

CREATE OR REPLACE FUNCTION public.get_season_documentary_facts(p_season_id uuid, p_team_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH my_signings AS (
    SELECT ft.amount, ft.metadata, ft.related_entity_type, ft.created_at
    FROM finance_transactions ft
    WHERE ft.season_id = p_season_id
      AND ft.team_id = p_team_id
      AND ft.type = 'transfer_out'
      AND ft.related_entity_type IN ('auction', 'transfer')
    ORDER BY ft.amount ASC  -- mest negative først = størst spend
    LIMIT 3
  ),
  team_results AS (
    SELECT rr.*, r.name AS race_name, r.race_class, r.race_type
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    WHERE r.season_id = p_season_id
      AND rr.team_id = p_team_id
      AND rr.result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team')
      AND rr.rank IS NOT NULL
  ),
  scored AS (
    SELECT *,
      (CASE result_type
        WHEN 'gc' THEN 500 WHEN 'points' THEN 300 WHEN 'mountain' THEN 300
        WHEN 'young' THEN 300 WHEN 'team' THEN 150 WHEN 'stage' THEN 200
        ELSE 0 END)
      + (CASE WHEN rank = 1 THEN 1000 ELSE GREATEST(0, 50 - rank) END)
      + COALESCE(points_earned, 0) AS score
    FROM team_results
  ),
  biggest_result AS (
    SELECT * FROM scored ORDER BY score DESC, race_name ASC LIMIT 1
  ),
  race_day_totals AS (
    SELECT race_id, race_name,
           SUM(points_earned)::bigint AS total_points,
           COUNT(DISTINCT rider_id)::int AS riders_scoring
    FROM team_results
    GROUP BY race_id, race_name
  ),
  best_race_day AS (
    SELECT * FROM race_day_totals ORDER BY total_points DESC, race_name ASC LIMIT 1
  ),
  my_standing AS (
    SELECT * FROM season_standings
    WHERE season_id = p_season_id AND team_id = p_team_id
  ),
  rival AS (
    SELECT ss.team_id, t.name AS team_name, ss.total_points, ss.rank_in_division,
           ABS(ss.total_points - (SELECT total_points FROM my_standing)) AS gap
    FROM season_standings ss
    JOIN teams t ON t.id = ss.team_id
    WHERE ss.season_id = p_season_id
      AND ss.division = (SELECT division FROM my_standing)
      AND ss.team_id <> p_team_id
      AND t.is_ai = false
      AND t.is_bank IS NOT TRUE
      AND t.is_test_account IS NOT TRUE
    ORDER BY gap ASC, ss.rank_in_division ASC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'signings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'amount', ABS(amount),
        'riderName', metadata -> 'params' ->> 'riderName',
        'source', related_entity_type
      ) ORDER BY amount ASC)  -- #3402: eksplicit ORDER BY i aggregatet — jsonb_agg
                               -- garanterer IKKE CTE-scan-rækkefølge uden den (samme
                               -- læring som get_season_honours' egne jsonb_agg-kald).
      FROM my_signings
    ), '[]'::jsonb),
    'biggestResult', (SELECT to_jsonb(biggest_result) FROM biggest_result),
    'bestRaceDay', (SELECT to_jsonb(best_race_day) FROM best_race_day),
    'rival', (SELECT to_jsonb(rival) FROM rival),
    'myStanding', (SELECT to_jsonb(my_standing) FROM my_standing)
  );
$$;

COMMENT ON FUNCTION public.get_season_documentary_facts(uuid, uuid) IS
  '#3402 · Verificerede rå-fakta til ét holds sæsondokumentar: signings (auktion+transfer), biggestResult (bedste enkelt-rytter-resultat), bestRaceDay (holdets bedste points-dag = "vendepunktet"), rival (nærmeste hold i samme division efter |points-gap|), myStanding (season_standings-rækken). Kaldes af backend/lib/seasonDocumentaryGenerate.js — ALDRIG direkte fra klienten (dokumentaren læses fra season_documentaries, den cachede/persisterede tekst).';

REVOKE ALL ON FUNCTION public.get_season_documentary_facts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_documentary_facts(uuid, uuid) TO anon, authenticated, service_role;

-- Feature-flag for LLM-forbedringslaget (idempotent; default OFF). Uden
-- ANTHROPIC_API_KEY i miljøet virker laget ikke uanset flagets værdi
-- (dobbelt-gate, se seasonDocumentaryGenerate.js).
INSERT INTO app_config (key, value)
VALUES ('season_documentary_llm_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- PostgREST schema-cache reload, så RPC'en og den nye tabel er tilgængelige
-- for PostgREST umiddelbart efter apply (mirror get_season_honours-migrationen).
NOTIFY pgrst, 'reload schema';

COMMIT;
