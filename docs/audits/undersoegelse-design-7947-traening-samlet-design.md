# Undersøgelse: #7947 R5 "I dag" mod den gamle I dag-fane (paritet)

Spor: `design/7947-traening-samlet-design`, kind: investigate (#5220). Dato: 20/11.

## Hvad der blev undersøgt

Spørgsmålet: mangler R5-skitsens I dag-fane stadig de huller, som paritetsgennemgangen 19/11 på #7947 lister (punkt 2, 3, 4, 7, 8, 9, 10 og 11)?

Metode:
- Læste kommentaren "Paritetsgennemgang 19/11 aften" på #7947.
- Søgte efter hvert hul i skitsens I dag-filer (`frontend/src/preview/sketches/7947-samlet/R5.tsx`, `R5Parts.tsx`, `r5data.ts`, `r5model.ts`, `R5TodayRowPlan.tsx`, `R5TodayDesktopPlan.tsx`, `R5TodayPlanReal.tsx`) og i den gamle side (`frontend/src/pages/TrainingPage.jsx` + `frontend/src/components/training/*`).
- Læste R5's I dag-kode for holdlinjen (assistenten) og telefonlisten.
- Tjekkede branchens afstand til `origin/main` (`git rev-list --left-right --count`, `git merge-tree`).

## Fund: hullerne findes stadig i R5 I dag

| # | Hul | Gammel side (live) | R5 I dag |
|---|-----|--------------------|----------|
| 2 | Train now-sikkerhed | Bekræftelsesdialog ved for få raske ryttere til korte løb (`confirmTrainNow`, `short_races_confirm`, TrainingPage.jsx ca. l. 611, 812, 2484-2510) + `TrainNowNote` (l. 81, 807) | Ingen bekræftelse, ingen `TrainNowNote` (0 træf) |
| 3 | Status i rækken | U23/JR-mærke (`TrainingTodayTable.tsx` l. 52), skade, akademi, kontrakt, pension i rækkens status | Kun et filterikon "injured" i `R5Parts.tsx`; ingen status-mærker i rækken (0 træf på academy/contract/retire/pension/JR) |
| 4 | Træthed "nu -> i aften ~xx" og dage 70+ | `fatigueTonight` + kolonnen "Fatigue tonight" (`TrainingTodayTable.tsx` l. 56-233, `todayRowModel.ts`, `TodayRowMobile.tsx`) | "Day load" (ord + pil) i stedet; intet tal for i aften (AFVIGELSE, ejer skal godkende) |
| 7 | Assistenten | `AssistantSuggestionsPanel`, `DailyDecision` med op til `MAX_DECISION_SUGGESTIONS` forslag og "Use all" (`DailyDecision.tsx` l. 69) | Én tekstlinje "Assistant suggests ... · Use" med ét hårdkodet forslag (R5.tsx l. 450-455); intet panel, ingen kolonne, intet "Use all" |
| 8 | Massehandlinger | Multi-select, `groupByType`, bulk-dag, "Set for group" (TrainingPage.jsx l. 722-729, 1033-1072, `bulkDayScope.ts`) | Ingen markering, ingen "Group by type", ingen "Set for group" (0 træf på checkbox/Group by/Set for group); "Set days for N riders" falder bort (AFVIGELSE) |
| 9 | Rytterkort og info ved sessionsvalget | Kvittering pr. evne (`AbilityReceiptRow`, `reportXp/`), tour-trinnet peger på fremgangen pr. evne (l. 1413) | Ingen XP-linjer pr. evne med EVNE/NU/FREMDRIFT/SENESTE, ingen "counts for", ingen "trains/fits type" (0 træf) |
| 10 | Ét tryk på telefonen | `TodayRowMobile` vælger direkte i rækken | Rækken er en fold-ud-knap (`toggle`), valget ligger i det åbne kort: to tryk (R5.tsx l. 519-560) (AFVIGELSE) |
| 11 | Tilstande | Indlæsning, tom, fejl, "Saved" (`TrainingDaySelect` `justSaved`, `lingerIds`), guidet tour (`useTrainingTourSteps`), låst under gem (l. 599), hjælpelink | Ingen indlæsning/tom/"Saved"/hjælpelink (0 træf); "tour" i R5 er tegnefilmen, ikke den guidede tour |

Ejerens tidligere godkendte valg (form på Day, `RiderTypeBadge`, ingen advarsel ved "No program", filtre, week blocks, sessioner pr. dag kan udvides) er til stede i R5 og skal ikke røres.

Branchen er 21 commits foran og 44 bag `origin/main`; `git merge-tree` viser en ren merge (ingen konflikt).

## Hvad dette spor ikke gjorde

Opgaveteksten bad også om at bygge hullerne ind i skitsen, lave billeder og merge main. Sporets gate (kind: investigate) tillader kun denne rapport og ingen kode-ændring, så skitsen, billederne og merge af main er ikke lavet her. De ligger i fix-planen nedenfor.

## Fix-plan

Trin (alle på `design/7947-traening-samlet-design`, kun skitse-filer, ingen spillerkode):

1. `git merge origin/main` (ren merge, ingen rebase/force-push).
2. `R5.tsx` + `R5Parts.tsx`, Train now: genbrug den ægte bekræftelsesdialog (samme `Modal`/`Button`-mønster som TrainingPage.jsx l. 2484-2510) med en mock af `shortRaces`, og vis `TrainNowNote` under knappen.
3. `R5.tsx` + `r5data.ts`, status i rækken: tilføj mock-felter (skade med løbsdage tilbage, skaderisiko, U23/JR, akademi, kontrakt, pension) og vis dem med de samme mærker som `TrainingTodayTable.tsx` (desktop) og `TodayRowMobile.tsx` (telefon).
4. `R5.tsx`, træthed: vis "nu -> i aften ~xx" og antal dage 70+ ved siden af (eller i stedet for) "Day load"; marker som AFVIGELSE hvis "Day load" beholdes.
5. `R5.tsx`, assistenten: erstat tekstlinjen med `DailyDecision` (flere forslag + "Use all") og en assistent-kolonne, med mock-forslag.
6. `R5.tsx`, massehandlinger: markering pr. række, "Group by type", "Set for group", og markering + sortering på telefonen (genbrug `bulkDayScope.ts`).
7. `R5.tsx`/`R5Parts.tsx`, rytterkortet: XP-linjer pr. evne med overskrifterne EVNE/NU/FREMDRIFT/SENESTE som i #8488 (`AbilityReceiptRow`), "counts for", tempo og "trains/fits type".
8. `R5.tsx`, telefon: ét tryk i rækken (som `TodayRowMobile`), ellers AFVIGELSE.
9. `R5.tsx` + `main.tsx`, tilstande: varianter for indlæsning, tom, fejl, "Saved", guidet tour, reload-spærre og hjælpelink (vælgbare i `main.tsx`).
10. Billeder 1440 og 390 (build i scratch uden for worktree, cookie-banner lukket), to sæt (gammel I dag-mock og R5 I dag) med røde rammer, danske labels og en nummereret "Problem -> Forslag"-liste; AFVIGELSE på de fem punkter fra 19/11. Læg dem i `.wave-scratch/7947-idag-billeder/` og `pr-screens/7947-idag/`.
11. Commit bag `guard-commit-branch.sh`, push, ingen merge. PC1 viser ejeren billederne og stiller afvigelserne som spørgsmål.

Risiko: lav for spillet (kun preview-skitse, ingen spillerkode, ingen prod). Største risiko er at røre ejer-godkendte dele; hold ændringerne i nye blokke og diff-tjek, at de godkendte dele er uændrede. Afvigelserne (Set days for N riders, ingen alder på Day, Day load, trains/fits type, ét tryk bliver to) må ikke bygges som endelige før ejerens ja.

## Dom

bekraeftet + fix-plan
