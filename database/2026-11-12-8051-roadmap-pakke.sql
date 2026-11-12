-- =============================================================================
-- 2026-11-12 · #8051 - roadmap-pakke 12/11: sammenlaegninger, status og fire nye punkter
-- =============================================================================
-- Ejer-ja 12/11 med een aendring: "En bedre loebsside" (#7778) og "Én
-- planlaegningsside" (#7535) bliver staaende paa denne uge (this_week), uroert.
--
-- Hvad filen goer (kun roadmap_items; roadmap_votes roeres aldrig):
--   A1. XP-modellen #6110: den stemte raekke overlever som "i gang" med samlet
--       tekst (ordet Potentiale, #3564 foldet ind); den tomme dublet arkiveres.
--   A2. Traen nu #7737: den stemte raekke overtager beta-koblingen (flag_key,
--       beta_since) fra den tomme beta-raekke, som arkiveres.
--   B.  Auto-pris #2176 kobles til kontakten auto_accept_enabled (beta 11/11).
--       Pengelaasen #6181 kobles til market_commitment_6181 og staar som leveret:
--       tændt for alle 12/11 kl. 12:52 dansk tid (11:52:25 UTC), samme moenster
--       som tidligere taendinger (status shipped, shipped_at = flip-tidspunktet).
--       Holdplaner, troejejagt, bjergudbrud, Traen nu-bonus, ranglister,
--       tidsgraense-varsel og traethed lige nu: "i gang".
--   C.  Fire nye punkter (faste id'er, ON CONFLICT DO NOTHING).
--   E.  Valgfrie punkter staar udkommenteret og koeres IKKE.
--
-- Konsekvens at kende: shipped paa pengelaasen goer, at roadmapDeliveredNotify
-- sender "leveret"-beskeden til de managere, der gav 5-6 paa punktet (en gang).
--
-- Kontakterne flytter selv koblede punkter (triggerne fra
-- 2026-10-05-5387-roadmap-hub.sql). Filen laeser derfor kontaktens stadie og
-- forventer den tilstand, triggeren giver: beta = i gang + beta_since, on =
-- leveret + shipped_at. Staar en kontakt paa off eller mangler den, stopper
-- filen hoejlydt (ejeren har trukket noget tilbage, pakken skal vurderes paa ny).
--
-- Idempotent: hver vagt accepterer foer- eller efter-tilstanden, hver UPDATE
-- springer over naar raekken allerede er rettet, INSERT er ON CONFLICT DO NOTHING.
-- En anden koersel aendrer intet (bevist i PR'en i en transaktion med ROLLBACK).
-- Slutkontrollen fejler hele transaktionen, hvis stemmetallet aendres, et punkt
-- mangler, eller status/horisont/kobling ikke er som forventet.
--
-- Laest read-only mod prod 12/11: 308 punkter, 2.984 stemmer -> 312 / 2.984.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- =============================================================================

SET lock_timeout = '3s';
BEGIN;

DO $rm$
DECLARE
  v_votes_before  bigint;
  v_items_before  bigint;
  v_found         text;
  v_bad           text;
  v_stage_train   text;
  v_stage_accept  text;
  v_stage_money   text;
  v_cfg_train     timestamptz;
  v_cfg_accept    timestamptz;
  v_old_beta      timestamptz;
  v_old_shipped   timestamptz;
  r               record;
BEGIN
  SELECT count(*) INTO v_votes_before FROM public.roadmap_votes;
  SELECT count(*) INTO v_items_before FROM public.roadmap_items;

  -- ---------------------------------------------------------------------------
  -- Vagt 1: kontakterne staar, hvor pakken forventer (beta eller on, aldrig off).
  -- ---------------------------------------------------------------------------
  SELECT value #>> '{}', updated_at INTO v_stage_train, v_cfg_train
    FROM public.app_config WHERE key = 'training_train_now_instant';
  SELECT value #>> '{}', updated_at INTO v_stage_accept, v_cfg_accept
    FROM public.app_config WHERE key = 'auto_accept_enabled';
  SELECT value #>> '{}' INTO v_stage_money
    FROM public.app_config WHERE key = 'market_commitment_6181';
  IF v_stage_train IS NULL OR v_stage_train NOT IN ('beta', 'on', 'true')
     OR v_stage_accept IS NULL OR v_stage_accept NOT IN ('beta', 'on', 'true') THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: Traen nu- eller auto-pris-kontakten er ikke beta/on, vurder paa ny';
  END IF;
  IF v_stage_money IS DISTINCT FROM 'on' AND v_stage_money IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: pengelaasen (market_commitment_6181) er ikke on, vurder paa ny';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Vagt 2: dubletterne, der arkiveres, skal vaere uden stemmer.
  -- ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.roadmap_votes WHERE item_id IN
      ('9c44fee0-e081-45ec-b325-08eddcc638d4', '6c187e69-8893-4345-8848-19abb1d445cd')) THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: en dublet har faaet stemmer siden 12/11, vurder paa ny';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Vagt 3: forventet status pr. raekke (foer-tilstand eller efter-tilstand).
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM (VALUES
    ('1fdf9eef-3df4-430a-850a-5e76f149e4c6', '6110 XP',          ARRAY['planned', 'in_progress']),
    ('9c44fee0-e081-45ec-b325-08eddcc638d4', '6110 dublet',      ARRAY['in_progress', 'archived']),
    ('9e332238-99b0-499a-968a-ad92eedca374', '7737 Traen nu',    ARRAY['planned', 'in_progress', 'shipped']),
    ('6c187e69-8893-4345-8848-19abb1d445cd', '7737 dublet',      ARRAY['in_progress', 'shipped', 'archived']),
    ('00006149-0000-4000-8000-000000000025', '2176 auto-pris',   ARRAY['planned', 'in_progress', 'shipped']),
    ('c48ac7be-f2de-45e9-959c-b75d89568a16', '6181 pengelaas',   ARRAY['planned', 'in_progress', 'shipped']),
    ('d8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc', '7864 holdplaner',  ARRAY['planned', 'in_progress']),
    ('00005387-0000-4000-8000-000000000202', '5573 troejejagt',  ARRAY['planned', 'in_progress']),
    ('925aa478-2038-4ef8-8063-e03024501911', '6912 bjergudbrud', ARRAY['planned', 'in_progress']),
    ('ca91c33a-4e11-40f8-a7f9-b61513e67642', '7741 bonus',       ARRAY['planned', 'in_progress']),
    ('391b0555-b234-4bcb-a422-1edbbf024433', '6765 ranglister',  ARRAY['planned', 'in_progress']),
    ('32c69b8f-71a9-4a0c-844f-31fb92e60cba', '7715 tidsgraense', ARRAY['planned', 'in_progress']),
    ('213788b8-e450-4d00-9c05-50af274c464e', '6984 traethed',    ARRAY['planned', 'in_progress']),
    ('d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee', '7778 loebsside',   ARRAY['planned']),
    ('2e314b44-132d-4817-8d84-d1c15cc54bf3', '7535 planlaegning', ARRAY['planned'])
  ) AS e(id, label, ok)
  LOOP
    SELECT status INTO v_found FROM public.roadmap_items WHERE id = r.id::uuid FOR UPDATE;
    IF v_found IS NULL OR NOT (v_found = ANY (r.ok)) THEN
      RAISE EXCEPTION 'roadmap-pakke #8051: baseline aendret paa % (status %)', r.label, COALESCE(v_found, 'mangler');
    END IF;
  END LOOP;

  -- ===========================================================================
  -- A1. XP-modellen #6110: stemt raekke overlever, tom dublet arkiveres.
  -- ===========================================================================
  UPDATE public.roadmap_items SET
    status = 'in_progress',
    title_en = 'Development 2.0: XP you can see, and one clear Potential number for every rider, the same on every page, with a word for how sure your scout is.',
    title_da = 'Udvikling 2.0: XP du kan se, og ét tydeligt Potentiale-tal for hver rytter, ens på alle sider, med et ord for hvor sikker din spejder er.',
    updated_at = now()
  WHERE id = '1fdf9eef-3df4-430a-850a-5e76f149e4c6'
    AND (status, title_en, title_da) IS DISTINCT FROM (
      'in_progress',
      'Development 2.0: XP you can see, and one clear Potential number for every rider, the same on every page, with a word for how sure your scout is.',
      'Udvikling 2.0: XP du kan se, og ét tydeligt Potentiale-tal for hver rytter, ens på alle sider, med et ord for hvor sikker din spejder er.');

  UPDATE public.roadmap_items SET status = 'archived', beta_soon = false, live_soon = false, updated_at = now()
  WHERE id = '9c44fee0-e081-45ec-b325-08eddcc638d4' AND status <> 'archived';

  -- ===========================================================================
  -- A2. Traen nu #7737: den stemte raekke overtager koblingen. flag_key er unikt,
  --     saa den gamle raekke slipper den foerst. beta_since/shipped_at flyttes med,
  --     saa datoerne er kontaktens rigtige datoer.
  -- ===========================================================================
  SELECT beta_since, shipped_at INTO v_old_beta, v_old_shipped
    FROM public.roadmap_items WHERE id = '6c187e69-8893-4345-8848-19abb1d445cd';

  UPDATE public.roadmap_items SET flag_key = NULL, status = 'archived', beta_soon = false, live_soon = false, updated_at = now()
  WHERE id = '6c187e69-8893-4345-8848-19abb1d445cd' AND (flag_key IS NOT NULL OR status <> 'archived');

  -- Triggeren roadmap_items_sync_flag saetter status ud fra kontakten (beta/on).
  UPDATE public.roadmap_items SET
    flag_key = 'training_train_now_instant',
    beta_since = COALESCE(beta_since, v_old_beta, v_cfg_train),
    shipped_at = CASE WHEN v_stage_train IN ('on', 'true') THEN COALESCE(shipped_at, v_old_shipped, v_cfg_train) ELSE shipped_at END,
    beta_soon = false, status = 'in_progress',
    title_en = 'Train now takes effect immediately: today''s free training applies at once, and form and fatigue carry into today''s races.',
    title_da = 'Træn nu virker med det samme: dagens ledige træning udføres straks, og form og træthed tæller med i dagens løb.',
    updated_at = now()
  WHERE id = '9e332238-99b0-499a-968a-ad92eedca374'
    AND flag_key IS DISTINCT FROM 'training_train_now_instant'
    AND status IN ('planned', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o
                    WHERE o.flag_key = 'training_train_now_instant' AND o.id <> '9e332238-99b0-499a-968a-ad92eedca374');

  -- ===========================================================================
  -- B. Status rettes
  -- ===========================================================================
  -- Auto-pris #2176: beta siden 11/11 (kontaktens flip-tid). Kobles til kontakten.
  UPDATE public.roadmap_items SET
    flag_key = 'auto_accept_enabled', status = 'in_progress',
    beta_since = COALESCE(beta_since, '2026-11-11 19:56:39.440618+00'::timestamptz),
    shipped_at = CASE WHEN v_stage_accept IN ('on', 'true') THEN COALESCE(shipped_at, v_cfg_accept) ELSE shipped_at END,
    beta_soon = false, updated_at = now()
  WHERE id = '00006149-0000-4000-8000-000000000025'
    AND flag_key IS DISTINCT FROM 'auto_accept_enabled'
    AND status IN ('planned', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o WHERE o.flag_key = 'auto_accept_enabled'
                    AND o.id <> '00006149-0000-4000-8000-000000000025');

  -- Pengelaas #6181: beta 11/11, tændt for alle 12/11 12:52 dansk tid -> leveret.
  -- shipped_at saettes eksplicit, saa triggeren ikke stempler apply-tidspunktet.
  UPDATE public.roadmap_items SET
    flag_key = 'market_commitment_6181', status = 'shipped',
    beta_since = COALESCE(beta_since, '2026-11-11 19:53:07+00'::timestamptz),
    shipped_at = COALESCE(shipped_at, '2026-11-12 11:52:25.584128+00'::timestamptz),
    beta_soon = false, live_soon = false, updated_at = now()
  WHERE id = 'c48ac7be-f2de-45e9-959c-b75d89568a16'
    AND flag_key IS DISTINCT FROM 'market_commitment_6181'
    AND status IN ('planned', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items o WHERE o.flag_key = 'market_commitment_6181'
                    AND o.id <> 'c48ac7be-f2de-45e9-959c-b75d89568a16');

  -- Holdplaner #7864: i gang, beta snart.
  UPDATE public.roadmap_items SET status = 'in_progress', beta_soon = true, updated_at = now()
  WHERE id = 'd8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc' AND status = 'planned';

  -- I gang (bygget eller under bygning, ingen kontakt i beta):
  -- troejejagt #5573/#7855, bjergudbrud #6912, Traen nu-bonus #7741, ranglister #6765,
  -- tidsgraense-varsel #7715 (live_soon saettes ikke), traethed lige nu #7801 (= #6984-raekken).
  UPDATE public.roadmap_items SET status = 'in_progress', updated_at = now()
  WHERE id IN ('00005387-0000-4000-8000-000000000202', '925aa478-2038-4ef8-8063-e03024501911',
               'ca91c33a-4e11-40f8-a7f9-b61513e67642', '391b0555-b234-4bcb-a422-1edbbf024433',
               '32c69b8f-71a9-4a0c-844f-31fb92e60cba', '213788b8-e450-4d00-9c05-50af274c464e')
    AND status = 'planned';

  -- Loebssiden #7778 og planlaegningssiden #7535: UROERT paa denne uge (ejer 12/11:
  -- "Dette skal stadig laves denne uge"). Kun med i slutkontrollen.

  -- ===========================================================================
  -- C. Fire nye punkter. Troejejagt (#7855) og traethed lige nu (#7801) faar IKKE
  --    ny raekke: de daekkes af #5573- og #6984-raekkerne ovenfor.
  -- ===========================================================================
  INSERT INTO public.roadmap_items (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, category) VALUES
  ('f0427fcb-97ec-49f9-b8bd-7f13d29aa956', 'races', 1501,
   'Attack after any climb you choose, not only the last one, picked by the climb''s name.',
   'Angrib efter den stigning, du vælger, ikke kun den sidste, valgt ved stigningens navn.',
   true, 'planned', 'next_week', 7884, 'tactics'),
  ('5cd73cc7-0ec5-466d-8e45-200331487027', 'races', 1502,
   'The race film tells an attack as it happens: the attack, the gap along the way, and whether he is caught or stays away, each at the time it really happened.',
   'Løbsfilmen fortæller et angreb, mens det sker: angrebet, forspringet undervejs, og om han bliver hentet eller holder, hver ting på det tidspunkt, det rent faktisk skete.',
   true, 'planned', 'next_week', 8045, 'race_film'),
  ('edf177c7-dbb0-45e6-85e6-0d63b9d4dca0', 'races', 1503,
   'Long descents: groups far behind no longer gain minutes on the group in front.',
   'Lange nedkørsler: grupper langt bagude henter ikke længere minutter på gruppen foran.',
   true, 'planned', 'next_week', 7644, 'race_engine'),
  ('136efc1d-7aca-4e85-9c7d-f11b88639198', 'youth', 1504,
   'New squad limits: up to 30 riders each on senior, U23 and junior, and at most 60 in total. The limits are temporary until U23 and junior are final.',
   'Nye trupgrænser: op til 30 ryttere på hver af senior, U23 og junior, og højst 60 i alt. Grænserne er midlertidige, indtil U23 og junior er endeligt udgivet.',
   true, 'in_progress', 'this_week', 8034, 'academy')
  ON CONFLICT (id) DO NOTHING;

  -- ===========================================================================
  -- E. VALGFRIT, KOERES IKKE (fjern kommentarerne kun efter eget ejer-ja pr. punkt)
  -- ===========================================================================
  -- E1. Kun hvis den nye nedkoersel-raekke (#7644) beholdes: tag nedkoersel-leddet
  --     ud af #6912-titlen (ejeren valgte selv den nuvaerende titel 10/11).
  -- UPDATE public.roadmap_items SET title_en = 'Mountain breakaways get a fair chance.',
  --   title_da = 'Bjergudbrud får en fair chance.', updated_at = now()
  -- WHERE id = '925aa478-2038-4ef8-8063-e03024501911';
  -- E2. #5950 (race_day_role_yield_enabled er on siden 1/11; ejer saa den som delvis 10/11) -> leveret.
  -- UPDATE public.roadmap_items SET status = 'shipped', shipped_at = COALESCE(shipped_at, '2026-11-01 12:00:00+00'::timestamptz),
  --   beta_soon = false, live_soon = false, updated_at = now()
  -- WHERE id = 'f8aa4a4c-ae9d-49d3-9fe2-d995dae92ba5' AND status = 'planned';
  -- E3. Ordet Potentiale i en eksisterende idé:
  -- UPDATE public.roadmap_items SET title_en = 'A message when an academy rider''s Potential is revealed.',
  --   title_da = 'En besked, når en akademirytters Potentiale er afsløret.', updated_at = now()
  -- WHERE id = '3941b33d-b04d-49e5-ba3e-aaac0a206adb';

  -- ===========================================================================
  -- SLUTKONTROL: fejler hele transaktionen, hvis noget ikke er som forventet.
  -- ===========================================================================
  IF (SELECT count(*) FROM public.roadmap_votes) <> v_votes_before THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: stemmetallet er aendret';
  END IF;
  IF (SELECT count(*) FROM public.roadmap_items) NOT BETWEEN v_items_before AND v_items_before + 4 THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: forkert antal raekker';
  END IF;

  SELECT string_agg(e.id, ', ') INTO v_bad
  FROM (VALUES
    ('1fdf9eef-3df4-430a-850a-5e76f149e4c6', 'in_progress', 'this_week'),
    ('9c44fee0-e081-45ec-b325-08eddcc638d4', 'archived',    'this_week'),
    ('9e332238-99b0-499a-968a-ad92eedca374', CASE WHEN v_stage_train IN ('on', 'true') THEN 'shipped' ELSE 'in_progress' END, 'this_week'),
    ('6c187e69-8893-4345-8848-19abb1d445cd', 'archived',    'unscheduled'),
    ('00006149-0000-4000-8000-000000000025', CASE WHEN v_stage_accept IN ('on', 'true') THEN 'shipped' ELSE 'in_progress' END, 'this_week'),
    ('c48ac7be-f2de-45e9-959c-b75d89568a16', 'shipped',     'this_week'),
    ('d8d17a3d-0fd4-42e7-b6b0-e1916c7e02cc', 'in_progress', 'this_week'),
    ('00005387-0000-4000-8000-000000000202', 'in_progress', 'this_week'),
    ('925aa478-2038-4ef8-8063-e03024501911', 'in_progress', 'next_week'),
    ('ca91c33a-4e11-40f8-a7f9-b61513e67642', 'in_progress', 'this_week'),
    ('391b0555-b234-4bcb-a422-1edbbf024433', 'in_progress', 'this_week'),
    ('32c69b8f-71a9-4a0c-844f-31fb92e60cba', 'in_progress', 'this_week'),
    ('213788b8-e450-4d00-9c05-50af274c464e', 'in_progress', 'this_week'),
    ('d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee', 'planned',     'this_week'),
    ('2e314b44-132d-4817-8d84-d1c15cc54bf3', 'planned',     'this_week'),
    ('f0427fcb-97ec-49f9-b8bd-7f13d29aa956', 'planned',     'next_week'),
    ('5cd73cc7-0ec5-466d-8e45-200331487027', 'planned',     'next_week'),
    ('edf177c7-dbb0-45e6-85e6-0d63b9d4dca0', 'planned',     'next_week'),
    ('136efc1d-7aca-4e85-9c7d-f11b88639198', 'in_progress', 'this_week')
  ) AS e(id, st, hz)
  LEFT JOIN public.roadmap_items i ON i.id = e.id::uuid
  WHERE i.id IS NULL OR i.status <> e.st OR i.horizon <> e.hz;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: forkert sluttilstand paa %', v_bad;
  END IF;

  -- Koblingerne: rigtig kontakt paa rigtig raekke, med dato.
  IF (SELECT flag_key FROM public.roadmap_items WHERE id = '9e332238-99b0-499a-968a-ad92eedca374') IS DISTINCT FROM 'training_train_now_instant'
     OR (SELECT flag_key FROM public.roadmap_items WHERE id = '00006149-0000-4000-8000-000000000025') IS DISTINCT FROM 'auto_accept_enabled'
     OR (SELECT flag_key FROM public.roadmap_items WHERE id = 'c48ac7be-f2de-45e9-959c-b75d89568a16') IS DISTINCT FROM 'market_commitment_6181'
     OR (SELECT flag_key FROM public.roadmap_items WHERE id = '6c187e69-8893-4345-8848-19abb1d445cd') IS NOT NULL
     OR (SELECT beta_since FROM public.roadmap_items WHERE id = '9e332238-99b0-499a-968a-ad92eedca374') IS NULL
     OR (SELECT beta_since FROM public.roadmap_items WHERE id = '00006149-0000-4000-8000-000000000025') IS NULL
     OR (SELECT shipped_at FROM public.roadmap_items WHERE id = 'c48ac7be-f2de-45e9-959c-b75d89568a16') IS NULL THEN
    RAISE EXCEPTION 'roadmap-pakke #8051: en kobling eller dato mangler';
  END IF;
END
$rm$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Post-verify (read-only, koeres efter apply):
--   1. SELECT (SELECT count(*) FROM public.roadmap_items) AS items,
--             (SELECT count(*) FROM public.roadmap_votes) AS votes;          -- 312 / 2984 (eller dagens tal, stemmer uaendret)
--   2. SELECT flag_key, status, beta_since, shipped_at FROM public.roadmap_items
--        WHERE flag_key IN ('training_train_now_instant', 'auto_accept_enabled', 'market_commitment_6181');
--        -- Traen nu + auto-pris: in_progress + beta_since; pengelaas: shipped, shipped_at 2026-11-12 11:52:25 UTC
--   3. SELECT status, horizon FROM public.roadmap_items
--        WHERE id IN ('d78b3b0c-0eaf-4bb5-a32d-c485e2dc71ee', '2e314b44-132d-4817-8d84-d1c15cc54bf3');  -- planned, this_week (uroert)
--   4. node scripts/roadmap-drift.mjs (read-only): Beta-drift tom for de tre kontakter.
--
-- Rollback: staar med vilje ikke som koerbar SQL her (auto-migrate koerer database/2026-*.sql).
-- Skal pakken fortrydes: et ejer-gated script i database/manual/ med de modsatte
-- saetninger (slet de fire nye raekker, hvis de stadig er uden stemmer; status
-- tilbage til planned; flag_key af auto-pris og pengelaas; Traen nu-koblingen
-- tilbage paa 6c187e69; XP-titlen tilbage og 9c44fee0 tilbage til in_progress).
-- Foer-tilstanden staar i PR-body'en paa #8051. NB: en "leveret"-besked, der
-- allerede er sendt for pengelaasen, kan ikke kaldes tilbage. Stemmer roeres aldrig.
-- =============================================================================
