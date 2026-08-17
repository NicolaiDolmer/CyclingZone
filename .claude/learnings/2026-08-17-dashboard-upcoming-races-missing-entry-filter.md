# 2026-08-17 — Dashboard "Kommende løb" manglede tilmeldings-filter (#3751)

## Bug
"Kommende løb"-kortet på Dashboard sorterede holdets pulje-løb på den ægte
næste-etape-tid (#2328, korrekt og urørt), men filtrerede ALDRIG på om
holdet faktisk havde en tilmelding (`race_entries`-række) til løbet. Et nyt
hold der opretter sig midt i et igangværende etapeløb er korrekt holdt ude
af det løb (trup låst, `nextSelectableRace.js`/#1681/#1825) — men det
igangværende løbs snarlige næste-etape-tid vandt alligevel sorteringen, så
kortet viste en nedtælling til noget holdet ikke deltog i.

Målt i prod 14/8: 7 hold, alle oprettet 12.-14/8, ramt. Rammer præcis nye
spilleres første indtryk af spillet.

## Rod-årsag
Manglende filter, ikke forkert sortering. To forskellige dele af koden havde
allerede løst "hvilke løb kan holdet interagere med"-spørgsmålet hver for
sig: `selectableRaces` (trup-lås-status, til udtagelses-CTA'en) og
`pickUpcomingRaces` (sortering, til dashboard-kortet) — men INGEN af dem
spurgte "er holdet faktisk tilmeldt dette løb?". CTA'en fik dette gratis
(en tilmeldingsløs race kan ikke være "scheduled uden trup-lås" for et hold
der aldrig var med), men dashboard-kortet gjorde ikke.

## Fix
`filterTeamEnteredRaces(races, enteredRaceIds)` i `lib/upcomingRaces.js` —
ren funktion, filtrerer FØR `pickUpcomingRaces` sorterer/vælger top-3.
`teamRaceIds` (Set af race_id'er holdet har mindst én `race_entries`-række
i) hentes i `DashboardPage.jsx`, scopet til de løb siden allerede har
hentet (`.in("race_id", racesRes-id'er)`) for at overholde
pagination-guardens deny-liste (#3331 — `race_entries` kan i teorien
akkumulere >1000 rækker for et gammelt hold over mange sæsoner).

No-op for etablerede hold (de ER tilmeldt det igangværende løb). Et hold
uden NOGEN entries endnu falder ind i det eksisterende empty-state-mønster.

## Læring
Når to flader (CTA + kort) begge afleder "hvilke løb er relevante for
holdet" fra det samme rå datasæt, er det let at en tredje, implicit
forudsætning (faktisk tilmelding) kun bliver eksplicit ét sted og glemt det
andet. Havde `selectableRaces`/`pickUpcomingRaces` delt én kanonisk
"holdets aktive løb"-liste fra starten, ville dette ikke være sket — issuet
foreslog eksplicit at overveje en delt hjælpefunktion; vurderet og afvist
denne gang (semantisk forskellige filtre: tilmelding vs. trup-lås-status),
men værd at revurdere hvis et tredje sted får brug for samme spørgsmål.

## Relateret
#3751 (dette issue) · #2328 (kortets sortering, urørt) · #1681/#1825
(udtagelses-CTA'ens tilsvarende trup-lås-regel) · #3331 (pagination-guard)
