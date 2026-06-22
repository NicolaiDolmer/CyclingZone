# Progression L0 (#1137) — readiness-verifikation + simulering

> Status pr. 2026-06-22: motoren er **bygget, merged og verificeret** — men gated **OFF**
> (`SEASON_RIDER_PROGRESSION_ENABLED = false` i `backend/lib/economyConstants.js`).
> Denne PR FLIPPER IKKE flaget. Ejeren flipper det ved relaunch efter review.

## Hvad er allerede live i koden (recon-bekræftet)

| Komponent | Fil | Rolle |
|-----------|-----|-------|
| Rene kurve-funktioner | `backend/lib/riderProgression.js` | `seededUnit` (FNV-1a), `buildCaps`, `stepAbility`, `retirementDecision`, `developRiderSeason`; `PROGRESSION_CONFIG` (peakAge=28 unified, retirement-vindue 36–40) |
| DB-orchestrator | `backend/lib/riderProgressionEngine.js` | `developRidersForSeason(...)` — lazy-init `ability_caps`, vækst/fald, base_value-recompute (`predictBaseValue`), `is_retired`/`is_u25`, `rider_retired`-notifikation, idempotens via `rider_development_log` UNIQUE(rider_id, season_id) |
| Wiring | `backend/lib/economyEngine.js` (~405) | Kører i `processSeasonStart` hvis `seasonNumber>=2` OG (`deps.developRidersForSeason` ELLER `SEASON_RIDER_PROGRESSION_ENABLED`) |
| Migration | `database/2026-06-07-rider-progression-l0.sql` | `rider_development_log` + `ability_caps` JSONB + `rider_retired` notif-type (allerede merged) |

Flaget er en **ren applikationskode-konstant** — genaktivering = sæt `true` + deploy, ingen migration.

## De 5 acceptkriterier — verifikation

| # | Kriterie | Bevis | Status |
|---|----------|-------|--------|
| a | 21-årig høj-pot stiger målbart over 2–3 sæsoner | Unit: `developRiderSeason: 21-årig høj-pot stiger målbart`. Sim (seed 2026): ung rouleur pot 4 `flat 65→71→75→78` (+13/3 sæsoner) | PASS |
| b | 34-årig falder målbart efter peak | Unit: `developRiderSeason: 34-årig falder målbart`. Sim: 34-årig sprinter `sprint 65→63→60→57` (−8/3 sæsoner) | PASS |
| c | Auto-retirement i høj alder MED notifikation | Unit: `garanteret retirement ved 40 + notifikation til ejer-hold` (engine emitter `rider_retired`). Sim: 57 pensioneret, yngste alder 38 (vindue starter 36) | PASS |
| d | Board #813 youth-goal opnåelig + #918 dev-tab har data | `boardGoals.js` `u25_development_delta`-mål = ">= 8 points/sæson"; sim viser gnsn. U25 ability-sum-vækst **24.96/sæson** ≫ 8. `is_u25` vedligeholdes af engine; `rider_development_log` er #918-snapshot. Underliggende data findes — UI-features ikke genbygget her. | PASS |
| e | Idempotent: samme transition 2× = identisk resultat | Unit: `idempotent: anden kørsel skipper alle og muterer intet`. Sim: re-run run-hash bit-identisk (`4375a859`) | PASS |

Cross-seed (2026 / 7 / 42 / 1337): **alle 5 kriterier PASS på hver seed.**

## Nyt i denne PR (additivt, ingen ændring af engine-adfærd)

- `backend/lib/progressionSimHarness.js` — deterministisk simulerings-harness der driver de
  SAMME rene engine-funktioner over en syntetisk population (synthetic-only, ingen DB/prod).
- `backend/lib/progressionSimHarness.test.js` — 9 tests (population, simulation, scorecard, idempotens).
- `backend/scripts/dev/simulate-progression-l0.mjs` — runbar CLI; exit 0 hvis alle 5 kriterier opfyldt.

Kør: `node backend/scripts/dev/simulate-progression-l0.mjs --verbose`

## Åbent ejer-spørgsmål (IKKE ændret her)

Issue-teksten nævner **type-afhængigt peak** (sprintere topper tidligere end klatrere), men
koden bruger ét **unified peakAge=28** (ejer-besluttet 2026-06-07). `peakAgeByType` er bevaret
som null-hook hvis type-variation senere ønskes. Ejer-beslutning respekteres — flag det kun som
spørgsmål: skal type-afhængigt peak indføres før relaunch, eller forbliver unified peak L0-scope?
