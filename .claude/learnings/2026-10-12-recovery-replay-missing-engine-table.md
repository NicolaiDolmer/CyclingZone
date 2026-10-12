# 2026-10-12 — #5928 recovery replay brød på ny motor-læsning

**Symptom:** `node --test scripts/trainingRecovery5928.test.mjs` fejlede 2/8 på main
(`Unsupported snapshot table team_training_rules`).

**Rod-årsag:** #5999 (træthedsregler) og #6000 (gruppe-regler) gav `runTeamTrainingDay`
nye tabel-læsninger (`team_training_rules`, `training_groups`, `training_group_members`).
Recovery-replayet kører den rigtige motor mod en frossen eksport, så hver ny motor-læsning
kræver en ny snapshot-tabel. Testen lå i `scripts/`, som `npm test` i backend ikke finder,
og stod ikke i `ci.yml` — derfor ingen rød CI.

**Fix:** tabellerne eksporteres (read-only), kræves af `validateSnapshot`, og replayet
bruger kun rækker der fandtes ved work-tidspunktet. Reglerne er nyere end 29/9, så en
række fra før work fejler lukket (flagets historiske stadie er ikke eksporteret).
Offline-klienten afviser stadig ukendte tabeller og alle mutationer. Testen kører nu i
backend-tests-jobbet.

**Lære:** tests i `scripts/` der importerer backend-motoren skal have et eksplicit CI-trin;
ellers opdages kontrakt-drift først når nogen kører dem manuelt.
