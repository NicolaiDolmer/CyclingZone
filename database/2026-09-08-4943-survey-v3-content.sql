-- #4943 · Spoergeskema 2026-09-features: v3-indhold (ejer-godkendt 8/9 kl. 13:30).
--
-- Skemaet gaar fra 11 spoergsmaal / 12 idéer til 12 spoergsmaal / 20 idéer.
-- Kilde: ejerens gennemsyn af v3-forslaget 8/9 (issue #4943). Systemets SSOT er
-- docs/SURVEY_SYSTEM.md; tabellerne selv kommer fra
-- database/2026-09-07-4943-in-app-survey.sql (laes den for kolonner og RLS).
--
-- HVAD DENNE MIGRATION AENDRER:
--   1. works_worst: to nye valg (mobile, learning) — de to omraader spillerne
--      naevner i forummet, som skemaet ellers ikke kunne pege paa.
--   2. feature_axes: 20 idéer i stedet for 12, grupperet i fem omraader.
--      manager_messages er UDE (shippet i #3200), scout_reports og
--      league_buyout er bevidst IKKE tilfoejet (ejer-afgoerelse 8/9),
--      more_races_lower BEHOLDES. custom_front_page er omdoebt til
--      custom_dashboard med ny tekst, og team_looks har mistet
--      rytterportraetterne, fordi de nu er deres egen idé
--      (rider_staff_portraits).
--   3. NY raekke fog_more: eet valg om hvor meget mere der skal skjules.
--      Spoergsmaalet bygger videre paa to af idéerne (value_no_leak,
--      fuzzy_rivals) og staar derfor lige efter dem paa siden.
--   4. sort_order renummereres, saa databasens raekkefoelge er den samme som
--      sidens nye flow: i dag -> hvad fungerer daarligst -> idéerne -> hvad du
--      kan se -> hvad du selv ville vaelge -> Pro -> foer du sender.
--
-- OPTIONS FAAR TO NYE FELTER (group_en/group_da) paa feature_axes. De er
-- rent redaktionelle: frontend tegner en lille gruppe-overskrift naar gruppen
-- skifter fra en option til den naeste, og options uden gruppe rendres praecis
-- som foer (bagudkompatibelt). Ingen skema-aendring — options er JSONB.
--
-- INGEN DATA-MIGRATION AF SVAR: skemaet er stadig status 'draft' og har 0
-- raekker i survey_responses/survey_completions (post-verify nedenfor), saa de
-- fjernede option-noegler (manager_messages, custom_front_page) findes ikke i
-- nogen gemt `ratings`-blob. Skulle skemaet mod forventning have faaet svar,
-- SKAL denne migration stoppes og noeglerne mappes foerst.
--
-- Idempotent: INSERT ... ON CONFLICT (survey_id, key) DO UPDATE paa
-- survey_questions_survey_key_uniq + en positionel UPDATE. Ingen destruktiv
-- klasse (intet DROP, ingen DELETE af svar). Applies af CI ved merge
-- (auto-migrate.yml).
--
-- Post-verify:
--   SELECT count(*) FROM public.survey_questions
--     WHERE survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features');
--     -- forventet 12
--   SELECT key, sort_order, kind, required FROM public.survey_questions
--     WHERE survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
--     ORDER BY sort_order;
--     -- forventet: satisfaction 10, works_worst 20, works_worst_detail 30,
--     --            feature_axes 40, fog_more 50, one_thing 60, play_more 70,
--     --            invite_friend 80, pro_contents 90, pro_exclusions 100,
--     --            pro_would_pay 110, follow_up 120
--   SELECT jsonb_array_length(options) FROM public.survey_questions
--     WHERE key = 'feature_axes'
--       AND survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features');
--     -- forventet 20
--   SELECT jsonb_array_length(options) FROM public.survey_questions
--     WHERE key = 'works_worst'
--       AND survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features');
--     -- forventet 12
--   SELECT count(*) FROM public.survey_questions
--     WHERE key = 'feature_axes'
--       AND survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
--       AND options @> '[{"key":"manager_messages"}]'::JSONB;
--     -- forventet 0
--   SELECT status FROM public.surveys WHERE slug = '2026-09-features';  -- forventet draft
--   SELECT count(*) FROM public.survey_responses;   -- forventet 0
--   SELECT count(*) FROM public.survey_completions; -- forventet 0

-- ── 1. Ny raekkefoelge paa de spoergsmaal der ellers er uaendrede ───────────
-- works_worst, feature_axes og fog_more faar deres sort_order i insertet
-- nedenfor; her staar kun de raekker der ikke aendrer indhold.
UPDATE public.survey_questions q
   SET sort_order = v.sort_order
  FROM (VALUES
    ('satisfaction',       10),
    ('works_worst_detail', 30),
    ('one_thing',          60),
    ('play_more',          70),
    ('invite_friend',      80),
    ('pro_contents',       90),
    ('pro_exclusions',    100),
    ('pro_would_pay',     110),
    ('follow_up',         120)
  ) AS v(key, sort_order)
 WHERE q.survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
   AND q.key = v.key
   AND q.sort_order IS DISTINCT FROM v.sort_order;

-- ── 2. Indholdet: works_worst, feature_axes og den nye fog_more ────────────
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
INSERT INTO public.survey_questions
  (survey_id, sort_order, key, kind, label_en, label_da, help_en, help_da, options, required)
SELECT s.id, q.sort_order, q.key, q.kind, q.label_en, q.label_da, q.help_en, q.help_da, q.options, q.required
FROM s, (VALUES

  -- mobile + learning er nye (ejer-afgoerelse 8/9). Loftet paa tre valg er
  -- uaendret: 12 valg uden loft ville goere spoergsmaalet ubrugeligt.
  (20, 'works_worst', 'multi_max3',
   'Which parts of the game work worst today? Pick up to three.',
   'Hvilke dele af spillet fungerer dårligst i dag? Vælg op til tre.',
   NULL, NULL,
   '[
     {"key":"racing","label_en":"Racing and results","label_da":"Løbene og resultaterne"},
     {"key":"training","label_en":"Training and rider development","label_da":"Træning og rytterudvikling"},
     {"key":"market","label_en":"Transfers and auctions","label_da":"Transfers og auktioner"},
     {"key":"selection","label_en":"Team selection and planning","label_da":"Holdudtagelse og planlægning"},
     {"key":"calendar","label_en":"The season calendar and the routes","label_da":"Sæsonkalenderen og ruterne"},
     {"key":"economy","label_en":"Money, sponsors and the board","label_da":"Penge, sponsorer og bestyrelsen"},
     {"key":"academy","label_en":"The academy and young riders","label_da":"Akademiet og de unge ryttere"},
     {"key":"inbox","label_en":"The inbox and notifications","label_da":"Indbakken og notifikationerne"},
     {"key":"forum","label_en":"The forum and the community","label_da":"Forummet og fællesskabet"},
     {"key":"stability","label_en":"Speed, bugs and things that break","label_da":"Hastighed, fejl og ting der går i stykker"},
     {"key":"mobile","label_en":"Playing on the phone","label_da":"At spille på telefonen"},
     {"key":"learning","label_en":"Learning the game: help, explanations, getting started","label_da":"At lære spillet: hjælp, forklaringer, at komme i gang"}
   ]'::JSONB, TRUE),

  -- To-akse-gitteret, nu 20 idéer i fem grupper. group_en/group_da tegnes som
  -- en lille overskrift naar gruppen skifter; raekkefoelgen ER grupperingen,
  -- saa options maa ALDRIG sorteres om i frontend.
  (40, 'feature_axes', 'idea_importance',
   'Rate each idea twice.',
   'Giv hver idé to karakterer.',
   'First: how good an idea is this for the game, no matter whether you would use it yourself. Second: how much it matters to you right now. Pick "Do not know" if you have no view.',
   'Først: hvor god en idé er det for spillet, uanset om du selv ville bruge det. Dernæst: hvor meget det betyder for dig lige nu. Vælg "Ved ikke" hvis du ikke har en mening.',
   '[
     {"key":"live_race","group_en":"Racing","group_da":"Løbene","label_en":"Follow a race live while it happens, stage by stage","label_da":"Følg et løb live mens det kører, etape for etape"},
     {"key":"races_train_you","group_en":"Racing","group_da":"Løbene","label_en":"Races train you: riding cobbled races makes you better on cobbles","label_da":"Løbene træner dig: kører du brostensløb, bliver du bedre til brosten"},
     {"key":"jersey_targets","group_en":"Racing","group_da":"Løbene","label_en":"Target the mountains or points jersey from the start","label_da":"Gå efter bjerg- eller pointtrøjen fra løbets start"},
     {"key":"race_orders","group_en":"Racing","group_da":"Løbene","label_en":"Race orders with conditions: chase the break only if other teams help, and pick where on the stage you attack","label_da":"Løbsordrer med betingelser: jag udbruddet kun hvis andre hold hjælper, og vælg selv hvor på etapen du angriber"},
     {"key":"more_races_lower","group_en":"Racing","group_da":"Løbene","label_en":"More races per day in the lower divisions, so squad size becomes a real choice","label_da":"Flere løb pr. dag i de lave divisioner, så trupstørrelsen bliver et reelt valg"},
     {"key":"training_programs","group_en":"Training and development","group_da":"Træning og udvikling","label_en":"Build a training week once as a reusable program","label_da":"Byg en træningsuge én gang som et genbrugeligt program"},
     {"key":"shared_programs","group_en":"Training and development","group_da":"Træning og udvikling","label_en":"Share training programs and use other managers programs","label_da":"Del træningsprogrammer og brug andre manageres programmer"},
     {"key":"form_training","group_en":"Training and development","group_da":"Træning og udvikling","label_en":"Form training for riders who no longer gain skills","label_da":"Formtræning til ryttere der ikke længere kan lære mere"},
     {"key":"coach_feedback","group_en":"Training and development","group_da":"Træning og udvikling","label_en":"Feedback from your coach in words instead of a number score","label_da":"Feedback fra din træner i ord i stedet for en talscore"},
     {"key":"youth_teams","group_en":"Youth","group_da":"Ungdom","label_en":"U23 and junior teams with their own races","label_da":"U23- og juniorhold med deres egne løb"},
     {"key":"one_big_squad","group_en":"Youth","group_da":"Ungdom","label_en":"One big squad where you decide who only trains in the academy, who races U23 and who races senior","label_da":"Én stor trup hvor du selv bestemmer hvem der kun træner i akademiet, kører U23 og kører senior"},
     {"key":"inbox_transfers","group_en":"The market and what you can see","group_da":"Markedet og informationen","label_en":"Handle transfer offers straight from your inbox","label_da":"Håndtér transfertilbud direkte fra din indbakke"},
     {"key":"ai_offers","group_en":"The market and what you can see","group_da":"Markedet og informationen","label_en":"AI teams that bid on your riders and send you offers","label_da":"AI-hold der byder på dine ryttere og sender dig tilbud"},
     {"key":"value_no_leak","group_en":"The market and what you can see","group_da":"Markedet og informationen","label_en":"A market value that no longer gives away a young rider''s hidden potential","label_da":"En markedsværdi der ikke længere afslører en ung rytters skjulte potentiale"},
     {"key":"fuzzy_rivals","group_en":"The market and what you can see","group_da":"Markedet og informationen","label_en":"Other teams'' rider abilities shown as ranges, revealed through scouting","label_da":"Andre holds rytter-evner vist som intervaller, afsløret gennem scouting"},
     {"key":"side_sponsors","group_en":"The club","group_da":"Klubben","label_en":"Smaller side sponsors with their own goals: a nationality in the top 10, a race type, one specific race","label_da":"Mindre side-sponsorer med egne mål: en nationalitet i top 10, en løbstype, ét bestemt løb"},
     {"key":"deeper_staff","group_en":"The club","group_da":"Klubben","label_en":"Deeper staff: more roles, real strengths and weaknesses","label_da":"Dybere personale: flere roller, rigtige styrker og svagheder"},
     {"key":"team_looks","group_en":"The club","group_da":"Klubben","label_en":"Team looks: kit colours and logo","label_da":"Holdets udseende: trøjefarver og logo"},
     {"key":"rider_staff_portraits","group_en":"The club","group_da":"Klubben","label_en":"Pictures of your riders and staff","label_da":"Billeder af dine ryttere og dit personale"},
     {"key":"custom_dashboard","group_en":"The club","group_da":"Klubben","label_en":"A dashboard you can set up yourself, showing what needs your action","label_da":"Et dashboard du selv kan tilpasse, med det der kræver din handling"}
   ]'::JSONB, FALSE),

  -- Fog of war. Selve raden staar som label; den nuvaerende tilstand staar som
  -- hjaelpetekst, saa spoergsmaalet kan laeses paa en telefon uden at fylde
  -- fire linjer i 13,5 px medium.
  (50, 'fog_more', 'single',
   'How much more should be hidden?',
   'Hvor meget mere skal skjules?',
   'Right now you can see other teams'' full rider stats, and a rider''s true potential is always hidden behind a scouted range.',
   'Lige nu kan du se andre holds fulde rytter-stats, og en rytters sande potentiale er altid skjult bag et scoutet interval.',
   '[
     {"key":"nothing","label_en":"Nothing more. I want to see other teams'' stats clearly, that is part of the fun","label_da":"Ikke mere. Jeg vil se andre holds stats klart, det er en del af sjovet"},
     {"key":"a_bit","label_en":"A bit more. Keep stats visible, but stop the market value from giving away hidden potential","label_da":"Lidt mere. Behold synlige stats, men stop markedsværdien i at afsløre skjult potentiale"},
     {"key":"a_lot","label_en":"A lot more. Show other teams'' abilities as ranges too, revealed through scouting","label_da":"Meget mere. Vis også andre holds evner som intervaller, afsløret gennem scouting"},
     {"key":"no_opinion","label_en":"No strong opinion","label_da":"Ingen stærk holdning"}
   ]'::JSONB, TRUE)

) AS q(sort_order, key, kind, label_en, label_da, help_en, help_da, options, required)
ON CONFLICT (survey_id, key) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      kind       = EXCLUDED.kind,
      label_en   = EXCLUDED.label_en,
      label_da   = EXCLUDED.label_da,
      help_en    = EXCLUDED.help_en,
      help_da    = EXCLUDED.help_da,
      options    = EXCLUDED.options,
      required   = EXCLUDED.required;
