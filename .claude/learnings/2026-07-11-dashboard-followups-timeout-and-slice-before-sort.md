# Postmortem · 2026-07-11 · Dashboard-opfølgninger (#2328): timeout-uden-fejl + slice-før-sort

## Hvad skete der?
Ejer-verify af dashboard-UX-pakken (#2288/PR #2296) 11/7 fandt 5 mangler: rytterranglisten
loadede ikke, "Kommende løb" viste forkerte løb, holdudtagelses-CTA'en linkede til det
forkerte løb, egen divisionsplacering manglede uden for top-5, og "Se kalender"-knappen
linkede til RaceHub i stedet for kalendersiden.

## Root cause
1. **Rytterranglisten**: `/api/dashboard/rider-ranking` hentede race_results for ALLE
   sæsonens løb på tværs af samtlige ~15 puljer (423 løb / ~125k rækker i prod) via
   `fetchAllRows`' side-for-side paginering (126 sekventielle round-trips). Det timede
   stille ud på Railway — frontend'ens `if (r.ok)`-guard fangede aldrig en fejl, den
   fyrede bare aldrig, så state forblev `[]` uden synlig fejl noget sted.
2. **Kommende løb**: DashboardPage sorterede races på `pool_race.date_text` (en statisk
   PCM-kalenderdato uden relation til det ægte real-time-forløb) og SLICEDE til top-3
   FØR den ægte etape-tid (`race_stage_schedule.scheduled_at`) overhovedet var hentet.
   De 3 viste løb kunne derfor være et vilkårligt udsnit af puljen.
3. **Holdudtagelses-CTA**: `TeamSelectionCtaCard` udledte selv "næste løb" via
   `pickNextSelectableRace(races)` — den tidligst SCHEDULEDE, uanset om udtagelse
   allerede var lavet. Samme bug forstærkedes af #2 (CTA'en så kun races-top-3).
4. **Egen divisionsplacering**: standings-kortet slicede unconditionally til top-5 uden
   at tilføje managerens egen række hvis han lå udenfor.
5. **"Se kalender"**: `Link to="/races"` (RaceHub) i stedet for `/calendar`
   (CalendarPage) — teksten lovede kalenderen, routen gjorde ikke.

## Fix
- `backend/routes/api.js` (`/dashboard/rider-ranking`): filtrér races på
  `req.team.league_division_id` (samme mønster som `/dashboard/recent-results` #2288 G) +
  `keyExtras` pr. division + throw på Supabase-fejl i stedet for tavs `data || []`.
- `frontend/src/lib/upcomingRaces.js` (ny, ren + testet): `pickUpcomingRaces(races,
  nextStageMsById, limit)` sorterer på den ægte næste-etape-tid, PCM-dato kun som
  fallback for løb uden kendt tid.
- `frontend/src/pages/DashboardPage.jsx`: `nextRaces`-state holder nu ALLE puljens løb
  (ikke kun top-3); `displayedRaces = pickUpcomingRaces(...)` bruges kun til
  "Kommende løb"-kortets rendering. `squadSelectionMissingRace` (allerede beregnet mod
  race_entries) sendes direkte til `TeamSelectionCtaCard` som `nextRace`-prop i stedet
  for at komponenten selv gætter. Standings: egen række tilføjes altid hvis manageren
  ligger uden for top-5, adskilt med en visuel skillelinje.
- `frontend/src/components/TeamSelectionCtaCard.jsx`: modtager nu `nextRace` direkte
  (den race der reelt mangler udtagelse) i stedet for at udlede sit eget løb.
- `Link to="/races"` → `Link to="/calendar"` i sæsonbanneret.

## Forhindret-fremover
- `frontend/src/lib/upcomingRaces.test.js` (7 tests) dækker sorterings-logikken.
- `backend/lib/dashboardUxPakke.routes.test.js` fik 3 nye tests der scanner
  rider-ranking-routen for division-filter, keyExtras og error-throw (samme
  kildeteksts-scan-mønster som recent-results-testene).

## Læring
"Ligner recent-results" var ikke nok — rider-ranking manglede PRÆCIS det samme
division-filter som recent-results allerede havde (#2288 G), men blev shippet uden det
i samme PR. Når to endpoints deler et mønster (season → races → race_results), kopiér
BEGGE sikkerhedsforanstaltninger, ikke kun happy-path-formen. Og: "slice til top-N" skal
altid ske EFTER den værdi man reelt sorterer visningen på er hentet — en to-trins
fetch→sort→slice-pipeline, hvor sort-nøglen kommer fra trin 2, er en klassisk kilde til
"tilfældigt forkerte" resultater uden nogen fejlmeddelelse.
