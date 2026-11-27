-- =============================================================================
-- 2026-11-27 · #8719 · roadmap runde 4: spillerønsker, planlagt -> idé, udskydelser
-- =============================================================================
-- Ejer 27/11 (AskUserQuestion i hovedsessionen, ét emne pr. spørgsmål; svarene står
-- på #8719). Kilde: read-only gennemgang af Discord + GitHub + roadmappet.
-- Kun roadmap_items. Hver ændring er bundet til id OG issue_ref; INSERT springer over,
-- når issuet allerede har en ikke-arkiveret række. Idempotent. Stemmer røres ikke.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- =============================================================================

SET lock_timeout = '3s';
BEGIN ISOLATION LEVEL REPEATABLE READ;

DO $r4$
DECLARE
  v_votes_before bigint;
BEGIN
  SELECT count(*) INTO v_votes_before FROM public.roadmap_votes;

  -- 1. Planlagt -> idé (ejer: "Ja, tilbage til idé"; #7892 ejer: "Til ide").
  UPDATE public.roadmap_items AS r
  SET status = 'active', horizon = 'unscheduled', updated_at = now()
  FROM (VALUES
    ('00006149-0000-4000-8000-000000000012'::uuid, 3463),
    ('00006149-0000-4000-8000-000000000013'::uuid, 4957),
    ('00006149-0000-4000-8000-000000000014'::uuid, 5106),
    ('00000954-0000-4000-8000-000000000019'::uuid, 1177),
    ('00005387-0000-4000-8000-000000000211'::uuid, 5063),
    ('00005387-0000-4000-8000-000000000210'::uuid, 5238),
    ('00005387-0000-4000-8000-000000000215'::uuid, 4620),
    ('e958aa49-2822-4d98-a6b6-7f2cc5f85e6b'::uuid, 4621),
    ('00000954-0000-4000-8000-000000000013'::uuid, 7892)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.status = 'planned';

  -- 2. Arkivér dubletter: #934 har allerede en idé-række (00005387-...205), og #1140
  --    slås sammen med #8084 (ejer: "Slå sammen med #8084").
  UPDATE public.roadmap_items AS r
  SET status = 'archived', updated_at = now()
  FROM (VALUES
    ('00000954-0000-4000-8000-000000000014'::uuid, 934),
    ('7fe90ddf-7838-4df4-a460-607589b5214d'::uuid, 1140)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.status = 'planned';

  -- 3. Udskudt (ejer): #7565 og #7708 -> uge 52, #961 -> januar (uge 2), #8829 -> Q1 2027.
  --    #5950 og #5113 beholder uge 51 (ejer: "Behold uge 51").
  UPDATE public.roadmap_items AS r
  SET horizon = v.horizon, updated_at = now()
  FROM (VALUES
    ('d9680bb1-3b33-44f7-811e-9c126aeace51'::uuid, 7565, '2026-W52'),
    ('5ac54f2e-3e98-4428-a0c3-0ca4b390dd66'::uuid, 7708, '2026-W52'),
    ('7bc4bac9-b963-4397-b613-096961ec073c'::uuid, 961, '2027-W02'),
    ('00005387-0000-4000-8000-000000000216'::uuid, 8829, 'q1_2027')
  ) AS v(id, issue, horizon)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.horizon IS DISTINCT FROM v.horizon;

  -- 4. Leveret: #7924 sortering efter scoutet potentiale (PR #8652, 9e2ed24b, live).
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, now()), beta_soon = false, live_soon = false, updated_at = now()
  WHERE r.id = '7ad96a5b-0021-4f03-a17a-4ac26766c3eb' AND r.issue_ref = 7924 AND r.status IS DISTINCT FROM 'shipped';

  -- 5. Nye punkter fra spillernes ønsker (ejer: "Ja, som idé" / "Ja, planlagt i dag").
  --    engine + sort_order kopieres fra en eksisterende række i samme område.
  INSERT INTO public.roadmap_items (engine, category, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  SELECT src.engine, v.category, src.sort_order, v.title_en, v.title_da, true, v.status, v.horizon, v.issue
  FROM (VALUES
    (8672, 'training', 'c460f604-5748-4d91-888c-e406e7ddcf29'::uuid, 'active', 'unscheduled',
     'One tap sets the whole training week.', 'Ét tryk sætter hele ugens træning.'),
    (8090, 'market', '68c03c33-70b3-4cc9-aac8-a36062b32dd6'::uuid, 'active', 'unscheduled',
     'See a bought rider who is still racing for his old team.', 'Se en købt rytter, der stadig kører for sit gamle hold.'),
    (8857, 'races', 'a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 'planned', '2026-11-27',
     'Climb details on every stage profile, also on the planning page.', 'Stigningsdetaljer på alle etapeprofiler, også på planlægningssiden.'),
    (8609, 'races', 'a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 'planned', '2026-11-27',
     'Cobbles and gravel sectors on every stage profile.', 'Brosten og grus-sektorer på alle etapeprofiler.'),
    (8781, 'selection', 'a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 'planned', '2026-11-27',
     'A season grid for selections, route fit, form and load.', 'Et sæsonoverblik over udtagelse, rutematch, form og belastning.'),
    (8856, 'training', 'c460f604-5748-4d91-888c-e406e7ddcf29'::uuid, 'planned', '2026-11-27',
     'The training report shows what was actually trained.', 'Træningsrapporten viser, hvad der faktisk er trænet.'),
    (8798, 'training', 'c460f604-5748-4d91-888c-e406e7ddcf29'::uuid, 'active', 'unscheduled',
     'Your own named training programs.', 'Dine egne navngivne træningsprogrammer.'),
    (8703, 'training', 'c460f604-5748-4d91-888c-e406e7ddcf29'::uuid, 'active', 'unscheduled',
     'The same effort colours in the program picker.', 'De samme indsatsfarver i programvælgeren.'),
    (8117, 'club', 'f79233f8-fac5-44c9-b791-d44b01843f55'::uuid, 'active', 'unscheduled',
     'Your board''s identity explained: what it values and why.', 'Din bestyrelses identitet forklaret: hvad den lægger vægt på og hvorfor.'),
    (8501, 'races', 'a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 'active', 'unscheduled',
     'Top 10 first in the stage result.', 'Top 10 først i etaperesultatet.')
  ) AS v(issue, category, src_id, status, horizon, title_en, title_da)
  JOIN public.roadmap_items AS src ON src.id = v.src_id
  WHERE NOT EXISTS (SELECT 1 FROM public.roadmap_items r WHERE r.issue_ref = v.issue AND r.status <> 'archived');

  -- Spillerønske fra Discord uden issue (ejer: "Ja, som idé"): tråde pr. roadmap-idé.
  INSERT INTO public.roadmap_items (engine, category, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  SELECT src.engine, 'social', src.sort_order, 'Discuss each roadmap idea in its own thread.',
         'Diskutér hver roadmap-idé i sin egen tråd.', true, 'active', 'unscheduled', NULL
  FROM public.roadmap_items AS src
  WHERE src.id = 'f79233f8-fac5-44c9-b791-d44b01843f55'
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE title_en = 'Discuss each roadmap idea in its own thread.');

  -- Slutkontrol.
  IF (SELECT count(*) FROM public.roadmap_votes) <> v_votes_before THEN
    RAISE EXCEPTION '#8719 runde 4: stemmetallet aendrede sig';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roadmap_items WHERE id IN (
       '00006149-0000-4000-8000-000000000012', '00006149-0000-4000-8000-000000000013',
       '00006149-0000-4000-8000-000000000014', '00000954-0000-4000-8000-000000000019',
       '00005387-0000-4000-8000-000000000211', '00005387-0000-4000-8000-000000000210',
       '00005387-0000-4000-8000-000000000215', 'e958aa49-2822-4d98-a6b6-7f2cc5f85e6b',
       '00000954-0000-4000-8000-000000000013') AND status = 'planned') THEN
    RAISE EXCEPTION '#8719 runde 4: planlagt -> idé blev ikke gennemført';
  END IF;
  IF (SELECT count(*) FROM public.roadmap_items
      WHERE issue_ref IN (8672, 8090, 8857, 8609, 8781, 8856, 8798, 8703, 8117, 8501) AND status <> 'archived') < 10 THEN
    RAISE EXCEPTION '#8719 runde 4: nye punkter mangler';
  END IF;
END
$r4$;

COMMIT;
