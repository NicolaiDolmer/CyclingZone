-- #4288 — Grand Tours: 17/17/18 etaper og laengder forankret i virkeligheden.
--
-- EJER-BESLUTNING 3/9 (bindende, to punkter):
--   1. Etapeantal i kataloget: Giro della Penisola 17 (i dag 18), Vuelta Iberica 17
--      (uaendret), Tour de l'Hexagone 18 (i dag 17).
--   2. GT-realisme forankret i virkeligheden: samlet snit INKL. enkeltstart 155-170 km
--      pr. etape, landevejsetaper 165-185 km i snit, prolog 8-14 km, enkeltstart 25-40 km.
--
-- MAALT READ-ONLY MOD PROD 3/9 (saeson 3, division 1 — de tre GT'ers eneste instanser):
--
--   | Loeb                | Etaper | Samlet snit | Landevejssnit | Prolog | Enkeltstart |
--   |---------------------|-------:|------------:|--------------:|-------:|------------:|
--   | Giro della Penisola |     18 |    162,6 km |      171,8 km |   6 km |           - |
--   | Tour de l'Hexagone  |     17 |    153,0 km |      171,3 km |   5 km |       26 km |
--   | Vuelta Iberica      |     17 |    155,6 km |      173,0 km |      - |    24+27 km |
--
--   Touren laa UNDER ejerens gulv paa 155 km, Vueltaen 0,6 km over det, og alle prologer
--   og den ene 24-km-enkeltstart laa under de nye gulve. Landevejssnittene laa i baandet,
--   men i den nederste tredjedel.
--
-- HVAD DENNE MIGRATION GOER — OG HVAD KODEN GOER
--   Etapernes RUTER er ikke katalogdata: de genereres deterministisk pr. saeson-instans
--   af backend/lib/raceStageProfileGenerator.js (pass 1: terraen + finale) og
--   raceRouteGenerator.js (pass 2: distance, stigninger, spurter). Et etapeantal og en
--   distance kan derfor ikke rettes det samme sted:
--     · ETAPEANTALLET er katalogdata (race_pool.stages) → denne migration, punkt 1.
--     · LAENGDERNE er generator-regler → GRAND_TOUR_DISTANCE_BANDS og
--       GRAND_TOUR_PROLOGUE_DISTANCE_BAND i raceRouteGenerator.js, i samme PR. Baandet
--       slaar terraen-baandet, men KUN for etapeloeb med grand_tour-arketypen, praecis
--       som #4104's klasse-baand gjorde det for monumenterne.
--   Punkt 3 nedenfor er sikkerhedsnettet for en `upcoming`-saeson der allerede maatte
--   vaere materialiseret med de gamle baand.
--
-- HVORFOR GIROEN MISTER EN ETAPE UDEN AT NOGEN VAELGER HVILKEN: generatoren bygger hele
-- etapesekvensen om fra `stages`, saa 17 etaper er en NY, komplet plan der overholder
-- §7's etaperaekkefoelge (garantier, bjerg-blokke paa maks 3, haardeste etape naestsidst)
-- og §7b's finale-fordeling. Der findes ingen "etape 12" at slette; at slette en raekke i
-- en genereret sekvens ville netop braekke de to regler. Samme mekanik giver Touren sin
-- 18. etape. Maalt over 600 saeson-seeds pr. GT rammer alle tre baandet i 97,6 % af
-- traekningerne (mod 16,7 % foer), se docs/audits/gt-realism-2026-09-03.md.
--
-- HVAD DEN BEVIDST IKKE GOER: den roerer IKKE saeson 3. S3 er `active`, GT'erne er koert
-- eller koerer, og resultater/praemier er bogfoert. Punkt 3 er derfor afgraenset til
-- saesoner med status `upcoming` — mod prod i dag rammer den 0 raekker (S4 findes endnu
-- ikke), og det er det rigtige resultat: S4 genereres EFTER denne migration og faar baade
-- etapeantallet og baandene fra starten. Samme WHERE-moenster som
-- 2026-09-03-4105-terre-di-toscana-gravel.sql. Jf. CALENDAR_RULES.md §2c.
--
-- IDEMPOTENT: alle tre UPDATE'er er WHERE-guardede paa den vaerdi de skriver, saa anden
-- koersel skriver 0 raekker. Ingen DDL. IKKE-DESTRUKTIV: intet slettes, intet pensioneres.
--
-- IKKE ANVENDT ENDNU: auto-migrate.yml koerer filen ved merge til main.
--
-- Refs #4288 #4270 #4709 #4203 #4105

-- ── 1. Etapeantallet i kataloget ──────────────────────────────────────────────
-- external_id d2045415269bc5a8 = Giro della Penisola, 28d2e64796e82b54 = Tour de
-- l'Hexagone. Vueltaen (93008619a50faeeb) staar allerede paa 17 og roeres ikke.
-- Spejlet i scripts/race_pool_seed.csv, saa seedRacePool.js ikke ruller aendringen
-- tilbage naeste gang den koerer (external_id = hash(navn + dato), saa etapetallet i
-- CSV'en kan aendres uden at raekken skifter identitet).
-- date_text er UAENDRET: kalenderens kronologi laeses af datoen (#3469), og begge
-- vinduer rummer det nye etapetal (Giro 8/5-28/5 = 21 dage, Tour 4/7-22/7 = 19 dage,
-- mod etaper + 2 hviledage jf. CALENDAR_RULES.md §3).
update public.race_pool
set stages = 17,
    updated_at = now()
where external_id = 'd2045415269bc5a8'
  and stages is distinct from 17;

update public.race_pool
set stages = 18,
    updated_at = now()
where external_id = '28d2e64796e82b54'
  and stages is distinct from 18;

-- ── 2. Sikkerhedsnet: prologer i en kommende saeson ───────────────────────────
-- En prolog er defineret som i #4709's scorecard: loebets FOERSTE etape, tempo-profil,
-- under 25 km. Nyt gulv 8 km, nyt loft 14 km. Klemningen kan kun LOEFTE (det gamle
-- baand var 5-8 km), saa etapens stigninger og sektorer forbliver gyldige — kun
-- maal-spurtens km foelger med, saa `sprints` ikke peger uden for ruten.
update public.race_stage_profiles p
set distance_km = greatest(8, least(14, p.distance_km)),
    sprints = (
      select jsonb_agg(
               case when e->>'kind' = 'finish'
                    then jsonb_set(e, '{km}', to_jsonb(greatest(8, least(14, p.distance_km))))
                    else e end
               order by ord)
      from jsonb_array_elements(p.sprints) with ordinality as t(e, ord)
    )
from public.races r
join public.seasons s on s.id = r.season_id
join public.race_pool rp on rp.id = r.pool_race_id
where p.race_id = r.id
  and rp.terrain_archetype = 'grand_tour'
  and s.status = 'upcoming'
  and p.is_manual = false
  and p.stage_number = 1
  and p.profile_type in ('itt', 'itt_hilly', 'ttt')
  and p.distance_km < 8;

-- ── 3. Sikkerhedsnet: rigtige enkeltstarter i en kommende saeson ──────────────
-- Alt tempo der IKKE er prologen (etape 2+, eller etape 1 paa 25 km og derover) skal
-- vaere mindst 25 km. Ogsaa her kun et loeft: de gamle baand var itt 15-40 og
-- itt_hilly 15-30, saa ingen raekke bliver kortere, og stigningernes crest_km bliver
-- ikke hjemloese.
update public.race_stage_profiles p
set distance_km = 25,
    sprints = (
      select jsonb_agg(
               case when e->>'kind' = 'finish' then jsonb_set(e, '{km}', to_jsonb(25))
                    else e end
               order by ord)
      from jsonb_array_elements(p.sprints) with ordinality as t(e, ord)
    )
from public.races r
join public.seasons s on s.id = r.season_id
join public.race_pool rp on rp.id = r.pool_race_id
where p.race_id = r.id
  and rp.terrain_archetype = 'grand_tour'
  and s.status = 'upcoming'
  and p.is_manual = false
  and p.profile_type in ('itt', 'itt_hilly', 'ttt')
  and p.stage_number > 1
  and p.distance_km < 25;

-- LANDEVEJSETAPER i en allerede materialiseret `upcoming`-saeson rettes IKKE her. En
-- distance kan ikke klemmes uden ogsaa at flytte stigningernes crest_km, spurternes km
-- og hoejdemetrene — SQL kan ikke genskabe en sammenhaengende rute, kun generatoren kan.
-- Findes der en saadan saeson naar migrationen koerer, er svaret CALENDAR_RULES.md §2c:
-- én regenerering af kalenderen, som saa henter baade etapeantal og baand fra koden.
-- Post-verify-forespoergslen nedenfor viser om det er noedvendigt.

-- ── Post-verify (koer efter apply) ────────────────────────────────────────────
-- 1) Etapeantallet i kataloget
-- select name, stages from public.race_pool
--   where external_id in ('d2045415269bc5a8','28d2e64796e82b54','93008619a50faeeb')
--   order by name;
--   forventet: Giro della Penisola 17 · Tour de l'Hexagone 18 · Vuelta Iberica 17
--
-- 2) Snit pr. GT pr. saeson + tempoetapernes laengder (baandet: samlet 155-170,
--    landevej 165-185, prolog 8-14, enkeltstart 25-40)
-- select s.number as saeson, s.status, rp.name,
--        count(*) as etaper,
--        round(avg(p.distance_km), 1) as samlet_snit,
--        round(avg(p.distance_km) filter (
--          where p.profile_type not in ('itt','itt_hilly','ttt')), 1) as landevejs_snit,
--        min(p.distance_km) filter (
--          where p.profile_type in ('itt','itt_hilly','ttt') and p.stage_number = 1
--            and p.distance_km < 25) as prolog_km,
--        array_agg(p.distance_km order by p.stage_number) filter (
--          where p.profile_type in ('itt','itt_hilly','ttt')
--            and not (p.stage_number = 1 and p.distance_km < 25)) as enkeltstart_km
--   from public.race_stage_profiles p
--   join public.races r on r.id = p.race_id
--   join public.seasons s on s.id = r.season_id
--   join public.race_pool rp on rp.id = r.pool_race_id
--   where rp.terrain_archetype = 'grand_tour'
--   group by s.number, s.status, rp.name, r.id
--   order by s.number, rp.name;
--   forventet lige efter apply: KUN saeson 3 (`active`) svarer, med de uaendrede tal fra
--   tabellen i hovedet — 162,6 / 153,0 / 155,6 km. S3 SKAL staa uroert; aendrer et af de
--   tal sig, har migrationen ramt en koert saeson og skal rulles tilbage.
--   forventet efter S4 er bygget: tre raekker i saeson 4 med etaper 17/18/17, samlet snit
--   i 155-170, landevejssnit i 165-185, prolog 8-14 og hver enkeltstart 25-40.
