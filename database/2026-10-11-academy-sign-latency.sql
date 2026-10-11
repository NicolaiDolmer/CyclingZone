-- =============================================================================
-- 2026-10-11 — Rytter-ejerskifte: ingen fuld scanning af træningsrapporter (#6450)
-- =============================================================================
--
-- PROBLEM: akademi-signering (RPC finalize_academy_acquisition) tog 8-13 s
-- (pg_stat_statements 11/10: 14 kald, snit 8,1 s, max 13,4 s). Signerer et hold
-- to ryttere tæt på hinanden, venter nr. 2 på holdets advisory-lås og rammer
-- lock timeout (55P03, Sentry CYCLINGZONE-98). Samme klasse rammer andre
-- skrivere der giver en rytter UDEN træningshistorik et hold (PostgREST
-- UPDATE riders SET team_id ...: 4-5 s i snit; INSERT riders med team_id).
--
-- ROD-ÅRSAG: triggeren trg_initialize_first_use_rider_condition (AFTER INSERT
-- OR UPDATE OF team_id ON riders, #6061) tjekker som sidste first-use-vagt
--
--     NOT EXISTS (SELECT 1 FROM training_day_runs
--                 WHERE report->'riders' @> jsonb_build_array(
--                         jsonb_build_object('rider_id', NEW.id)))
--
-- Der findes et GIN-indeks på (report->'riders') jsonb_path_ops, men planneren
-- vælger det ALDRIG inde i en EXISTS: den antager at hver ~100. række matcher
-- og at en sekventiel scanning derfor stopper efter få rækker (seq scan-cost
-- ~9 mod bitmap-cost ~445). For en rytter UDEN historik (præcis en akademi-
-- kandidat eller fri rytter) matcher ingen rækker, så scanningen læser HELE
-- tabellen og detoaster hver rapport (heap + TOAST ~375 MB). Seq scan-costen
-- regner ikke detoast med, så estimatet er groft for lavt.
--
-- BEVIS (prod, read-only 11/10 — kun SELECT/EXPLAIN uden ANALYZE):
--   * EXPLAIN (GENERIC_PLAN) af triggerens INSERT ... WHERE NOT EXISTS:
--     InitPlan 4 -> Seq Scan on training_day_runs (Filter: report->'riders' @> ...).
--     Samme plan med en konstant uuid (custom plan).
--   * Samme probe som ren SELECT med en uuid der ikke findes, timet med
--     clock_timestamp() i én read-only transaktion:
--       standard-plan (seq scan)        12 354 ms
--       SET LOCAL enable_seqscan = off       59 ms   (Bitmap Index Scan på GIN)
--     Med en rytter der FINDES i en rapport: found=true på 2,6 ms (samme svar).
--   * pg_stat_statements: finalize_academy_acquisition bruger ~173k buffer-
--     blokke (~1,35 GB) PR. KALD. Det er arbejde, ikke ventetid på en lås.
--
-- HOT-ROW-HYPOTESEN (mark_ranking_refresh_dirty -> ranking_refresh_work_state)
-- er IKKE årsagen: (1) blok-tallet ovenfor forklarer tiden; (2) refresh-
-- funktionerne læser kun work_state-rækken (ingen FOR UPDATE), og claim/finish
-- opdaterer den på <1 ms; (3) i RPC'en fyrer statement-triggeren først EFTER
-- rytter-UPDATE'ens row-triggere, altså efter den langsomme scanning. Bemærk:
-- pg_stat_statements.track='top', så den indlejrede UPDATE kan ikke måles
-- direkte — konklusionen hviler på (1)-(3).
--
-- LØSNING: SET enable_seqscan = off på trigger-funktionen. Det gælder kun
-- mens funktionen kører (funktions-lokal GUC, gendannes ved retur). Alle
-- andre opslag i funktionen bruger allerede indeks (rider_condition PK,
-- app_config PK, training_condition_settlements/training_rider_ticks/
-- training_race_loads PK med rider_id som første kolonne), så kun træningsrapport-
-- proben skifter plan: Seq Scan -> Bitmap Index Scan på
-- idx_training_day_runs_report_riders. enable_seqscan=off FORBYDER ikke en
-- seq scan; findes indekset ikke, vælges seq scan stadig (korrekt, bare
-- langsomt). Semantikken er derfor uændret: samme fire first-use-vagter,
-- samme rækkefølge, samme INSERT ... ON CONFLICT DO NOTHING.
--
-- HVORFOR IKKE en separat helper-funktion: triggeren kører med kalderens
-- rettigheder (SECURITY INVOKER), og EXECUTE på en ny funktion tjekkes ved
-- kald-tid. Det ville åbne en ny rettigheds-flade på enhver rolle der kan
-- flytte en rytter. Funktions-lokal SET på den eksisterende funktion ændrer
-- ingen grants.
--
-- Ingen data ændres. Ingen backfill. Idempotent: CREATE OR REPLACE FUNCTION
-- (samme signatur, samme trigger), REVOKE/GRANT som #6061. Triggeren selv
-- røres ikke. Ingen prod-apply som del af at skrive filen: auto-migrate.yml
-- kører den ved merge (#2642); post-verify nederst køres efter.
--
-- =============================================================================
-- ROLLBACK: kør database/2026-10-03-6061-first-use-rider-condition.sql igen
-- (samme krop uden SET enable_seqscan). Ingen data at rulle tilbage.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.initialize_first_use_rider_condition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
-- #6450: tving træningsrapport-proben på GIN-indekset (se header).
SET enable_seqscan = off
AS $$
BEGIN
  IF NEW.team_id IS NULL OR NEW.is_retired IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.rider_condition WHERE rider_id=NEW.id) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_condition_per_date'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_tick_per_race_day'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN
    RAISE EXCEPTION 'training_condition_per_date requires training_tick_per_race_day';
  END IF;
  -- Same first-use guards as register_training_date_work. Ownership mutation
  -- already holds this rider row lock; ON CONFLICT preserves any existing state.
  INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
    SELECT NEW.id,50,0,COALESCE(NEW.acquired_at,NEW.created_at)
    WHERE NOT EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_race_loads WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_day_runs
        WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',NEW.id)))
    ON CONFLICT(rider_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_first_use_rider_condition() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_first_use_rider_condition() TO service_role;

COMMIT;

-- =============================================================================
-- POST-VERIFY (køres EFTER apply, read-only — forventet output i kommentaren)
-- =============================================================================
-- 1. Funktionen bærer den lokale GUC, triggeren er uændret:
--   SELECT proconfig FROM pg_proc
--    WHERE oid = 'public.initialize_first_use_rider_condition()'::regprocedure;
--     -- forventet: {"search_path=public, pg_temp",enable_seqscan=off}
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgname = 'trg_initialize_first_use_rider_condition';
--     -- forventet: AFTER INSERT OR UPDATE OF team_id ON public.riders FOR EACH ROW ...
--
-- 2. Proben under funktionens indstilling vælger GIN-indekset:
--   BEGIN READ ONLY; SET LOCAL enable_seqscan = off;
--   EXPLAIN (GENERIC_PLAN) SELECT EXISTS(SELECT 1 FROM public.training_day_runs
--     WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',$1::uuid)));
--   ROLLBACK;
--     -- forventet: Bitmap Index Scan on idx_training_day_runs_report_riders
--
-- 3. Effekt i drift (efter de næste akademi-signeringer):
--   SELECT calls, round(mean_exec_time) AS mean_ms, round(max_exec_time) AS max_ms
--     FROM extensions.pg_stat_statements
--    WHERE query ILIKE '%p_squad_cap%' AND query ILIKE '%pgrst%';
--     -- forventet: nye kald i sub-sekund-området (før: snit ~8 s). Nulstil evt.
--     -- ikke statistikken; sammenlign i stedet calls/total før og efter.
-- =============================================================================
