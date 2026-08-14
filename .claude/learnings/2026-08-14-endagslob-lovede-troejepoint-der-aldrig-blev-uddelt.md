# Endagsløb lovede trøjepoint der aldrig blev uddelt

**Dato:** 2026-08-14 · **Issue:** [#3718](https://github.com/NicolaiDolmer/CyclingZone/issues/3718) · **PR:** [#3727](https://github.com/NicolaiDolmer/CyclingZone/pull/3727)

## Symptom

"Forventet pulje" på et endagsløb var op til 39 % højere end noget løbet kunne udbetale. Over sæson 2's kalender: 134.256 point = 10,07 M CZ$ vist til spillerne og aldrig betalt. Sæson 3's allerede genererede kalender ville have gentaget det med 8,42 M.

Ingen havde opdaget det, fordi tallet er et overslag. Der findes ingen kvittering der siger "du fik 924 hvor der stod 1.518" — spilleren ser kun to tal på hver sin flade og har ingen grund til at sammenligne dem.

## Rod-årsag

`expectedPrizeCalculator.js` deler én formel mellem to løbstyper, og de to typer har ikke de samme klassementer. Et etapeløb har point-, bjerg- og ungdomstrøje. Et endagsløb har dem ikke, hverken i spillet eller i virkeligheden. Formlen listede dem for begge.

Race-motoren har altid opført sig korrekt: målt over hele sæson 2 producerer endagsløb kun `gc` (22.133 rækker) og `team` (3.680 rækker), nul trøje-rækker. Det var kun overslaget der løj.

## Fælden jeg gik i, og som næste person også vil

Den første, indlysende rettelse var at slette trøje-rækkerne for endagsløb i `race_points`. **Den ville have været forkert og destruktiv.**

`race_points` er nøglet på `(race_class, result_type, rank)`. Der er **ingen `race_type`-dimension**. De rækker der ser ud som "endagsløbs-trøjer" er de samme rækker etapeløbene bruger, og etapeløbene udbetaler dem fuldt ud. Verificeret mod prod: et ProSeries-etapeløb forudsiger 594 trøjepoint og uddeler 594. En sletning ville have fjernet 594 point pr. ProSeries-etapeløb.

**Læringen:** når en tabel er nøglet på færre dimensioner end den bruges med, kan du ikke rette en af brugsmåderne ved at ændre data. Tjek nøglen før du foreslår en sletning. Jeg nåede at anbefale sletningen i chat før jeg tjekkede, og rettede den først da PR-arbejdet begyndte.

## Hvorfor hverken preview eller e2e fangede det

`frontend/src/preview/seedData.js` havde ingen trøje-rækker for nogen endagsløbs-klasse. Fixturen kunne derfor per konstruktion ikke vise forskellen: den gamle og den nye kode gav samme tal. En hel e2e-suite på 431 tests kørte grønt gennem hele fejlens levetid.

Det er den generelle fælde: **en fixture der mangler præcis de rækker der udløser fejlen, gør testen grøn og beviser ingenting.** PR'en tilføjede rækkerne (prod har dem), så fixturen nu diskriminerer.

## Forward-guards der landede

1. `SINGLE_RACE_RESULT_TYPES.finals` er `["Klassiker", "KlassikerHold"]` med en kommentar der forklarer hvorfor et trøje-klassement aldrig må tilføjes uden at motoren kan uddele det.
2. `raceResultsEngine.RESULT_TYPE_TO_RACE_POINTS.single` har mistet `points`/`mountain`/`young`. Mappingen var ubrugt, men var en åben dør: begyndte simulatoren at emitte dem for et endagsløb, blev de betalt uden en beslutning.
3. Tre tests, hvoraf **modstykket er det vigtigste**: fjerner man trøje-rækkerne fra fixturen skal et etapeløb flytte sig præcis 178 point. Uden den kunne fixet overkorrigere og stille slukke for etapeløbenes trøjer.

## Beslægtet

[#2818](https://github.com/NicolaiDolmer/CyclingZone/issues/2818) er samme tema på en anden flade: rute-grafen viser "AT STAKE"-bjerg- og spurtpoint på endagsløb, som passage-laget aldrig beregner fordi det er gatet på `isStageRace`. To uafhængige steder hvor etapeløbs-logik er blevet delt med endagsløb uden at nogen har spurgt om klassementerne findes. Værd at lede efter et tredje.
