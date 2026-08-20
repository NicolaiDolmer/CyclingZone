-- #2847 — Season-end hardening: DB-niveau-garanti mod concurrent dobbelt-POST
-- på POST /admin/seasons/:id/end.
--
-- Fund (S2-review, #2832-body): endpointets status-guard er check-then-act
-- (SELECT season.status !== 'active' → ... → UPDATE status='completed') uden
-- nogen DB-constraint der forhindrer to samtidige requests i begge at bestå
-- checket og begge køre den fulde season-end-pipeline (ensureSeasonStandings +
-- updateStandings + processSeasonEnd — division-flytning, lønkørsel, præmier,
-- notifikationer, Discord-broadcast). Praktisk risiko lav (single-admin + UI-
-- disable), men et netværks-retry i selve kaldøjeblikket kan teoretisk trigge
-- dobbelt udbetaling/udsendelse.
--
-- season-end-pipelinen er multi-step Node-orkestrering på tværs af mange
-- separate DB-kald (ikke én SQL-transaktion), så et pg_advisory_xact_lock
-- (transaktions-scoped, som balanceRpc.js/loanEngine.js bruger for enkelt-
-- statement RPC'er) løser IKKE denne race — en session-level advisory lock
-- holder heller ikke pålideligt over flere separate PostgREST-kald. Løsningen
-- her er samme mønster som resten af idempotency-laget i motoren (unique-
-- constraint som backstop, jf. #2301-emergency-loan-idempotency): et lille
-- claim-INSERT med en PRIMARY KEY, gjort som det FØRSTE skridt EFTER alle
-- read-only pre-checks (pending-results, seasonEndBlockers) og FØR selve den
-- tunge/irreversible bearbejdning starter. Kun ét request kan vinde INSERT'et;
-- taberen får 23505 unique_violation → 409 uden at røre noget som helst.
--
-- Ingen udløb/oprydning — en sæson afsluttes præcis én gang nogensinde, så et
-- permanent claim-row er korrekt (ikke en TTL-lock).
--
-- Idempotent (IF NOT EXISTS). Rollback nederst.
BEGIN;

CREATE TABLE IF NOT EXISTS season_end_claims (
  season_id  UUID PRIMARY KEY REFERENCES seasons(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE season_end_claims IS
  '#2847 — en raekke pr. sæson der nogensinde har faaet sin season-end-pipeline startet. PRIMARY KEY er selve dobbelt-POST-garantien: en concurrent/gentaget POST til season-end-endpointet taber sit INSERT med 23505 og afvises foer nogen bearbejdning.';

COMMIT;
-- Rollback:
--   DROP TABLE IF EXISTS season_end_claims;
