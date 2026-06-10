# Postmortem · 2026-06-10 · Ranglistens podie-kolonne læste et DB-felt der aldrig har eksisteret

## Hvad skete der?
Ranglisten (StandingsPage) viste 0 podier for alle managers, selv hold med
mange top-3-resultater (Discord-rapport 2026-06-05, #1093). Kolonnen så
funktionel ud — header, celle, fallback `s.podiums || 0` — men værdien var
altid `undefined`.

## Root cause
`season_standings` har ingen `podiums`-kolonne (verificeret i prod via
information_schema OG i database/schema.sql), og backend-aggregeringen
`updateStandings` (backend/lib/economyEngine.js) tæller kun
points/stage_wins/gc_wins/races_completed. Frontend læste `s.podiums` fra et
felt ingen nogensinde skriver. E2e-mocken (standings-gold-leader.spec.js)
mockede endda `podiums: 0` — UI'et blev bygget mod en antaget kolonne uden at
verificere skemaet.

## Fix
Client-side aggregering fra race_results (samme mønster som holdkonkurrence-
og præmiepenge-kolonnerne på samme side): ny pure helper
`frontend/src/lib/standingsPodiums.js` (`countTeamPodiums`), wired i
StandingsPage.jsx. Semantik matcher rytter-ranglistens "Top 3"-kolonne
(RiderRankingsPage): kun result_type stage+gc med rank <= 3; team-attribution
= `team_id || rider.team_id` (samme regel som backend updateStandings).

## Forhindret-fremover
10 unit-tests i standingsPodiums.test.js låser semantikken (stage+gc tæller,
trøje-klassementer + holdkonkurrence gør ikke, attribution-fallback,
string-rank coercion).

## Læring
En UI-kolonne med pæn fallback (`x || 0`) kan skjule at datakilden slet ikke
findes — `undefined || 0` ser ud som "bare ingen data endnu". Ved nye
kolonner: verificér at feltet faktisk skrives af noget (grep backend +
skema), ikke kun at query'en ikke fejler. PostgREST fejler IKKE på
`select("*")` mod manglende kolonner — den udelader dem bare stille.
