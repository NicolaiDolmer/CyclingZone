# Postmortem: lokal cron mod prod + race_results statement-timeouts (#4721)

## Fund A — rodårsag

`backend/server.js` kaldte `startCron()` (fra `cron.js`) UBETINGET i sin
`app.listen()`-callback, og intet i `cron.js` tjekkede om processen kørte i
produktion eller om `SUPABASE_SERVICE_KEY` rent faktisk var en service_role-
nøgle. Enhver helt almindelig lokal `node server.js`/`npm run dev` begynder
derfor STRAKS at sende cron-ticks (auktioner hvert minut, scout-sweep hvert 5.
min, osv.) mod hvad end den lokale `.env`s `SUPABASE_URL` peger på.

3/9 sås konsekvensen: 191 x 401 "permission denied for table riders" fra
ejerens hjemme-IP over 12 timer, samtidig med ~190 x 200 OK på SAMME
forespørgsel — to forskellige lokale processer kørte cron samtidig, én med
gyldig service_role-nøgle, én uden.

## Hvorfor fangede vagterne det ikke

Ingen eksisterende vagt tjekkede "kører denne proces i produktion?" nogen
steder i `cron.js`/`server.js` — hverken `NODE_ENV`, `RAILWAY_ENVIRONMENT_NAME`
eller nøglens rolle blev nogensinde læst. Cron-boot var implicit "altid kør"
siden filen blev skrevet.

## Forward-guard

`backend/lib/cronRuntimeGuard.js` (`evaluateCronRuntimeGuard`) — `startCron()`
kalder den FØRST og returnerer uden at sætte noget `setInterval` op medmindre
BÅDE `SUPABASE_SERVICE_KEY` dekoder til `role=service_role` OG
`RAILWAY_ENVIRONMENT_NAME=production`. `CRON_FORCE_LOCAL=1` er den eksplicitte
undtagelse for legitim lokal cron-test, og logger en tydelig advarsel når den
bruges. Dækning: `backend/lib/cronRuntimeGuard.test.js`.

## Fund B — rodårsag

Tre høj-trafik `race_results`-forespørgsler (1,26 mio. rækker, 353 MB) havde
kun enkelt-kolonne-indeks at filtrere på og måtte derfor sortere separat
(Bitmap Heap Scan + Sort) — dyrt nok til at ramme statement_timeout under
belastning. Målt read-only mod prod (pg_stat_statements + EXPLAIN ANALYZE, se
migrationsfilens kommentarer for tal):

- `team_id = $1 ORDER BY id` (TeamResultsTab.jsx) — prods reelt tungeste
  race_results-forespørgsel, max 6.993 ms (tæt på 8s-timeouten).
- `race_id = ANY($1) ORDER BY rank, id` (RaceHistoryPage.jsx).
- `race_id = ANY($1) AND rank = $2 ORDER BY id` (backend
  `/api/dashboard-recent-results`, #4590s dashboard-klage).

## Forward-guard

`database/2026-09-03-4721-race-results-composite-indexes.sql` — tre nye
sammensatte, dækkende indeks (samme mønster som #4507s
`idx_race_results_rank_dupe_check`). IKKE applied af denne PR — Claude
applier post-merge under #2642-rammen.

## Læring til fremtidige sessioner

En proces der "bare starter serveren lokalt for at teste noget andet" er ikke
harmløs, hvis serveren selv starter en cron-scheduler — check ALTID om
boot-kæden har en implicit "kør automatisk"-antagelse før du antager en lokal
`npm run dev`/`node server.js` er isoleret fra prod.

Refs #4721 #4590 #4507 #1162
