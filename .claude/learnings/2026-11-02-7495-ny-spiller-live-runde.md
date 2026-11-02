# Postmortem · 2026-11-02 · Et nyt hold så forkert info fem steder (live-runde med testkonto, #7495)

## Hvad skete der?
En live-gennemgang som helt nyt hold (testkonto oprettet i sæson 5) fandt fem flader, der viste forkert info til nye spillere: "Dit første løb" pegede på et løb 9 dage frem og sagde "udtagelse gemt" med 0 ryttere (#7502), bestyrelseskortet sagde "Planen er udløbet" og "overgået 100 %" (#7507), planlægningen sagde "stillede ikke op" om et løb der startede før holdet fandtes (#7518), "Sæt dag" nævnte løb holdet ikke var med i (#7505), og to tekster nævnte "sæson 1" og "din første rytter" (#7513). Derudover stod 20.614 "Holdudtagelse mangler"-advarsler ulæste for løb med ryttere (#7508), og 2 frigivne akademiryttere var strandet (#7488).

## Root cause
Samme klasse flere steder: koden antog et hold, der har eksisteret siden sæson 1 og har historik.
- `orderedSelectableRaces` sorterede efter den statiske PCM-dato (`pool_race.date_text`), ikke `races.scheduled_for`.
- `isExpired = negotiation_status === "pending"`: "pending" betyder både "udløbet" og "aldrig underskrevet".
- `did_not_start` brugte "ikke i startfeltet" uden at spørge, om holdet fandtes ved start.
- `loadTodayRacesForTeam` tog alle puljens løb uden at se på holdets trupper/tilmeldinger.
- Notifikationer, der beder om handling, blev aldrig markeret løst, når handlingen skete.

## Fix
PR #7504, #7509, #7520, #7506, #7510, #7514, #7499 (+ data: 20.614 notifikationer, 2 ryttere, begge med backup). Patch notes 7.393/7.394.

## Forhindret-fremover
- Live-runde som NY spiller (testkonto "Turbo Tester") er nu fast del af #7495-rytmen; nye hold er den flade, ingen udvikler ser til daglig.
- Tests for "nyt hold"-scenariet er tilføjet i firstRaceCardModel, planningDidNotStart og boardCopy.
- Tilstande der dækker to betydninger (pending) skal adskilles ved kilden, ikke ved hver visning.
- En "handling mangler"-notifikation skal have en rydningssti i samme PR, som opretter den.

## Læring
Det billigste fund-værktøj i dag var at oprette et hold og se siden med nye øjne; 7 reelle fejl på ~2 timer. Kør det ved hver større ændring af onboarding, bestyrelse, planlægning og indbakke.
