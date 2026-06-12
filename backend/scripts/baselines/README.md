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
