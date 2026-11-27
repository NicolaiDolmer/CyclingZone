-- =============================================================================
-- 2026-11-27 · #8719 · roadmap-synk efter ejerbeslutningerne fre 27/11 (runde 3)
-- =============================================================================
-- Ejer-svarene staar ordret paa #8719 (issuecomment-7218617557). Princip (ejer):
-- faerdigt = fortael spillerne det nu, med datoen for hvornaar det gaar live.
--
-- Kun roadmap_items. roadmap_votes roeres aldrig, ingen titel paa eksisterende
-- punkter aendres. Hver aendring er bundet til raekkens id OG dens issue_ref, saa
-- en forkert raekke aldrig rammes. Idempotent: hver UPDATE springer over, naar
-- raekken allerede har maalet; INSERT'en af #8853 springer over, hvis punktet
-- findes. Slutkontrollen fejler hele transaktionen, hvis stemmetallet aendres,
-- eller en raekke ikke staar som forventet.
--
-- Laest read-only mod prod 27/11: 393 raekker. Planlagte raekker kraever issue +
-- fast tidspunkt (roadmap_items_check_plan); alle tidspunkter herunder er faste.
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642); Claude post-verificerer.
-- =============================================================================

SET lock_timeout = '3s';
BEGIN ISOLATION LEVEL REPEATABLE READ;

DO $rm$
DECLARE
  v_votes_before bigint;
  v_votes_after  bigint;
  v_bad          text;
