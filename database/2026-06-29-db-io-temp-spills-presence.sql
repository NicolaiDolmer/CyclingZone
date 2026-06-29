-- Disk-IO reduktion: temp-file-spills + last_seen write-amplification.
--
-- Baggrund (diagnose 2026-06-29):
-- Supabase advarede "Disk IO Budget about to deplete". DB'en er kun 91 MB og
-- har 100% cache-hit (blks_read ~5k siden 30/3) — så det er IKKE reads. Budgettet
-- tømmes af WRITES til disk:
--   1. Temp-file-spills: 930 GB skrevet til disk (164k temp-filer) siden 30/3.
--      Værste enkelt-synder: viewet ai_active_season_status — ~1.5 GB temp PR. KALD.
--      Årsag: fire uafhængige 1:mange LEFT JOINs (races, race_results,
--      season_standings, finance_transactions) ganges til et kartesisk
--      mellemresultat (~100 mio. rækker for én sæson) før count(DISTINCT) reducerer.
--   2. users.last_seen: 281k UPDATEs (presence-heartbeat skrev ved HVERT kald).
--
-- Denne migration:
--   A. Omskriver ai_active_season_status med præ-aggregerede scalar-subqueries.
--      Samme kolonner + samme tal — kun beregningsmåden ændres. Eliminerer
--      kartesisk eksplosion → temp-spill fra ~1.5 GB/kald til ~0.
--   B. Tilføjer touch_user_presence(uuid): atomisk betinget last_seen-UPDATE der
--      kun skriver hvis stemplet er >60s gammelt. Backend (/api/presence) kalder
--      den i stedet for et ubetinget UPDATE. Online-prik + online-count + "sidst
--      set" bruger alle 5-min-granularitet, så 60s-throttle er funktionelt usynlig.
--
-- Verifikation (2026-06-29, ad-hoc mod prod FØR merge):
--   - Ny view-SELECT giver identiske tal som det gamle view (sammenlignet pr. række).
--   - EXPLAIN (ANALYZE, BUFFERS): gammel = temp written ~X MB, ny = 0 temp.
--   - WHERE-prædikatet i touch_user_presence er gyldig SQL mod users.
--
-- Rollback:
--   A. DROP VIEW + gen-CREATE original-definitionen (fire LEFT JOINs) fra
--      database/2026-05-21-security-hardening-phase-a.sql:108-126.
--   B. DROP FUNCTION public.touch_user_presence(uuid);
--      + gendan ubetinget UPDATE i backend/routes/api.js /presence.

-------------------------------------------------------------------------------
-- A. Omskriv ai_active_season_status (fjern kartesisk fan-out)
-------------------------------------------------------------------------------
-- Samme DROP+CREATE+grant-mønster som 2026-05-21-security-hardening-phase-a.sql,
-- så security_invoker + rolle-grants (codex_readonly inkl.) bevares konsistent.
DROP VIEW IF EXISTS public.ai_active_season_status CASCADE;
CREATE VIEW public.ai_active_season_status
WITH (security_invoker = true) AS
SELECT s.id AS season_id,
       s.number AS season_number,
       s.status,
       s.race_days_total,
       s.race_days_completed,
       (SELECT count(*) FROM public.races r
          WHERE r.season_id = s.id) AS race_count,
       (SELECT count(*) FROM public.race_results rr
          JOIN public.races r ON r.id = rr.race_id
          WHERE r.season_id = s.id) AS race_result_count,
       (SELECT count(*) FROM public.season_standings ss
          WHERE ss.season_id = s.id) AS standings_count,
       (SELECT count(*) FROM public.finance_transactions ft
          WHERE ft.season_id = s.id AND ft.type = 'prize') AS prize_transaction_count
FROM public.seasons s
WHERE s.status = 'active';

REVOKE ALL ON public.ai_active_season_status FROM anon;
GRANT SELECT ON public.ai_active_season_status TO authenticated, service_role, codex_readonly;

-------------------------------------------------------------------------------
-- B. Atomisk, throttlet presence-touch (erstatter ubetinget last_seen-UPDATE)
-------------------------------------------------------------------------------
-- SECURITY INVOKER: kaldes kun af backend (service_role), som bypasser RLS.
-- Bevidst IKKE eksponeret til anon/authenticated (matcher revoke-mønsteret for
-- backend-only functions i security-hardening-migrationen). Stabil search_path
-- for at undgå advisor 0011_function_search_path_mutable.
CREATE OR REPLACE FUNCTION public.touch_user_presence(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.users
  SET last_seen = now()
  WHERE id = p_user_id
    AND (last_seen IS NULL OR last_seen < now() - interval '60 seconds');
$$;

REVOKE ALL ON FUNCTION public.touch_user_presence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_user_presence(uuid) TO service_role;
