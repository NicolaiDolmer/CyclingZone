-- Engangs-datareparation for #3015 (AI-holdenes ryttere restituerer aldrig).
--
-- IKKE en migration — ligger bevidst i scripts/oneoff/, ikke database/, fordi
-- database/*.sql auto-applies ved merge (#2642-rammen) og dette er en
-- ejer-gated masse-mutation, ikke et skema-skift. Ejeren kører denne manuelt
-- efter at have set dry-run-tallene og godkendt reparations-værdien.
--
-- HVAD DEN GØR: bringer AI-ryttere der aldrig har fået den daglige recovery
-- (backend/lib/aiRecoverySweep.js, ny i denne PR) ét enkelt tick fremad — SAMME
-- formel/funktion som den nye nattelige sweep bruger (riderCondition.nextFatigue/
-- nextForm, intensity "rest"), anvendt direkte i SQL. Det er bevidst IKKE en
-- vilkårlig nulstilling — det er "kør den rigtige mekanisme én gang NU i stedet
-- for at vente til i nat", så tallene er 100% konsistente med hvad cron'en
-- ville have produceret som sit første tick.
--
-- SCOPE: kun ryttere på ægte AI-hold (is_ai=true, is_bank=false, is_frozen=false,
-- is_test_account=false), ikke-pensionerede. Rører KUN rider_condition.fatigue/
-- form (+ updated_at) — injured_until/injury_cause, abilities, alt andet er urørt.
--
-- DRY-RUN-TAL (verificeret read-only mod prod 2026-08-03, se PR/issue #3015 for
-- fuld kontekst):
--   3.737 ikke-pensionerede ryttere på 188 ægte AI-hold. 3.238 af dem har en
--   eksisterende rider_condition-række; af DEM sad 1.977 (61%) på det absolutte
--   trætheds-loft (100) — mod menneskeholdenes 1.388/3.033 (46%) samme dag.
--   Efter ét tick: 0 AI-ryttere tilbage på loftet, gns. træthed 66,4 → 42,9,
--   maks 69. Form ændres marginalt (AI-ryttere har aldrig trænet, så form ligger
--   allerede omkring neutral 50).
--
-- BALANCE-ADVARSEL (se PR-beskrivelse + issue #3015's "Hvorfor det betyder noget"):
-- denne reparation gør AI-felterne MÆRKBART stærkere med det samme (træthed er et
-- direkte fradrag i raceSimulator.js's score). Koordinér timing med #2731/#2557
-- (AI-dominans-metrikker) FØR den køres — de to workers måler formentlig præcis
-- denne skævhed lige nu.
--
-- IDEMPOTENS: IKKE sikker at køre to gange samme dag — anden kørsel ville tage
-- endnu et "rest"-tick oveni det første (dobbelt recovery). Kør ÉN gang. Sektion
-- 3 (nedenfor) forhindrer at den nattelige sweep ALSO tager et tick for de
-- samme hold samme dansk dato (ai_recovery_runs-mutex, se aiRecoverySweep.js) —
-- kør sektion 3 KUN hvis du kører denne reparation FØR kl. 22 dansk tid samme
-- dag som du vil have effekten til at gælde fra.

BEGIN;

-- ── 1) DRY RUN — kør denne FØRST og verificér tallene ligner ovenstående ──────
-- (kommentér UPDATE'et i sektion 2 ud og kør kun dette SELECT for at se preview
-- uden at skrive noget).
WITH ai_riders AS (
  SELECT r.id AS rider_id, r.team_id,
         rc.fatigue AS fatigue_before, rc.form AS form_before,
         COALESCE(rda.recovery, 50) AS recovery_ability
  FROM riders r
  JOIN teams t ON t.id = r.team_id
  LEFT JOIN rider_condition rc ON rc.rider_id = r.id
  LEFT JOIN rider_derived_abilities rda ON rda.rider_id = r.id
  WHERE t.is_ai = true AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false
    AND r.is_retired = false
    AND rc.rider_id IS NOT NULL -- kun ryttere der faktisk har en condition-række at reparere
),
computed AS (
  SELECT
    rider_id, team_id, fatigue_before, form_before,
    GREATEST(0, LEAST(100, ROUND(
      fatigue_before + (-14) -
      (4 + 4 * (recovery_ability / 99.0) + 0.13 * GREATEST(0, fatigue_before))
    ))) AS fatigue_after
  FROM ai_riders
)
SELECT
  count(*) AS riders_would_touch,
  round(avg(fatigue_before)::numeric, 1) AS avg_fatigue_before,
  round(avg(fatigue_after)::numeric, 1) AS avg_fatigue_after,
  count(*) FILTER (WHERE fatigue_before = 100) AS before_at_cap,
  count(*) FILTER (WHERE fatigue_after = 100) AS after_at_cap,
  max(fatigue_after) AS max_fatigue_after
FROM computed;

-- ── 2) DEN FAKTISKE REPARATION — fjern kommentaren for at eksekvere ───────────
-- UPDATE rider_condition rc
-- SET
--   fatigue = computed.fatigue_after,
--   form = GREATEST(0, LEAST(100,
--     CASE
--       WHEN computed.fatigue_after BETWEEN 25 AND 60 THEN rc.form + 3
--       WHEN computed.fatigue_after > 80 THEN rc.form - 4
--       WHEN computed.fatigue_after > 60 THEN rc.form - 1
--       ELSE rc.form + 1
--     END
--   )),
--   updated_at = now()
-- FROM (
--   WITH ai_riders AS (
--     SELECT r.id AS rider_id,
--            rc.fatigue AS fatigue_before,
--            COALESCE(rda.recovery, 50) AS recovery_ability
--     FROM riders r
--     JOIN teams t ON t.id = r.team_id
--     JOIN rider_condition rc ON rc.rider_id = r.id
--     LEFT JOIN rider_derived_abilities rda ON rda.rider_id = r.id
--     WHERE t.is_ai = true AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false
--       AND r.is_retired = false
--   )
--   SELECT
--     rider_id,
--     GREATEST(0, LEAST(100, ROUND(
--       fatigue_before + (-14) -
--       (4 + 4 * (recovery_ability / 99.0) + 0.13 * GREATEST(0, fatigue_before))
--     ))) AS fatigue_after
--   FROM ai_riders
-- ) AS computed
-- WHERE rc.rider_id = computed.rider_id;

-- ── 3) VALGFRIT — marker dagens tick som brugt, så nattens cron IKKE giver et
-- ekstra tick oveni denne reparation SAMME dansk dato. Spring over hvis du
-- kører reparationen på en anden dag end den du vil have cron'en til at
-- fortsætte fra (ai_recovery_runs.tick_date bruger dansk lokal dato, samme
-- som copenhagenDateString() i backend/lib/copenhagenTime.js).
-- INSERT INTO ai_recovery_runs (team_id, tick_date, riders_recovered)
-- SELECT DISTINCT t.id, (now() AT TIME ZONE 'Europe/Copenhagen')::date, 0
-- FROM teams t
-- WHERE t.is_ai = true AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false
-- ON CONFLICT (team_id, tick_date) DO NOTHING;

-- Husk: ROLLBACK hvis dry-run-tallene i sektion 1 ikke matcher forventning,
-- COMMIT når sektion 2 (og evt. 3) er kørt og verificeret.
ROLLBACK;
-- Skift ROLLBACK til COMMIT når du har fjernet kommentarerne i sektion 2 og
-- (valgfrit) 3 og har verificeret sektion 1's output.
