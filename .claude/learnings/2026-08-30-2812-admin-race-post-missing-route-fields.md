# Postmortem · 2026-08-30 · POST /admin/races manglede rute-felter i race_stage_profiles

## Hvad skete der?
POST /api/admin/races (admin-oprettelse af nye loeb) skrev race_stage_profiles-raekker uden distance_km, elevation_gain_m, climbs, sprints og sectors - selvom raekken blev stemplet med generator_version 5, som ellers lover at rutedata er genereret og gemt. Ingen prod-raekker blev korrupte (feature bruges sjaeldent, og alle eksisterende generator_version 4/5-raekker kommer fra tierCalendarMaterializer/backfill-vejen), men enhver ny loeb oprettet via admin-UI'et ville have faaet ufuldstaendige profiler.

## Root cause
`backend/routes/api.js` POST /admin/races-handleren byggede race_stage_profiles-raekker med en lokal inline-liste der kun tog race_id/stage_number/profile_type/finale_type/demand_vector/segments/weather med - de fem rute-felter fra `generateRaceStageProfiles()`'s output blev aldrig laest ind i raekken. En kode-kommentar tilfoejet i PR #4028 erklaerede eksplicit at rute-felterne var "uden for scope" for den aendring, hvilket lod hullet staa aabent i stedet for at blive fanget som en bug.

## Fix
Tilfoejede `toStageProfileRow(raceId, p)` i `backend/lib/raceStageProfileGenerator.js` - en delt, ren row-shaper der mapper alle 12 kolonner (inkl. de fem rute-felter) fra en genereret profil `p` til en insertbar raekke. De tre skrivesites (`backend/lib/tierCalendarMaterializer.js`, `backend/scripts/backfillRaceStageProfiles.js`, `backend/routes/api.js` POST /admin/races) bruger nu alle helperen i stedet for hver sin inline-liste.

## Forhindret-fremover
- Ny test `backend/lib/raceCreateAdminRoute.test.js`: en statisk guard paa at POST-handleren rent faktisk kalder `toStageProfileRow` (fanger en fremtidig revert til en lokal inline-liste) + en funktionel test der asserter at alle fem rute-felter er udfyldt for baade enkeltstart- og etapeloeb.
- Den delte helper goer det strukturelt sværere for de tre skrivesites at drifte fra hinanden igen - en fremtidig kolonne-tilfoejelse behoever kun aendres ét sted.

## Læring
En kode-kommentar der erklaerer et hul "uden for scope" for den PR den staar i, er ikke det samme som at hullet er acceptabelt permanent - det er en tracket TODO der let glemmes, fordi kommentaren ikke er synlig nogen andre steder end i den ene fil. Naar tre parallelle skrivesites til samme tabel eksisterer, er en delt row-shaper billigere end at holde dem i sync via disciplin/kommentarer.
