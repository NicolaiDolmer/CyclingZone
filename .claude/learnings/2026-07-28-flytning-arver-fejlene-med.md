# Postmortem · 2026-07-28 · En 1:1-flytning arvede også fejlene (#3102 etape 2)

> Skrevet 2026-08-06 som efterslæb: rettelserne landede i PR #3106, men close-out'en
> sprang postmortem-trinnet over. Læringen er generisk og gælder enhver IA-flytning.

## Hvad skete der?
#3102 etape 2 flyttede løbs-biblioteket og point-tabellerne fra `/races` til den
nye Resultat-hub. Filter-baren og tabellen blev flyttet **uændret** — bevidst, for
at flytningen ikke også skulle være en redesign. CodeRabbit fandt derefter to
fejl i den flyttede kode, hvoraf den ene havde ligget i `/races?tab=library` hele
tiden:

1. **Statusfilteret matchede aldrig "Live".** Filteret sammenlignede rå
   `races.status`, mens kolonnen viste `deriveRaceStatus(...)`. Et etapeløb i gang
   står som `scheduled` i DB og vises som `live` — så "Live" gav 0 træf, og
   "Kommende" tog igangværende etapeløb med. `RACE_STATUS_OPTIONS` havde
   tilmed værdien `active`, som `deriveRaceStatus` aldrig returnerer.
2. **Fanen fulgte ikke browserens tilbage-knap.** Fane-tilstanden lå i en
   `useState`-kopi der kun blev seedet ved mount, og `changeTab` muterede den
   `searchParams`-instans React Router ejer. Tilbage/frem mellem `?tab=archive`
   og `?tab=points` flyttede URL'en, men indholdet blev på den gamle fane.

## Root cause
Fejl 1 var **arvet, ikke indført**. Flytningen var en ren kopi, og en ren kopi
kopierer også det der var galt. Ingen læste logikken igennem undervejs, fordi
opgaven var formuleret som "flyt", ikke "flyt og gennemgå".

Fejl 2 var **indført**: `RacesPage` havde samme `useState`+mutation-mønster, og
det blev kopieret videre som "husets konvention" — selv om `FinancePage` og
`TransfersPage` allerede brugte det korrekte mønster. To konventioner i samme
kodebase, og den forkerte lå tættest på.

## Fix
- `RaceArchiveTable.jsx`: filtrerer på `deriveRaceStatus(...)`, samme værdi som
  kolonnen viser. `raceFilterOptions.js`: `live` i stedet for `active`.
- `ResultaterPage.jsx`: `tab` udledes fra `searchParams`; `changeTab` skriver via
  `setSearchParams(prev => new URLSearchParams(prev))` og muterer intet.
- Efterprøvet i preview-mock: "Live" giver 1 af 4 løb, "Kommende" 1 af 4 (før
  0 og 2); tilbage fra `?tab=points` lander på Arkiv med Arkiv markeret.

## Forhindret-fremover
- Fane-tilstand hører i URL'en. Det korrekte mønster står nu tre steder
  (Finance, Transfers, Resultater) mod ét forkert, og det forkerte forsvandt
  helt da #3102 etape 3 opløste `RacesPage`.
- Filter-input skal sammenlignes mod den værdi kolonnen **viser**. Hvor en
  visning bruger en afledning (`deriveRaceStatus`, `raceHasReportableResults`),
  skal filteret bruge samme afledning — ikke råkolonnen.

## Læring
**En "ren flytning" er ikke risikofri, den er bare ikke-diagnosticeret.** Når en
flade flyttes 1:1, følger dens fejl med til den nye adresse og ser der ud som om
de er nye — eller bliver aldrig fundet, fordi ingen har grund til at læse koden.
Enhver flytning bør derfor læse den flyttede logik igennem én gang, også når
diff'en er ren.

Beslægtet: samme etape efterlod `.eq("status","completed")` i hubbens egen query,
hvilket skjulte igangværende etapeløb indtil #3333 fandt det — se
[2026-08-04-inprogress-races-invisible-results-hub.md](2026-08-04-inprogress-races-invisible-results-hub.md).
Begge fejl har samme rod: `status` alene beskriver ikke et etapeløbs tilstand.
