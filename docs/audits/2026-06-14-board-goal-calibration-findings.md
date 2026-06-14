# Board-mål-kalibrering (#1267) — fund + harness-realisme-verifikation

> 2026-06-14 · Refs #1267, #1187-B, #1102, #1105 · simulér-før-ship
> Branch: `feat/board-relaunch-goal-calibration-1267`

## Bundlinje

1. **Strukturel mål-urimelighed er rettet** (shippet i denne PR): `min_riders`-mål var
   bogstaveligt umulige for hele populationen (alle 49 mål havde target > truppen), og
   `sponsor_growth` er uvindbar på 1yr-planer. Begge rettet.
2. **Men det løser IKKE ≤10%-konsekvens-rate-gaten.** Kalibreringen flyttede raten fra
   50,0 % → 45,5 % — den ægte driver er en anden.
3. **Den ægte driver:** results-kategorien vejer 50 % og bliver præcis **0 når et hold
   vinder 0 etaper** — og ~halvdelen af alle hold vinder 0 etaper pr. sæson.
4. **Owner-besluttet verifikation (14/6): er det et harness-artefakt?** NEJ. Den ægte
   race-motor koncentrerer sejre lige så hårdt (eller hårdere). Sejrs-knapheden er
   fundamental, ikke en harness-fejl.
5. **Tilbageværende beslutning (ejer):** ≤10%-gaten kræver en board-MEKANIK-beslutning
   (belønn konkurrencedygtighed, ikke kun sejre / blødere konsekvenser) — ikke mere
   mål-kalibrering. Se "Resterende beslutning" nederst.

## 1. Strukturel kalibrering (rettet)

| Mål | Problem | Fix |
|---|---|---|
| `min_riders` | Target 15-25 (fra `DIVISION_SQUAD_LIMITS` div 1/2 = 20-30/14-20, PCM-æra). Reelle trupper 8-17 → alle 49 mål umulige. | Re-kalibreret div 1 → `{10,16}`, div 2 → `{9,13}` (div 3 `{8,10}` var allerede launch-passende). min_riders-target nu 10-13. |
| `sponsor_growth` (1yr) | sponsor_income ændres kun ved sæson-skift → vækst = 0 % hele 1yr-planen → scorer altid 0, nuller economy-kategorien (eneste economy-mål i star_signing). | Fjernet fra 1yr-planer (`generateBoardGoals`-filter). Beholdt på 3yr/5yr hvor det reelt kan vokse. |

Verificeret via nyt `boardSatisfactionHarness.js --regen-goals`-flag (regenererer mål fra
den nuværende generering mod den realistiske trup-population — relaunch-gate-infrastruktur).

## 2. Hvorfor det ikke flytter gaten — den ægte driver

Per-kategori-nedbrydning af et div-1 1yr-hold med **perfekte** identitets- + økonomi-mål:

```
rank | stageW | results ranking ident econ | overall | sat | HARD?
  6  |   2    |  1.00   0.82   1.10  1.05  |  1.01   | 69  |
  6  |   0    |  0.00   0.82   1.10  1.05  |  0.49   | 41  |
 10  |   0    |  0.00   0.57   1.10  1.05  |  0.47   | 39  | ← lag 2 (salary cap)
```

`satisfactionDelta = (overallScore − expectation) × 55` (boardEvaluation.js). Results
vejer 50 %; ved 0 sejre bliver results = 0 → overall falder under hard-lag-tærsklen
uanset alt andet. Et hold der kører en hel sæson uden at vinde får løntilbageholdelse.

## 3. Harness-realisme-verifikation (owner-valgt skridt)

Spørgsmål: harnessets sejrs-lotteri vægter med team-strength² (én skalar/hold). Over-
koncentrerer det vs. den ægte motor (per-rytter terrain-score pr. etape-profil + støj)?

Metode: 22 hold bygget af ÆGTE fiktive ryttere (samme værdikæde som prod), kørt gennem
`simulateStage` over en varieret 30-etape-sæson. Måling: andel hold der vinder 0 etaper.
Script: `backend/scripts/dev/harnessWinModelCheck.js`.

| Scenarie | seed 1187 | seed 7 | seed 42 |
|---|---|---|---|
| Banded hold (svag/middel/stærk, som harness-arketyper) | 55 % | 68 % | 68 % |
| Snake-draft (balancerede hold) | 50 % | 45 % | 64 % |
| Snake + 50 % deltagelse (varierede felter) | 36 % | 36 % | 45 % |
| Snake + 35 % deltagelse (mest spredt) | 36 % | 23 % | 41 % |
| **Harnessets squared-lotteri (reference)** | **~50 %** | | |

**Konklusion:** i ALLE scenarier vinder langt over 10 % af holdene 0 etaper. Harnesset
ligger midt i spændet — det er IKKE for pessimistisk. Med winner-take-all-etaper og en
stejl talent-pyramide (pool: median overall ~19, max ~70) er sejrs-knapheden fundamental.
Selv perfekt balancerede hold giver 45-64 % nul-sejrs-hold.

## Resterende beslutning (ejer) — ≤10%-gaten

Gaten kan IKKE nås med mål-kalibrering eller harness-fix. Den kræver en beslutning om
hvordan board-tilfredshed reagerer på det iboende-almindelige "vandt få/ingen etaper":

- **A) Delvis results-kredit** — lad podier/stærke placeringer tælle, ikke kun sejre.
  Mest spil-designmæssigt sundt (belønner konkurrencedygtighed). Kræver placerings-data
  fra race-motoren (#1102) i board-context.
- **B) Blødere konsekvenser** — kun de nederste hold rammer hårde lag (juster
  expectation-baseline/satisfaction-tærskel). Rører mekanik låst 11/6.
- **C) Rebalancér mål-vægt** — results vægter mindre; opnåelige mål bærer tilfredsheden;
  sejre = upside. Rører kategori-vægte.

Konsekvens-mekanikken er bag flag OFF, så denne PR (struktur-fix + verifikations-
infrastruktur) er launch-sikker uafhængigt af beslutningen.
