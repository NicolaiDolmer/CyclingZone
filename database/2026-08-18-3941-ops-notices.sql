-- #3941 — Race Control: driftsbanner + kendte problemer i appen (loesning A).
--
-- Baggrund: in-app feedback 9/8 under incident-dagen viste at spillere ikke har
-- nogen synlig kilde til driftsstatus naar noget er i gang med at blive rettet
-- ("Nu naermer vi os 8 timer siden at problemerne startede... Og jeg ved
-- stadig intet."). Loesning A (ejer-go 18/8) er et lille live-ops-lag: en tabel
-- Claude/ejeren kan skrive til uden deploy, laest af et banner + en
-- "Kendte problemer"-liste paa Hjaelp-siden.
--
-- Design:
--   * ops_notices: kurateret driftstekst (EN+DA i samme raekke, redaktionelt
--     indhold ligesom roadmap_items — ikke brugertekst). severity styrer
--     status-farven i UI (info/warning/incident). active + starts_at/ends_at
--     styrer synlighedsvinduet uden at raekken skal slettes.
--   * Skrivning: KUN service role (backend/Claude via service-role-noeglen).
--     Ingen insert/update/delete-policies for authenticated — RLS enabled
--     UDEN skrive-policies blokerer anon/authenticated helt (samme mynster
--     som database/2026-08-18-3582-rider-ownership-audit.sql).
--   * Laesning: alle authenticated kan laese alle raekker (banneret/Hjaelp-
--     siden filtrerer selv paa active/starts_at/ends_at klient-side — ingen
--     RLS-baaret hemmelighed her, kun redaktionel driftstekst).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS foer CREATE POLICY, ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY er selv idempotent. Ikke-destruktiv (ingen DROP/DELETE af data).
-- APPLY IKKE her — orkestrator applier post-merge under #2642-rammerne.
--
-- Rollback: DROP TABLE IF EXISTS ops_notices;
--
-- Refs #3941, #2642.

CREATE TABLE IF NOT EXISTS ops_notices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'incident')),
  title_en    TEXT NOT NULL,
  title_da    TEXT NOT NULL,
  body_en     TEXT NOT NULL,
  body_da     TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Baereren for begge frontend-forespoergsler (banner: active-vindue lige nu;
-- Hjaelp-siden: active OR seneste 14 dage) — starts_at DESC daekker sorteringen
-- i begge, det partielle index paa active=true daekker banner-hot-path'en.
CREATE INDEX IF NOT EXISTS ops_notices_active_window_idx
  ON ops_notices (starts_at DESC)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS ops_notices_created_at_idx
  ON ops_notices (created_at DESC);

ALTER TABLE ops_notices ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE saa auto-/re-apply er idempotent (feedback_create_policy_idempotent).
DROP POLICY IF EXISTS "Authenticated can read ops notices" ON ops_notices;
CREATE POLICY "Authenticated can read ops notices"
  ON ops_notices FOR SELECT
  TO authenticated
  USING (true);

-- Post-verify (koer efter apply, alle read-only):
--   1. select count(*) from pg_tables where tablename = 'ops_notices';        -- 1
--   2. select polname from pg_policies where tablename = 'ops_notices';       -- 1 raekke: "Authenticated can read ops notices"
--   3. select rowsecurity from pg_tables where tablename = 'ops_notices';     -- true
--   4. select count(*) from ops_notices;                                     -- 0 (tom indtil foerste driftsnotice skrives)
--   5. select indexname from pg_indexes where tablename = 'ops_notices';      -- ops_notices_active_window_idx, ops_notices_created_at_idx (+ pkey)
