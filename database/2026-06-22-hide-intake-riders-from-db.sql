-- #1743 — Skjul akademi-intake-/scouting-kandidater fra den almindelige
-- rytterdatabase indtil de er hentet til et akademi.
--
-- Kontekst: RidersPage + alle rytter-lister henter klient-side direkte via
-- supabase-js (PostgREST), så synlighed styres af RLS — IKKE af backend-endpoints.
-- En intake-kandidat er en rytter med en academy_intake-række i status 'offered'
-- (team_id = NULL, is_academy = false). Indtil holdet HENTER kandidaten (signerer)
-- må han ikke være søgbar/klikbar i den generelle rytter-DB med fulde stats.
-- Akademi-fladen (/api/academy/me) kører service_role og bypasser RLS, så holdet
-- ser stadig sine egne kandidater dér (kun display-safe felter: potentiale-estimat,
-- pris, alder, navn, nationalitet, seriøs-flag).
--
-- Effekt:
--   • Ikke-admin / anonym: ser IKKE ryttere med en 'offered' intake-række.
--     Når kandidaten signeres (status -> 'signed') eller afvises (status ->
--     'rejected' + ungdomsauktion), forsvinder 'offered'-rækken og rytteren bliver
--     synlig som almindelig akademi-/free-agent-rytter på sædvanlig vis.
--   • Admin: is_admin() = true -> ser ALLE ryttere (uændret).
--   • Backend (service_role): bypasser RLS uændret -> akademi-fladen upåvirket.
--
-- Beslutning: SECURITY DEFINER helper (is_offered_intake_rider) frem for en rå
-- subquery i policyen. En subquery mod academy_intake i en RLS-policy ville køre
-- under den kaldende rolles RLS (academy_intake_owner_read begrænser til eget
-- hold), så en kandidat tilbudt ET ANDET hold ville IKKE blive skjult for resten.
-- En SECURITY DEFINER-funktion (samme mønster som is_admin()) ser hele
-- academy_intake og skjuler kandidaten konsekvent for alle ikke-admins.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + ALTER POLICY + CREATE INDEX IF NOT EXISTS.
-- ALTER (ikke DROP+CREATE) på policyen -> atomisk, intet deny-all-vindue.

-- Indeks til policy-opslaget (rider_id, status). idx_academy_intake_team_status
-- dækker (team_id, status) men ikke et rider_id-opslag.
CREATE INDEX IF NOT EXISTS idx_academy_intake_rider_status
  ON public.academy_intake (rider_id, status);

-- SECURITY DEFINER så policyen kan slå op på tværs af HELE academy_intake uden
-- at ramme academy_intake_owner_read (eget-hold-begrænsningen). STABLE: samme
-- svar inden for en query. search_path låst (sikkerheds-hardening, jf. fase B).
--
-- Vigtigt: vi skjuler KUN kandidater der endnu ikke er anskaffet — dvs. fri
-- (team_id IS NULL) og ikke-akademi. En 'offered'-række kan blive STALE hvis
-- rytteren er anskaffet ad en anden vej (fx vundet på ungdomsauktion → team_id
-- sat). Sådan en ejet rytter SKAL stadig være synlig i rytter-DB'en; det er kun
-- de reelt skjulte (endnu ikke-hentede) prospekter der må forsvinde. (Prod-audit
-- 2026-06-22: 73 'offered'-rækker, hvoraf 5 allerede var ejede — disse forbliver
-- synlige med denne strammere betingelse.)
CREATE OR REPLACE FUNCTION public.is_offered_intake_rider(p_rider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.academy_intake ai
    JOIN public.riders r ON r.id = ai.rider_id
    WHERE ai.rider_id = p_rider_id
      AND ai.status = 'offered'
      AND r.team_id IS NULL
      AND r.is_academy = false
  );
$$;

REVOKE ALL ON FUNCTION public.is_offered_intake_rider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_offered_intake_rider(uuid) IS
  'Returns true if the rider currently has an offered academy_intake row (#1743). '
  'SECURITY DEFINER so the riders read-policy can hide intake candidates from ALL '
  'non-admins, not just the team that was offered the candidate.';

-- Skjul 'offered' intake-kandidater fra ikke-admins. Bevar admin-fuldsyn.
-- (Den nuværende policy er USING (true) efter relaunch-cutover 2026-06-17.)
ALTER POLICY "Public read riders" ON public.riders
  USING (
    public.is_admin()
    OR NOT public.is_offered_intake_rider(id)
  );

-- PostgREST schema-cache reload (policy-/funktions-ændring).
NOTIFY pgrst, 'reload schema';
