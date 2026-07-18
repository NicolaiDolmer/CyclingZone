-- #2602 · in-game contact/feedback/bug-report knap.
--
-- Problem: spillere uden Discord har ingen vej til at sende feedback eller
-- rapportere en bug direkte fra spillet — hele feedback-loopet gik hidtil
-- gennem Discord, som en del af spillerbasen ikke bruger.
--
-- Løsning (#2602): ny tabel player_feedback + backend-endpoint (service-role
-- insert, aldrig direkte klient-skrivning) + frontend-modal (Contact-indgang
-- samme sted som Help i sidebar/bottom-nav).
--
-- Design:
--   * user_id/team_id udledes SERVER-SIDE fra req.user/req.team (auth) —
--     klienten sender aldrig egne id'er. team_id er nullable (en spiller kan
--     i teorien mangle et hold endnu, fx midt i onboarding).
--   * category begrænset til 'feedback'|'bug'|'idea' (matcher frontend-valget).
--   * message: NOT NULL + ikke-tom (trim) + maks 4000 tegn — håndhæves OGSÅ i
--     backend (validering før insert), denne CHECK er et andet lag.
--   * page_path/viewport/user_agent: diagnostik til bug-rapporter, valgfri.
--   * status: 'new' som default — forbereder fremtidig triage-UI (out of
--     scope for #2602 selv).
--
-- RLS: ENABLE, INGEN policies (hverken anon eller authenticated). Al skrivning
-- sker via backend service-role (POST /api/feedback), som bypasser RLS. Der er
-- bevidst ingen spiller-læse-adgang til egne indsendelser i denne omgang —
-- kun fremtidigt admin-værktøj (service-role) kan læse tabellen.
--
-- ⚠️ Denne fil COMMITTES kun — den anvendes ALDRIG af implementerings-
--    agenten mod prod. EJEREN merger PR'en (database/*.sql) og applier
--    migrationen som et SEPARAT manuelt post-merge-skridt (apply sker IKKE
--    automatisk ved merge).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS-mønster
-- følges ikke (ingen policies) — re-run er et no-op via IF NOT EXISTS.
--
-- Rollback: DROP TABLE IF EXISTS player_feedback;

CREATE TABLE IF NOT EXISTS player_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('feedback', 'bug', 'idea')),
  message TEXT NOT NULL CHECK (length(btrim(message)) > 0 AND length(message) <= 4000),
  page_path TEXT,
  viewport TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS player_feedback_user_id_idx ON player_feedback (user_id);
CREATE INDEX IF NOT EXISTS player_feedback_created_at_idx ON player_feedback (created_at DESC);

ALTER TABLE player_feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE player_feedback IS
  '#2602: in-game feedback/bug/idea-indsendelser fra spillere uden Discord. Skrives KUN via backend service-role (POST /api/feedback) — ingen RLS-policies (hverken anon eller authenticated), da hverken klient-læsning eller -skrivning er understøttet endnu.';
