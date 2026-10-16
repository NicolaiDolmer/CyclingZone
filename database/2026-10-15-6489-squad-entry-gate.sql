-- #6489 · Trup-skift: én port i databasen
--
-- PROBLEM
--   En rytters trup (riders.squad) skrives mange steder: JS-stierne (moveRider,
--   graduering, akademi-oprykning; lukket i #6480), SQL-funktioner (fx
--   database/2026-09-24-5432-squad-caps-rpc.sql) og manuelle rettelser. Hver ny sti
--   kan glemme at fjerne rytteren fra den gamle trups ikke-startede løb (#5903).
--   Den eksisterende forward-guard (database/2026-06-26-ghost-race-entries-trigger.sql)
--   fyrer kun på team_id/is_academy/is_retired og kender ikke trupperne, så et
--   junior → U23-skift (kun squad ændres) gik helt uden om den.
--
-- HVAD DEN GØR
--   1) public.squad_entry_allowed(...): ÉN SQL-regel for "må rytteren stå på denne
--      startliste?". Spejler backend/lib/riderEligibility.js led for led:
--        løbets trup   = raceSquadOf: u23/junior, ellers senior
--        seniorløb     = isSeniorSquadRider: squad er ikke en ungdomstrup OG
--                        is_academy er ikke true
--        ungdomsløb    = rytterens squad er præcis løbets trup
--        pensioneret   = is_retired er true → aldrig
--        hold          = entry'ens team_id sat → rytterens team_id skal matche
--      Paritetstesten (backend/lib/squadEntryGate.test.js) kører samme tilfælde mod
--      denne funktion, mod triggeren og mod isEligibleRider.
--   2) cleanup_ineligible_future_entries() (samme navn, CREATE OR REPLACE): sletter
--      rytterens rækker i løb der ikke er startet (status 'scheduled', 0 kørte
--      etaper), som hans NYE tilstand ikke må køre. Historik og igangværende felter
--      røres aldrig (samme prædikat som før).
--   3) Triggeren fyrer nu også på squad. Det er stadig én trigger: den gamle regel
--      (akademi/pensioneret/holdskift) er et delmængde-tilfælde af den nye.
--
-- ADFÆRDSÆNDRING MOD DEN GAMLE KROP
--   Den gamle krop slettede ALLE ikke-startede entries for en rytter med
--   is_academy = true. Den nye beholder en ungdomsrytters entries i løb for hans
--   egen trup. Før trupperne var det det samme; nu er det den rigtige regel.
--
-- HVAD DEN IKKE GØR
--   Ingen backfill: prod havde 15/10 0 forkerte rækker i ikke-startede løb (læst
--   read-only). Den daglige vagt (squad-entry-gate-watch) tæller dem fremover.
--
-- IDEMPOTENT: CREATE OR REPLACE + DROP/CREATE TRIGGER i samme transaktion (intet
-- vindue uden trigger). Anden kørsel = no-op. Ingen data muteres ved apply.
--
-- ⚠️ Applies af auto-migrate.yml ved merge (#2642). Ikke destruktiv for data.
--
-- Rollback: gen-kør database/2026-06-26-ghost-race-entries-trigger.sql (gammel krop
-- + trigger uden squad), derefter
--   DROP FUNCTION IF EXISTS public.squad_entry_allowed(uuid, text, boolean, boolean, uuid, text);

BEGIN;

-- riders og race_entries er varme tabeller: fejl hurtigt i stedet for at stå i kø
-- bag live-trafik (auto-migrate kan køres igen).
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.squad_entry_allowed(
  p_rider_team_id     uuid,
  p_rider_squad       text,
  p_rider_is_academy  boolean,
  p_rider_is_retired  boolean,
  p_entry_team_id     uuid,
  p_race_squad        text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT
    p_rider_is_retired IS NOT TRUE
    AND (p_entry_team_id IS NULL OR p_rider_team_id IS NOT DISTINCT FROM p_entry_team_id)
    AND CASE
          WHEN p_race_squad IN ('u23', 'junior')
            THEN p_rider_squad IS NOT DISTINCT FROM p_race_squad
          ELSE (p_rider_squad IS NULL OR p_rider_squad NOT IN ('u23', 'junior'))
               AND p_rider_is_academy IS NOT TRUE
        END
$$;

COMMENT ON FUNCTION public.squad_entry_allowed(uuid, text, boolean, boolean, uuid, text) IS
  '#6489: må rytteren stå på startlisten? SQL-spejl af riderEligibility.isEligibleRider + raceSquadOf. Paritetstest: backend/lib/squadEntryGate.test.js.';

-- Ren funktion uden dataadgang. Triggeren kaldes som den rolle der opdaterer
-- riders, så service_role og authenticated skal kunne kalde den; anon aldrig.
REVOKE ALL ON FUNCTION public.squad_entry_allowed(uuid, text, boolean, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.squad_entry_allowed(uuid, text, boolean, boolean, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_ineligible_future_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  DELETE FROM race_entries re
    USING races r
    WHERE re.rider_id = NEW.id
      AND re.race_id = r.id
      AND r.status = 'scheduled'
      AND coalesce(r.stages_completed, 0) = 0
      AND NOT public.squad_entry_allowed(
        NEW.team_id, NEW.squad, NEW.is_academy, NEW.is_retired, re.team_id, r.squad
      );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_ineligible_future_entries ON public.riders;
CREATE TRIGGER trg_cleanup_ineligible_future_entries
  AFTER UPDATE OF team_id, is_academy, is_retired, squad ON public.riders
  FOR EACH ROW
  WHEN (
    NEW.team_id      IS DISTINCT FROM OLD.team_id
    OR NEW.is_academy IS DISTINCT FROM OLD.is_academy
    OR NEW.is_retired IS DISTINCT FROM OLD.is_retired
    OR NEW.squad      IS DISTINCT FROM OLD.squad
  )
  EXECUTE FUNCTION public.cleanup_ineligible_future_entries();

COMMIT;
