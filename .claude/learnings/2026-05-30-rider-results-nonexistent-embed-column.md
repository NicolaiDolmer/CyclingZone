# Rytter-resultathistorik tom: embed på ikke-eksisterende kolonne fælder hele queryen

**Dato:** 2026-05-30
**Issue:** [#780](https://github.com/NicolaiDolmer/CyclingZone/issues/780)
**Fil:** `frontend/src/pages/RiderStatsPage.jsx`

## Symptom
Resultat-fanen (og Sæson-fanen) på den enkelte rytter var helt tom, selvom
`race_results` indeholdt 2.672 rækker med `rider_id` sat.

## Rod-årsag
To bugs, den første dødelig:

1. **Embed på ikke-eksisterende kolonne.** `loadRider` lavede
   `.select('*, race:race_id(name, race_type, start_date)')`. `races` har
   **ingen `start_date`** (kolonnerne er bl.a. `edition_year`, `created_at`,
   `season_id`). PostgREST fejler HELE requesten med 400 når en embedded select
   peger på en ukendt kolonne — supabase-js returnerer så `{ data: null }`, og
   `setResults(data || [])` gav `[]`. Fanen så tom ud uden fejl i UI.

2. **Forkert kolonnenavn i render.** Render + `bySeason` brugte `r.position`,
   men kolonnen hedder `rank`. Selv hvis query'en var lykkedes ville
   placeringen vise `#undefined` og sejre/top-3 altid være 0.

## Fix
Aligned med det velfungerende `RaceHistoryPage.jsx`-mønster:
`start_date` → `edition_year`, `r.position` → `r.rank` (både render og
`bySeason`-aggregering).

## Læring / forward-guard
- **Verificér embed-kolonner mod faktisk skema, ikke mod antagelse.** En enkelt
  ukendt kolonne i en PostgREST-embed fælder hele query'en stille — `data`
  bliver `null`, ikke en delvis række. Tomme lister i UI = mistænk query-fejl
  før du mistænker "ingen data".
- **Genbrug etablerede query-mønstre.** En søster-side (`RaceHistoryPage.jsx`)
  læste allerede `race_results` korrekt med `rank`/`edition_year`. Diverging
  kolonnenavne mellem to sider der rammer samme tabel = lugt.
- Denne fil blev ikke ramt af #772/#774's 1000-row-cap (limit 20 pr. rytter),
  så cap var ikke årsagen — kolonne-mismatch var.