BEGIN
  SELECT count(*) INTO v_votes_before FROM public.roadmap_votes;

  -- 1. Leveret 26/11 (live i prod): rotation, akademisiden, akademiets aldersgruppe,
  --    skader nulstilles (ejer: "Skriv den er live nu, for det er den").
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, '2026-11-26T22:09:50Z'::timestamptz),
      beta_soon = false, live_soon = false, updated_at = now()
  FROM (VALUES
    ('786060ea-18d4-4e86-ab35-440ab6572d32'::uuid, 7456),
    ('d946b0d3-710b-4497-9602-5072b6ca7a60'::uuid, 8060),
    ('4ab9f564-1f74-435d-9219-8221ab7986dc'::uuid, 6944),
    ('00006149-0000-4000-8000-000000000021'::uuid, 5865)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.status IS DISTINCT FROM 'shipped';

  -- 1b. Trupgraenser #8034: live siden 25/11 (#8668 00d5e11a + #8728 0b65d71d).
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, '2026-11-25T12:00:00Z'::timestamptz),
      beta_soon = false, live_soon = false, updated_at = now()
  WHERE r.id = '136efc1d-7aca-4e85-9c7d-f11b88639198' AND r.issue_ref = 8034 AND r.status IS DISTINCT FROM 'shipped';

  -- 1c. Ugeblokke med prioritet #8549: on for alle 27/11 kl. 14:11 (ejer-go, bevis paa #8549).
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, '2026-11-27T13:11:00Z'::timestamptz),
      beta_soon = false, live_soon = false, updated_at = now()
  WHERE r.id = 'c460f604-5748-4d91-888c-e406e7ddcf29' AND r.issue_ref = 8549 AND r.status IS DISTINCT FROM 'shipped';

  -- 2. Leveret nu, virker fra skiftet (ejer: "Leveret nu, virker fra skiftet"):
  --    bestyrelsen efter pause #8100 (merget i #8675).
  UPDATE public.roadmap_items AS r
  SET status = 'shipped', shipped_at = coalesce(r.shipped_at, now()), beta_soon = false, live_soon = false, updated_at = now()
  WHERE r.id = 'f79233f8-fac5-44c9-b791-d44b01843f55' AND r.issue_ref = 8100 AND r.status IS DISTINCT FROM 'shipped';

  -- 3. Faerdige, gaar live ved skiftet 28/11 (ejer: "skriv hvornaar det gaar live"):
  --    automatisk oprykning #7323 (merget i #8668/#8728). Trupgraenserne #8034 er
  --    allerede live og haandhaevet i prod siden 25/11 (PC1 maalte 27/11, patch note
  --    7.516) og flyttes til Leveret 25/11 i punkt 1b.
  --    Aldring #8522 (laves i dag) faar kategorien Udvikling.
  UPDATE public.roadmap_items AS r
  SET horizon = '2026-11-28', updated_at = now()
  FROM (VALUES
    ('ad93f4cd-5750-4196-8a1e-7dabb4beac1d'::uuid, 7323)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.horizon IS DISTINCT FROM '2026-11-28';
  UPDATE public.roadmap_items AS r
  SET category = 'development', horizon = '2026-11-28', updated_at = now()
  WHERE r.id = '9099ebce-5236-4a5a-a4da-9473b786bf4a' AND r.issue_ref = 8522
    AND (r.category IS DISTINCT FROM 'development' OR r.horizon IS DISTINCT FROM '2026-11-28');

  -- 4. I dag 27/11: S6-kalenderens to punkter (Leveret ved --apply i dag, flyttes
  --    ved apply), ugeprioritet, planlaegningssiden, Kun denne dag, prognosen, AI-hold
  --    (kategori Traening). Solgte ryttere #7455 bygges i dag -> 28/11.
  UPDATE public.roadmap_items AS r
  SET horizon = '2026-11-27', updated_at = now()
  FROM (VALUES
    ('3f3530a9-2de8-4249-a93d-73ea2af68941'::uuid, 7471),
    ('55deb42a-938a-4757-9882-521c8d7bdf51'::uuid, 8259),
    ('a84c7b6b-25b7-4905-a598-6ffc601f1db7'::uuid, 8419),
    ('23f166d1-f97a-409a-ab81-ff593ba74d2d'::uuid, 8592),
    ('a85f958a-c5a9-4fe3-98ed-ab7d1ab09e3c'::uuid, 8604)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.horizon IS DISTINCT FROM '2026-11-27';
  UPDATE public.roadmap_items AS r
  SET category = 'training', horizon = '2026-11-27', updated_at = now()
  WHERE r.id = 'fda1fcca-8af7-4734-98b7-30f803b0d63f' AND r.issue_ref = 8614
    AND (r.category IS DISTINCT FROM 'training' OR r.horizon IS DISTINCT FROM '2026-11-27');
  UPDATE public.roadmap_items AS r
  SET horizon = '2026-11-28', updated_at = now()
  WHERE r.id = '68c03c33-70b3-4cc9-aac8-a36062b32dd6' AND r.issue_ref = 7455 AND r.horizon IS DISTINCT FROM '2026-11-28';

  -- 5. Saesonstart 30/11: motor, taktik og loebsfilm som een blok (ejer: "De skal
  --    vaere klar FOER saesonstarten. Altsaa FOER mandag") + Angrib paa #7884.
  --    Mellemtider #8343 faar kategorien Loeb.
  UPDATE public.roadmap_items AS r
  SET horizon = '2026-11-30', updated_at = now()
  FROM (VALUES
    ('925aa478-2038-4ef8-8063-e03024501911'::uuid, 6912),
    ('e1a5014f-155f-4ea9-adf8-08c45d5108f5'::uuid, 8189),
    ('48fe0b96-a83b-4f89-b312-8d07a7e6b705'::uuid, 7645),
    ('b2df9553-d363-4355-abb3-eef468de04a0'::uuid, 7644),
    ('5cd73cc7-0ec5-466d-8e45-200331487027'::uuid, 8045),
    ('5e162a4d-ecd5-4c25-9415-c7d20b9bd7d3'::uuid, 8824),
    ('47ddbb1b-cdb3-4833-b6c9-93ef6ae5e127'::uuid, 7866),
    ('727a6196-77bf-4554-957a-f67af973a295'::uuid, 8386),
    ('8d78f78d-8b56-4ed8-92f3-401e8e28d2e1'::uuid, 8458),
    ('00006149-0000-4000-8000-000000000010'::uuid, 5101),
    ('00006149-0000-4000-8000-000000000011'::uuid, 5574),
    ('21ebc737-901a-4aa4-afd4-a36cd3de6309'::uuid, 7417),
    ('f0427fcb-97ec-49f9-b8bd-7f13d29aa956'::uuid, 7884)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.horizon IS DISTINCT FROM '2026-11-30';
  UPDATE public.roadmap_items AS r
  SET category = 'races', horizon = '2026-11-30', updated_at = now()
  WHERE r.id = '09bc633a-3835-45f9-a083-b3df758a1294' AND r.issue_ref = 8343
    AND (r.category IS DISTINCT FROM 'races' OR r.horizon IS DISTINCT FROM '2026-11-30');

  -- 6. Uge 49: stabilitet #6917, patch notes-dato #8449. Uge 50: foerste dage #8084 -> App.
  UPDATE public.roadmap_items AS r
  SET horizon = '2026-W49', updated_at = now()
  FROM (VALUES
    ('00006149-0000-4000-8000-000000000016'::uuid, 6917),
    ('f2a8f9e0-a08e-4bce-9c25-5164d74d5b0d'::uuid, 8449)
  ) AS v(id, issue)
  WHERE r.id = v.id AND r.issue_ref = v.issue AND r.horizon IS DISTINCT FROM '2026-W49';
  UPDATE public.roadmap_items AS r
  SET category = 'app', updated_at = now()
  WHERE r.id = '41f63d6f-48d8-4162-9b44-f924f09638b0' AND r.issue_ref = 8084 AND r.category IS DISTINCT FROM 'app';

  -- 7. Nyt punkt #8853 (ejer: "Ja, Akademi, 30/11"): planlagt, godkendt.
  INSERT INTO public.roadmap_items (engine, category, sort_order, title_en, title_da, approved, status, horizon, issue_ref)
  SELECT src.engine, 'academy', src.sort_order,
         'U23 and Junior are clearly marked wherever races are shown.',
         'U23 og Junior står tydeligt overalt, hvor løb vises.',
         true, 'planned', '2026-11-30', 8853
  FROM public.roadmap_items AS src
  WHERE src.id = '3f3530a9-2de8-4249-a93d-73ea2af68941'
    AND NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE issue_ref = 8853 AND status <> 'archived');

  -- Slutkontrol.
  SELECT count(*) INTO v_votes_after FROM public.roadmap_votes;
  IF v_votes_after <> v_votes_before THEN
    RAISE EXCEPTION '#8719 roadmap-synk: stemmetallet aendrede sig (% -> %)', v_votes_before, v_votes_after;
  END IF;
  SELECT string_agg(issue_ref::text, ', ') INTO v_bad FROM public.roadmap_items
  WHERE (issue_ref IN (7456, 8060, 6944, 5865, 8100, 8034, 8549) AND status <> 'archived' AND id IN (
           '786060ea-18d4-4e86-ab35-440ab6572d32', 'd946b0d3-710b-4497-9602-5072b6ca7a60',
           '4ab9f564-1f74-435d-9219-8221ab7986dc', '00006149-0000-4000-8000-000000000021',
           'f79233f8-fac5-44c9-b791-d44b01843f55', '136efc1d-7aca-4e85-9c7d-f11b88639198', 'c460f604-5748-4d91-888c-e406e7ddcf29') AND status <> 'shipped')
     OR (id = '9099ebce-5236-4a5a-a4da-9473b786bf4a' AND (category IS DISTINCT FROM 'development' OR horizon <> '2026-11-28'))
     OR (id = 'fda1fcca-8af7-4734-98b7-30f803b0d63f' AND (category IS DISTINCT FROM 'training' OR horizon <> '2026-11-27'))
     OR (id = '09bc633a-3835-45f9-a083-b3df758a1294' AND (category IS DISTINCT FROM 'races' OR horizon <> '2026-11-30'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#8719 roadmap-synk: raekker staar ikke som forventet: %', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roadmap_items WHERE issue_ref = 8853 AND status = 'planned' AND horizon = '2026-11-30') THEN
    RAISE EXCEPTION '#8719 roadmap-synk: #8853 mangler';
  END IF;
END
$rm$;

COMMIT;
