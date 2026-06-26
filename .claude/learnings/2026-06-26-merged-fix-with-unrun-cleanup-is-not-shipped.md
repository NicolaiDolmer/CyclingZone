# Et merged+lukket fix med et un-run manuelt prod-step er IKKE shippet

**Dato:** 2026-06-26 · **Type:** bugfix-postmortem · **Issues:** #1906 (#1823 genåbnet) · **PR:** #1911

## Hvad skete
Spillere rapporterede 26/6 (10:24-10:42) at holdudtagelse stadig var brudt — ryttere låst i auto-løb, kan ikke gemme egen trup — **selvom #1823 var lukket `completed` 25/6 og fix-PR #1893 (v6.17) var merged samme morgen**. Ejeren bekræftede live: "der er rettet en større fejl, og denne er åbenbart efterladt derinde."

## Rod-årsag #1 — un-run cleanup
#1893 løste mekanikken (delt `riderEligibility.js` + forbrugs-punkt-forward-guard), MEN de 415→373 eksisterende ghost-`race_entries` skulle ryddes med et **manuelt script** (`cleanup-ghost-race-entries.mjs --apply`) som var en ejer-TODO i NOW.md. Det blev aldrig kørt. Frontend + backend var deployet (verificeret: prod = commit efter #1893; dagens løbsgenerering havde 0 akademi-entries), men de gamle ghosts låste stadig kolonnerne. Kørt `--apply` → slettede 373, verificeret 0.

**Lektion:** Når en fix-PR efterlader et manuelt prod-step (data-cleanup, backfill, flag-flip), er issuet IKKE done før det step er kørt + verificeret. "Merged + closed" ≠ "live for brugere". Enten kør stepet i samme session som merge, eller hold issuet åbent med stepet som eksplicit blocker — luk aldrig på merge alene. (Forstærker [[feedback_mark_issues_done_after_ship]] + [[feedback_runtime_verify_first]].)

## Rod-årsag #2 — to datakilder for samme begreb
Dashboardets "næste løb" og holdudtagelse (RaceHub) udledte begge "hvilke løb er mit hold i", men fra **forskellige kilder**: Dashboard = direkte `races`-query uden pulje-filter (alle 7 divisioner); RaceHub = `/api/races/distribution` med `teamInRacePool`. Resultat: dashboard viste fremmede divisioners løb (99 vs 10 i prod-verifikation). Fixet (#1911): samme pulje-filter på begge.

**Lektion:** Når to flader viser "samme" afledte data, skal de dele kilde/filter — ellers divergerer de synligt for brugeren. (Samme klasse som #1830 dashboard-vs-board tilfredshed.) Matcher [[feedback_match_ui_filter_for_capacity_logic]].

## Bonus — mock-divergence skjuler adfærd
Dashboards e2e-snapshot var bagt med en TOM løbs-widget, fordi en løs `id=eq`-regex i mock-handleren fangede `season_id=eq.` → tom liste. Fixet afslørede det; mock'en discriminerer nu på `pool_race`-join. **Lektion:** en mock der returnerer tomt "ved et uheld" tester ingenting — snapshottet så grønt ud mens fladen var udokumenteret tom.
