-- scripts/constraint-form-audit.sql
-- Runtime-vagt for KRITISK CONSTRAINT-FORM (#4163 / #4159 punkt 3).
--
-- HVORFOR. `scripts/lint-constraint-form.mjs` er den STATISKE halvdel: den læser
-- database/*.sql og spærrer en migration der genskaber en kritisk constraint uden
-- dens fulde definition. Den kan pr. definition kun se filer. Hånd-anvendt SQL,
-- en manuel Studio-ændring eller et reparations-script der aldrig blev commitet
-- ser den aldrig. #4155-reparationen droppede `no_rider_double_booking` og gav den
-- tilbage UDEN `deferrable`; post-verify spurgte kun `select conname` og så præcis
-- dét den spurgte om. Sweepen fejlede 116-140 enheder pr. tick i timerne op til
-- S3's første løbsdag, og fejlteksten pegede på "ægte dobbeltbooking" — den stik
-- modsatte diagnose.
--
-- Denne fil er den anden halvdel: den spørger DATABASEN, dagligt, og er derfor den
-- eneste af de to der kan se den faktiske tilstand. Samme arbejdsdeling som
-- check-secdef-revoke-lint.mjs (filer) vs. security-grants.sql (prod).
--
-- KONTRAKT. Tom output = alt i orden. Hver række er ét fund:
--     <constraint>|<tabel>|<problem>
--
-- Invarianten "1 rytter = 1 løb pr. løbsdag" flyttede i #4173 fra
-- `no_rider_double_booking` (int4range-EXCLUDE på race_entries) til
-- `no_rider_double_booking_day` (UNIQUE på race_entry_days). Vagten kræver derfor
-- ikke at BEGGE findes — den kræver at MINDST ÉN bærer invarianten, og at enhver
-- der findes er DEFERRABLE. Uden deferrability svarer Postgres 42809 på
-- apply_race_entry_unit_batch's `set constraints ... deferred`, og
-- entry-generator-sweepen falder tilbage i insert-før-delete-dødvandet.
--
-- Kørsel:
--   psql "$SUPABASE_DB_URL" -tA -F '|' -v ON_ERROR_STOP=1 -f scripts/constraint-form-audit.sql
--
-- Refs #4159 #4163 #4173 #3934 #4155.

with kritiske(conname, tabel, hvorfor) as (
  values
    ('no_rider_double_booking',     'race_entries',    'apply_race_entry_unit_batch udskyder den under rytter-swaps (#3934)'),
    ('no_rider_double_booking_day', 'race_entry_days', '#4173-afloeseren; samme udskydelse i batch-RPC en (#3934/#4173)')
),
fundet as (
  select k.conname, k.tabel, k.hvorfor, c.condeferrable, c.conrelid::regclass::text as faktisk_tabel
    from kritiske k
    left join pg_constraint c
      on c.conname = k.conname
     and c.connamespace = 'public'::regnamespace
)
-- Fund 1: en constraint der FINDES, men har mistet sin form.
select conname || '|' || faktisk_tabel || '|' ||
       'findes men er IKKE deferrable - ' || hvorfor
  from fundet
 where condeferrable is false

union all

-- Fund 2: ingen af dem bærer invarianten laengere. Én af dem SKAL findes; hvilken
-- af de to er et migrations-spoergsmaal (#4173), at ingen findes er et hul.
select 'no_rider_double_booking(_day)|race_entry_days|'
       || 'INGEN af de to constraints findes - invarianten "1 rytter = 1 loeb pr. loebsdag" er ubevogtet (#3420/#4173)'
 where not exists (select 1 from fundet where condeferrable is not null);
