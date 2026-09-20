-- #5405 — tre nye bjergrige etapeløb i kataloget (EJER-GO 20/9).
--
-- HVORFOR. Afgørende bjergdage lå under målet i både Division 2 og Division 3.
-- Undersøgelsen 19/9 (docs/audits/2026-09-19-5405-bjergdage-bytte.md +
-- docs/audits/2026-09-19-5405-nye-bjergloeb-udkast.md) viste to ting: forsyningen af
-- bjergrige etapeløb i det klasse-vindue D2 og D3 deler (ProSeries) er for lille, OG
-- arketype-reservationen binder samtidig. Ingen af delene virker alene:
--   · kun nye løb  → D2 og D3 står helt uændrede (walket tager dem ikke af sig selv)
--   · kun højere reservation → D3 når bjerg-målet, men mister sin enkeltstart
-- Denne migration er FORSYNINGS-halvdelen. Reservations-halvdelen ligger i samme PR
-- (backend/lib/tierCalendarGuarantees.js, TIER_ARCHETYPE_RESERVATIONS). De to hører
-- sammen og må ikke skilles ad: uden løbene her kan de hævede reservationer ikke mættes.
--
-- HVORFOR ProSeries OG IKKE Class1 (TIER_CLASS_WHITELIST, tierRaceSelection.js):
--   D1 alle klasser · D2 OtherWorldTourB/C + ProSeries · D3 ProSeries + Class1 ·
--   D4 Class1 + Class2.
-- ProSeries er den ENESTE klasse D2 og D3 deler. Class1-løb kan pr. konstruktion aldrig
-- nå D2, og målingen bekræftede det: nye Class1-bjergløb lander i praksis alle i D4 og
-- gør den for bjergrig, mens D2 og D3 ikke flytter sig en eneste etape.
--
-- DEN ÆRLIGE NOTE OM KLASSEN (ejeren har taget stilling 20/9): alle tre forbilleder er i
-- virkeligheden UCI 2.1 (= Class1 i kataloget). De ligger her én klasse højere, fordi de
-- ellers ikke kan nå D2. Det er en afvigelse fra kataloget som rent spejl af
-- virkeligheden. Den er til at forsvare — katalogets ProSeries- og WorldTour-bånd er
-- allerede fyldt 1:1 mod virkeligheden, så der findes ikke et ubrugt bjergrigt løb på
-- det niveau at tage udgangspunkt i, og forbillederne er reelt vokset over deres klasse.
--
-- NAVNENE ER SEED-NØGLEN, IKKE PYNT. Der er ingen etaper i kataloget: etapeprofilerne
-- genereres hver gang en kalender bygges, ud fra arketypen og en seed afledt af
-- external_id (raceStageProfileGenerator.seedIdentityFor). external_id er her udledt
-- PRÆCIS som seed-importen gør det (racePoolImport.buildExternalId =
-- sha256(lowercase(navn) | date_text), 16 tegn), så rækkerne her er bit-identiske med de
-- rækker `scripts/race_pool_seed.csv` selv ville skabe — og med det parcours tørkørslen
-- 19-20/9 målte på. Ændres et navn eller en dato, ændres parcours, og målingen holder
-- ikke. Derfor er navnene låst.
--   Volta Galega                 | 14/4 - 18/4 -> 4adca5fb36d7264d
--   Rundfahrt der Hohen Tauern   | 9/7 - 13/7  -> 3823e08096f72db9
--   Volta Portuguesa             | 6/8 - 10/8  -> cc776090c82ec546
-- Navnene er FIKTIVE og afledt af regionen, ikke af arrangørens varemærke — samme
-- juridiske spor som de fiktive ryttere (#669) og resten af kataloget.
--
-- date_text ER IKKE PYNT (#3469): den er kilden til seasonFraction, altså hvor på året
-- løbet hører hjemme. De tre ligger i april, juli og august, som deres forbilleder.
--
-- ETAPEANTAL: ProSeries-båndet er 3-5 etaper (CLASS_STAGE_LENGTH_BAND, #3328). Alle tre
-- ligger på 5. Volta Portuguesas forbillede har 10 etaper i virkeligheden; det hører til
-- en højere klasse og er kortet ned til båndets maksimum.
--
-- NAVNE-DEDUP er en hård invariant (#4075 within-tier, #2276 cross-tier). De tre navne er
-- kontrolleret mod hele det aktive katalog: 0 kollisioner.
--
-- IDEMPOTENT: ON CONFLICT (external_id) DO NOTHING. Kørt to gange indsættes 0 rækker.
-- IKKE-DESTRUKTIV: rører ingen eksisterende række, sletter intet, pensionerer intet.
-- Applies af auto-migrate.yml EFTER merge (#2642); intet er kørt mod prod fra denne PR.
--
-- Refs #5405 #3469 #3328 #4075 #2276 #669

insert into public.race_pool (external_id, name, race_class, race_type, stages, terrain_archetype, country, date_text)
values
  ('4adca5fb36d7264d', 'Volta Galega',               'ProSeries', 'stage_race', 5, 'summit_tour', 'Spain',    '14/4 - 18/4'),
  ('3823e08096f72db9', 'Rundfahrt der Hohen Tauern', 'ProSeries', 'stage_race', 5, 'summit_tour', 'Austria',  '9/7 - 13/7'),
  ('cc776090c82ec546', 'Volta Portuguesa',           'ProSeries', 'stage_race', 5, 'summit_tour', 'Portugal', '6/8 - 10/8')
on conflict (external_id) do nothing;

-- ── Post-verify (køres efter apply) ───────────────────────────────────────────
-- select external_id, name, race_class, stages, terrain_archetype, country, date_text
--   from public.race_pool
--   where external_id in ('4adca5fb36d7264d','3823e08096f72db9','cc776090c82ec546');
--   forventet: 3 rækker, retired_at is null, præcis de værdier der står ovenfor
-- select name, count(*) from public.race_pool where retired_at is null
--   group by name having count(*) > 1;
--   forventet: 0 rækker (navne-dedup er en hård invariant)
-- select count(*) from public.race_pool
--   where retired_at is null and race_class = 'ProSeries' and terrain_archetype = 'summit_tour';
--   forventet: 3 flere end før migrationen — det er forsyningen de hævede
--   summit_tour-reservationer for D2 og D3 skal mættes af.
