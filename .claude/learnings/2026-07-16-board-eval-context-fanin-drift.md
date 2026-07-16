# Board: context-drift på fan-in — delt motor, håndbyggede contexts (#2469)

**Dato:** 2026-07-16 · **Issue:** #2469 (bug 1) · **Forudgående:** #2308, #2307, #1830, #979

## Symptom

`/board/request` (forhandlings-afgørelsen) beregnede bestyrelses-scoren på et
andet grundlag end det `/board/status` netop viste spilleren: `relative_rank`
pinnedes til `awaiting_data` (0.6) og results-competitiveness-gulvet kollapsede
til 0. Seks rigtige spillere brugte forhandlingen 26.–30/6; to fik `rejected`.

## Rod-årsag

Én delt motor (`calculateBoardPerformance`), men hvert kaldested håndbyggede
sit eget `context`-objekt. #2308 rettede tre stier ved at kopiere de manglende
felter ind — men lukkede ikke bugKLASSEN: den fjerde sti (`/board/request`)
manglede stadig `isFinalSeason` + hele `loadGoalContextForBoard`-blokken
(`divisionManagerCount`/`divisionTeamCount` m.fl.). Fælden blev forværret af
modsatte defaults for samme felt i samme fil (`boardGoals.js`: `evaluateGoal`
defaulter `isFinalSeason = true`, `evaluateGoalProgress` → `false`).

## Fix (strukturel lukning, ikke en fjerde kopi)

`buildBoardEvalContext()` (boardGoalContext.js) — én delt bygger som alle
stier kalder: /board/status, /board/request, weekend-finalization, season-end
+ admin-season-end-preview. Ny kontekst-parameter tilføjes nu ét sted.
Forward-guard: `boardEvalContext.test.js` source-scanner alle stier.

## Læring

- **Fan-in-drift fikses ved kilden, ikke pr. kaldested.** Når N kaldesteder
  bygger samme input-objekt til én delt motor, er "kopiér de manglende felter
  ind" (#2308) et symptom-fix — sti N+1 arver ikke rettelsen. Uddrag byggeren.
- **Modsatte defaults for samme felt i samme fil er en tidsindstillet fælde** —
  et manglende context-felt betyder "ja" ét sted og "nej" et andet.
  (`evaluateGoal:742` vs `evaluateGoalProgress:895` består; ensretning mod
  `false` er kortlagt i #2469 men holdt ude af dette fix, da eksisterende
  tests låser default-true-semantikken for direkte kald.)
- **Source-scan-forward-guards virker begge veje:** #2308's guard låste det
  gamle inline-mønster og fangede (korrekt!) denne refaktor — opdatér guards
  til at låse invarianten, ikke implementeringen.
