-- =============================================================================
-- 2026-11-28 · #8719 · roadmap på skiftedagen: passerede datoer og leverede punkter
-- =============================================================================
-- Ejer 28/11 (AskUserQuestion i hovedsessionen, ét punkt ad gangen; svarene står
-- på #8719). Kun roadmap_items. Hver ændring er bundet til id OG issue_ref og rører
-- kun rækker, der stadig står som før. Idempotent. Stemmer røres ikke.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- #7323, #7325, #8180 og #8522 flyttes først efter skiftet i aften, når de er set virke.
-- =============================================================================

SET lock_timeout = '3s';
BEGIN ISOLATION LEVEL REPEATABLE READ;

DO $r5$
DECLARE
  v_votes_before bigint;
  v_votes_after bigint;
BEGIN
  SELECT count(*) INTO v_votes_before FROM public.roadmap_votes;

  -- 1. Leveret (ejer: "Begge leveret nu" og "Leveret nu").
  --    #8592 Kun denne dag (tændt 28/11), #8856 træningsrapporten (live 27/11),
  --    #7471 + #8259 S6-kalenderen (#8836, skrevet til S6).
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, now()), beta_soon = false, live_soon = false, updated_at = now()
  FROM (VALUES
    ('23f166d1-f97a-409a-ab81-ff593ba74d2d'::uuid, 8592),
    ('5a588769-7ee0-43ab-aab2-d8e911e70281'::uuid, 8856),
    ('3f3530a9-2de8-4249-a93d-73ea2af68941'::uuid, 7471),
    ('55deb42a-938a-4757-9882-521c8d7bdf51'::uuid, 8259)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.status IS DISTINCT FROM 'shipped';

  -- 2. Ny dato (ejer): #8604 trend-prognose og #8614 AI-hold fryses i dag (tænding efter
  --    skiftet), planlægnings-pakken #8419/#8781/#8609 live søndag 29/11, #8857 uge 49.
  UPDATE public.roadmap_items AS r
  SET horizon = v.horizon, updated_at = now()
  FROM (VALUES
    ('a85f958a-c5a9-4fe3-98ed-ab7d1ab09e3c'::uuid, 8604, '2026-11-28'),
    ('fda1fcca-8af7-4734-98b7-30f803b0d63f'::uuid, 8614, '2026-11-28'),
    ('a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 8419, '2026-11-29'),
    ('93ee9da6-f31b-49aa-8ca2-7634a150bfb1'::uuid, 8781, '2026-11-29'),
    ('5fe64ae8-8ea1-4b54-9ed0-22f279896d06'::uuid, 8609, '2026-11-29'),
    ('570270a7-a52a-45bb-9bcf-a67457b8a784'::uuid, 8857, '2026-W49')
  ) AS v(id, issue, horizon)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.status <> 'shipped' AND r.horizon IS DISTINCT FROM v.horizon;

  -- 3. #7455 scouting-viden: merges i dag (ejer "merge"), så den står som i gang.
  UPDATE public.roadmap_items AS r
  SET status = 'in_progress', updated_at = now()
  WHERE r.id = '68c03c33-70b3-4cc9-aac8-a36062b32dd6' AND r.issue_ref = 7455 AND r.status = 'planned';

  -- Slutkontrol: stemmerne er urørte.
  SELECT count(*) INTO v_votes_after FROM public.roadmap_votes;
  IF v_votes_after <> v_votes_before THEN
    RAISE EXCEPTION 'roadmap_votes ændret (% -> %)', v_votes_before, v_votes_after;
  END IF;
END
$r5$;

COMMIT;
