-- #4215 — 22 nye løb i race_pool, så sæsonen kan køre 31 løbsdage med løb HVER dag.
--
-- EJER-DIREKTIV 25/8:
--   "Jeg vil ikke have dage uden løb. I den nye sæson skal der være løb hver dag."
--   Sæson 3: fredag 28/8 til søndag 27/9 = 31 kalenderdage.
--   "Nej lad os nu få det gjort ordentligt fra start af. Ikke flere åndsvage quick fixes."
--
-- HVORFOR DE ER NØDVENDIGE. Kataloget havde 140 brugbare løb / 402 etaper. Generatorens
-- kvote er density × antal dage, så 31 dage kræver 155+124+93+62 = 434 etaper. Målt mod
-- det gamle katalog (ren funktion, prod-fixture, ingen skrivning):
--
--   dage | D1     | D2     | D3          | D4
--   -----|--------|--------|-------------|------------
--   28   | 28 dg  | 28 dg  | 28 dg       | 28 dg      ← katalogets loft
--   29   | 29 dg  | 29 dg  | 25 dg (-4)  | 28 dg (-1)
--   31   | 31 dg  | 31 dg  | 19 dg (-12) | 28 dg (-3)
--
-- D1 og D2 klarer 31 dage på det gamle katalog. D3 og D4 løber tør, fordi klasse-
-- whitelisten (#2276) giver dem de mindste puljer: D3 må kun bruge ProSeries + Class1,
-- D4 kun Class1 + Class2 — og D2 vælger ProSeries FØR D3, D3 vælger Class1 FØR D4.
-- Kaskaden sulter altså nedad, og det er netop de to divisioner hvor flest spillere er.
--
-- HVORFOR PRÆCIS 22. Målt iterativt mod generatoren: 18 løb lukkede D1/D2/D4 men efterlod
-- D3 med 4 tomme dage; 20 lukkede D3 til én tom dag (27/9); 22 lukker alle fire. Løb 21-22
-- er ENDAGSLØB med vilje — D3 manglede ikke etaper, men noget der kunne fylde en ENKELT
-- dag. To etapeløb mere flyttede ikke den sidste dag; to endagsløb gjorde.
--
-- VERIFICERET (buildTierMaterializationPlan, realDays=31, quotas=density×31, baseSeed=1):
--   tier 1: 155 etaper / 31 kalenderdage      tier 3: 92 etaper / 31 kalenderdage
--   tier 2: 124 etaper / 31 kalenderdage      tier 4: 62 etaper / 31 kalenderdage
--   plan-violations: 0 · detectEmptyCalendarDays: ok i alle fire divisioner
--
-- NAVNENE er regionale europæiske løb i katalogets egen stil, kontrolleret for kollision
-- mod alle 140 eksisterende navne (0 kollisioner). Navne-dedup er en hård invariant
-- (#4075 within-tier, #2276 cross-tier), så en kollision ville få generatoren til at
-- afvise planen.
--
-- IDEMPOTENT via external_id (stabil, hardkodet — ikke hashet, så gentagen kørsel rammer
-- samme række). ON CONFLICT DO NOTHING: kører scriptet to gange, indsættes 0 rækker.
-- IKKE-DESTRUKTIV: rører ingen eksisterende række.
--
-- Refs #4215 #4214 #2276 #4075 #4176 #3328

insert into public.race_pool (external_id, name, race_class, race_type, stages, terrain_archetype, date_text)
values
  -- ProSeries (D2 + D3). 3-5 etaper pr. CLASS_STAGE_LENGTH_BAND (#3328).
  ('cz4215-pro-alentejo',   'Volta ao Alentejo',             'ProSeries', 'stage_race', 4, 'sprinters_week', '3/4 - 6/4'),
  ('cz4215-pro-limousin',   'Tour du Limousin Nouveau',      'ProSeries', 'stage_race', 4, 'hilly_tour',     '18/8 - 21/8'),
  ('cz4215-pro-lucania',    'Giro della Lucania',            'ProSeries', 'stage_race', 5, 'summit_tour',    '6/6 - 10/6'),
  ('cz4215-pro-rioja',      'Vuelta a La Rioja Nueva',       'ProSeries', 'stage_race', 4, 'balanced_week',  '21/4 - 24/4'),
  ('cz4215-pro-silesie',    'Tour de Silésie',               'ProSeries', 'stage_race', 3, 'mountain_tour',  '12/7 - 14/7'),
  ('cz4215-pro-zeeland',    'Ronde van Zeeland',             'ProSeries', 'stage_race', 3, 'cobbled_tour',   '8/5 - 10/5'),
  -- Dybde til D3, som D2 ellers sulter via ProSeries-kaskaden.
  ('cz4215-pro-irpinia',    'Giro dell''Irpinia',            'ProSeries', 'stage_race', 5, 'summit_tour',    '1/6 - 5/6'),
  ('cz4215-pro-yonne',      'Tour de l''Yonne',              'ProSeries', 'stage_race', 5, 'balanced_week',  '14/8 - 18/8'),

  -- Class1 (D3 + D4).
  ('cz4215-c1-fourmies',    'Grand Prix de Fourmies Neuf',   'Class1', 'single',     1, 'flat_sprint',     '13/9'),
  ('cz4215-c1-bretagne',    'Tour de Bretagne Sud',          'Class1', 'stage_race', 3, 'cobbled_tour',    '28/4 - 30/4'),
  ('cz4215-c1-euganei',     'Coppa dei Colli Euganei',       'Class1', 'single',     1, 'hilly_classic',   '11/5'),
  ('cz4215-c1-zamora',      'Gran Premio de Zamora',         'Class1', 'single',     1, 'itt_classic',     '27/6'),
  ('cz4215-c1-drenthe',     'Ronde van Drenthe Nieuw',       'Class1', 'single',     1, 'cobbled_classic', '15/3'),
  ('cz4215-c1-sibillini',   'Giro dei Monti Sibillini',      'Class1', 'stage_race', 4, 'summit_tour',     '2/7 - 5/7'),
  -- Endagsløb: D3 manglede ikke etaper, men noget der kunne fylde ÉN dag (27/9).
  ('cz4215-c1-castelli',    'Trofeo dei Castelli Romani',    'Class1', 'single',     1, 'hilly_classic',   '6/9'),
  ('cz4215-c1-valladolid',  'Gran Premio de Valladolid',     'Class1', 'single',     1, 'flat_sprint',     '12/6'),

  -- Class2 (kun D4 — den smalleste pulje i spillet).
  ('cz4215-c2-vosges',      'Circuit des Vosges',            'Class2', 'single',     1, 'mountain_classic','23/5'),
  ('cz4215-c2-valdichiana', 'Trofeo Val di Chiana',          'Class2', 'single',     1, 'hilly_classic',   '7/3'),
  ('cz4215-c2-segovia',     'Vuelta a Segovia Menor',        'Class2', 'stage_race', 3, 'hilly_tour',      '16/9 - 18/9'),
  ('cz4215-c2-waasland',    'Omloop van het Waasland',       'Class2', 'single',     1, 'flat_sprint',     '4/4'),
  ('cz4215-c2-morbihan',    'Grand Prix du Morbihan Mineur', 'Class2', 'single',     1, 'puncheur',        '30/8'),
  ('cz4215-c2-perigord',    'Tour du Périgord',              'Class2', 'stage_race', 2, 'balanced_week',   '20/6 - 21/6')
on conflict (external_id) do nothing;

-- Post-verify: 22 nye rækker, ingen navnekollision mod resten af kataloget.
do $$
declare v_nye int; v_dub int;
begin
  select count(*) into v_nye from public.race_pool where external_id like 'cz4215-%';
  select count(*) into v_dub from (
    select name from public.race_pool group by name having count(*) > 1
  ) d;
  if v_nye <> 22 then
    raise exception '#4215: forventede 22 nye katalog-loeb, fandt %', v_nye;
  end if;
  if v_dub > 0 then
    raise exception '#4215: % dublet-navn(e) i race_pool — navne-dedup er en haard invariant (#4075/#2276)', v_dub;
  end if;
  raise notice '#4215 OK — 22 nye loeb, 0 dublet-navne i kataloget';
end $$;
