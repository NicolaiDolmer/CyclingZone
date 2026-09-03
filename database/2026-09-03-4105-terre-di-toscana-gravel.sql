-- #4105 — grus bliver en rigtig etapetype, og Terre di Toscana bliver et grusløb.
--
-- EJER-DIREKTIV 21/8 2026 (Discord #feedback-from-dolmer):
--   "Terre di Toscana skal blive et grusvejs løb og ikke et brostensløb"
--
-- EJER-RAMME 3/9: "det skal være næsten samme type der er god til den slags løb"
-- (altså: brostensrytteren vinder stadig grusløb) + "brostensevnen tæller kun på
-- etaper med brosten/grus".
--
-- HVORFOR DET IKKE ER EN REN DATARETTELSE. #4105 punkt 1 stiller selv spørgsmålet:
-- findes grus overhovedet som type? Svaret var nej. `race_stage_profiles.sectors`
-- har haft `kind: "cobbles"|"gravel"` siden 2026-07-21-race-route-model.sql, men
-- profile_type-CHECK'en kendte kun 10 værdier, og ingen af dem var grus. At sætte
-- Terre di Toscana til `terrain_archetype = 'gravel_classic'` uden denne migration
-- ville gøre løbet ugenerérbart. Motor-siden (demand-vektor, finale-vægte, sektor-
-- forsyning, terræn-bucket, labels) ligger i samme PR.
--
-- HVAD DEN GØR
--   1. Udvider race_stage_profiles.profile_type-CHECK'en med 'gravel' (additivt —
--      ingen eksisterende værdi fjernes, ingen eksisterende række rører sig).
--   2. Flytter Terre di Toscana fra arketypen `cobbled_classic` til `gravel_classic`
--      i race_pool. Fra næste kalender-generering får løbet profile_type 'gravel'.
--
-- HVAD DEN BEVIDST IKKE GØR: den rører IKKE etaper i en sæson der allerede kører.
-- S3 er `active`, og en spiller der har udtaget en brostensrytter til Terre di
-- Toscana skal ikke opdage midt i sæsonen at løbet har skiftet underlag. Punkt 2's
-- profil-opdatering er derfor afgrænset til sæsoner med status `upcoming` — mod
-- prod i dag rammer den 0 rækker (S4 findes endnu ikke), og det er det rigtige
-- resultat: S4 genereres EFTER denne migration og får grus fra arketypen.
-- Jf. CALENDAR_RULES.md §2c (én regenerering pr. sæson) og #4270's tørkørsel §5 M.
--
-- IDEMPOTENT: CHECK'en droppes+genskabes (samme mønster som
-- 2026-08-17-3546-itt-hilly-profile-type.sql), og begge UPDATE'er er WHERE-guardede
-- så gentagen kørsel skriver 0 rækker. IKKE-DESTRUKTIV.
--
-- Refs #4105 #4270 #3864

-- ── 1. profile_type kender nu grus ────────────────────────────────────────────
alter table public.race_stage_profiles
  drop constraint if exists race_stage_profiles_profile_type_check;

alter table public.race_stage_profiles
  add constraint race_stage_profiles_profile_type_check
  check (profile_type in (
    'flat','rolling','hilly','mountain','high_mountain',
    'itt','itt_hilly','ttt','cobbles','gravel','classic'
  ));

-- ── 2. Terre di Toscana er en grusklassiker ───────────────────────────────────
-- external_id 6ada4b5428dfd7b2 (OtherWorldTourB, single, 1 etape, date_text '7/3').
-- Spejlet i database/seed/race_pool_archetypes.json, så applyRacePoolArchetypes.js
-- ikke ruller ændringen tilbage næste gang den kører.
update public.race_pool
set terrain_archetype = 'gravel_classic',
    updated_at = now()
where external_id = '6ada4b5428dfd7b2'
  and terrain_archetype is distinct from 'gravel_classic';

-- ── 3. Kun kommende sæsoner: eksisterende etaperækker følger med ──────────────
-- Sikkerhedsnet hvis en `upcoming`-sæson allerede er materialiseret med den gamle
-- arketype. Rører aldrig en `active`/`completed` sæson (se hovedet).
update public.race_stage_profiles p
set profile_type = 'gravel'
from public.races r
join public.seasons s on s.id = r.season_id
join public.race_pool rp on rp.id = r.pool_race_id
where p.race_id = r.id
  and rp.external_id = '6ada4b5428dfd7b2'
  and s.status = 'upcoming'
  and p.is_manual = false
  and p.profile_type = 'cobbles';

-- pgrst_ddl_watch reloader normalt ved DDL; eksplicit NOTIFY koster intet.
notify pgrst, 'reload schema';

-- ── Post-verify (kør efter apply) ─────────────────────────────────────────────
-- select terrain_archetype from public.race_pool where external_id = '6ada4b5428dfd7b2';
--   forventet: gravel_classic
-- select count(*) from public.race_stage_profiles where profile_type = 'gravel';
--   forventet: 0 indtil S4 er genereret (S3 røres ikke — se hovedet)
-- select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'race_stage_profiles_profile_type_check';
--   forventet: listen indeholder 'gravel'
