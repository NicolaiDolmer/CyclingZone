# L1 mod knaphedsmålene er blindt for identitet — og otte porte kunne ikke fejle

**Dato:** 2026-08-10 · **Kontekst:** #3570-natbølgen, valg af hvad ryttertypen skal fryses på ·
**Fundet af:** den samlede kritiker, efter at fire spor havde rangeret kandidater på L1

## Hvad der skete

Hele #3570-materialet rangerede fryse-kandidater efter **L1** — summen af absolutte afvigelser
mellem den resulterende type-fordeling og ejerens knaphedsmål. Det er et rimeligt mål for
*fordeling*, og det blev brugt som mål for *identitet*.

Kritikeren permuterede de tildelte typer mellem ryttere: identiteten blev revet af, fordelingen
bevaret. **L1 rørte sig 0,0** (F4 104,9 → 104,9; tildelingen 7,9 → 7,9), mens pasnings-rangen
kollapsede fra 3,89 til 4,72 og 3,65 til 4,50.

Konsekvensen var reel: en kandidat der gav hver rytter et **rent terningkast** fra målfordelingen
scorede L1 4,4 og slog dermed alle metoder der faktisk forsøgte at genfinde rytterens ægte anlæg.
Nattens første hovedanbefaling byggede på det og var forkert — den ville have tredoblet det
spillervendte chok for noget der ikke kunne skelnes fra en terning.

## Reglen

**Et fordelings-mål kan aldrig alene afgøre et identitets-spørgsmål.** Måler du "rammer vi den
rigtige sammensætning", så mål ved siden af det "får den enkelte det rigtige" — med mindst ét
mål der har ægte ground truth, og mindst ét der falder til tilfældigheds-niveau under permutation.

I denne sag var de brugbare: **pasnings-rang** (hvor højt ligger den tildelte type på rytterens
egen score-liste, 1-8, tilfældighed = 4,5) og **ground truth** mod de ryttere hvor det ægte
anlæg findes (tilfældighed = 12,5 %).

## Otte porte kunne ikke fejle

Samme runde afslørede at otte af materialets porte var identiteter, ikke evidens. Værd at kende
som mønster, fordi syv ud af otte spor rapporterede mindst én af dem som "bestået":

| Port | Hvorfor den ikke kan fejle |
|---|---|
| "0 gulv-brud" | `buildCapsForRider` returnerer `clamp(max(tapered, current), 0, 99)` — loftet kan pr. konstruktion ikke komme under evnen |
| "T4 frossen = 0,00 %" | `predictBaseValue` læser `valuation_type` FØR `primary_type`, og den er frosset (#3345). Giver 0,00 % selv for "frys alle som baroudeur" |
| "0 drift med fast identitet" | `resolveRiderTypes` returnerer draw'ets primær pr. konstruktion. Et absurd draw driver også 0 |
| "F0 skifter 0 typer" | F0 **er** reklassifikationen (rammer persisteret type 8.196/8.199) |
| L1 som identitetsmål | se ovenfor |
| F4's konfidens i segment B | median 1,000, men entropi 1,16 bit af 3 — modellen er sikker på et degenereret træk |
| "alle L1 0,0" ved kvote-tildeling | kvote-bibetingelsen, ikke en måling |
| pasnings-rang for F4-argmax | kroner argmax med 1,00 pr. konstruktion |

**Modtesten der virker:** før en port tælles som bestået, konstruér en tilstand hvor den *burde*
fejle, og vis at den gør det. Repoet har allerede mønsteret i `scripts/gateMutationAudit.js` —
det bør bruges på nye porte, ikke kun på launch-gates.

## Hvad det ændrede i beslutningen

Med pasnings-rang og ground truth som supplerende mål vendte rangordenen: den kandidat der så
bedst ud på L1 (fordeling næsten perfekt) faldt til plads 5, og den der beholdt rytterens ægte
anlæg hvor det fandtes gik til plads 1 — til en femtedel af det spillervendte chok.

Refs #3570 #3564
