-- #5259 (ejer 15/9, del af rolle-direktivet #4268) — spillerens ansoegning om
-- beta-adgang. EEN raekke pr. bruger, ejeren godkender hver enkelt.
-- ============================================================================
-- ADDITIV + IDEMPOTENT. Migrationen fjerner INTET og aendrer INGEN eksisterende
-- adfaerd: en ny tabel, tre RLS-politikker og et grant-saet.
--
-- ── HVORFOR EN TABEL OG IKKE EN KOLONNE PAA users ───────────────────────────
-- `users.is_beta_tester` (database/2026-06-13-beta-access.sql) er RESULTATET —
-- "denne bruger ser stadier i `beta`". Ansoegningen er en SELVSTAENDIG
-- begivenhed med sin egen levetid (ansoegt → godkendt/afvist → evt. traadt ud
-- igen), og ejeren skal kunne se hvem der har spurgt UDEN at have sagt ja endnu.
-- En bool kan ikke baere "har spurgt, ikke besvaret".
--
-- ── HVORFOR EEN RAEKKE PR. BRUGER (UNIQUE paa user_id) ──────────────────────
-- Statussen er brugerens NUVAERENDE forhold til beta-programmet, ikke en
-- historik-log. En ny ansoegning efter et afslag skal genbruge raekken (UPSERT),
-- ellers kan en spiller spamme admin-listen med pending-raekker. Revisionssporet
-- ligger i admin_log (action_type 'beta_tester_changed'), som er det sted
-- projektet i forvejen laeser admin-beslutninger fra.

-- ── 1) Tabellen ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beta_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  -- 'pending'  = spilleren har ansoegt, ejeren har ikke svaret endnu
  -- 'approved' = ejeren sagde ja (users.is_beta_tester blev sat samtidig)
  -- 'rejected' = ejeren sagde nej
  -- 'withdrawn'= spilleren trak ansoegningen tilbage ELLER traadte ud af beta selv
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Saettes ved hver statusaendring, ogsaa spillerens egen tilbagetraekning.
  decided_at  TIMESTAMPTZ,
  -- NULL naar spilleren selv trak sig; ellers den admin der traf beslutningen.
  decided_by  UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- Admin-fladen henter "hvem venter paa svar" — den ene laesesti der har volumen.
CREATE INDEX IF NOT EXISTS idx_beta_requests_status_created
  ON public.beta_requests (status, created_at DESC);

COMMENT ON TABLE public.beta_requests IS
  '#5259: spillerens ansoegning om beta-adgang. EEN raekke pr. bruger (UPSERT ved ny '
  'ansoegning). Resultatet lever i users.is_beta_tester; denne tabel baerer VEJEN dertil, '
  'saa ejeren kan se hvem der har spurgt uden at have svaret endnu.';

COMMENT ON COLUMN public.beta_requests.status IS
  '#5259: pending | approved | rejected | withdrawn. withdrawn daekker BAADE at spilleren '
  'trak en ubesvaret ansoegning tilbage og at en beta-tester selv traadte ud igen.';

-- ── 2) RLS ───────────────────────────────────────────────────────────────────
-- Spilleren: kun sin egen raekke, og kun laes + opret. UPDATE/DELETE er
-- bevidst UDE af grant-saettet: en tilbagetraekning gaar gennem backendens
-- service-role-klient, saa en spiller aldrig kan skrive 'approved' i sin egen
-- raekke. Admin laeser alt via service-role (backend), ikke via en RLS-politik —
-- samme moenster som resten af admin-fladen (/api/admin/*).
ALTER TABLE public.beta_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "beta_requests_select_own" ON public.beta_requests;
CREATE POLICY "beta_requests_select_own" ON public.beta_requests
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "beta_requests_select_admin" ON public.beta_requests;
CREATE POLICY "beta_requests_select_admin" ON public.beta_requests
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- SELECT er auto-grantet til authenticated for enhver ny tabel (se
-- database/2026-08-14-2830-revoke-truncate-og-default-privileges.sql: "SELECT
-- revokes ikke"), men vi skriver det eksplicit saa politikkerne ovenfor ikke kan
-- rende ind i 42501 hvis default-privilegierne strammes senere (#4943).
GRANT SELECT ON public.beta_requests TO authenticated;

-- INGEN INSERT/UPDATE/DELETE-grants til authenticated: alle skrivninger gaar
-- gennem backendens service-role (POST /api/me/beta-access/request m.fl.), som
-- er det ene sted hvor "spilleren maa kun saette pending paa SIG SELV" kan
-- haandhaeves sammen med rate-limiteren.

-- ── 3) is_beta_tester kan stadig KUN skrives af service_role/admin ───────────
-- Ingen aendring noedvendig, og det er med vilje verificerbart her: kolonnen er
-- IKKE i UPDATE-grant-saettet for authenticated (database/2026-07-23-rls-write-
-- lockdown-users-transfers-bids-swaps.sql giver kun consent_preferences,
-- discord_id, language, nps_last_prompted_at). Opt-in-fladen skriver derfor
-- aldrig direkte i users — den laegger en raekke her og venter paa ejeren.
--
-- Post-verify (koer efter apply):
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='users'
--     AND grantee='authenticated' AND privilege_type='UPDATE'
--   ORDER BY column_name;
--   Forventet: consent_preferences, discord_id, language, nps_last_prompted_at
--   (is_beta_tester maa IKKE staa der).
--
--   SELECT polname, cmd FROM pg_policies WHERE tablename = 'beta_requests';
--   Forventet: beta_requests_select_own + beta_requests_select_admin, begge SELECT.
--
-- Rollback: DROP TABLE IF EXISTS public.beta_requests;
