# Postmortem · 2026-07-25 · academy promote() overskrev en eksisterende kontrakt

## Hvad skete der?
Discord #bugs (thelamba, 24/7): en rytter med 3 resterende kontraktsæsoner der
blev sendt i akademiet og senere promote't tilbage, endte med kun 2 sæsoner
tilbage + en ny (genberegnet) løn. #2881.

## Root cause
`backend/lib/academyTransfer.js` `promote()` skrev ubetinget en ny kontrakt på
HVER kald (`salary`, `contract_length = DEFAULT_ACQUIRE_LENGTH (2)`,
`contract_end_season`) i stedet for at bruge den delte
`contractOnAcquirePatch`-gate (#1309: "eksisterende kontrakt arves uændret —
regenerér ALDRIG"), som alle andre erhvervelses-paths (auktion, transfer,
swap) allerede brugte. Fordi enhver akademi-rytter ALTID har en akademi-
kontrakt (3 sæsoner, sat af enten `finalize_academy_acquisition`- eller
`demote_rider_to_academy`-RPC'en) inden promote, ramte bugget praktisk talt
hver eneste promotion.

## Fix
`promote()` (academyTransfer.js:69-77) genbruger nu
`contractOnAcquirePatch(rider, seasonNumber, { division })` — samme gate som
resten af kodebasen. `{}` hvis `rider.salary != null` (kontrakten røres slet
ikke); kun kontraktløse ryttere (fx en fejlfri fremtidig sti) får en frisk
standard-kontrakt. Commit 066a36c4, PR for #2881.

## Forhindret-fremover
Regressionstest i `academyTransfer.test.js` ("#2881 — eksisterende kontrakt
(3 sæsoner) overlever UÆNDRET, kun is_academy flipper") låser fast at
`riderUpdates[0]` KUN indeholder `{is_academy: false}` når rytteren allerede
har en kontrakt.

## Læring
Enhver ny "flyt rytter mellem tilstande"-funktion der rører `riders`-rækken
skal eksplicit tjekkes mod #1309-kontrakt-invarianten FØR den skriver
salary/contract_*-felter — invarianten er ikke selvhåndhævende bare fordi
`contractOnAcquirePatch` findes; den skal aktivt genbruges ved hver ny
skrive-sti, ellers gentager mønstret sig (auktion/transfer/swap gjorde det
rigtigt fra start, men promote() blev tilføjet senere uden samme review).
Data-siden af skaden var IKKE rekonstruerbar for løn (ingen kolonne-historik
på `riders.salary`) — kun kontraktlængde/udløbssæson kunne repareres
deterministisk, fordi akademi-kontraktlængden er en fast konstant
(`ACADEMY.CONTRACT_LENGTH = 3`). Overvej en let audit-log på kontrakt-
mutationer (før/efter) hvis flere af disse dukker op — uden den er skade fra
denne bug-klasse kun delvist reversibel.
