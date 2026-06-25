-- #940 In-app NPS (Net Promoter Score) — struktureret bruger-feedback fra launch.
--
-- Datamodel:
--   - nps_responses: én række pr. afgivet svar (0-10 + valgfri fritekst).
--     RLS: en manager kan kun INSERT/SELECT sine EGNE svar (auth.uid() = user_id).
--     Aggregat (NPS-score på tværs af brugere) sker via service_role / admin —
--     ingen cross-user read for almindelige brugere (samme privacy-mønster som
--     signup_attribution, blot med eget-svar-read tilladt).
--   - users.nps_last_prompted_at: trigger-throttle-state (vis MAX 1 prompt / 90
--     dage pr. bruger). Skrives af klienten når prompten vises; læses for at gate.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + DROP POLICY
-- IF EXISTS før CREATE. schema_migrations-insert håndteres af
-- .github/workflows/auto-migrate.yml.

-- ── 1. nps_responses-tabellen ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nps_responses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nps_responses_user    ON public.nps_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_nps_responses_created ON public.nps_responses(created_at);

ALTER TABLE public.nps_responses ENABLE ROW LEVEL SECURITY;

-- Manager må læse sine egne svar (så UI kan vise "tak / allerede besvaret").
DROP POLICY IF EXISTS "nps_responses_select_own" ON public.nps_responses;
CREATE POLICY "nps_responses_select_own" ON public.nps_responses
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Manager må indsætte sine egne svar (kun for sig selv — WITH CHECK på user_id).
DROP POLICY IF EXISTS "nps_responses_insert_own" ON public.nps_responses;
CREATE POLICY "nps_responses_insert_own" ON public.nps_responses
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Player-facing tabel → eksplicitte privilegier (samme disciplin som riders/
-- rider_derived_abilities, #1162/#1309): RLS gater rækker, men GRANT gater
-- tabel-adgang. Ingen anon — NPS kræver en authenticated manager.
GRANT SELECT, INSERT ON public.nps_responses TO authenticated;

COMMENT ON TABLE public.nps_responses IS
  '#940 NPS-svar: score 0-10 + valgfri fritekst. RLS: eget-svar read+insert; aggregat via service_role/admin. Trigger = efter første løb-resultat, max 1 prompt/90 dage (users.nps_last_prompted_at).';

-- ── 2. Throttle-state på users ──────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nps_last_prompted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.users.nps_last_prompted_at IS
  '#940 NPS-throttle: tidspunkt prompten sidst blev VIST for brugeren. NULL = aldrig vist. Klienten gater på (NOW - denne) >= 90 dage.';

-- users har både tabel- OG kolonne-privilegier (union-model). De eksisterende
-- kolonne-grants (consent_preferences/language/last_seen) viser at en NY kolonne
-- ikke automatisk arver kolonne-grants → tilføj eksplicit SELECT+UPDATE så
-- klienten kan læse throttle-staten og skrive den ved visning. UPDATE-rækker
-- gates fortsat af "Users can update own profile"-policy (auth.uid() = id).
GRANT SELECT (nps_last_prompted_at) ON public.users TO authenticated;
GRANT UPDATE (nps_last_prompted_at) ON public.users TO authenticated;
