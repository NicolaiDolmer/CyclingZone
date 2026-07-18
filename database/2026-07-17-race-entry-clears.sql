-- #2599: eksplicit "ryd"-markering. Rod-årsag for "manuelt ryddede trupper kommer
-- tilbage": et tomt race_entries-sæt for (race,team) var UMULIGT at skelne fra
-- "aldrig rørt" — raceSelection.js's validateSelection-kommentar sagde det ligeud:
-- "en tom trup = ren auto-udtagelse". Den periodiske entry-generator-sweep
-- (raceEntryGeneratorSweep.js, kører hver time + ved hvert deploy-boot) og
-- sæson-transitionen fyldte derfor en netop ryddet trup ud igen ved næste tick.
--
-- Denne tabel er IKKE den samme handling som en almindelig tom PUT /selection
-- (som fortsat betyder "auto-udtag mig", uændret adfærd — en rytter fjernet ved et
-- uheld skal ikke blokere auto-fill). Den skrives KUN af de nye eksplicitte
-- "Ryd dag"/"Ryd alt"-knapper (POST /races/distribution/clear, bekræftelses-dialog
-- i UI'et) og læses af generatoren som et "spring over"-signal — mirror
-- race_withdrawals-mønsteret (2026-06-23-race-withdrawals.sql), men pr. (race,team)
-- i stedet for global afmelding: holdet deltager stadig, det er kun auto-udtagelsen
-- der er sat på pause. Markeringen slettes automatisk igen når spilleren enten
-- udtager manuelt (raceSelection.js) eller selv beder om auto-fill/udfyld-manglende
-- (regenerate-endpointet) — først da må generatoren fylde ud igen.
--
-- RLS-mønster spejler race_withdrawals: skrivning sker udelukkende via
-- service_role (backend-endpoints), authenticated kan kun læse egen status.
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.race_entry_clears (
  race_id     UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  cleared_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_race_entry_clears_team ON public.race_entry_clears(team_id);

ALTER TABLE public.race_entry_clears ENABLE ROW LEVEL SECURITY;

-- Player-facing: alle authenticated kan læse (ryd-status kan vises i UI senere).
DROP POLICY IF EXISTS "race_entry_clears_select_authenticated" ON public.race_entry_clears;
CREATE POLICY "race_entry_clears_select_authenticated"
  ON public.race_entry_clears FOR SELECT TO authenticated USING (true);

-- Skrivning sker via service_role (backend-endpoint) — ingen direkte klient-write.
GRANT SELECT ON public.race_entry_clears TO authenticated;

COMMENT ON TABLE public.race_entry_clears IS
  '#2599: eksplicit "Ryd dag/alt"-markering. (race_id, team_id) = spilleren har bekræftet
   at rydde truppen og entry-generatoren må IKKE fylde den ud igen, før spilleren selv
   udtager manuelt eller beder om auto-fill.';
