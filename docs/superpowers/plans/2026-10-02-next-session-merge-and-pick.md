# Næste session: merge det færdige, byg det vigtigste (ejer-godkendt 1/10)

> Visuelt: `docs/design/mockups-traen-nu-2026-09-29/next-session-plan-2026-10-01.png`. Roadbook-kilde: Discord #roadbook 30/9 kl. 21.00-21.03 (tre indlæg) + 29/9 træningsoversigt.

## Del 0 · Roadbook-tjek (30/9-løfterne, status 1/10 eftermiddag)
| Løfte 30/9 | Status 1/10 | Handling |
|---|---|---|
| Træning torsdag: ALLE fem ting | Alle fem live i prod, men kun **beta** (ejer valgte beta først 1/10): Train now, 35 felter, prognose, træthedsregler (#5999), daglig rapport (#5915) | Beta → alle er sidste skridt på løftet. Ejer-go på flip, derefter flag-tjek + kort EN-note (ejeren poster selv) |
| Første motor-rettelser fra torsdag | #5990 live 7.327 | Ingen |
| Udbrud efter ordre, modstand, ingen tvungen dannelse | #5996 merget (slukket, låst til legacy) | GC-reaktion → kalibrering → tænd for nye løb |
| GC-reaktion med rigtig stilling | Ikke bygget | Bølge-lane |
| Specialister underpræsterer (#5957), bjergpoint på flad enkeltstart (#5956) | Under undersøgelse | #5956 i lane 4; #5957 som undersøgelsesspor |
| Ungdoms-fravalg "denne uge" (#5944) | Ikke bygget, needs-design | Skitse i morgenblok, bygning senest søndag 4/10 |
| Analyse af talentudvikling man/tir (#5965) | Ikke startet | Analyse mandag 5/10 (ikke en lovet ændring) |
| Tabt træning 28/9 (#5912), undtagelser (#5928) | Åbne | Morgenblok-kort med konkrete tal |
| "Opdaterer status når ting faktisk shipper" | | Kort EN-statusudkast når træning går til alle; ingen stor udmelding |
| Registreret uden dato: #5947 #5946 #5979 #5980 #5941 #5940 #5916 #5162 | Åbne | Rangeres efter filteret nedenfor |

## Del 1 · Merge-blok (første time, ingen nybyg)
1. Status: NOW, åbne PR'er, CI og `mergeStateStatus`. 2. Klargør: merge main ind, grøn CI + CodeRabbit, ét før/efter-billede pr. UI-PR. 3. Ét kort ad gangen, go = ordret "merge". 4. `scripts/merge-queue.ps1`, én PR ad gangen, post-verify (deploy, migration). 5. Done-flip straks, patch note samlet, NOW opdateres.

| PR | Kategori |
|---|---|
| #5993/#5994/#5995 | Luk (erstattet af #5999) |
| #5828 omdømme (lovet) | Rebase → billede → ejer-go |
| #5894 trup-advarsel (#5867) | Rebase → billede → ejer-go |
| #5829 mobil sæsonmatrix | Ejerens A/B-retningsvalg |
| #5984 motor-docs | Stående regel (docs) |
| #5827 rating dry-run | Merges ikke (ejer-gated) |

## Del 2 · Prioriteringsfilter (samme hver gang)
1. Brand (ødelægger spil/data nu) · 2. Lovet til spillerne (dato først, ældste først) · 3. Spillerrapporter (antal, påvirkning) · 4. Kerne-motorer (løbsmotor, træning) · 5. Bane 2/3. Tjek live-data + issuets seneste kommentarer før listen; låste beslutninger åbnes ikke; løfter med samme dato bygges parallelt.

## Del 3 · Bølge efter merge-blokken (4 laner, `wave.js`, brug `touches` for delte filer)
1. #5944 fravælg ungdomsløb (lovet, senest 4/10) efter skitse-go.
2. Motor Task 4: GC-reaktion (`#5984`-planen), slukket; kalibreringsrapport til ejeren.
3. #6000 træningsgrupper (mockup godkendt 1/10), beta.
4. #5820 Boardroom (lovet 26/9) + #5956 bjergpoint (spillerrapport).

Parallelt: datareparationer #5912/#5928/#5897 som morgenblok-kort, ingen kæde af prod-indgreb. MASTERPLAN er forældet (28/9) og opdateres ved close-out med ejerens go på rækkefølgen.
