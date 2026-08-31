# En forward-guard der kun kendte én stavemåde (#4455)

**Dato:** 31. august 2026
**Kontekst:** Adversarisk review af PR #4459, som deduplikerede alders-formlen i `backend/scripts/`.

## Rod-årsag

PR #4459 fjernede fire inlinede kopier af launch-referenceåret og satte en forward-guard op.
Guarden var skrevet ud fra **de forekomster PR'en selv havde ryddet op i**, ikke ud fra klassen
af måder konstanten kan skrives på. Den kendte præcis to former:

```js
const LAUNCH_REFERENCE_YEAR = 2026;   // guard 1: erklæringen
const age = 2026 - new Date(bd)...    // guard 2: årstal og fødselsdato paa SAMME linje
```

Konstanten optræder i mindst fire former mere: som objekt-property (`asOfYear: 2026`), som
default-parameter (`referenceYear = 2026`), som fallback (`|| 2026`), og som en formel fordelt
over to linjer. Resultatet:

- **22 forekomster** slap forbi i 19 filer. Fire af dem stod i filer PR'en selv redigerede, som
  dermed var halvt dedupede: de importerede allerede `ageForSeason` fra SSOT'en, men bar stadig
  årstallet inline.
- **Den femte kopi lå i den kørende backend**, ikke i scripts: `abilityDerivation.js`'s
  `CALIBRATION.asOfYear = 2026`. `deriveAbilities()` kaldes uden `asOfYear` fra `backfillCores.js`
  og `starterSquadAllocator.js`, så literalen var den faktiske default i prod. Guarden scannede
  kun `backend/scripts` og kunne per konstruktion ikke se den.
- Da guard 2 bagefter blev udvidet til `backend/lib`, fandt den straks **kopi seks og syv**
  (`balanceSnapshot.js`, `starterSquadAllocator.js`). De havde ligget der hele tiden.

Sekundært fund: SSOT'en brugte `new Date(birthdate).getFullYear()`. Dato-kun-strenge parses som
UTC-midnat, mens `getFullYear()` læser lokal tid, så vest for UTC ruller 1. januar et år tilbage.
Prod har 9 ryttere født 1/1. De gamle script-varianter (`getUTCFullYear()`, `slice(0,4)`) var
begge tidszone-uafhængige, så dedupliceringen gjorde faktisk resultatet **dårligere** end det den
erstattede. Ingen effekt i Europe/Copenhagen eller UTC, men `frontend/src/lib/riderAge.js` har den
samme formel og kører i **spillerens** browser: en manager i Amerika ville se en anden alder end
backend regnede med. Præcis divergens-klassen #3071 kostede, blot i tidszone i stedet for wall-clock.

## Fix

- Guard 1 fælder nu ethvert nøglenavn der ender på `Year`/`YEAR` sat til 2026, plus `|| 2026`.
  Seeds er eksplicit undtaget, og no-op-testen kræver at `seed: 2026` og `makeRng(2026)` IKKE fældes.
- Guard 2 fælder nu også den flerlinjede form (fødselsår i en lokal variabel, formel på næste linje)
  og scanner `backend/lib` sammen med `backend/scripts`.
- `careerCurveSimulation.js`'s fjernede `ageInSeason1` står ordret som positiv kontrol i no-op-testen,
  sammen med en assert på at en-linje-guarden IKKE matcher den, så forudsætningen ikke kan rådne ubemærket.
- SSOT'en fik `birthYearFrom()`, som læser året direkte ud af dato-kun-strenge. Frontend-kopien er
  rettet med, ellers ville de to divergere i stedet for at være ens.
- SSOT'en fik `ageForReferenceYear()`, fordi referenceår-drevne kaldere (generatorer, snapshots,
  allokatorer) duplikerede `referenceYear − fødselsår` hver for sig.

## Læring

**En forward-guard skrevet ud fra de forekomster du netop ryddede op i, bekræfter kun dit eget
oprydningsarbejde.** Den skal skrives ud fra *klassen* — hvilke former kan det her udtryk antage? —
og derefter køres mod hele kodebasen, ikke kun den mappe du arbejdede i. Kør guarden bredere end du
tror er nødvendigt, ÉN gang, og se hvad den finder. Her fandt den to kopier mere på første forsøg.

**No-op-testen skal indeholde de fjernede linjer ORDRET, ikke en parafrase.** PR #4459's no-op-test
påstod at tjekke begge regexes mod de linjer PR'en fjernede. For `careerCurveSimulation.js`'s formel
var det falsk: guard 2 matchede den aldrig. Kopien blev kun fanget indirekte, fordi dens
`const SEASON1_YEAR = 2026` faldt i alias-guarden. Havde konstanten heddet noget andet, var den
gået lige igennem en "verificeret" guard.

**Dedupliker aldrig til den variant du tilfældigvis har valgt som SSOT — tjek hvilken variant der er
rigtigst.** Her var de fire kopier tidszone-uafhængige og SSOT'en ikke. En differentialtest der kun
køres i din egen tidszone kan ikke se det: kør den mod flere tidszoner når input er en dato.

## Kontrakt-detalje værd at huske

`starterSquadAllocator.computeAge` returnerer bevidst `NaN` ved ugyldig fødselsdato, ikke `null`.
`age` bruges i numeriske gates, og `NaN <= x` er false mens `null <= x` er **true** — et mekanisk
skift til SSOT'ens null-kontrakt ville lydløst have lukket ugyldige ryttere gennem alders-gaten.
Del år-udtrækket, ikke returkontrakten.
