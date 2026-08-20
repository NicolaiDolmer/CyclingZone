# Hjælpeteksten drev fra formlen, og spillerne regnede baglæns fra den

**Dato:** 2026-08-20 · **Issues:** #3986, #3989 · **PR:** #3992

## Hvad skete der

19/8 kl. 16 eksploderede #dansk-snak i rapporter om at sæson 3-lønbudgettet var
3-5x for højt. jeppek regnede sig frem til at Hofmann og Brandt tilsammen ville
koste 550K:

> "Det er taget udefra boksen 'Sådan fungere økonomi', hvor løn er 6,7% af
> rytterens værdi"

Han citerede `finance.json` → `hint.salary`:

> "6,7% af rytterens markedsværdi pr. sæson (baseværdi plus præmiebonus)."

Den tekst havde været forkert siden **18. juli**. Løn-decouplingen (#2594) flyttede
dengang grundlaget fra `market_value × 0.067` til
`current_production_value × SALARY_RATE_PROD[division]`. Koden, testene og
scorecards fulgte med. Hjælpeteksten gjorde ikke.

I en måned lærte spillerne altså en formel spillet ikke brugte — og da prognosen
så begyndte at vise store tal, havde de en (forkert) model til at forklare dem
med. Det gjorde en kalibrerings-diskussion til en tillidskrise.

## Rod-årsag

`SALARY_RATE` (0.067) blev ikke slettet ved cutoveren; den blev efterladt som
"reference/legacy" med en kommentar. Konstanten levede videre i offline-harnesses,
og teksten der beskrev den levede videre i `finance.json`. Intet band de to
sammen: der findes en paritets-vagt mellem backendens og frontendens
løn-KONSTANT (`handheldCopyGuards.test.js`), men ingen mellem konstanten og den
PROSA der forklarer den.

Samme klasse ramte to andre steder samtidig:

- `help.json` → `faq.riderSalaryView`: "Lønnens størrelse afhænger af rytterens
  markedsværdi"
- `academyTransfer.js`'s doc-comment beskrev stadig
  `base_value × ACADEMY.SALARY_RATE`, mens funktionen kaldte `computeFrozenSalary`

## Hvad vi gjorde

- Alle tre tekster rettet i EN+DA (#3992).
- Prognosen importerer nu `computeFrozenSalary` i stedet for at have sin egen
  kopi af kurven — der er ÉN formel, så prognose og virkelighed ikke kan drive.
- `division` er fjernet HELT fra løn- og kontrakt-API'et, ikke bare gjort
  ubrugt: en parameter der stadig kan sendes er en invitation til at
  skaleringen kommer tilbage.
- Forward-guard i `handheldCopyGuards.test.js` der fejler hvis
  `SALARY_RATE_PROD` eller `salaryRateForDivision` genindføres i én af enderne.
  Negativ kontrol kørt: en injiceret konstant får vagten til at fejle.

## Læring

**Når et tal i en formel ændrer sig, så grep efter tallet i `locales/` — ikke kun
i koden.** En hjælpetekst der citerer en konkret procentsats er reelt en test
uden assertion: den påstår noget om systemet, men intet fejler når påstanden
bliver falsk.

Konkret at gøre næste gang en økonomi-konstant flyttes:

1. `grep -rn "<den gamle værdi>" frontend/public/locales/ frontend/src/data/`
   (både `6,7` og `6.7` — DA og EN formaterer forskelligt).
2. Slet den gamle konstant frem for at efterlade den som "legacy". Overlever den,
   overlever teksten der beskriver den også.
3. Overvej om prosaen overhovedet skal nævne satsen. "En fast andel af hans
   nuværende produktionsværdi" forældes ikke når andelen justeres; "6,7 %" gør.

## Bi-fund

- **Prognose-routen manglede `current_production_value` i sit select.** Uden
  kolonnen ville hver rytter tavst falde tilbage på
  `CONTRACT.BASE_VALUE_FALLBACK` og prognosen vise et velformet, plausibelt og
  forkert tal. Samme fejlklasse som #2796 og #3784 — tredje gang. Guarden mod
  den lever i `salaryProjection.test.js`.
- **Perf-gaten var rød på main selv** (926,8 KB mod 924,0-loftet) før nogen PR i
  dag. #3697's headroom fra 18/8 var spist på to dage, og #2511 (kør gaten på
  push til main) er lukket uden at driften er væk.
