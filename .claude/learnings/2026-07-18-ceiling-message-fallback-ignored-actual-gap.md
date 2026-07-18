# Postmortem · 2026-07-18 · "Approaching ceiling" vist for ryttere langt fra loftet

## Hvad skete der?
Spillerrapporter på Discord 18/7 (2 spillere uafhængigt, #2645): en rytter med
evne 29 og loft 90+ fik teksten "approaching ceiling" i Udvikling-fanen. En
20-årig fik samme type besked, mens andre unge ryttere fik en helt anden
("peaks around 24-25", fra "Ceiling age"-rækken) — beskederne modsagde
hinanden på tværs af ryttere.

## Root cause
`ceilingRows()` i `frontend/src/components/rider/profile/RiderDevelopmentTab.jsx`
brugte KUN `!projection.timing` (backend fandt ingen "til loft"-ETA inden for
det viste 6-sæsons-vindue, `backend/lib/developmentProjection.js
ceilingTiming()`/`DISPLAY_SEASONS`) som eneste betingelse for at vise
"Approaching ceiling" — uden at tjekke hvor stort det faktiske gab (nu-rating
vs. loft) var. En rytter med et 60+ points gab (29 mod 90+) rammer PRÆCIS
samme "ingen ETA fundet"-gren som en rytter der reelt plateauer 2-3 point
under loftet — begge fik samme tekst.

Verificeret mod prod (Supabase, read-only SELECT + kørsel af de ægte
`buildTypeCeilingBands`/`ceilingTiming`-funktioner mod 6.670 ryttere med
caps): 2.005 ryttere (ikke past-peak, ingen ETA i vinduet) ville have vist
"Approaching ceiling" med gab langt over "nær loft" — nogle helt ned til
ratio 0.44 (fx now=19 mod ceilLo=43).

## Fix
Ny ren funktion `ceilingOutlookKey(projection)` i
`frontend/src/lib/developmentReport.js`: kun "approaching" når
`now / ceilLo ≥ 0.85` (NEAR_CEILING_RATIO); ellers en ny neutral
"gapToCeiling"-besked ("Long gap to ceiling" / "Stort spring til loftet") der
hverken låner alders-familiens ord ("peak") eller overdriver nærhed.
pastPeak-grenen er uændret. i18n-nøgle tilføjet EN+DA
(`profile.development.projection.gapToCeiling`). Test låser klassen i
`frontend/src/lib/developmentReport.test.js` (evne 29/loft 90+ ≠
"approaching"; ≥85% = "approaching"; pastPeak vinder altid). PR
`fix/2645-ceiling-message-consistency`.

## Forhindret-fremover
`ceilingOutlookKey` er nu en ren, testet funktion i stedet for inline JSX-logik
— fremtidige ændringer af "ingen ETA"-grenen tvinges gennem
`developmentReport.test.js` i stedet for kun at kunne verificeres visuelt.

## Læring
En fallback-gren ("vi fandt ikke et præcist svar inden for vinduet") er IKKE
det samme som "svaret er nej/tæt-på" — de to skal aldrig dele tekst. Når en
besked antyder nærhed/tilstand (fx "approaching"), verificér altid mod det
underliggende TAL (her: nu vs. loft), ikke mod hvorvidt en beregning lykkedes
at finde et ETA-punkt inden for et vilkårligt vindue.
