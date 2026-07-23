-- =============================================================================
-- 2026-07-23 — RLS-skrive-lockdown: users / transfer_offers / auction_bids / swap_offers
-- (#2802, #2803, #2814 — fundet i backlog-audit 23/7, verificeret mod prod)
-- =============================================================================
-- PROBLEM: information_schema.role_table_grants viser at BÅDE `anon` OG
-- `authenticated` har fuld kolonne-INSERT/UPDATE/DELETE på disse fire tabeller —
-- ikke kun authenticated som issue-teksterne oprindeligt antog. Samme mønster
-- findes reelt på ALLE ~140 tabeller i public-schemaet (schema-level default
-- privileges, sandsynligvis fra Supabase' provisioning + efterfølgende
-- schema-restores — se postmortem .claude/learnings/2026-07-23-rls-broad-write-grants.md).
-- Denne migration lukker kun de fire tabeller hvor RLS-policyerne reelt gør
-- grantet exploitable (bekræftet ved at RLS er enabled + der findes en
-- matchende INSERT/UPDATE-policy uden kolonne-/værdi-begrænsning):
--
--   users            — UPDATE-policy "Users can update own profile" har
--                       with_check = (auth.uid() = id) men INGEN kolonne-
--                       begrænsning → authenticated kan sætte SIN EGEN role='admin'
--                       (åbner alle /api/admin/*-ruter). #2802.
--   transfer_offers   — UPDATE-policy "Involved parties can update offers"
--                       tillader begge parter, with_check = NULL → køber kan
--                       sætte seller_confirmed uden sælgers accept. #2803.
--   auction_bids      — INSERT-policy "Teams can insert bids" tjekker kun at
--                       team_id er ens eget, intet om amount/budget → fiktive
--                       bud vises i realtid som ægte (Live-bud-feed, rytter-
--                       tidslinje, achievements). #2814.
--   swap_offers       — INGEN insert/update-policy overhovedet, så write er
--                       allerede RLS-default-deny for authenticated/anon. Rent
--                       grant-hygiejne (belt-and-suspenders) — ingen live exploit
--                       her lige nu, men grantet efterlader et hul hvis nogen
--                       senere tilføjer en policy uden at tænke på det.
--
-- FRONTEND-VERIFIKATION (2026-07-23, grep frontend/src for `.from(...)` mod de
-- fire tabeller): frontend skriver ALDRIG direkte til transfer_offers,
-- auction_bids eller swap_offers (kun `.select()` for visning + realtime-
-- subscriptions; alle mutationer går gennem backend/service_role via
-- /api/transfers/*, /api/auctions/:id/bid, /api/swaps/*). transfer_offers og
-- auction_bids's INSERT/UPDATE-policies har derfor INGEN legitim klient-bruger
-- — hele grantet kan fjernes uden erstatning.
--
-- For `users` fandtes fire reelle, legitime direkte frontend-writes (kolonne-
-- scoped update fra den indloggede bruger selv):
--   language              — frontend/src/lib/language.jsx:139
--   consent_preferences   — frontend/src/lib/consent.jsx:88,103
--   discord_id            — frontend/src/pages/ProfilePage.jsx:112
--   nps_last_prompted_at  — frontend/src/hooks/useNpsPrompt.js:63
-- Disse fire kolonner genoprettes som kolonne-scoped GRANT til authenticated
-- (ikke anon — policyen kræver auth.uid()=id, anon har altid auth.uid()=NULL,
-- så anon har aldrig haft nogen legitim brug af skriveadgangen).
--
-- role/xp/level/login_streak/is_beta_tester/email/username/created_at m.fl. på
-- users skrives KUN af backend (service_role, upåvirket af REVOKE her).
-- `handle_new_user()` (signup-trigger på auth.users) er SECURITY DEFINER og
-- EXECUTE er allerede revoket fra anon/authenticated (2026-05-21-security-
-- hardening-phase-a.sql) — INSERT-revoke her ændrer derfor ikke signup-flowet.
--
-- FORWARD-GUARD: udover kolonne-grant tilføjes en BEFORE UPDATE-trigger på
-- users der afviser enhver ændring af `role` medmindre kaldet kommer fra
-- service_role. Det er et andet lag end grantet — hvis nogen fremtidig
-- migration/schema-restore ved et uheld genopretter UPDATE(role)-grantet til
-- authenticated (samme mekanisme som ramte #2676), stopper triggeren stadig
-- den faktiske mutation. Samme mønster som eksisterende service_role-gates i
-- denne kodebase (fx 2026-07-12-recompute-standings-rpc.sql).
--
-- Idempotent: REVOKE på et allerede-manglende privilegium er en no-op; GRANT
-- er also idempotent (gentaget GRANT overskriver ikke andre kolonners grants).
-- CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER er idempotent. Ingen rækker
-- muteres — kun kataloggrants + én ny trigger-funktion.
--
-- IKKE-DESTRUKTIV: backend bruger service_role (SUPABASE_SERVICE_KEY) til ALT
-- skrive-arbejde på disse fire tabeller (bekræftet: backend/routes/api.js
-- instantierer `supabase`-klienten med process.env.SUPABASE_SERVICE_KEY,
-- linje 542-544) — service_role har BYPASSRLS og er upåvirket af REVOKE på
-- anon/authenticated. Ingen af de fire tabellers backend-skriveveje ændres.
--
-- ROLLBACK (ikke anbefalet — genåbner sårbarhederne):
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.users, public.transfer_offers,
--     public.auction_bids, public.swap_offers TO anon, authenticated;
--   DROP TRIGGER IF EXISTS guard_users_role_change_trigger ON public.users;
--   DROP FUNCTION IF EXISTS public.guard_users_role_change();
-- =============================================================================

BEGIN;

-- ── 1. REVOKE bredt skrive-grant fra anon + authenticated på alle fire ──────
-- TRUNCATE er inkluderet som gratis defense-in-depth (ikke eksponeret via
-- PostgREST's REST-API, men ingen grund til at rollerne har privilegiet).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.users, public.transfer_offers, public.auction_bids, public.swap_offers
  FROM anon, authenticated;

-- ── 2. Genopret KUN de kolonne-scopede UPDATE-grants som frontend faktisk ───
--       bruger direkte (verificeret ved grep, se header). Ingen INSERT/DELETE-
--       grant genoprettes noget sted — de bruges ikke af frontend på nogen af
--       de fire tabeller.
GRANT UPDATE (language, consent_preferences, discord_id, nps_last_prompted_at)
  ON public.users TO authenticated;

-- transfer_offers, auction_bids, swap_offers: INGEN regrant. Frontend skriver
-- aldrig direkte til dem (kun .select() + realtime-subscribe); al mutation går
-- gennem backend/service_role. De eksisterende RLS-policies
-- ("Buyers can insert offers", "Involved parties can update offers",
-- "Teams can insert bids") bliver dermed uden virkning for anon/authenticated
-- (intet grant = ingen adgang uanset policy) og står tilbage som ren
-- dokumentation af den oprindelige (fejlagtige) hensigt. Bevidst ikke droppet
-- i denne migration for at holde diffen minimal — kan ryddes op i en separat
-- non-security PR.

-- ── 3. Forward-guard: role kan kun ændres af service_role ───────────────────
CREATE OR REPLACE FUNCTION public.guard_users_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'role_change_forbidden: users.role kan kun ændres af service_role (backend-admin-rute)'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger-funktion har ingen legitim direkte RPC-kalder (samme forward-guard-
-- mønster som #2676: revoke EXECUTE fra anon/authenticated/PUBLIC).
REVOKE EXECUTE ON FUNCTION public.guard_users_role_change() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS guard_users_role_change_trigger ON public.users;
CREATE TRIGGER guard_users_role_change_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_role_change();

COMMIT;

-- PostgREST henter schema-cache på ny så grant-ændringerne slår igennem med det samme.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
-- 1) Ingen bred INSERT/UPDATE/DELETE/TRUNCATE tilbage til anon/authenticated:
--
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema='public'
--     AND table_name IN ('users','transfer_offers','auction_bids','swap_offers')
--     AND grantee IN ('anon','authenticated')
--     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
--   ORDER BY table_name, grantee, privilege_type;
--
--   Forventet: KUN users/authenticated/UPDATE (resten tomt).
--
-- 2) users: kun de fire kolonner har UPDATE-grant for authenticated:
--
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='users'
--     AND grantee='authenticated' AND privilege_type='UPDATE'
--   ORDER BY column_name;
--
--   Forventet: consent_preferences, discord_id, language, nps_last_prompted_at
--   (INGEN role, xp, level, login_streak, email, username, is_beta_tester, ...).
--
-- 3) Trigger findes og blokerer selv-forfremmelse:
--
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid='public.users'::regclass AND tgname='guard_users_role_change_trigger';
--
-- 4) Funktionel regressionstest (kør som den indloggede bruger selv, IKKE
--    service_role) — skal fejle med role_change_forbidden:
--
--   UPDATE public.users SET role='admin' WHERE id = auth.uid();
--   -- forventet: ERROR: role_change_forbidden: ...
--
-- 5) Backend-smoke: bekræft at følgende STADIG virker (service_role, upåvirket):
--    - PATCH /api/admin/users/:userId/role (admin skifter andens rolle)
--    - POST /api/transfers/... (bud/tilbud-flows)
--    - POST /api/auctions/:id/bid
--    - Profil-siden: sprogskift, cookie-consent, Discord-ID, NPS-prompt
-- =============================================================================
