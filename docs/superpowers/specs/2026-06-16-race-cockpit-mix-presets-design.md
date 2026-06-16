# Race-cockpit: ét-kommando rerun + rytter-mix-presets (#1420)

> Status: design godkendt 2026-06-16 (kollaborativ session, ejer til stede). Kort spec → byg direkte med TDD (ejer-valgt proces). Kun dev-tooling — ingen prod/gameplay-ændring.

## Mål

Gør det nemt for ejeren selv at teste race-motoren og danne sin egen mening — bedre end at åbne en statisk HTML manuelt. To konkrete ønsker: (1) nemt "rerun" for et nyt eksempel, (2) en anden blanding af ryttere. Plus en lær-mig-session i hvordan man læser cockpit'en og skelner varians fra et ægte problem.

## Verificeret udgangspunkt (16/6)

- `backend/scripts/out/` er **allerede gitignored** (.gitignore:23) og `race-dry-run.html` er **ikke tracked** (`git ls-files`/`git check-ignore`). Issue'ets præmis "filen er tracked" var forældet → gitignore-deldelen er allerede løst.
- `generateFictionalRiders({ seed, count, referenceYear, existingFoldedNames, nationalityWeights })`: seed/count/nationalityWeights er override-bare; **komposition** (`TIERS`-fraktioner + `TIER_TYPE_WEIGHTS`) er modul-konstanter uden override.
- Dry-run kalder generatoren uden `nationalityWeights` (simulateSeasonDryRun.js:252).
- Default-felt (seed 2026, 800): climber 28% · tt 21% · baroudeur 10% · leadout 10% · rouleur 8% · sprinter 7% · brostensrytter 7% · puncheur 6% · gc 4%.

## Beslutninger (ejer-valgt)

1. **Output-fil:** per-run-navn `out/cockpit-<mix>-<seed>[-cond][-roles].html`. Samme parametre → samme fil (deterministisk, ingen dubletter); andre parametre → ny fil ved siden af → flere cockpits kan sammenlignes. Alt i gitignored `out/`.
2. **Presets (6, moderat-stærke skews):**

   | Preset | Løftestang | Effekt |
   |--------|-----------|--------|
   | `default` | — | nuværende konstanter (uændret) |
   | `random` | — | = default; friskhed kun fra `-Seed` |
   | `sprint-heavy` | type-vægte: sprinter ×3, leadout ×2 | dybe sprint-felter |
   | `climb-heavy` | type-vægte: climber ×2, gc ×2, baroudeur ×1.5 | dybe bjerg-felter |
   | `elite-dense` | tier-fraktioner: superstar 1.5→6%, star 7.5→16%, solid 35% | stablet topfelt (pyramide fladet bevidst) |
   | `balanced` | type-vægte fladet (alle arketyper ~lige) | hver disciplin lige repræsenteret |

   Værdi-pyramiden bevares overalt undtagen `elite-dense` (hvor flading er pointen).

## Komponenter

1. **`backend/lib/fictionalRiderMixPresets.js`** (ny) — `MIX_PRESETS` + `resolveMix(name)` → `{ tierFractions?, tierTypeWeights? }`. Bygger på default-konstanter eksporteret fra generatoren. Ukendt navn → fejl med liste over gyldige presets.
2. **`backend/lib/fictionalRiderGenerator.js`** (ændring) — eksportér `DEFAULT_TIER_FRACTIONS` + `DEFAULT_TIER_TYPE_WEIGHTS`; tilføj `tierFractions` + `tierTypeWeights` params (default = konstanterne → 0 adfærdsændring uden flag).
3. **`backend/scripts/simulateSeasonDryRun.js`** (ændring) — `--mix=<preset>` → `resolveMix` → generatoren. Default HTML-sti = per-run-navn. Cockpit-header viser preset-navn. `race:gate*` (`--no-html`) upåvirket; `--html=` override bevaret.
4. **`scripts/race-cockpit.ps1`** (ny) — knapper `-Seed`/`-Mix`/`-Condition`/`-Roles`/`-Count`; kører node, fanger den printede `📄 HTML-cockpit:`-sti, auto-åbner. `npm run race:cockpit` (root) = default-kørsel.

## Test (TDD)

- Ny `fictionalRiderMixPresets.test.js`: `resolveMix("default")` == defaults · hvert preset valid · ukendt navn kaster · sprint-heavy hæver sprinter-vægt · elite-dense ændrer fraktioner.
- Generator-test: default-override === ingen-override (regression) + skewet `tierTypeWeights` flytter realiseret type-fordeling i forventet retning.
- Eksisterende generator- + integration-tests grønne · `npm run race:gate` grøn (default-sti urørt).

## Afgrænsning

Kun dev-tooling, read-only, deterministisk. Ingen `--nat`-knap (ikke i de aftalte knapper — YAGNI). PatchNotes/help.json/FEATURE_STATUS røres ikke (ingen brugerrettet ændring).

Relateret: #1021 (udbruds-motor), #1102/#1122 (race-engine v2 / specialisering).
