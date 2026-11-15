-- =============================================================================
-- 2026-11-13 · #8129 - roadmap-pakke 13/11: holdplaner-dublet, trupgraenser,
-- loebssiden og fire koblinger
-- =============================================================================
-- Ejer-go paa fire kort 13/11 (svarene staar ordret i #8129 og i PR'en).
--
-- Hvad filen goer (kun roadmap_items; roadmap_votes roeres aldrig, ingen tekst aendres):
--   1. Holdplaner #7864 ("Ja, behold den med stemmerne"): sync-dubletten
--      15634206 (0 stemmer, baerer tactics_ready_7864) slipper kontakten og
--      arkiveres FOERST; derefter faar den stemte raekke d8d17a3d kontakten og
--      viser selv "i beta". Stemmerne flyttes ikke.
--   2. Trupgraenser #8034 ("Planlagt og flyt til naeste uge"): 136efc1d til
--      planned + next_week. Intet bygget, ingen aaben PR eller gren 13/11.
--   3. Loebssiden #7778 ("I gang, koblet til kontakten"): d78b3b0c til
--      in_progress og kobles til race_page_v6.
--   4. Fire koblinger uden statusskift ("Ja, kobl alle fire"):
--      troejejagt #5573 -> jersey_hunt_7855, Udvikling 2.0 #6110 ->
--      development_xp_model, Traen nu-bonus #7741 -> training_train_now_bonus,
--      ranglister #6765 -> ranking_shadow_decoupled_6765.
--
-- Kontakterne flytter selv koblede punkter (triggerne fra
-- 2026-10-05-5387-roadmap-hub.sql): beta = i gang + beta_since, on = leveret.
-- Koblingerne i punkt 3 og 4 er til slukkede kontakter, saa triggeren roerer
-- ikke status. Staar en af dem paa on, eller mangler den i app_config, stopper
-- filen hoejlydt: en "leveret"-besked er ikke det, ejeren valgte. Holdplanernes
-- kontakt skal vaere beta eller on (aldrig off eller manglende).
--
-- flag_key er unik (roadmap_items_flag_key_uniq), derfor raekkefoelgen i punkt 1.
--
-- Idempotent: hver vagt accepterer foer- eller efter-tilstanden, hver UPDATE
-- springer over, naar raekken allerede er rettet. Slutkontrollen fejler hele
-- transaktionen, hvis stemmetallet aendres, en kontakt staar paa to raekker,
-- eller status/horisont/kobling ikke er som forventet. Proeven ligger i
-- backend/lib/testdb/roadmapPakke8129.integration.test.js.
--
-- Laest read-only mod prod 13/11: 314 punkter, 2.993 stemmer, 0 dobbelte
-- kontakter. Efter koersel: 314 / 2.993 / 0.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- =============================================================================

SET lock_timeout = '3s';
-- REPEATABLE READ: stemmetallet foer og efter laeses i samme snapshot, saa en
-- spiller, der stemmer paa et andet punkt imens, ikke vaelter pakken.
BEGIN ISOLATION LEVEL REPEATABLE READ;

DO $rm$
DECLARE
  v_votes_before  bigint;
  v_items_before  bigint;
  v_voted_before  bigint;
  v_stage_tactics text;
  v_found         text;
  v_flag          text;
  v_bad           text;
  r               record;
BEGIN
  SELECT count(*) INTO v_votes_before FROM public.roadmap_votes;
  SELECT count(*) INTO v_items_before FROM public.roadmap_items;
  SELECT count(*) INTO v_voted_before FROM public.roadmap_votes
    WHERE item_id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc';

  -- ---------------------------------------------------------------------------
  -- Vagt 1: kontakterne staar, hvor pakken forventer.
  -- ---------------------------------------------------------------------------
  SELECT value #>> '{}' INTO v_stage_tactics FROM public.app_config WHERE key = 'tactics_ready_7864';
  IF v_stage_tactics IS NULL OR v_stage_tactics NOT IN ('beta', 'on', 'true') THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: holdplanernes kontakt er ikke beta/on, vurder paa ny';
  END IF;

  SELECT string_agg(k.key, ', ') INTO v_bad
  FROM (VALUES ('race_page_v6'), ('jersey_hunt_7855'), ('development_xp_model'),
               ('training_train_now_bonus'), ('ranking_shadow_decoupled_6765')) AS k(key)
  LEFT JOIN public.app_config c ON c.key = k.key
  WHERE c.key IS NULL OR (c.value #>> '{}') NOT IN ('off', 'false', 'beta');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: kontakt mangler eller staar paa on: %, vurder paa ny', v_bad;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Vagt 2: dubletten, der arkiveres, skal vaere uden stemmer.
  -- ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.roadmap_votes WHERE item_id = '15634206-1cae-4b9a-81c7-d7b4d5841dd8') THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: holdplaner-dubletten har faaet stemmer siden 13/11, vurder paa ny';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Vagt 3: status, horisont og kobling pr. raekke (foer- eller efter-tilstand).
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM (VALUES
    ('15634206-1cae-4b9a-81c7-d7b4d5841dd8', '7864 dublet',     ARRAY['in_progress', 'archived'], NULL::text[],                    'tactics_ready_7864'),
    ('d8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc', '7864 holdplaner', ARRAY['in_progress', 'shipped'],  ARRAY['this_week'],              'tactics_ready_7864'),
    ('136efc1d-7aca-4e85-9c7d-f11b88639198', '8034 trupper',    ARRAY['in_progress', 'planned'],  ARRAY['this_week', 'next_week'], NULL),
    ('d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee', '7778 loebsside',  ARRAY['planned', 'in_progress'],  ARRAY['this_week'],              'race_page_v6'),
    ('00005387-0000-4000-8000-000000000202', '5573 troejejagt', ARRAY['in_progress'],             ARRAY['this_week'],              'jersey_hunt_7855'),
    ('1fdf9eef-3df4-430a-850a-5e76f149e4c6', '6110 XP',         ARRAY['in_progress'],             ARRAY['this_week'],              'development_xp_model'),
    ('ca91c33a-4e11-40f8-a7f9-b61513e67642', '7741 bonus',      ARRAY['in_progress'],             ARRAY['this_week'],              'training_train_now_bonus'),
    ('391b0555-b234-4bcb-a422-1edbbf024433', '6765 ranglister', ARRAY['in_progress'],             ARRAY['this_week'],              'ranking_shadow_decoupled_6765')
  ) AS e(id, label, ok, hz, flag)
  LOOP
    SELECT status, flag_key INTO v_found, v_flag FROM public.roadmap_items WHERE id = r.id::uuid FOR UPDATE;
    IF v_found IS NULL OR NOT (v_found = ANY (r.ok)) THEN
      RAISE EXCEPTION 'roadmap-pakke #8129: baseline aendret paa % (status %)', r.label, COALESCE(v_found, 'mangler');
    END IF;
    IF r.hz IS NOT NULL AND NOT ((SELECT horizon FROM public.roadmap_items WHERE id = r.id::uuid) = ANY (r.hz)) THEN
      RAISE EXCEPTION 'roadmap-pakke #8129: horisont aendret paa %', r.label;
    END IF;
    -- Raekken er ukoblet (foer) eller baerer netop pakkens kontakt (efter).
    IF v_flag IS NOT NULL AND v_flag IS DISTINCT FROM r.flag THEN
      RAISE EXCEPTION 'roadmap-pakke #8129: % er koblet til en anden kontakt (%)', r.label, v_flag;
    END IF;
  END LOOP;

  -- Ingen anden raekke maa baere pakkens kontakter (tactics_ready_7864 kun dubletten
  -- eller den stemte raekke; de fem andre kun deres maalraekke).
  SELECT string_agg(i.flag_key || ' paa ' || i.id::text, ', ') INTO v_bad
  FROM public.roadmap_items i
  JOIN (VALUES
    ('tactics_ready_7864',            ARRAY['15634206-1cae-4b9a-81c7-d7b4d5841dd8', 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc']),
    ('race_page_v6',                  ARRAY['d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee']),
    ('jersey_hunt_7855',              ARRAY['00005387-0000-4000-8000-000000000202']),
    ('development_xp_model',          ARRAY['1fdf9eef-3df4-430a-850a-5e76f149e4c6']),
    ('training_train_now_bonus',      ARRAY['ca91c33a-4e11-40f8-a7f9-b61513e67642']),
    ('ranking_shadow_decoupled_6765', ARRAY['391b0555-b234-4bcb-a422-1edbbf024433'])
  ) AS k(flag, ok_ids) ON k.flag = i.flag_key
  WHERE NOT (i.id::text = ANY (k.ok_ids));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: kontakten staar paa en anden raekke: %, vurder paa ny', v_bad;
  END IF;

  -- ===========================================================================
  -- 1. Holdplaner #7864. Foerst slipper dubletten kontakten og arkiveres ...
  -- ===========================================================================
  UPDATE public.roadmap_items SET flag_key = NULL, status = 'archived', beta_soon = false, live_soon = false, updated_at = now()
  WHERE id = '15634206-1cae-4b9a-81c7-d7b4d5841dd8' AND (flag_key IS NOT NULL OR status <> 'archived');

  -- ... saa faar den stemte raekke den. Triggeren roadmap_items_sync_flag saetter
  -- status ud fra kontakten (beta = i gang). beta_since er kontaktens flip-tid
  -- 12/11 (app_config.updated_at, laest 13/11), ikke dublettens oprettelsestid.
  UPDATE public.roadmap_items SET
    flag_key = 'tactics_ready_7864',
    beta_since = COALESCE(beta_since, '2026-11-12 18:02:01.555157+00'::timestamptz),
    beta_soon = false,
    updated_at = now()
  WHERE id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc'
    AND flag_key IS DISTINCT FROM 'tactics_ready_7864'
    AND status = 'in_progress'
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o
                    WHERE o.flag_key = 'tactics_ready_7864' AND o.id <> 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc');

  -- ===========================================================================
  -- 2. Trupgraenser #8034: planlagt, naeste uge.
  -- ===========================================================================
  UPDATE public.roadmap_items SET status = 'planned', horizon = 'next_week', beta_soon = false, live_soon = false, updated_at = now()
  WHERE id = '136efc1d-7aca-4e85-9c7d-f11b88639198'
    AND flag_key IS NULL
    AND (status, horizon) IS DISTINCT FROM ('planned', 'next_week');

  -- ===========================================================================
  -- 3. Loebssiden #7778: i gang, koblet til race_page_v6 (slukket).
  -- ===========================================================================
  UPDATE public.roadmap_items SET flag_key = 'race_page_v6', status = 'in_progress', updated_at = now()
  WHERE id = 'd78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee'
    AND (flag_key IS DISTINCT FROM 'race_page_v6' OR status <> 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o
                    WHERE o.flag_key = 'race_page_v6' AND o.id <> 'd78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee');

  -- ===========================================================================
  -- 4. Fire koblinger til slukkede kontakter, status uroert.
  -- ===========================================================================
  UPDATE public.roadmap_items i SET flag_key = k.flag, updated_at = now()
  FROM (VALUES
    ('00005387-0000-4000-8000-000000000202', 'jersey_hunt_7855'),
    ('1fdf9eef-3df4-430a-850a-5e76f149e4c6', 'development_xp_model'),
    ('ca91c33a-4e11-40f8-a7f9-b61513e67642', 'training_train_now_bonus'),
    ('391b0555-b234-4bcb-a422-1edbbf024433', 'ranking_shadow_decoupled_6765')
  ) AS k(id, flag)
  WHERE i.id = k.id::uuid
    AND i.flag_key IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o WHERE o.flag_key = k.flag);

  -- ===========================================================================
  -- SLUTKONTROL: fejler hele transaktionen, hvis noget ikke er som forventet.
  -- ===========================================================================
  IF (SELECT count(*) FROM public.roadmap_votes) <> v_votes_before
     OR (SELECT count(*) FROM public.roadmap_votes WHERE item_id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc') <> v_voted_before THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: stemmetallet er aendret';
  END IF;
  IF (SELECT count(*) FROM public.roadmap_items) <> v_items_before THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: forkert antal raekker';
  END IF;
  SELECT string_agg(flag_key, ', ') INTO v_bad FROM (
    SELECT flag_key FROM public.roadmap_items WHERE flag_key IS NOT NULL GROUP BY flag_key HAVING count(*) > 1
  ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: kontakt paa flere raekker: %', v_bad;
  END IF;

  SELECT string_agg(e.id, ', ') INTO v_bad
  FROM (VALUES
    ('15634206-1cae-4b9a-81c7-d7b4d5841dd8', 'archived',    'unscheduled', NULL),
    ('d8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc',
       CASE WHEN v_stage_tactics IN ('on', 'true') THEN 'shipped' ELSE 'in_progress' END, 'this_week', 'tactics_ready_7864'),
    ('136efc1d-7aca-4e85-9c7d-f11b88639198', 'planned',     'next_week',   NULL),
    ('d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee', 'in_progress', 'this_week',   'race_page_v6'),
    ('00005387-0000-4000-8000-000000000202', 'in_progress', 'this_week',   'jersey_hunt_7855'),
    ('1fdf9eef-3df4-430a-850a-5e76f149e4c6', 'in_progress', 'this_week',   'development_xp_model'),
    ('ca91c33a-4e11-40f8-a7f9-b61513e67642', 'in_progress', 'this_week',   'training_train_now_bonus'),
    ('391b0555-b234-4bcb-a422-1edbbf024433', 'in_progress', 'this_week',   'ranking_shadow_decoupled_6765')
  ) AS e(id, st, hz, flag)
  LEFT JOIN public.roadmap_items i ON i.id = e.id::uuid
  WHERE i.id IS NULL OR i.status <> e.st OR i.horizon <> e.hz OR i.flag_key IS DISTINCT FROM e.flag;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: forkert sluttilstand paa %', v_bad;
  END IF;

  -- Den stemte holdplan-raekke viser "i beta": beta_since er sat.
  IF (SELECT beta_since FROM public.roadmap_items WHERE id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc') IS NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: holdplanerne mangler beta-dato';
  END IF;

  -- Ingen raekke, filen roerer, er shipped, medmindre dens kontakt er on.
  SELECT string_agg(i.id::text, ', ') INTO v_bad
  FROM public.roadmap_items i
  LEFT JOIN public.app_config c ON c.key = i.flag_key
  WHERE i.id IN ('15634206-1cae-4b9a-81c7-d7b4d5841dd8', 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc',
                 '136efc1d-7aca-4e85-9c7d-f11b88639198', 'd78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee',
                 '00005387-0000-4000-8000-000000000202', '1fdf9eef-3df4-430a-850a-5e76f149e4c6',
                 'ca91c33a-4e11-40f8-a7f9-b61513e67642', '391b0555-b234-4bcb-a422-1edbbf024433')
    AND i.status = 'shipped'
    AND (c.key IS NULL OR (c.value #>> '{}') NOT IN ('on', 'true'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8129: leveret uden taendt kontakt paa %', v_bad;
  END IF;
END
$rm$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Post-verify (read-only, koeres efter apply):
--   1. SELECT (SELECT count(*) FROM public.roadmap_items) AS items,
--             (SELECT count(*) FROM public.roadmap_votes) AS votes;   -- 314 / 2993 (eller dagens tal, stemmer uaendret)
--   2. SELECT flag_key, count(*) FROM public.roadmap_items WHERE flag_key IS NOT NULL
--        GROUP BY 1 HAVING count(*) > 1;                               -- 0 raekker
--   3. SELECT id, status, horizon, flag_key, beta_since IS NOT NULL AS beta
--        FROM public.roadmap_items WHERE id IN (
--        '15634206-1cae-4b9a-81c7-d7b4d5841dd8', 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc',
--        '136efc1d-7aca-4e85-9c7d-f11b88639198', 'd78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee',
--        '00005387-0000-4000-8000-000000000202', '1fdf9eef-3df4-430a-850a-5e76f149e4c6',
--        'ca91c33a-4e11-40f8-a7f9-b61513e67642', '391b0555-b234-4bcb-a422-1edbbf024433');
--        -- dublet archived/NULL; holdplaner in_progress + beta; trupper planned/next_week;
--        -- loebsside in_progress/race_page_v6; de fire in_progress med hver sin kontakt.
--   4. SELECT count(*) FROM public.roadmap_votes
--        WHERE item_id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc';     -- 11 (uaendret)
--   5. node scripts/roadmap-drift.mjs (read-only): ingen drift paa de seks kontakter.
--
-- Rollback: staar med vilje ikke som koerbar SQL her (auto-migrate koerer database/2026-*.sql).
-- Skal pakken fortrydes: et ejer-gated script i database/manual/ med de modsatte
-- saetninger (flag_key af de fem koblinger; loebssiden tilbage til planned;
-- trupper tilbage til in_progress/this_week; tactics_ready_7864 tilbage paa
-- 15634206 og den tilbage til in_progress, i omvendt raekkefoelge af punkt 1).
-- Foer-tilstanden staar i PR-body'en paa #8129. Stemmer roeres aldrig.
-- =============================================================================
