-- 2026-06-26 — Forward-guard mod ghost race_entries (#1906 defense-in-depth)
--
-- Rod-årsag: når en rytter forlader sit hold (salg/transfer/fyring/tvangssalg) eller
-- bliver akademi/pensioneret, ændres riders.team_id/is_academy/is_retired — men hans
-- FREMTIDIGE race_entries hænger ved med det gamle holds team_id og phantom-binder en
-- ægte rytter (gav "kan ikke gemme opstilling"-409 + dobbeltbooking). Kun
-- demote_rider_to_academy-RPC'en ryddede hidtil entries; alle andre afgangs-stier
-- (auktion, transfer, swap, release, gælds-tvangssalg, squad-enforcement, pensionering,
-- legacy-retirement, beta-reset, admin) efterlod ghosts.
--
-- Denne trigger gør ghosts STRUKTURELT umulige: så snart en af de tre eligibility-bærende
-- kolonner ændrer sig, ryddes rytterens entries i ENDNU-IKKE-AFVIKLEDE løb. Predikatet er
-- IDENTISK med demote_rider_to_academy (status='scheduled' AND stages_completed=0), så
-- historik (completed-løb) og igangværende/frosne felter (stages_completed>0) ALDRIG røres.
--
-- App-laget (backend/lib/raceEntryCleanup.js) rydder også med det samme på de fleste stier
-- (defense-in-depth + dækker vinduet hvis denne migration afventer merge). Begge sletter
-- samme rækker → idempotent og ufarligt at have begge.
--
-- VERIFIKATION FØR MERGE (kør mod prod-klon eller en branch-DB):
--   1) Tæl forventede sletninger:
--        SELECT count(*) FROM race_entries re JOIN races r ON r.id = re.race_id
--        WHERE r.status='scheduled' AND r.stages_completed=0;   -- = aktive felter (rør kun ineligible)
--   2) Bekræft at completed/igangværende entries IKKE rammes (predikatet ekskluderer dem).
--   3) Simulér en team_id-ændring på én test-rytter og bekræft kun hans fremtidige entries forsvinder.
-- Pr. 2026-06-26 var der 0 aktive ghosts (cleanup-scriptet #1800/#1742 har kørt) → dette er
-- en ren FORWARD-GUARD, ingen backfill.

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
      AND r.stages_completed = 0
      AND (
        NEW.is_academy = true                       -- blev akademirytter
        OR NEW.is_retired = true                     -- blev pensioneret
        OR re.team_id IS DISTINCT FROM NEW.team_id   -- forlod entry'ens hold (salg/fyring/swap)
      );
  RETURN NEW;
END;
$$;

-- Fyrer KUN når en af de tre eligibility-bærende kolonner faktisk ændrer sig — undgår
-- write-amplification ved urelaterede rytter-opdateringer (form/værdi/løn osv.).
-- NB (perf): ved bulk-ops (legacy-retirement/beta-reset, 600-800 rækker) fyrer triggeren
-- pr. række. Relaunch wiper typisk race_entries separat; hold øje hvis det bliver en hot path.
DROP TRIGGER IF EXISTS trg_cleanup_ineligible_future_entries ON public.riders;
CREATE TRIGGER trg_cleanup_ineligible_future_entries
  AFTER UPDATE OF team_id, is_academy, is_retired ON public.riders
  FOR EACH ROW
  WHEN (
    NEW.team_id   IS DISTINCT FROM OLD.team_id
    OR NEW.is_academy IS DISTINCT FROM OLD.is_academy
    OR NEW.is_retired IS DISTINCT FROM OLD.is_retired
  )
  EXECUTE FUNCTION public.cleanup_ineligible_future_entries();
