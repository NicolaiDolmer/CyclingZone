# Postmortem · 2026-07-27 · Peak-assistenten regnede alder på wall-clock (#3081)

## Hvad skete der?
Season Planner-assistentens peak-forslag (#2455) tildelte kun ét peak-vindue
til 121 ryttere på ægte hold der reelt skulle have to. Ingen spiller
rapporterede det — fundet i forarbejdet til #2905. Samme fejlklasse som #3071
(frontend), men i backend, og med en anden konsekvens: den ændrer ikke bare
hvad der VISES, den ændrer hvad assistenten faktisk PLANLÆGGER.

## Root cause
`backend/lib/peakSuggestions.js`'s `ageFromBirthdate(birthdate, todayDateString)`
regnede alder som `todayYear - birthYear` (wall-clock-året). Kanonisk
backend-alder er `riderProgressionEngine.ageForSeason(birthdate, seasonNumber)`
= `LAUNCH_REFERENCE_YEAR + (seasonNumber − 1) − fødselsår`. De to formler er
identiske i sæson 1 (launch-året), men fordi sæson-cutover ikke sker på
nytår, driftede wall-clock-året fra sæson-året allerede i sæson 2 — en rytter
der reelt fyldte 23 (voksen-loft) blev stadig regnet som 22 (ungdoms-loft),
og `suggestedPeakCount` delte forkert ved `YOUNG_AGE_THRESHOLD = 23`.

## Fix
`backend/lib/peakSuggestions.js`: fjernede `ageFromBirthdate` helt (var
ubrugt uden for denne fil og dens egen test) og tilføjede en bevidst
duplikeret `ageForSeason` (samme mønster + samme begrundelse som
`squadRiskGuard.js`: en import af `riderProgressionEngine.js` ville bryde
filens dokumenterede renheds-kontrakt — den trækker DB-afhængigheder
(`supabasePagination`, `notificationService`, `node:fs`) ind i en lib der
eksplicit skal være ren og køres on-demand pr. rytter).
`suggestPeaksForRider` tager nu `seasonNumber` i stedet for `todayDateString`
(som udelukkende blev brugt til alder i denne fil — verificeret med grep før
parameteren blev fjernet). Kalderen `backend/routes/api.js` (GET
`/peak-plans/board`) sender `seasonNumber: season.number`.

## Forhindret-fremover
Ny test i `backend/lib/peakSuggestions.test.js`: en rytter født 2004 (23 år
ved sæson 2, `2027 − 2004`) skal have det voksne peak-antal, ikke
ungdomsantallet — fejlede på `main` før fixet.

Forward-guard (samme fil): scanner `peakSuggestions.js`'s kildetekst for
wall-clock-alders-mønstre (`todayYear - birthYear`,
`new Date().getFullYear()`, `getUTCFullYear() - ... getUTCFullYear()`) og
kræver at `ageForSeason` stadig findes. Scope er bevidst KUN denne fil (ikke
hele backend-træet, modsat frontends `riderAgeSeasonGuard.test.js` fra
#3078) — backend bruger legitimt wall-clock-datoer alle mulige andre steder
(scheduling, `copenhagenDateString`), så et helt-træ-scan ville give
falske positiver i stedet for signal.

## Læring
"Ren, DB-fri lib" og "SSOT-import" kan stå i konflikt — når de gør, er en
BEVIDST dokumenteret duplikat (med kommentar der peger på SSOT'en og
begrunder hvorfor der ikke importeres) bedre end enten (a) en tavs tredje
kopi af formlen, eller (b) at bryde modulets renheds-kontrakt for at DRY'e.
`squadRiskGuard.js` havde allerede etableret dette mønster for præcis samme
formel — genbrug mønsteret i stedet for at opfinde et nyt, når et nyt sted i
koden rammer samme afvejning.
