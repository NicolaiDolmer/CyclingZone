# En plausibel konstant skjulte et manglende argument i 3 uger

**Dato:** 2026-07-23 · **Issue:** [#2796](https://github.com/NicolaiDolmer/CyclingZone/issues/2796) · **PR:** [#2801](https://github.com/NicolaiDolmer/CyclingZone/pull/2801)

## Hvad var galt

Bekræftelses-dialogen for at rykke en akademi-rytter op i senior-truppen viste
**161 CZ$** som "Senior-løn" — for *enhver* rytter, uanset talent, alder eller
division. Tallet stod fed og centralt i den ene dialog der findes netop for at
gøre konsekvensen tydelig før et irreversibelt valg.

## Rodårsag: to uafhængige defaults der begge så rimelige ud

```js
// AcademyPage.jsx (før)
newSalary: projectSeniorSalary(rider),        // ← ingen { division }
```

```js
// marketValues.js
function salaryFromProduction(rider, division) {
  const cpv = Number(rider?.current_production_value);
  const base = cpv > 0 ? cpv : RIDER_BASE_VALUE_FALLBACK;   // ← 1000
  return Math.max(1, Math.round(base * salaryRateForDivision(division)));
}                                             // ← ukendt division → global 0,1606
```

To fallbacks ramte samtidig:

1. `division` blev aldrig sendt med, selvom `useAcademy` **eksponerede** den
   (tilføjet i #2594 netop til dette formål) — `AcademyPage` destrukturerede den
   bare aldrig. → global sats 0,1606 i stedet for fx 0,3029 i division 1.
2. `current_production_value` var ikke med i `/academy/me`-selecten. → base
   faldt til `RIDER_BASE_VALUE_FALLBACK` = 1000.

1000 × 0,1606 = **161**. Et velformet, plausibelt lønbeløb.

## Hvorfor det overlevede

- **Ingen exception, intet log, ingen Sentry-støj.** Begge fallbacks er
  bevidste, dokumenterede defaults — designet til free agents uden hold. De
  gjorde præcis hvad de skulle; de blev bare anvendt i en kontekst hvor begge
  inputs *burde* have været kendte.
- **Tallet så rigtigt ud.** 161 CZ$ er ikke absurd. Havde fallbacken været 0,
  `NaN` eller `-1` var det opdaget med det samme. En plausibel værdi er
  farligere end en åbenlyst forkert.
- **Konstant på tværs af rækker er kun synligt hvis man ser to.** Dialogen viser
  én rytter ad gangen. Man skal promovere to forskellige ryttere i træk *og*
  huske det første tal for at opdage det.
- **AcademyPage havde nul tests.** RidersPage har fire; holdsiden har en
  `fields.test.js` der netop asserter at felter ikke falder ud af en select.
  Akademiet havde ingen af delene.

## Hvad vi gjorde

- `division` sendes med; `current_production_value` tilføjet til roster-selecten.
- Ny `AcademyPage.contract.test.js` asserter *begge* led: at backend-selecten
  bærer feltet, og at kald-siden sender divisionen:
  ```js
  assert.match(pageSource, /projectSeniorSalary\(rider,\s*\{\s*division\s*\}\s*\)/);
  ```

## Læring

**En default der er rigtig ét sted er en fejlkilde et andet.** `salaryFromProduction`s
fallbacks er korrekte for free agents og forkerte for en ejet akademirytter — men
funktionen kan ikke se forskel. Når en funktion har en "ukendt input"-gren, så
spørg ved hvert kald-site: *kan dette kald-site overhovedet ramme den gren, og
hvad ser brugeren hvis det gør?*

**Backwards-check (jf. [[feedback_backwards_check_forward_guard]]):** kig efter
andre kald af `projectSeniorSalary`/`projectYouthSalary`/`getRiderSalary` uden
`division`. Demote-dialogen på holdsiden er den oplagte nabo — den er ikke
verificeret i denne omgang og bør tjekkes.

**Forward-guard:** en side der viser tal fra en backend-select skal have en
kilde-tekst-test der binder de to sammen. Det er billigt (ingen React-render) og
fanger præcis den klasse hvor et felt falder ud af en select og efterlader en
tom celle eller en fallback-konstant.

**Symptomet at kigge efter:** *samme værdi på tværs af rækker der burde variere.*
Det er signaturen på en fallback der er blevet den primære sti.
