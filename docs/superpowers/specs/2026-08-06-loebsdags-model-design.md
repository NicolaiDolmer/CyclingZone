# Løbsdags-modellen — design-spec (fatigue + træning + udvikling forbundet)

**Status:** Udkast til ejer-godkendelse (retning nikket 6/8 i chat efter afvisning af K4/K4′).
**Ejer-beslutninger 6/8 (chat):** (1) Racing udvikler LIDT bedre end træning — ~10-20 % mere end det pas det erstatter, kun i løbets relevante evner (D2 er kalibreret herefter). (2) Motor-skiftet går live VED SÆSONSKIFTET 23/8 sammen med markedsmodel-100 % og løn-genberegningen — ét nulpunkt, én roadbook. Konsekvens accepteret af ejer: AI-under-træthedsglidningen (#3015) står frem til 23/8 uden interim-fix; fase 1 (V1+V2) kører nu.
**Ejer-krav:** managers træningsvalg må ALDRIG overskrives eller "bogholderi-fuskes" (K4′ afvist som fup 6/8); systemerne skal forbindes ærligt — verdensklasse, ikke sjusk.
**Refs:** #2650 (mætning + sim), #2402 (nat-restitution, lukkes med ærligt svar), #3015 (AI-hvile-fixet der vendte problemet), #2578 (0-fremgang-klager), #2262 (trænings-rekalibrering).

## 1. Problemet, målt (sim-harness `backend/scripts/fatigueSimulation2650.js`, 6/8)

1. **To ukoordinerede systemer:** race-belastning (`raceFatigue.js`, +10-20/løbsdag) og træningsbelastning (`dailyTraining.js`, +4-16) STABLES samme dag — `dailyTrainingEngine.js` kender ikke løbskalenderen. Menneske-ryttere har empirisk 0,915 løbsdage/dag → indstrøm slår altid restitutionen → median 85, 60 % over straf-tærsklen 70.
2. **AI-siden er vendt, ikke fixet:** #3015 gav AI tvungen fuld hvile (−14) hver dag → median 33 på vej mod 0 = aldrig træt = skjult fordel + skævvredet balance-grundlag.
3. **28-dages status-quo-prognose:** menneske 85→97, AI 33→0. Begge forværres.
4. K1 (mere recovery) og K2 (mildere raceLoad) er utilstrækkelige alene; K3 (hvile på løbsdage) overskyder menneske-siden til 0; K4/K4′ (auto-nedgradering/fatigue-rabat på træning) afvist af ejeren — hhv. overstyring af managerens valg og uærligt bogholderi.

## 2. Design: løbsdagen ER dagens arbejde

Princippet fra virkeligheden: ingen kører intervaller oven i et 200 km-løb — løbet er både dagens belastning og dagens træningsstimulus.

### D1 — På løbsdage udføres det planlagte pas ikke
- `dailyTrainingEngine` konsulterer løbskalenderen: har rytteren løbsdag, springes træningspasset over — ærligt og synligt ("Løbsdag — dagens træning erstattes af løbet" i trænings-/kalender-UI).
- Managerens PLAN røres aldrig: den står præcis som sat og gælder alle ikke-løbsdage. Manageren styrer fortsat hvem der overhovedet stilles til start — rotation bliver det centrale håndtag, som designet lover i Hjælp.

### D2 — Løbet giver udviklings-stimulus
- Racing er den bedste træning: løbsdeltagelse giver udviklings-effekt mappet fra løbsprofilen (bjerg-etape → climbing/endurance-stimulus; brosten → cobblestone; enkeltstart → tt osv.), skaleret af indsats/distance. Verifikationsskridt V1 (nedenfor) fastlægger præcist hvordan dette kobles ind i den eksisterende udviklings-mekanik uden dobbelt-kredit.
- **Kalibrering (ejer-valgt 6/8): løbet udvikler ~10-20 % MERE end det pas det erstatter — men kun i løbets relevante evner.** Som i virkeligheden: man bliver bedst af at køre løb. Bænken følger med via træning; den mister kun spidsen. 1-rytter-1-løb/dag-invarianten (låst) begrænser naturligt mod race-spam.

### D3 — Rekalibrering af konstanterne
- **KORRIGERET af Fase 1-simuleringen (6/8):** den oprindelige antagelse ("raceLoad alene er for lav, skal skaleres op") byggede på en modelleringsfejl i den gamle K3-sim (rest-intensitetens −14 blev lagt oven i løbsdage). Med korrekt D1-semantik er **raceLoad ×1,0 (uændret) + recoveryFraction 0,13→0,15** tilstrækkeligt: begge kohorter lander i 40-60-båndet, G2/G3 bestået, robust på tværs af nuværende kalender og K-B. Fase 2 finjusterer omkring frac ≈0,14/base ≈4,5 for at centrere human-medianen (sidder på 60-grænsen). Se #3459 Fase 1-scorecardet.
- Etapeløb SKAL kunne skubbe ryttere over 70 (design-intentionen: kun spidsbelastning straffer) — kalibreres eksplicit mod flerdages-serier.

### D4 — AI følger PRÆCIS samme regler
- `aiRecoverySweep.js` (#3015-særtilfældet) NEDLÆGGES. AI-hold får standard-træningsplaner og kører gennem samme `dailyTrainingEngine` + D1-gate som menneskehold. Én motor, nul asymmetri — fjerner både "AI altid træt" (før 3/8) og "AI aldrig træt" (nu) ved roden.

## 3. Success-kriterier (28-dages sim mod ægte population, FØR ship)

| # | Kriterium | Mål |
|---|---|---|
| G1 | Median-fatigue efter 28 dage, menneske OG AI hver for sig | begge i 40-60 |
| G2 | Andel ≥70 (straf-tærsklen), uden for etapeløbs-klynger | <15 % pr. kohorte |
| G3 | Etapeløbs-spids: ryttere i 3+ dages serier rammer >70 undervejs | ja (design-intention bevaret) |
| G4 | Udviklingstempo for aktivt racende ryttere (evne-vækst/uge) | ≥ i dag (racing må ikke nerfe progression) |
| G5 | Ingen managers træningsplan muteres af motoren | 100 % (kode-invariant + test) |
| G6 | Skadesfrekvens | ±20 % af i dag (injuryFatigueFloor-samspillet re-måles) |

## 4. Verifikationsskridt før implementering

- **V1:** Kortlæg den NUVÆRENDE kobling løbsdeltagelse→udvikling i koden (giver racing i dag nogen evne-vækst? risiko for dobbelt-kredit med D2). Resultatet bestemmer D2's præcise indkobling.
- **V2:** Udvid `fatigueSimulation2650.js` til fuld løbsdags-model (D1-D4) + etapeløbs-scenarier; parameter-sweep for D3.
- **V3:** UI-flow: kalender/træningsside viser løbsdags-erstatningen tydeligt (mockup til ejer FØR byg, jf. vis-visuelt-reglen).

## 5. Faser

1. **Fase 1:** V1+V2 (read-only) → parameter-anbefaling + sim-scorecard til ejer-godkendelse.
2. **Fase 2:** D1+D3+D4 i én PR (motor-ændringen), D2 i søster-PR (udviklings-koblingen) — begge med sim-bevis i PR-body. Kill-switch pr. #3448-mønster: gammel adfærd bag flag indtil verificeret.
3. **Fase 3:** Hjælpetekst (en+da) om restitution/løbsdage opdateres; #2402 lukkes med ærligt svar; patch note.

## 6. Risici og fravalg

- **Udviklings-balancen** er det følsomme punkt (G4): D2 kalibreres mod #1137/#2262-kæden så race-stimulus ikke bliver en gratis progressions-boost for dem der spammer løb — 1 rytter = 1 løb/dag-invarianten (låst, alle tiers) begrænser naturligt.
- **Fravalgt:** K4′-bogholderi (fup, ejer 6/8) · K3 rå (overskyder) · at røre managerens planer i nogen form.
