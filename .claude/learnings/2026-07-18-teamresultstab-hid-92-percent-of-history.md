# Postmortem · 2026-07-18 · TeamResultsTab skjulte 92% af holdets løbshistorik

## Hvad skete der?
#2466 (bølge 16/7) tilføjede et dashboard-kort "Sådan gik det for dit hold" der
altid pusher holdets seneste finaliserede løb — uanset om holdet scorede point i
det løb. Men holdprofilens Resultater-fane (`TeamResultsTab.jsx`) filtrerede
siden #824 kun pointgivende resultater (`.gt("points_earned", 0)`). Ville en
spiller klikke videre fra dashboard-kortet til fanen for at se mere om sit
holds resultater, kunne præcis det løb kortet lige havde vist være usynligt der
— især for hold i lavere divisioner, som ofte ikke scorer point.

## Root cause
`frontend/src/components/TeamResultsTab.jsx:60` (før fix) filtrerede
`race_results`-forespørgslen med `.gt("points_earned", 0)`. Verificeret mod
prod-data i #2466-auditet: kun 5.919 af 78.213 resultatrækker (7,6%) var
pointgivende — resten (92%) var strukturelt usynlige i fanen, uanset
sæsonfilter.

## Fix
Fjernede `.gt("points_earned", 0)`-filteret — fanen henter nu ALLE holdets
`race_results`-rækker. Pointgivende rækker fremhæves stadig visuelt (bold +
`text-cz-1` i stedet for `text-cz-3` i points-kolonnen). i18n-copy (subtitle +
emptyAll, en+da) opdateret til at afspejle at fanen nu viser al historik, ikke
kun pointgivende. Refs #2593 (opfølger på #2466), PR-branch
`fix/2593-teamresults-defaults`.

## Forhindret-fremover
Ingen dedikeret regressionstest tilføjet — komponenten har ikke en unit-test-fil
i dag, og at teste query-shape uden ægte Supabase-integration ville kun teste
mocket adfærd. Playwright core-smoke dækker generel rendering, ikke denne
specifikke filter-adfærd. Hvis TeamResultsTab-filtrering ændres igen, verificér
mod ægte prod-data (samme metode som #2466-auditet) i stedet for kun at læse
koden.

## Læring
En "push"-feature (dashboard-kort) og den "pull"-flade den linker videre til
(holdprofilens fane) skal dele samme synligheds-kontrakt — ellers lover push-
featuren noget pull-fladen ikke kan indfri. Når man bygger en ny indgang til
eksisterende data, tjek altid om destinationens EGNE filtre kan modsige det nye
løfte.
