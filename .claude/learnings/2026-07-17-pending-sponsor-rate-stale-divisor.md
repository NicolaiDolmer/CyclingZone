# Postmortem · 2026-07-17 · Pending sponsor-rate fryser med gammel kalender-divisor

## Hvad skete der?
`generateOffers` (#1663) deler den ikke-garanterede del af sponsor-target med
`calendarDays` (=`seasons.race_days_total`) for at udlede `perRaceDayRate`. Da
#2512 rettede den hardcodede divisor fra 60 til den rigtige sæson-kalender
(nu 28), regenererede alle NYE tilbud sig korrekt on-demand — men allerede
valgte tilbud var frosset i `sponsor_contracts`-rækker med status `pending`
(skrevet af `acceptOffer`). Ved sæsonskifte flippede `expireAndRenewContracts`
disse pending->active uden at genberegne raten. 60 pending-rækker (59 fra
FØR #2512 + 1 EFTER) ville have aktiveret med en per-dag-rate ~2× for lav ift.
tilbuddets implicitte target, fra sæson 2.

## Root cause
Raten beregnes ÉN gang ved PICK-tidspunktet (`acceptOffer`) ud fra den
calendarDays der gælder DER — men pick sker altid under den FORRIGE sæson for
den KOMMENDE sæsons kontrakt, så pick-tidspunktet kan strukturelt aldrig kende
den kommende sæsons faktiske kalenderlængde. `expireAndRenewContracts`
(`backend/lib/sponsorContractsService.js`) behandlede aktivering som en ren
status-flip uden at revalidere den frosne rate mod ny data.

## Fix
`backend/lib/sponsorContractsService.js` — `expireAndRenewContracts`: ved
pending->active matches pending-rækken (`length_seasons` + `guaranteed_base`,
som er invariant over `calendarDays` — kun `perRaceDayRate` afhænger af
divisoren) mod friskt genererede tilbud for den nye sæson (samme teknik som
`getNegotiationState` bruger til `pendingVariant`-aflæsning). Hvis den
matchede rate afviger fra den frosne, opdateres `per_race_day_rate` i samme
update som status-flippet. Ingen migration — retter sig selv deterministisk
ved sæson 2-skiftet (seed `teamId:seasonNumber` er tabsfrit).

Test: `backend/lib/sponsorContractsService.test.js` — to nye tests låser at
(a) aktivering genberegner raten når den er stale, og (b) IKKE rører payload'en
når raten allerede matcher.

## Forhindret-fremover
Mønstret "beregn en afledt værdi ved pick-tid, brug den ved en SENERE
begivenhed" er strukturelt sårbart hver gang den afledte værdi afhænger af
data der kan ændre sig imellem de to tidspunkter (her: sæson-kalenderen).
Fremover: enhver frossen/cachet afledt værdi der aktiveres/materialiseres ved
en senere event bør revalidere mod aktuel data ved AKTIVERINGS-tidspunktet,
ikke kun ved skrive-tidspunktet — særligt ved sæsonskifter, hvor "den nye
sæsons facts" per definition ikke eksisterede da valget blev truffet.

## Læring
Guaranteed_base afhang IKKE af calendarDays, kun perRaceDayRate gjorde —
denne invarians gjorde det muligt at matche/genkende den valgte variant uden
at gemme varianten eksplicit på rækken. Når man designer en "match mod
regenererede kandidater"-genkendelse (i stedet for at persistere en enum),
tjek eksplicit hvilke felter er invariante over den akse der ændrer sig, og
match kun på dem.
