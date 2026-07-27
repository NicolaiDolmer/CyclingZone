# Postmortem · 2026-07-27 · Bonus-sprint placeret midt på stigninger (#3048)

## Hvad skete der?
Discord-rapport (#feedback-and-ideas, 25/7): en mellemsprint (grøn prik) lå visuelt
oven på en stigning på flere Hauts Plateaux-etaper. Verificeret mod prod: 137 af 1148
`race_stage_profiles`-rækker i S2 (100 distinkte løb, ud af 776 mellemsprints totalt)
har mellemsprintens km inden for et kategoriseret klatresegment. Hauts Plateaux etape
3 og 7 reproducerede; etape 5 (nævnt i rapporten) var en falsk positiv — sprinten der
lå tæt på toppen af "Col de Saint-Roch" var faktisk 1 km inde på nedkørslen, hvilket
er tilladt per fixet.

## Root cause
`buildSprints()` i `backend/lib/raceRouteGenerator.js` trak mellemsprintens km
udelukkende som en distance-fraktion (`40-65%` af etapen) uden nogensinde at kigge på
`climbs`-arrayet, der allerede var bygget for samme etape. Da klatresegmenter typisk
også ligger midt i etapen, var overlap ren tilfældighed — ca. hver 6. mellemsprint på
tværs af hele S2-kalenderen ramte en stigning.

## Fix
`backend/lib/raceRouteGenerator.js`: `buildSprints()` tager nu `climbs` som parameter;
ny `clampSprintKm()` flytter kun en mellemsprint der lander inden for
`[crest_km - length_km, crest_km]` for en stigning — foretrækker nedkørslen (crest+1km),
falder tilbage til lige før foden. Ingen ekstra rng-forbrug (deterministisk ud fra
allerede-trukne climbs) → sectors-strømmen er upåvirket. KOM-passager (climbs) er
urørt — de SKAL fortsat ligge på stigninger.

## Forhindret-fremover
Ny invariant-test i `backend/lib/raceRouteGenerator.test.js`: "mellemsprint ligger
aldrig inden for et klatresegment" — kører 300 genererede etaper på tværs af
terræntyper/finaler og assert'er ingen overlap. Fanger regression hvis nogen
genindfører distance-only placering.

## Læring
En placeringsalgoritme der trækker ÉN egenskab (km) uafhængigt af en anden allerede
genereret egenskab (climbs) på samme etape er en klassisk kilde til "tilfældigt
overlap"-bugs — når to uafhængige tilfældige placeringer deler samme værdirum
(her: 0-distance_km), er kollision ikke en outlier, det er en sandsynlighed man skal
regne på. Tjek altid om en ny genereret egenskab skal være bevidst om allerede
genererede egenskaber på samme entitet, før man antager uafhængige træk er sikre.
