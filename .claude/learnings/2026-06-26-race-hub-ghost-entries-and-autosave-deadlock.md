# Race-hub: ghost-entries + auto-gem-deadlock (#1823/#1800/#1742)

**Dato:** 2026-06-26 · **Type:** bugfix-postmortem · **PR:** #1893

## Symptomer (Discord-sweeps 23-25/6)
Hård "udtag mellem 6 og 6"-lås; afmeld frigør ikke; kan ikke tilføje ledige ryttere;
genudfyld virker ikke; "spøgelses-ryttere" (4 valgte + 2 blanke "til hvem ved");
fyrede/pensionerede/akademi-ryttere valgbare i lineup/assistent.

## To rod-årsager (ikke 6 løse bugs)

### Rod A — auto-gem-hver-ændring × min==max
`SELECTION_SIZE` har **min == max** for næsten alle klasser (6/6, 7/7, 8/8). Board'et
PUT'ede hver enkelt add/remove med det samme, og backend afviser enhver ugyldig trup
(`selection_wrong_size`). På en fuld 6/6-trup er **både** fjern (→5) **og** tilføj (→7)
ugyldige → man kan ikke engang bytte én rytter. Afmeld slettede ikke entries og
`loadTeamBindingContext` ekskluderede ikke afmeldte løb → binding-lås overlevede afmeld.

### Rod B — gyldighed afgrænset 4 steder, 2 med hul
"Valgbar rytter" var defineret i `getSelectionContext`, regenerate-endpointet (begge
korrekt), **men** `runRaceEntryGenerator` + `raceRunner`-autofill manglede `is_academy`
(kun `is_retired`). Og committede `race_entries` blev **aldrig krydset mod rytterens
nuværende tilstand** → en rytter udtaget FØR salg/fyring/akademi-promotion hang ved som
ghost: renderede `null` i kolonnen (intet ×), talte i `counts.selected` (6/6) → låste
kolonnen totalt. **Prod: 156/414 lineup-kolonner (38%) ramt; 264 akademi + 151 off-team.**

## Fixes
- **Én delt definition** `backend/lib/riderEligibility.js` brugt alle 4 steder.
- **Forbrugs-punkt-forward-guard:** kryds entries mod *nuværende* team_id+status i
  `getSelectionContext` + `raceRunner` — robust uanset HVORDAN rytteren forsvandt.
  Bevidst valg: IKKE delete-kald i de ~10 departure-sites (auction/transfer/akademi/
  retirement/...) — det er fælden "lap ti steder". Gyldighed afgøres hvor entries forbruges.
- **Frontend kladde, auto-gem-når-gyldig** (`isSelectionSavable`): redigér frit, gem kun gyldigt.
- **Afmeld ekskluderer løb fra binding** (entries bevares → gen-tilmeld = samme trup).
- Engangs-script til de 415 eksisterende ghosts (ikke per-mutation cleanup).

## Lektioner
1. **min==max + optimistisk-gem-hver-ændring = deadlock.** Redigerbare flader med en
   "skal-være-gyldig"-invariant skal have en kladde der tillader transient-ugyldig.
2. **Stale fremmednøgle-rækker = forbrugs-punkt-validering, ikke mutations-punkt-cleanup.**
   Når en entity kan forlade en relation mange steder, valider hvor den LÆSES, ikke ved
   hvert exit. Robust mod nye exit-paths. (Mønster fandtes allerede: #1846 division-filter.)
3. **Konsolidér gentaget filter til ét sted FØR du tilføjer det 4. — ellers divergerer de.**
   Tre korrekte + ét med hul er værre end ét delt.
4. **Test-fixtures der udelader felter (team_id) skjuler forbrugs-punkt-bugs.** At gøre
   fixtures realistiske afslørede + dækkede den rigtige adfærd.
