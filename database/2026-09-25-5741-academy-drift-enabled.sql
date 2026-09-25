-- database/2026-09-25-5741-academy-drift-enabled.sql
-- #5741: kill-switch for AKADEMI-DRIFT specifikt ved S3→S4-skiftet 27/9
-- (ejer-beslutning 25/9 kl. 13:30: ingen ungdomsdrift ved dette ene skifte).
-- Læses af backend/lib/academyDriftFlag.ts og gater trin 4 i
-- backend/lib/economyEngine.js (processTeamSeasonPayroll).
--
-- DEFAULT = 'on': UÆNDRET adfærd — akademi-drift opkræves som i dag. Denne
-- migration ændrer INTET ved merge. Ejeren sætter nøglen til 'off' MANUELT
-- før cutover-kørslen 27/9 (se docs/SEASON_CUTOVER_RUNBOOK.md, trinnet lige
-- før 12a "Afslut sæson") — aldrig fra et script.
--
-- Fail-safe hvis nøglen mangler/læsningen fejler: 'on' (drift opkræves som i
-- dag) — MODSAT de fleste stage-flag i denne mappe. Se academyDriftFlag.ts.
--
-- Slå fra før cutover: UPDATE public.app_config SET value='"off"'::jsonb WHERE key='academy_drift_enabled';
-- Slå til igen (rollback): UPDATE public.app_config SET value='"on"'::jsonb  WHERE key='academy_drift_enabled';
--
-- Idempotent (ON CONFLICT DO NOTHING) — sikker at køre flere gange, og
-- overskriver ALDRIG en værdi ejeren allerede har sat.

INSERT INTO public.app_config (key, value, description)
VALUES ('academy_drift_enabled', '"on"'::jsonb,
  'Kill-switch for akademi-drift ved sæsonskiftet (#5741). ''on'' (default) = uændret adfærd, akademi-drift opkræves pr. besat ungdomsplads som i dag. ''off'' = INGEN akademi-drift opkræves ved den sæsonskiftekørsel, og ingen academy_drift-ledgerpost skrives. Fail-safe ''on'' hvis nøglen mangler eller læsningen fejler — modsat resten af stage-flag-kataloget, fordi en flag-fejl her aldrig må stille et hold gratis akademi-drift. Ejeren sætter denne til ''off'' manuelt før S3→S4-cutover 27/9, se docs/SEASON_CUTOVER_RUNBOOK.md.')
ON CONFLICT (key) DO NOTHING;
