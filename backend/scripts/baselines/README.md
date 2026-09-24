# Balance-baselines (#1197)

Deterministiske "tal-screenshots" af spilbalancen — samme idé som core-smoke-
screenshots, bare for tal. `balance-baseline.json` er sandheden; `.md` er det
menneskelæsbare resumé af samme snapshot.

## Hvordan det virker

1. `backend/lib/balanceSnapshot.js` kører hele balance-kæden in-memory med fast
   seed (2026, 800 ryttere — samme som `race:gate`): generator → abilities →
   typer → værdimodel → race-motor (8 terræner × 300 løb + Grand Tour) →
   progression (6 sæsoner). Ingen DB, ingen timestamps, ingen locale-formatering.
2. Baselinen her er committet. Ved PR'er der rører balance-følsomme stier kører
   CI (`.github/workflows/balance-baseline-check.yml`) snapshottet igen og
   differ mod baselinen. **Diffen ER reviewet** — fx "gc p50 +5,7%".
3. Tom diff = grøn. Ikke-tom diff = balance-skifte: er det tilsigtet, bumpes
   baselinen i samme PR (så er skiftet synligt i git-historikken = audit-trail).

## Kommandoer (i `backend/`)

```bash
npm run balance:check      # diff mod baseline (exit 1 ved diff)
npm run balance:baseline   # regenerér baseline → commit begge filer
```

CI kører checket advisory (`--advisory`, exit 0 + warning) indtil gate-beslutning
— flip til gate ved at fjerne `--advisory` i workflowet.

## Hvornår SKAL baselinen bumpes?

Når en PR med vilje ændrer noget af dette: `riderValuationModel.json`/anchors,
`riderTypes*`, `abilityDerivation.js`, `fictionalRiderGenerator.js`,
`raceStageProfileGenerator.js` (DEMAND_VECTORS), `raceSimulator.js` (noise),
`raceRunner.js`, `riderProgression.js`. Diff uden baseline-bump = ureviewet
balance-skifte.

## Population-snapshots (race-harnesset, #2224 / #4936 / #5572)

Eksporteret READ-ONLY fra prod med `backend/scripts/exportPopulationSnapshot.js`.
Race-harnesset (`headToHeadV4.js`, `buildV4AnchorBaseline.mjs`,
`v4EffortTwinMeasure.js` m.fl.) indlæser dem via `--population=<fil>`.

sha256 er taget af den **committede blob** (LF), så tallet er ens på alle
maskiner: `git show HEAD:backend/scripts/baselines/<fil> | sha256sum`. Et
Windows-checkout med `core.autocrlf=true` giver filen CRLF på disken og
dermed en anden hash af selve filen (det er den `v4-anchor-baseline.json`s
16-tegns `population_file_sha256_16` er taget af).

| Fil | Evner | Hold-id'er | sha256 (blob) | Rolle |
|---|---|---|---|---|
| `population-snapshot-2026-09-07.json` | 13 (klassifikatorens liste — **uden** `tactics`/`positioning`) | rå | `a64ef5966fcbda959ae817784d4157a1bd87a6255a6ca514ddbd3763d5f3bc36` | **Gaten** — §7b-ankertabellen og v4-anker-baselinen måles på denne |
| `population-snapshot-2026-09-24.json` | alle registry-evner (`ability_keys` i filen), inkl. `tactics`/`positioning` | pseudonymiseret (`team-0001` …) | `f9ffbe22d8a4a310a114f842235f48f6bc35a779993458a19001b2237363b534` | Side-om-side-måling (#5572). **Ikke** gaten — at flytte gaten hertil er en ejerbeslutning |

Ny pin (committes under `baselines/`): brug altid `--pseudonymize-teams`, så
hold-id'erne ikke ligger i det offentlige repo. Aliaserne tildeles i samme
orden som de rigtige id'er, så harnessets gruppering og sortering er uændret.

```bash
infisical run --env=prod --silent -- node backend/scripts/exportPopulationSnapshot.js \
  --out=backend/scripts/baselines/population-snapshot-<dato>.json --pseudonymize-teams
git show HEAD:backend/scripts/baselines/population-snapshot-<dato>.json | sha256sum   # efter commit → tabellen ovenfor
```

Side-om-side-måling på en anden population (gaten røres ikke; en anden
population uden `--out` uden for baselinen afvises):

```bash
node backend/scripts/buildV4AnchorBaseline.mjs --population=<fil> --out=<fil>
node backend/scripts/v4EffortTwinMeasure.js --population=<fil> --out=<fil>
```
