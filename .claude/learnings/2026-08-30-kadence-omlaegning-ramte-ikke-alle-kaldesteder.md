# En kadence-omlaegning ramte kun det kaldested den blev skrevet i

**Dato:** 2026-08-30 · **Issue:** [#4419](https://github.com/NicolaiDolmer/CyclingZone/issues/4419) · **Relateret:** #3448, #1364

## Hvad skete der

6/8 blev det besluttet (#3448) at rytterværdier fremover KUN skal flytte sig om
søndagen. Omlægningen blev implementeret der hvor den daglige genberegning laa:
i `trainingSweep.js`, som fik en søndags-gate.

Men `refreshChangedRiderValues` havde to kaldesteder. Det andet,
`POST /api/training/run-today` i `backend/routes/api.js`, var skrevet 25/7
under #1364 og blev ikke rørt. Det kaldte videre uaendret, enhver ugedag, for
det hold der trykkede paa "Traen i dag".

Resultatet stod i prod i 24 dage: reglen "vaerdier flytter sig kun soendag" var
sand for alle undtagen de ca. 50 hold i doegnet der traenede manuelt. For dem
flyttede vaerdien sig med det samme, og kun for deres egne ryttere. Det blev
foerst fundet fordi ejeren spurgte "er der andre tidspunkter end soendage".

## Hvorfor det ikke blev fanget

- **Ingen test daekkede reglen paa tvaers af kaldesteder.** `trainingSweep.test.js`
  testede at sweepen ikke rører vaerdier paa en ikke-soendag. Ingen test spurgte
  "kan vaerdier overhovedet aendre sig paa en tirsdag?"
- **Kommentarerne var korrekte og alligevel vildledende.** Baade
  `trainingSweep.js` og `marketValueSundaySweep.js` beskrev soendags-kadencen
  udfoerligt. `api.js`-kaldet bar stadig sin egen #1364-kommentar
  ("opdatér base_value hvis træningen hævede en evne"), som var sand da den blev
  skrevet. Ingen af de tre filer vidste om hinanden.
- **Symptomet lignede noget andet.** #4417 (spiller: "markedsværdi står uændret
  i 14 dage") peger paa den modsatte retning, saa ingen ledte efter et hul der
  gav for MANGE opdateringer.

## Reglen fremover

**Naar en beslutning aendrer HVORNAAR noget sker, saa grep efter funktionen, ikke
efter filen.** En kadence, et vindue eller en gate er en egenskab ved
MUTATIONEN, ikke ved det ene sted du tilfaeldigvis stod da beslutningen blev
truffet. Konkret:

1. `grep -rn "<funktionsnavn>" backend/ --include="*.js" | grep -v test` FOER du
   skriver gaten. Alle kaldesteder skal enten gates eller have en skreven
   begrundelse for hvorfor de ikke skal.
2. Skriv testen paa reglen, ikke paa kaldestedet: "denne mutation kan ikke ske
   uden for sit vindue" er en anden test end "dette job kalder ikke mutationen".
3. Flyt mutationen ud i sit eget modul med sin egen gate naar den har faaet en
   politik. Saa arver den ikke et vindue fra en vaert der handler om noget andet
   (her: vaerdierne arvede traeningens kl.-22-vindue, hvilket ingen havde valgt).

## Hvad der blev gjort

Vaerdi-pipelinen flyttet til `backend/lib/sundayValueSweep.js` med eget vindue
(soendag fra kl. 06, ejer-beslutning 30/8) og eget dato-claim der daekker hele
pipelinen. Kaldet fjernet fra `run-today`. `trainingSweep.test.js` udvidet med
en test der laaser at traenings-sweepen ikke rører vaerdier, heller ikke paa en
soendag inde i sit eget vindue. Kadencen + alle veje en vaerdi kan flytte sig er
nu skrevet ned i `docs/ECONOMY_RULES.md` sektion 9, saa naeste aendring har en
liste at tjekke imod.
