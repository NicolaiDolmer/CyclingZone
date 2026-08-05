# Dashboardets "Seneste resultater" var det sidste sted et løb ikke var klikbart (#3373)

**Dato:** 2026-08-05
**Issue:** [#3373](https://github.com/NicolaiDolmer/CyclingZone/issues/3373) (spillerrapport, Discord #dansk-snak 4/8, @smukkethomsen)

## Symptom

"Løbene under seneste resultater under dashboard linker ikke." Rapporteret fra mobil,
dagen efter patch note-opsamlingen lovede at "race cards are clickable everywhere".

## Rod-årsag

`DashboardPage.jsx`s recentResults-modul rendrede løbsnavnet og vinder-underteksten
som to `<p>` i en ikke-interaktiv `<div>`. Vinderen ved siden af var et `RiderLink`,
så rækken SÅ klikbar ud og var det halvt: alt det der handlede om rytteren virkede,
alt det der handlede om løbet var dødt.

Ingen regression. Modulet blev bygget i #1005 før `RaceLink` fandtes (#2526/#3187),
og de senere "gør løb klikbare"-runder ramte rytterprofilen (#2526) og
Planlægnings-hubbens løbskort (#3187) uden at nogen gik tilbage over dashboardet.
"Everywhere" i patch noten var en påstand om intention, ikke en måling.

## Fix

Venstre celle er nu ét hit-target via `RaceLink` (ægte `<a>`, tastatur-fokus + Enter),
præcis som løbskortenes header i #3187. Vinderen forbliver sit eget `RiderLink`:
et link i et link er ikke tilgængeligt (samme grænse som `RaceResultCard` på
Resultat-hubben).

Etapevinder-rækker på et etapeløb deep-linker til `?stage=N` (samme kontrakt som
rytterprofilens etape-rækker, #2526); gc-vindere og endagsløb til `/races/:id`.
Reglen bor i en ren `recentResultStage()` med unit-tests, ikke i JSX.

## Læring

**"Klikbart overalt" er en måling, ikke en påstand.** Når en tværgående kvalitets-
runde (løb skal være klikbare) erklæres færdig, skal den have en liste over ALLE
flader der viser den entitet - ellers finder spillerne det sidste hjørne.
Backwards-check-reglen fandtes; den blev bare aldrig kørt mod dashboardet.

**Halvt klikbare rækker er værre end helt ikke-klikbare.** Rækken havde ét link
(rytteren), så affordancen sagde "denne række er interaktiv" mens det element
brugeren sigtede efter (løbsnavnet) ikke var det. Det er samme fælde som #3187
(129 dødeklik på 6 minutter i Clarity).

## Forward-guard

`frontend/tests/e2e/dashboard-recent-results-deadclick.spec.js` klikker det der var
dødt (vinder-underteksten og løbsnavnet) på begge løbstyper. Verificeret rød uden
fixet, grøn med, på alle 3 playwright-projekter.
