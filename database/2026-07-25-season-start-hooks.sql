-- #2910 + #2911 — sæsonstart-hooks: flag-rækker (fail-safe OFF) + claim-tabel til
-- akademiets sæson-optagelse. Idempotent: kan replayes uden fejl og uden at
-- overskrive en flag-værdi ejeren allerede har flippet.

-- ── #2911 · claim-tabel (idempotens pr. hold + sæson) ───────────────────────
-- academy_intake-rækkerne kan IKKE bruges som guard (søndags-drippet skriver
-- dem også for samme season_id), og academy_intake_ticks kan ikke bruges fordi
-- sæsonskiftet selv kører på en søndag — drippet ville have claimet dagen først.
-- Mønster: academy_intake_ticks (claim-FØRST, PK-kollision = allerede kørt).
CREATE TABLE IF NOT EXISTS academy_season_intake_runs (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, season_id)
);

-- Service-role-only (ingen policies = deny for anon/authenticated; service role
-- bypasser RLS). Spejler academy_intake_ticks.
ALTER TABLE academy_season_intake_runs ENABLE ROW LEVEL SECURITY;

-- ── Flag-rækker ─────────────────────────────────────────────────────────────
-- EFTER APPLY:  season_fatigue_reset_enabled  = "on"   (#2910 — ejer-beslutning)
--               season_academy_intake_enabled = "off"  (#2911 — ejer-beslutning)
--
-- Verificeret read-only 2026-07-26: INGEN af de to raekker findes i prod endnu,
-- og academy_season_intake_runs findes ikke. Migrationen er altsaa ikke applyet.

-- #2910 · TAENDT. Ejeren valgte fuld nulstilling ("alle starter saesonen lige")
-- frem for harnessens anbefaling om 3 hviledage. DO UPDATE i stedet for DO
-- NOTHING, saa vaerdien er deterministisk "on" efter apply uanset om en tidligere
-- delvis apply naaede at laegge raekken. Klausulen kan kun saette flaget TIL,
-- aldrig fra. NB: flip ejeren det senere til "off" som kill-switch, maa denne
-- migration ikke replayes — den ville gen-arme mekanikken.
INSERT INTO app_config (key, value, description)
VALUES
  ('season_fatigue_reset_enabled', '"on"'::jsonb,
   '#2910 - saesonskiftet nulstiller traethed helt (alle paa 0). on = aktiv fra cutover 2026-07-26.')
ON CONFLICT (key) DO UPDATE
  SET value = '"on"'::jsonb, description = EXCLUDED.description;

-- #2911 · SLUKKET VED EJER-BESLUTNING, ikke ved forglemmelse. Simuleringen viste
-- at soendags-drippet (#2064) fylder akademierne til 8-plads-cappen alligevel, saa
-- optagelsen er unoedvendig. Koden bliver liggende som sikkerhedsventil hvis
-- underskrivningsraten falder. DO NOTHING: en re-run maa ALDRIG slaa en mekanik
-- fra som ejeren har slaaet til.
INSERT INTO app_config (key, value, description)
VALUES
  ('season_academy_intake_enabled', '"off"'::jsonb,
   '#2911 - saeson-optagelse til akademiet ved skiftet (top-up til 8 pladser, maks 3 pr. hold). off = ejer-valgt, uaendret adfaerd.')
ON CONFLICT (key) DO NOTHING;
