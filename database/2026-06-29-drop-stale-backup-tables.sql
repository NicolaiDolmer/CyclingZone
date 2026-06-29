-- =============================================================================
-- 2026-06-29 — Drop forældede backup-tabeller fra 23-27/6-batchen (#1972)
-- =============================================================================
-- KILDE: Supabase security advisor 29/6 — rls_enabled_no_policy (INFO) +
-- no_primary_key (INFO) paa backup-tabeller i public. RLS uden policy =
-- default-deny (ingen laek), men de er stadig PostgREST-eksponeret API-surface
-- og kilden til stoerstedelen af advisor-INFO-stoejen.
--
-- SCOPE (ejer-godkendt 29/6 — destruktiv prod-op, eksplicit liste-godkendelse):
-- Dropper de 21 backups fra 23-27/6 hvis underliggende operation er bekraeftet
-- live + superseded. BEHOLDER bevidst 28/6-batchen (chronrebuild/seedfix/
-- academy_freeagent/ghost_auctions) som recovery-vindue for den live-kalender
-- race-motoren genstartede paa 29/6 — droppes separat naar race-ugen er stabil.
--
-- SIKKERHED (verificeret mod live 29/6 foer drop):
--   - inbound foreign keys fra ikke-backup-tabeller: 0
--   - afhaengige views/matviews: 0
-- Derfor plain DROP (ingen CASCADE) — fejler hellere end at rive uventet med.
--
-- IDEMPOTENT: DROP TABLE IF EXISTS (re-run = no-op).
-- Refs #1972. Forrige backup-drop: #1733.
-- =============================================================================

DROP TABLE IF EXISTS public.prize_rescale_backup_20260623;

-- d3-reset (27/6)
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_board;
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_fatigue;
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_prizetx;
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_races;
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_results;
DROP TABLE IF EXISTS public.backup_d3_reset_20260627_teams;

-- all-reset (27/6)
DROP TABLE IF EXISTS public.backup_allreset_20260627_board;
DROP TABLE IF EXISTS public.backup_allreset_20260627_entries;
DROP TABLE IF EXISTS public.backup_allreset_20260627_fatigue;
DROP TABLE IF EXISTS public.backup_allreset_20260627_prizetx;
DROP TABLE IF EXISTS public.backup_allreset_20260627_profiles;
DROP TABLE IF EXISTS public.backup_allreset_20260627_races;
DROP TABLE IF EXISTS public.backup_allreset_20260627_results;
DROP TABLE IF EXISTS public.backup_allreset_20260627_schedule;
DROP TABLE IF EXISTS public.backup_allreset_20260627_standings;
DROP TABLE IF EXISTS public.backup_allreset_20260627_teams;

-- cal-rebuild (27/6 — dobbelt-foraeldet, kalenderen blev rebuildet igen 28/6)
DROP TABLE IF EXISTS public.backup_calrebuild_20260627_entries;
DROP TABLE IF EXISTS public.backup_calrebuild_20260627_profiles;
DROP TABLE IF EXISTS public.backup_calrebuild_20260627_races;
DROP TABLE IF EXISTS public.backup_calrebuild_20260627_schedule;
