-- #3327/#3328 — race_pool-katalog-udvidelse: flere WorldTour B/C-etapeløb + flere
-- brosten-endagsløb. Beskyttet mod #3327's "ejer så FØR store destruktive prod-indgreb"
-- (irrelevant her — ren additiv INSERT, ingen sletning/opdatering af eksisterende data)
-- men stadig BEVIDST ikke-appliet: race_pool-kataloget er spillets balance-overflade, og
-- nye løbs terrain_archetype/klasse/etapeantal er et game-design-valg ejeren bør se FØR
-- de indgår i S3-genereringen (deadline 23/8, #3295).
--
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/README.md).
-- Flyt til database/2026-*.sql (top-niveau) i en separat PR NÅR ejeren har godkendt.
--
-- ─── HVORFOR (dry-run-fund, PR der refser #3327/#3328) ───
--
-- selectTierRaceSet vælger prestige-først PÅ TVÆRS af tiers (øverste tier vælger først,
-- #2276 cross-tier dedup). Tier 1 (Division 1) har `classWhitelist=null` — den kan vælge
-- ALLE klasser, inkl. OtherWorldTourB/OtherWorldTourC, som "filler" under sin GT/Monuments/
-- OtherWorldTourA-rygrad. Med KUN 4 OtherWorldTourB-etapeløb (5/6/7/7 etaper) og 2
-- OtherWorldTourC-etapeløb (6/7 etaper) i hele kataloget æder tier 1's fillerbehov (~47
-- resterende game-days efter GT+Monuments+OtherWorldTourA) reelt HELE forsyningen, FØR
-- tier 2 (Division 2 — #3327/#3328's mål) overhovedet vælger. Dry-run mod ægte katalog
-- (2026-08-04) bekræftede: EFTER #3327/#3328-garantierne fik D2 stadig kun 1
-- OtherWorldTourC-etapeløb + 0 OtherWorldTourB-etapeløb (17 ProSeries dominerer 94% af
-- etapeløbene) — selve SELECTION-mekanikken var rettet, men KATALOGET rakte ikke.
--
-- Denne migration tilføjer 6 OtherWorldTourB + 5 OtherWorldTourC etapeløb (alle inden for
-- #3328's 6-8-etapers-bånd) + 4 nye brosten-endagsløb (2 pr. klasse), så tier 1's
-- fillerbehov OG tier 2's kernebehov begge kan dækkes af kataloget. Simuleret (samme
-- dry-run-script, `--with-expansion`, IN-MEMORY — ingen DB rørt) gav D2 5 OtherWorldTourB +
-- 7 OtherWorldTourC + 3 ProSeries etapeløb (fra 0+1+17) — se PR-body for fuld før/efter-tabel.
--
-- Klasse/etapeantal/terrain_archetype er et forslag, IKKE ejer-godkendte tal — race-navne
-- er fiktive (matcher kataloget stil, ingen ægte UCI-brands). Ejeren bør reviewe før apply.
--
-- Idempotent: ON CONFLICT (external_id) DO NOTHING — external_id er den stabile
-- import-nøgle (jf. racePoolImport.js), sikkert at re-køre.

-- ─── date_text: udfyldt 2026-08-05 før apply ──────────────────────────────────
--
-- Første udkast lod date_text være NULL. Alle 136 eksisterende race_pool-rækker
-- HAR en værdi, så de 15 nye ville være de eneste uden. Verificeret hvad
-- kolonnen faktisk driver, før den blev udfyldt:
--
--   * Kalender-genereringen bruger den IKKE — hverken tierCalendarMaterializer.js
--     eller tierRaceSelection.js refererer date_text. Løbsdage kommer fra
--     race_stage_schedule.scheduled_at via seasonDayForTime().
--   * Den er en ren VISNINGS-etiket: api.js sætter dayProfiles[].dateText som
--     in-game-dato-label pr. sæsondag, og SeasonEndPage sorterer løbslisten med
--     dateTextToDayOfYear(), der returnerer Infinity for NULL — de 15 ville
--     altså lande i en klump sidst i hver sæsonoversigt, uden dato.
--   * racePoolImport.js hasher (name + date_text) til external_id. De 15
--     external_id'er her er hardcodede, så en NULL ville kunne kollidere med en
--     senere import af samme navn.
--
-- Datoerne er derfor etiketter, ikke en planlægnings-beslutning: de bestemmer
-- hvad spilleren ser stå ved løbet, ikke hvornår det køres. Spændet matcher
-- etapeantallet (7 etaper = 7 kalenderdage), og placeringen følger den rigtige
-- sæsonform (brosten i det tidlige forår, bjerg-uger om sommeren). Overlap med
-- eksisterende løb er tilsigtet design (ejer, låst 10/7 på #2256).

BEGIN;

INSERT INTO race_pool (external_id, name, race_class, race_type, stages, country, terrain_archetype, date_text)
VALUES
  -- OtherWorldTourB etapeløb (6-8 etaper, #3328-bånd)
  ('26a1914e9391d46f', 'Ronde van Limburg',        'OtherWorldTourB', 'stage_race', 7, 'Belgium',     'balanced_week',         '12/5 - 18/5'),
  ('7c89cea334c5dd5c', 'Tour du Massif Central',    'OtherWorldTourB', 'stage_race', 6, 'France',      'mountain_tour',         '9/6 - 14/6'),
  ('8e16015cf1f35207', 'Settimana Ligure',          'OtherWorldTourB', 'stage_race', 7, 'Italy',       'hilly_tour',            '17/3 - 23/3'),
  ('c654f5de25847b55', 'Bayern Rundfahrt',          'OtherWorldTourB', 'stage_race', 6, 'Germany',     'sprinters_week',        '26/5 - 31/5'),
  ('b82d89d64e488328', 'Tour de Bretagne',          'OtherWorldTourB', 'stage_race', 6, 'France',      'cobbled_tour',          '21/4 - 26/4'),
  ('92e05a8bd2376062', 'Volta a Portugal Maior',    'OtherWorldTourB', 'stage_race', 8, 'Portugal',    'summit_tour',           '4/8 - 11/8'),
  -- OtherWorldTourC etapeløb (6-8 etaper, #3328-bånd)
  ('94d0a93648e19393', 'Tour of Scandinavia',       'OtherWorldTourC', 'stage_race', 6, 'Sweden',      'balanced_week',         '2/6 - 7/6'),
  ('1d1063f10467a909', 'Kroatien Rundfahrt',        'OtherWorldTourC', 'stage_race', 7, 'Croatia',     'sprinters_week',        '22/9 - 28/9'),
  ('8abd38ba643bc1bc', 'Tour de Tunisie',           'OtherWorldTourC', 'stage_race', 7, 'Tunisia',     'sprinter_tour_summits', '9/2 - 15/2'),
  ('bd5d230bce30433a', 'Ronde van Nederland Maior', 'OtherWorldTourC', 'stage_race', 6, 'Netherlands', 'cobbled_tour',          '25/8 - 30/8'),
  ('3175cdde86ba575c', 'Vuelta a Murcia Mayor',     'OtherWorldTourC', 'stage_race', 8, 'Spain',       'mountain_tour',         '6/10 - 13/10'),
  -- Brostens-endagsløb (#3327 — flere cobbled_classic-kandidater til D1/D2's whitelist)
  ('6a7e48230d6d4983', 'Scheldeprijs Groot',            'OtherWorldTourB', 'single', 1, 'Belgium', 'cobbled_classic', '8/4'),
  ('f9036e873eb0bfbf', 'Grote Prijs Jef Scherens',       'OtherWorldTourB', 'single', 1, 'Belgium', 'cobbled_classic', '15/4'),
  ('d88ec518fff5a605', 'Handzame Classic',               'OtherWorldTourC', 'single', 1, 'Belgium', 'cobbled_classic', '18/3'),
  ('80c642a40efe81fc', 'Le Samyn Groot',                 'OtherWorldTourC', 'single', 1, 'Belgium', 'cobbled_classic', '4/3')
ON CONFLICT (external_id) DO NOTHING;

COMMIT;

-- ─── Post-verify (kør manuelt efter apply) ───
-- select race_class, race_type, count(*), min(stages), max(stages)
-- from race_pool
-- where external_id in (
--   '26a1914e9391d46f','7c89cea334c5dd5c','8e16015cf1f35207','c654f5de25847b55',
--   'b82d89d64e488328','92e05a8bd2376062','94d0a93648e19393','1d1063f10467a909',
--   '8abd38ba643bc1bc','bd5d230bce30433a','3175cdde86ba575c','6a7e48230d6d4983',
--   'f9036e873eb0bfbf','d88ec518fff5a605','80c642a40efe81fc'
-- )
-- group by race_class, race_type;
-- -- forventet: 15 rækker fordelt 6 OWB-stage/5 OWC-stage/2 OWB-single/2 OWC-single.
