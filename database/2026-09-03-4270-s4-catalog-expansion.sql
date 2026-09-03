-- #4270 — katalog-udvidelse før sæson 4 bygges.
--
-- EJER-BESLUTNINGER 3/9 (bindende, se docs/audits/s4-catalog-expansion-2026-09-03.md):
--   · S4 = 28 løbsdatoer (28/9 → søn 25/10), uden #4103-tilt.
--   · D4 hæves til 3 etaper pr. kalenderdag. Kvoten går fra 56 til 84 etaper.
--   · Class1/Class2 får etapebånd 3-6 (regel-sporet sætter tallet; alle nye
--     Class1/Class2-etapeløb herunder ligger inden for det).
--   · D4's højbjergs-overskud lukkes med FLERE flade/kuperede Class1/Class2-etapeløb,
--     IKKE med et arketype-loft (#4278, ejer-valg B).
--   · `rolling` skal kunne leveres i D4 (i dag 1 etape i hele 28-dages-planen).
--
-- HVORFOR KATALOGET OG IKKE KALIBRERING (CALENDAR_RULES.md §5b): et katalog-loft må
-- aldrig lukkes ved at slække et mål eller ved at regenerere. Det lukkes ved at tilføje
-- løb FØR sæsonen bygges. Tørkørslen 3/9 målte fire blokerende fund, og tre af dem er
-- forsyning, ikke vægte:
--   D2 kuperet 38,4 % (mål 33) og bjerg 20,5 % (mål 28) · D1 nedkørsels-finale-etapedage
--   6 < 8 (#3469) · D1 brosten-i-etapeløb 0 < 1 (#3469).
--
-- HVORDAN KLASSEN STYRER HVOR ET LØB LANDER (TIER_CLASS_WHITELIST, tierRaceSelection.js):
--   D1: alle klasser · D2: OtherWorldTourB/C + ProSeries · D3: ProSeries + Class1 ·
--   D4: Class1 + Class2. Tiers vælger 1→4 med cross-tier-dedup, så en højere tier tømmer
--   de knappe arketyper først. Et løb der SKAL ende i D4 hører derfor i Class2; et der
--   SKAL ende i D1 hører i OtherWorldTourA (D2's whitelist udelader netop den klasse).
--   Det er dét der gør "brosten-i-etapeløb" løsbart for D1 UDEN at røre reservationerne.
--
-- ETAPEANTAL: OtherWorldTour A/B/C = 6-8 og ProSeries = 3-5 (CLASS_STAGE_LENGTH_BAND,
-- #3328). Class1/Class2 = 3-6 pr. ejer-beslutningen ovenfor.
--
-- date_text ER IKKE PYNT (#3469). Kalenderens kronologi læses af selve datoen: brostens-
-- blokken i februar-marts er dét der giver #3864's belgiske åbningsuge. De ni nye
-- belgiske/nordfranske brostens- og flad-løb ligger derfor alle i 7/2 - 5/4.
--
-- NAVNENE er kontrolleret mod alle 168 aktive katalog-navne (0 kollisioner) — navne-dedup
-- er en hård invariant (#4075 within-tier, #2276 cross-tier), så en kollision ville få
-- generatoren til at afvise planen. Verificeret af backend/scripts/dev/s4CatalogDryRun.mjs.
--
-- IDEMPOTENT via external_id (stabil, hardkodet — ikke hashet, så gentagen kørsel rammer
-- samme række). ON CONFLICT DO NOTHING: kører migrationen to gange, indsættes 0 rækker.
-- IKKE-DESTRUKTIV: rører ingen eksisterende række, sletter intet, pensionerer intet.
--
-- Refs #4270 #4278 #4105 #3864 #3469 #4103 #4176 #4218 #3328 #4075

insert into public.race_pool (external_id, name, race_class, race_type, stages, terrain_archetype, country, date_text)
values
  -- ═══ D1 (OtherWorldTourA — den ENESTE klasse D2 ikke må røre) ═══════════════
  -- To bjerg-etapeløb: `mountain` slutter nedad 20-35 % (§7b), så flere mellembjergs-
  -- etaper er den direkte vej til D1's nedkørsels-finale-gulv på 8 (målt 6).
  ('cz4270-wta-grandes-alpes', 'Tour de la Haute-Savoie',      'OtherWorldTourA', 'stage_race', 7, 'mountain_tour',   'France',      '10/6 - 16/6'),
  ('cz4270-wta-alpi-orient',   'Giro delle Alpi Orientali',    'OtherWorldTourA', 'stage_race', 7, 'sprinter_tour_summits', 'Italy', '4/5 - 10/5'),
  ('cz4270-wta-oostende',      'Grote Prijs van Oostende',     'OtherWorldTourA', 'single',     1, 'flat_sprint',     'Belgium',     '11/4'),
  ('cz4270-wta-bordeaux',      'Grand Prix de Bordeaux',       'OtherWorldTourA', 'single',     1, 'flat_sprint',     'France',      '2/5'),
  -- Brosten-i-etapeløb for D1 UDEN at røre reservationerne: D1's cobbled_tour-reservation
  -- står bevidst på 0 (#4075), men prestige-walket vælger stadig et OtherWorldTourA-løb.
  ('cz4270-wta-noord-fr',      'Ronde van Noord-Frankrijk',    'OtherWorldTourA', 'stage_race', 6, 'cobbled_tour',    'France',      '31/3 - 5/4'),
  -- Nordisk grus-klassiker: giver den nye etapetype en anden ejer end Terre di Toscana,
  -- så grus ikke er ét løb der kan forsvinde igen (#4105).
  ('cz4270-wta-lille',         'Grand Prix de Lille',          'OtherWorldTourA', 'single',     1, 'flat_sprint',     'France',      '18/4'),
  ('cz4270-wta-valencia',      'Gran Premio de Valencia',      'OtherWorldTourA', 'single',     1, 'flat_sprint',     'Spain',       '23/5'),
  ('cz4270-wta-strade-nord',   'Strade Bianche del Nord',      'OtherWorldTourA', 'single',     1, 'gravel_classic',  'Italy',       '14/3'),

  -- ═══ D2 (OtherWorldTourB/C) — mere bjerg, mindre kuperet ═══════════════════
  ('cz4270-wtb-pirineos',      'Vuelta al Alto Aragón',        'OtherWorldTourB', 'stage_race', 7, 'mountain_tour',   'Spain',       '23/6 - 29/6'),
  ('cz4270-wtb-appen-ligure',  'Giro dell''Appennino Ligure',  'OtherWorldTourB', 'stage_race', 6, 'summit_tour',     'Italy',       '7/7 - 12/7'),
  ('cz4270-wtc-vosges',        'Tour du Massif des Vosges',    'OtherWorldTourC', 'stage_race', 6, 'mountain_tour',   'France',      '20/7 - 25/7'),
  ('cz4270-wtc-sierra-nevada', 'Vuelta a Sierra Nevada',       'OtherWorldTourC', 'stage_race', 7, 'summit_tour',     'Spain',       '17/8 - 23/8'),
  -- Erstatter den brostens-forsyning Terre di Toscana tager med sig når den bliver grus
  -- (2026-09-03-4105-terre-di-toscana-gravel.sql). Samme klasse, samme tid på året.
  ('cz4270-wtb-geraardsberg',  'Kasseienklassieker van Geraardsbergen', 'OtherWorldTourB', 'single', 1, 'cobbled_classic', 'Belgium', '14/3'),

  -- ═══ D2 + D3 (ProSeries) ═══════════════════════════════════════════════════
  ('cz4270-pro-valtellina',    'Giro dell''Alta Valtellina',   'ProSeries', 'stage_race', 5, 'mountain_tour',   'Italy',       '26/6 - 30/6'),
  ('cz4270-pro-cevennes',      'Tour du Larzac',               'ProSeries', 'stage_race', 5, 'mountain_tour',   'France',      '9/7 - 13/7'),
  ('cz4270-pro-somiedo',       'Vuelta a Somiedo',             'ProSeries', 'stage_race', 5, 'mountain_tour',   'Spain',       '20/5 - 24/5'),
  ('cz4270-pro-carpazi',       'Turul Carpaților',            'ProSeries', 'stage_race', 5, 'summit_tour',     'Romania',     '4/8 - 8/8'),
  ('cz4270-pro-jura',          'Tour du Haut-Jura',            'ProSeries', 'stage_race', 5, 'mountain_tour',   'France',      '2/6 - 6/6'),
  ('cz4270-pro-sila',          'Giro della Sila',              'ProSeries', 'stage_race', 5, 'mountain_tour',   'Italy',       '17/3 - 21/3'),
  ('cz4270-pro-gredos',        'Vuelta a Gredos',              'ProSeries', 'stage_race', 5, 'mountain_tour',   'Spain',       '25/8 - 29/8'),
  ('cz4270-pro-tatry',         'Tour de Tatry',                'ProSeries', 'stage_race', 4, 'summit_tour',     'Poland',      '11/6 - 14/6'),
  ('cz4270-pro-vlaams-brab',   'Omloop van Vlaams-Brabant',    'ProSeries', 'single',     1, 'cobbled_classic', 'Belgium',     '7/3'),
  ('cz4270-pro-scheldeprijs',  'Prijs van de Beneden-Schelde', 'ProSeries', 'single',     1, 'flat_sprint',     'Belgium',     '1/4'),

  -- ═══ D3 + D4 (Class1) ══════════════════════════════════════════════════════
  -- sprinters_week er den eneste etapeløbs-arketype UDEN bjerg-garanti og med den
  -- højeste rolling-filler. Den er derfor både svaret på D4's højbjergs-overskud og
  -- på at D4 kun har 1 rolling-etape i hele planen.
  ('cz4270-c1-somme',          'Tour de la Somme',             'Class1', 'stage_race', 5, 'sprinters_week',  'France',      '5/5 - 9/5'),
  ('cz4270-c1-ribatejo',       'Volta ao Ribatejo',            'Class1', 'stage_race', 4, 'sprinters_week',  'Portugal',    '11/3 - 14/3'),
  ('cz4270-c1-monferrato',     'Giro del Monferrato',          'Class1', 'stage_race', 5, 'hilly_tour',      'Italy',       '1/7 - 5/7'),
  ('cz4270-c1-navarra',        'Vuelta a Navarra Nueva',       'Class1', 'stage_race', 5, 'balanced_week',   'Spain',       '13/8 - 17/8'),
  ('cz4270-c1-rovigo',         'Gran Premio di Rovigo',        'Class1', 'single',     1, 'flat_sprint',     'Italy',       '20/3'),
  ('cz4270-c1-aalst',          'Grote Prijs van Aalst',        'Class1', 'single',     1, 'flat_sprint',     'Belgium',     '7/2'),
  ('cz4270-c1-chrono-vl',      'Chrono van Vlaanderen',        'Class1', 'single',     1, 'itt_classic',     'Belgium',     '5/9'),
  ('cz4270-c1-pajottenland',   'Omloop van het Pajottenland',  'Class1', 'single',     1, 'cobbled_classic', 'Belgium',     '21/2'),

  -- ═══ D4 (Class2 — spillets smalleste vindue, og det eneste D3 ikke rører) ═══
  ('cz4270-c2-twente',         'Ronde van Overijssel',         'Class2', 'stage_race', 5, 'sprinters_week',  'Netherlands', '12/5 - 16/5'),
  ('cz4270-c2-costa-blanca',   'Vuelta a la Costa Blanca',     'Class2', 'stage_race', 4, 'sprinters_week',  'Spain',       '4/2 - 7/2'),
  ('cz4270-c2-pays-de-caux',   'Tour du Pays de Caux',         'Class2', 'stage_race', 4, 'sprinters_week',  'France',      '9/6 - 12/6'),
  ('cz4270-c2-marche',         'Giro del Piceno',              'Class2', 'stage_race', 5, 'hilly_tour',      'Italy',       '22/5 - 26/5'),
  ('cz4270-c2-minho',          'Volta ao Minho',               'Class2', 'stage_race', 4, 'hilly_tour',      'Portugal',    '15/7 - 18/7'),
  ('cz4270-c2-allier',         'Tour de l''Allier',            'Class2', 'stage_race', 5, 'balanced_week',   'France',      '2/8 - 6/8'),
  ('cz4270-c2-cantabria',      'Vuelta al Valle del Nansa',    'Class2', 'stage_race', 4, 'balanced_week',   'Spain',       '18/6 - 21/6'),
  ('cz4270-c2-antwerpen',      'Ronde van Antwerpen',          'Class2', 'stage_race', 4, 'cobbled_tour',    'Belgium',     '25/3 - 28/3'),
  ('cz4270-c2-kortrijk',       'Grote Prijs van Kortrijk',     'Class2', 'single',     1, 'flat_sprint',     'Belgium',     '19/2'),
  ('cz4270-c2-alicante',       'Gran Premio de Alicante',      'Class2', 'single',     1, 'flat_sprint',     'Spain',       '26/2'),
  ('cz4270-c2-grosseto',       'Trofeo di Grosseto',           'Class2', 'single',     1, 'flat_sprint',     'Italy',       '3/2'),
  ('cz4270-c2-berry',          'Chrono du Berry',              'Class2', 'single',     1, 'itt_classic',     'France',      '21/6'),
  ('cz4270-c2-chianti',        'Coppa del Chianti',            'Class2', 'single',     1, 'hilly_classic',   'Italy',       '10/4'),
  ('cz4270-c2-herve',          'Grand Prix de Herve',          'Class2', 'single',     1, 'puncheur',        'Belgium',     '24/4'),
  ('cz4270-c2-denderstreek',   'Omloop van de Denderstreek',   'Class2', 'single',     1, 'cobbled_classic', 'Belgium',     '28/2')
on conflict (external_id) do nothing;

-- ── Post-verify (kør efter apply) ─────────────────────────────────────────────
-- select count(*) from public.race_pool where external_id like 'cz4270-%';
--   forventet: antallet af rækker i listen ovenfor
-- select name, count(*) from public.race_pool where retired_at is null
--   group by name having count(*) > 1;
--   forventet: 0 rækker (navne-dedup er en hård invariant)
-- select race_class, race_type, terrain_archetype, count(*) from public.race_pool
--   where retired_at is null group by 1,2,3 order by 1,2,3;
--   sammenlign med tabellen i docs/audits/s4-catalog-expansion-2026-09-03.md
