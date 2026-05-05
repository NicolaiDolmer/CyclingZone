-- S-02e · Konsekvens-tier (6 lag)
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md (Appendix C + Q-batch 1B Q11/Q14 + Q-batch 1C Q21)
--
-- Tilføjer:
--   1. board_consequences — én row pr. aktiv konsekvens. Lag 1-6 har forskellige
--      severity-skalaer og expiration-regler. Ét aktivt event pr. (team_id, layer)
--      ad gangen. Inserted ved sæson-end via boardConsequences.evaluateAndApplyConsequences,
--      expired ved sæson-start (sponsor-pullout) eller efter manager-action (bonus-offer).
--
-- Lag-oversigt:
--   1  passive_modifier   (live, satisfactionToModifier — IKKE persisteret her, dækket af board_profiles.budget_modifier)
--   2  salary_cap         (sat<40, hard-block i transfer/auction; cap = total_salary at create-time)
--   3  signing_restriction(sat<30, hard-block ved køb >threshold-pris)
--   4  forced_listing     (sat<15, sæson-end auto-list rytter med laveste market_value)
--   5  sponsor_pullout    (sat<10 ELLER 2× plan-udløb <30%, -10% sponsor_modifier_factor i ÉN sæson)
--   6  bonus_offer        (sat>75 + ≥75% mål 'ahead', +200K mod 1 ekstra-mål, manager kan accept/decline)
--
-- Ingen ændring til notifications_type_check — board_critical eksisterer allerede (S-02b 2026-05-05).
-- Ingen ændring til board_profiles — budget_modifier dækker stadig lag 1; sponsor-pullout multiplicerer i runtime.

BEGIN;

CREATE TABLE IF NOT EXISTS board_consequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  layer INTEGER NOT NULL CHECK (layer BETWEEN 2 AND 6),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'declined', 'expired', 'fulfilled')),
  -- severity: numerisk størrelse for laget
  --   layer 2 (salary_cap):  total-salary-cap i CZ$ (frosset ved create)
  --   layer 3 (signing_restriction): pris-tærskel for godkendelse i CZ$
  --   layer 4 (forced_listing): asking_price på den listede rytter
  --   layer 5 (sponsor_pullout): pullout-faktor som heltal i basis-points (900 = 0.90 = -10%)
  --   layer 6 (bonus_offer):    bonus-budget i CZ$
  severity INTEGER NOT NULL,
  -- payload: lag-specifikke detaljer (rytter-id ved forced_listing, ekstra-mål ved bonus-offer, etc.)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_board_id UUID REFERENCES board_profiles(id) ON DELETE SET NULL,
  expires_at_season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Kun ÉN aktiv consequence pr. (team, layer). Statushistorik bevares som separate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_consequences_active_per_team_layer
  ON board_consequences(team_id, layer)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_board_consequences_team_active
  ON board_consequences(team_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_board_consequences_expires_season
  ON board_consequences(expires_at_season_id) WHERE status = 'active';

COMMENT ON TABLE board_consequences IS
  'S-02e: Aktive konsekvens-events fra bestyrelsen (lag 2-6). Lag 1 = passive sponsor-modifier (board_profiles.budget_modifier). Status-flow: active → accepted/declined (lag 6) ELLER active → expired (lag 5 ved sæson-start) ELLER active → fulfilled (lag 4 når listing sælges). Ingen automatisk fyring (Q-batch 1A #4).';

COMMENT ON COLUMN board_consequences.severity IS
  'Lag-specifik numerisk størrelse: layer 2=total-salary-cap CZ$, layer 3=pris-tærskel CZ$, layer 4=asking_price CZ$, layer 5=pullout-faktor i basis-points (900=0.90), layer 6=bonus-budget CZ$.';

COMMENT ON COLUMN board_consequences.payload IS
  'Lag-specifikke detaljer: layer 4 {rider_id, listing_id, rider_name}, layer 6 {extra_goal_type, extra_goal_target, extra_goal_label}.';

COMMIT;
