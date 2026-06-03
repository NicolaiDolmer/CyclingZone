-- Rider profile visit logging (#963) — datafundament for popularitet (#957).
-- Vi begynder at opsamle visninger NU, så popularitets-trendgrafen har historik
-- den dag #957 bygges. INGEN UI i denne issue — kun persistens.
--
-- Design:
--   * Kun RYTTERE logges (ikke managers/teams) — beslutning fra brainstorm 2026-06-02.
--   * Dedup pr. (bruger, rytter, dag): én tællelig række pr. bruger pr. rytter pr.
--     kalenderdag (UTC). Det dræber re-mount/refresh-spam og giver den rette
--     opløsning for en "unikke daglige seere"-trend. view_date er en GENERATED
--     STORED kolonne, så vi kan bruge en navngiven UNIQUE-constraint i ON CONFLICT.
--   * Skrives backend-side via service_role i POST /api/riders/:id/view
--     (presence-pulse rate-limiter, 120/min/bruger) med upsert/ignoreDuplicates.
--   * RLS: authenticated kan KUN indsætte egne rows (defense-in-depth oven på
--     backend-valideringen, hvis vi senere skifter til direkte frontend-insert).
--     Læsning sker aggregeret via service_role (samme mønster som player_events) —
--     derfor ingen SELECT-policy for authenticated.
--
-- AT TIME ZONE 'UTC' på en timestamptz er IMMUTABLE, så udtrykket er lovligt i en
-- GENERATED STORED kolonne.

CREATE TABLE IF NOT EXISTS rider_profile_views (
  id BIGSERIAL PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_date DATE NOT NULL GENERATED ALWAYS AS ((viewed_at AT TIME ZONE 'UTC')::date) STORED,
  CONSTRAINT rider_profile_views_daily_uniq UNIQUE (user_id, rider_id, view_date)
);

-- Per-rytter aggregering ("hvor mange visninger sidste 24t / 7d for rytter X").
CREATE INDEX IF NOT EXISTS rider_profile_views_rider_id_viewed_at_idx
  ON rider_profile_views (rider_id, viewed_at DESC);

-- Globale tidsvinduer ("top-viste ryttere sidste 24t / 7d").
CREATE INDEX IF NOT EXISTS rider_profile_views_viewed_at_idx
  ON rider_profile_views (viewed_at DESC);

ALTER TABLE rider_profile_views ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE så auto-/re-apply er idempotent (feedback_create_policy_idempotent).
DROP POLICY IF EXISTS "Authenticated can insert own rider views" ON rider_profile_views;
CREATE POLICY "Authenticated can insert own rider views"
  ON rider_profile_views FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE rider_profile_views IS
  'Besøgs-log pr. rytter-profil (#963). Én row pr. bruger/rytter/kalenderdag (UTC) via rider_profile_views_daily_uniq. Datafundament for popularitet (#957). Aggregeres via service_role; managers har ingen SELECT-policy.';

COMMENT ON COLUMN rider_profile_views.view_date IS
  'Genereret UTC-dag af viewed_at. Indgår i daily-dedup UNIQUE-constraint.';
