# Race-hub: overlap-redigering + rytter-gyldighed (Rod A + Rod B)

**Dato:** 2026-06-25
**Issues:** #1823 (overlap-trup-flow), #1800 (fyrede hænger i lineup), #1742 (pensionerede/akademi i lineup/assistent)
**Branch:** `fix/race-hub-overlap-eligibility-1823` · ét samlet PR.

## Problem (rod-årsager, bekræftet i kode + prod-DB)

To fælles rødder, ikke tre løse bugs.

### Rod B — "hvilken rytter er gyldig?" (ghost-ryttere)
Gyldigheden afgrænses **fire steder**, tre korrekt, men generatoren + runneren har et hul:

| Sti | team | is_academy | is_retired |
|---|---|---|---|
| `getSelectionContext` (manuel GET-roster) | ✓ | ✓ | ✓ |
| Manuel regenerate-endpoint (`api.js`) | ✓ | ✓ | ✓ |
| `runRaceEntryGenerator` (baggrunds-assistent) | ✓ | **✗** | ✓ |
| `raceRunner` sim-tids-autofill | — | **✗** | ✓ |

Desuden:
- **Display læser `race_entries` råt** uden at krydse mod gyldighed → en ghost (udtaget *før* han blev uegnet) renderer som `null` i kolonnen (intet `×`), men tæller i `counts.selected` (6/6). Det er den fysiske "kan ikke fjerne / kan ikke tilføje"-lås.
- **Ingen oprydning** når en rytter forlader holdet (salg/fyring/akademi-promotion/retirement) → off-team-ghosts.

**Prod-måling (2026-06-25, kommende scheduled løb):** 264 akademi-ghosts + 151 off-team-ghosts. På rigtige menneske-hold: **156 af 414 lineup-kolonner (38%) ramt.**

### Rod A — redigeringsflowet
- **min == max** for næsten alle klasser (Class1/2 + ProSeries 6/6, WorldTour 7/7, Grand Tours 8/8) + **auto-gem hver ændring** → enhver enkelt add/remove på en fuld trup er ugyldig server-side (`selection_wrong_size`) → "hård 6-og-6-lås". Man kan ikke engang bytte én rytter.
- **Afmeld frigør ikke binding:** afmelding sletter ikke `race_entries`, og `loadTeamBindingContext` + `buildBindingMap` ekskluderer ikke afmeldte løb → rytterne forbliver låst i puljen og i det andet løb.

## Løsning

### Rod B
1. **Én delt eligibility-definition** — nyt modul `backend/lib/riderEligibility.js`:
   - `applyEligibleRiderFilter(query)` — påfører `is_academy=false` + `is_retired` ikke-true på en supabase-query.
   - `isEligibleRider(rider, { teamId })` — ren predikat: på det rette hold, ikke akademi, ikke pensioneret.
   Bruges ALLE fire steder (konsolidér — erstat de tre ad-hoc-filtre + tilføj academy hvor det mangler).
2. **Forbrugs-punkt-gyldighed (robust forward-guard):**
   - `getSelectionContext`: kryds `selection`-entries mod den gyldige roster → ghosts forsvinder fra visning + count. `counts.selected` bliver ærlig → låser op straks.
   - `raceRunner` feltbygning (`loadStartField`): drop entries hvis rytterens *nuværende* `team_id` ≠ entry'ens `team_id` eller rytteren er akademi/pensioneret. Defense-in-depth: et solgt-væk-rytter kører aldrig for det gamle hold.
   - **Ingen** delete-kald sprøjtet ud i de ~10 departure-sites (fragilt). Gyldighed afgøres hvor entries forbruges.
3. **Engangs-oprydningsscript** `backend/scripts/dev/cleanup-ghost-race-entries.mjs` — sletter ghost-entries i kommende (scheduled, ikke-startede) løb. Dry-run default + før/efter-tal. Køres mod prod efter merge-verifikation.

### Rod A
4. **Frontend kladde, auto-gem-når-gyldig** (`RaceHubBoard.jsx`): add/remove/rolle muterer lokal kladde-state pr. kolonne. PUT sker kun når kladden er en gyldig udtagelse (størrelse inden for min–max + gyldige roller). Ugyldig mellemtilstand (5 eller 7) vises med inline "mangler N / for mange" uden at gemme og uden rollback. Ingen ny knap — gem er implicit. Server-validering uændret (den er sandheden; kladden gemmes kun når den vil passere).
5. **Afmeld ekskluderer løbet fra binding** (behold entries):
   - `loadTeamBindingContext` + regenerate-`lockedWindows`: ekskludér afmeldte løb (LEFT JOIN/anti-join mod `race_withdrawals` for holdet).
   - `buildBindingMap` / distribution: marker ikke ryttere i afmeldte kolonner som bundet.
   - Entries bevares → gen-tilmelding giver samme trup.

### Bevidst udeladt
- Underbemandet efter ghost-fjernelse: **lad stå** (kolonne viser "mangler N"); sim-tids-autofill fylder ved afvikling. Ingen øjeblikkelig auto-genudfyld.
- #1747 UX-pynt (skjul skadede, vis stats) — separat scope, holdes ude.

## Tests (skrives FØR fix — TDD)
- **(a) Overlap/afmeld:** `assignTeamAcrossRaces` + binding — afmeldt løb frigør rytter til det overlappende løb; ingen dobbeltbinding.
- **(b) Gyldighed:** `isEligibleRider`/filter afviser akademi + pensioneret + off-team; `getSelectionContext` udelader ghost fra `selection` + `counts`; generator vælger ikke akademi.
- **Frontend:** kladde tillader transient 5/7 uden PUT; PUT fyres ved retur til gyldig størrelse; swap (fjern→tilføj) på 6/6-løb lykkes.

## Verifikation
Ægte konto med to overlappende løb + ≥12-rytters trup: auto-udfyld → distinkte 6+6; byt rytter; afmeld → frigør → tilføj ledig; ingen "Couldn't save". DB: 0 ghost-entries i kommende løb efter script. Luk #1823/#1800/#1742 kun når hvert symptom er verificeret væk.

## Migration / merge
Ingen skema-ændring. Oprydning = engangs-script (ikke migration) → intet ejer-merge-krav på den konto. Hvis noget alligevel kræver `database/*.sql`: ejeren merger.
