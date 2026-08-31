# Kadencen flyttede serveren, men ikke varslet spilleren læser (#4419)

**Dato:** 31/8-2026 (natbølge, spor "Rettelse efter review: PR #4421")
**Issue:** [#4419](https://github.com/NicolaiDolmer/CyclingZone/issues/4419) · **Relateret:** #4004, #3448

## Rod-årsag

PR #4421 flyttede søndagens værdi-genberegning fra kl. 22 til kl. 06 og skrev
samtidig sin egen learning om at gribe kadence-ændringer bredt. Reglen den skrev
lød `grep -rn "<funktionsnavn>" backend/`. Den blev fulgt præcist, og derfor
blev `frontend/src/lib/auctionValueUpdateWindow.js` aldrig set: den indeholder
ikke funktionsnavnet, den indeholder **tallet** (`VALUE_UPDATE_HOUR = 22`), og
den ligger uden for `backend/`.

Konsekvens: #4004-varslet i bud-bekræftelsen ("denne auktion lukker efter
søndagens værdi-genberegning") regnede stadig med søndag kl. 22. En auktion der
lukker søndag kl. 12 fik derfor intet varsel, selvom værdierne reelt havde
flyttet sig kl. 06 samme morgen. Reviewet målte 505 af 4.501 historiske
auktioner i det hul, altså 11,2 %. Fem tests hardkodede 22:00 og holdt den
forældede værdi grøn.

Samme review fandt en anden fejl af beslægtet type: da pipelinen fik sit eget
job, arvede den ikke længere trænings-sweepens 5-minutters retry. Claimet blev
taget før mutationen og aldrig frigivet ved fejl, så ét statement-timeout ville
have kostet en hel uges værdiopdatering i stedet for fem minutter. Begge fejl
har samme form: **noget der virkede fordi det lå et bestemt sted, mistede den
egenskab ved at flytte, uden at nogen skrev egenskaben ned.**

## Fix

- `VALUE_UPDATE_HOUR` sat til 6, kommentarer og fem tests rettet.
- Ny `auctionValueUpdateWindow.parity.test.js` importerer backendens
  `SUNDAY_VALUE_FROM_HOUR` direkte og kræver at de to tal er ens. Frontenden kan
  ikke bundle backend-kode, så tallet må stå to steder, men det må ikke kunne
  drifte i tavshed.
- Fejlet v4-refresh frigiver nu dagens claim, springer markedsblendet over og
  lader næste times tick køre hele den ordnede pipeline forfra.
- Ny `backend/valueWriteEntrypoints.test.js`: statisk vagt der scanner hele
  `backend/` og kræver at de værdi-skrivende funktioner kun importeres af
  søndags-jobbet. Verificeret ved at lægge en probe-fil ind med importen og se
  testen blive rød.

## Læring

**Når du flytter en regel, så flyt også alt der kender reglens tal.** Et
funktionsnavn er kun én af de måder en regel lækker ud i kodebasen på. De andre
er konstanter, klokkeslæt i copy, hardkodede forventninger i tests og
kommentarer der forklarer den gamle sandhed. Grep efter tallet og efter vinduet,
i hele repoet, ikke kun efter funktionen i den mappe du står i.

**Og spørg hvad det gamle sted gav gratis.** En mutation der flytter fra en
sweep til sit eget job, mister værtens retry-kadence, værtens feature-flag og
værtens tidlige returns. Hver af dem er et valg når man flytter — skriv
eksplicit ned hvilke der følger med, og hvilke der bevidst ikke gør. Her fulgte
`daily_training_enabled` med (ejerens nødbremse skal ikke blive smallere), mens
`no_active_season` bevidst ikke gjorde (sæson-ankeret er korrekt uden den siden
cutover-fixet 23/8).
