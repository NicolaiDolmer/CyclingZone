# Patch noten meldte en balanceændring der aldrig blev bygget

**Dato:** 2026-08-15 · **Fundet i:** github-housekeeping-audit, Kategori K agent-verify · **Issue:** [#2699](https://github.com/NicolaiDolmer/CyclingZone/issues/2699)

## Hvad skete der

Patch note v7.112 ([PR #3617](https://github.com/NicolaiDolmer/CyclingZone/pull/3617), 11/8) fortalte spillerne:

> "Fjorten emner der blev født for stærke er sat tilbage i niveau."

PR'en ændrer én fil: `frontend/src/data/patchNotes.js`. Ingen backend-fil, intet script, ingen migration.

Ejer-beslutningen på #2699 var truffet 30/7 og lød **udskudt** — hverken option A, B eller C blev valgt. Der findes ingen senere kommentar der bekræfter en kørsel. Konverteringen af de fjorten akademi-overflow-talenter blev aldrig udført.

## Hvorfor det er værre end et brudt løfte

De øvrige 15 poster i løfte-hovedbogen er løfter om noget **fremtidigt**: "det kommer", "vi kigger på det". Spilleren venter, og ventetiden kan måles.

Denne er en melding om noget der **allerede var sket**. Spilleren har ingen grund til at vente eller spørge — han tror det er gjort. Fejlen er derfor selv-skjulende: den producerer ingen opfølgende spørgsmål i Discord, og den bliver først synlig når nogen sammenligner patch noten mod koden.

## Rod-årsag

Patch noten blev skrevet ud fra **det planlagte arbejde**, ikke ud fra det merged arbejde. Sessionen der skrev v7.112 samlede sandsynligvis punkterne fra issue-listen frem for fra diffen.

Det er samme grundfejl som [`2026-08-14-issue-markeret-done-fordi-en-pr-naevnte-det.md`](2026-08-14-issue-markeret-done-fordi-en-pr-naevnte-det.md): en påstand om leverance baseret på en *reference* til arbejdet i stedet for på arbejdet selv. Her ramte den bare den kanal hvor prisen betales af spilleren, ikke af backloggen.

## Forward-guard

Én linje i en patch note må kun beskrive noget der kan peges på i en merged diff.

Konkret ved patch-note-skrivning: for hvert punkt i noten, navngiv den merged PR eller commit der bærer det. Kan du ikke, hører punktet ikke til i noten — heller ikke i formen "er nu på plads" eller "er sat tilbage". Et punkt hvis eneste kilde er et issue eller en plan skal enten skrives om til fremtidsform med en dato, eller udelades.

Det gælder skarpest for **balance- og økonomi-punkter**, hvor spilleren ikke selv kan se forskellen på en flade: han kan aflæse en UI-ændring, men ikke om fjorten ryttere faktisk blev nedjusteret.

## Status

Ført ind i løfte-hovedbogen `docs/audits/2026-08-14-oplaas-vaerdier-og-loefter.md` som række 15; tallet gik fra 15 til 16. #2699 er kommenteret med de to veje: byg konverteringen så noten bliver sand, eller korrigér noten i en kommende patch note. Ejer-beslutning udestår.
