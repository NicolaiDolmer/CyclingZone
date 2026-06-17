# Ét seed i en kalibrerings-gate kan maskere population-drevet drift — kør de blessede seeds, ikke kun ét

**Dato:** 2026-06-17 · **Issue:** #1102 (race-motor verify) · **Refs:** #1021 (post-launch breakaway), #1122/#1434 (population-skift), #1307

## Hvad skete

Verifikation af Race Engine v2 (#1102): kernen er sund — evner afgør faktisk løbene
(win-rate-scorecard + strukturelle oracles + evne-liveness grønne på alle seeds, 1721
backend-tests grønne). Men da jeg kørte dry-run-harnessen på tværs af seeds i stedet for
kun CI's ene seed, fejlede **udbruds-fordelings-båndene på 18/20 seeds**: flat-udbrud
~+2pp for højt, hilly under gulvet. CI havde været grøn hele tiden.

## Den ægte rod-årsag

To ting der mødtes:

1. **Population-skift uden re-kalibrering.** Udbruds-båndene (#1021 Fase 1, indført 16/6
   som eksplicit "KANDIDAT-bånd — verificeres grøn på tværs af seeds (plan Task 5)") var
   fittet mod den GAMLE population. Samme dag skiftede populationen (#1428 ability v3 +
   #1434 leadout-cut 9→8 flyttede terræn-gab-strukturen ved udbruds-cut'et). Task 5 blev
   aldrig fuldført → kandidat-båndene matchede ikke længere.

2. **Gaten kørte kun ét seed.** `race:gate` i CI var `--seed=2026`. Seed 2026 lå
   tilfældigvis i bånd; seed 7 og 42 (de to ANDRE kalibrerings-seeds) faldt udenfor.
   `race:gate:condition`/`:roles` fandtes som npm-scripts men var ikke wired ind i
   `ci.yml`. Ét lykke-seed maskerede en systematisk drift.

Ikke en launch-blocker: udbruds-realisme er #1021 (`post-launch`-milestone), og win-rate-
dominansen var uændret (sprintere vinder stadig ≥90% af flade etaper).

## Fix (ejer-valgt: udskyd + luk CI-hul)

- Udbruds-båndene afkoblet fra `--enforce-targets` → **rapport-only**, opt-in via nyt
  `--enforce-breakaway` til #1021-kalibrerings-sessionen (printes stadig hver kørsel).
- `race:gate` → multi-seed wrapper (`scripts/raceGate.js`) på de tre kalibrerings-seeds
  {2026, 7, 42}. Denne præcise drift (brød seed 7 OG 42, ikke 2026) ville nu være rød i CI.
- condition/roles forblev UDE af hard-gaten: de har egne marginale post-launch-seams
  (durability-liveness via placeholder-fatigue #1021; itt-tt 59% population-bundet #1122).
  At gøre dem hårde nu ville bare lave en ny flaky gate.

## Lektien

En seeded kalibrerings-gate er kun så stærk som de seeds den kører. **Når en gate
"verificerer" et balance-system mod en population, så kør gaten på FLERE seeds — mindst
hele det blessede kalibrerings-sæt — ellers kan ét lykke-seed skjule en systematisk
drift.** Og **enhver population-ændring (#1428/#1434) invaliderer en kandidat-gate der er
fittet mod den gamle population** — re-kør den brede gate som en del af population-PR'en,
ikke bagefter.

Skeln engine- vs. indholds-bundet gap ([[feedback_simulate_before_ship_balance]]): driften
her var indholds-bundet (population), så fixet var gate-policy + udskyd til #1021-
kalibrering, IKKE at pille ved motor-konstanterne. Forlænger
[[feedback_backwards_check_forward_guard]] (forward-guard = multi-seed CI) og
[[feedback_runtime_verify_first]] (kør den brede gate før du kalder v2 verificeret).
