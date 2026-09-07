-- =============================================================================
-- 2026-09-08 — Discord-brugernavn (offentligt visningsfelt) paa managerprofilen
-- (#5012, ejer-direktiv 3/9 #4751)
-- =============================================================================
-- SCOPE: nyt valgfrit felt users.discord_handle -- Discord-brugernavn (IKKE
-- det numeriske discord_id der allerede findes til bot-DM-levering, #2161).
-- Vises paa den offentlige managerprofil (/managers/:teamId) naar udfyldt.
--
-- FORMAT: Discords nuvaerende brugernavn-regler (post-2023, ingen
-- discriminator#tag laengere): 2-32 tegn, kun smaa bogstaver, tal, punktum og
-- underscore. Haandhaeves baade i frontend (frontend/src/lib/discordHandle.js,
-- delt af ProfilePage-formularen) og som DB-CHECK-constraint her (forsvar i
-- dybden -- samme moenster som andre felt-constraints i repoet).
--
-- WRITE: RLS-policyen "Users can update own profile" (auth.uid() = id)
-- findes allerede paa public.users og daekker enhver kolonne -- kun den
-- kolonne-scopede GRANT mangler. Samme moenster som discord_id, language,
-- consent_preferences, nps_last_prompted_at fra
-- 2026-07-23-rls-write-lockdown-users-transfers-bids-swaps.sql (som INDSKRAENKEDE
-- users' write-grant til netop disse kolonner -- vi udvider den liste her,
-- ikke aabner den igen).
--
-- READ (bevidst IKKE en ny RLS SELECT-policy): 2026-05-22-rls-permissive-
-- policy-lockdown.sql fjernede EKSPLICIT "Public read basic user info" (alle
-- authenticated kunne laese ALLE kolonner paa ALLE brugere -- inkl. email,
-- discord_id, xp) og erstattede den med "Users read own profile or admin
-- reads all". RLS er per-raekke, ikke per-kolonne: en ny bred SELECT-policy
-- for at goere netop discord_handle offentligt ville genaabne samme hul for
-- ALLE andre kolonner (issue-teksten "alle authenticated laeser" er derfor
-- IKKE implementeret som en RLS-policy). I stedet eksponeres discord_handle
-- (+ det eksisterende discord_id, til link-vs-kopi-valget) samme vej som
-- username/last_seen allerede naas paa managerprofilen: GET /api/managers/:teamId
-- (backend/routes/api.js), som koerer med service_role og derfor er upaavirket
-- af RLS. Det opfylder "alle laeser det offentlige felt" uden at aabne
-- klient-til-klient-laesning af hele users-tabellen igen. Se PR-beskrivelse for
-- samme begrundelse til ejeren.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; CHECK-constraint tilfoejes kun hvis
-- den ikke allerede findes (DO-blok mod pg_constraint); GRANT er additiv og
-- kan koeres igen uden effekt.
--
-- IKKE-DESTRUKTIV: ny nullable kolonne, ingen eksisterende data aendres.
--
-- ROLLBACK (ikke forventet noedvendig):
--   REVOKE UPDATE (discord_handle) ON public.users FROM authenticated;
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_discord_handle_format_check;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS discord_handle;
-- =============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS discord_handle text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_discord_handle_format_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_discord_handle_format_check
      CHECK (discord_handle IS NULL OR discord_handle ~ '^[a-z0-9._]{2,32}$');
  END IF;
END $$;

-- Udvider den eksisterende kolonne-scopede UPDATE-grant fra 2026-07-23 (som
-- kun listede discord_id, language, consent_preferences, nps_last_prompted_at)
-- med den nye offentlige handle-kolonne. GRANT UPDATE (col) er additivt --
-- fjerner IKKE de fire eksisterende kolonners grant.
GRANT UPDATE (discord_handle) ON public.users TO authenticated;

COMMIT;

-- PostgREST henter schema-cache paa ny saa den nye kolonne + grant slaar
-- igennem med det samme for frontend-klienten.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Post-verifikation (koer efter merge, read-only)
-- =============================================================================
-- 1) Kolonne + constraint findes:
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users' AND column_name='discord_handle';
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.users'::regclass
--     AND conname = 'users_discord_handle_format_check';
--
-- 2) Kolonne-grant: discord_handle er nu blandt de UPDATE-bare kolonner for
--    authenticated (sammen med de fire eksisterende -- ingen af dem forsvinder):
--
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='users'
--     AND grantee='authenticated' AND privilege_type='UPDATE'
--   ORDER BY column_name;
--
--   Forventet: consent_preferences, discord_handle, discord_id, language,
--   nps_last_prompted_at (ingen andre nye kolonner).
--
-- 3) Ingen ny SELECT-grant/-policy er tilfoejet af denne migration (bevidst --
--    laesning sker via service_role-backend, se header):
--
--   SELECT polname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='users' ORDER BY polname;
--
--   Forventet: uaendret i forhold til foer denne migration (stadig kun
--   "Users can update own profile" + "Users read own profile or admin reads all").
-- =============================================================================
