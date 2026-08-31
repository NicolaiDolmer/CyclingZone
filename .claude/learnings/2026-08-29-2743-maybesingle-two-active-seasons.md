# #2743: `.maybeSingle()` uden `.order()+.limit()` doeder haardt ved 2 aktive saesoner

## Root cause
Tre cron-interne call-sites (`stageScheduler.js`, `raceEntryGeneratorSweep.js`,
`tierCalendarMaterializer.js`'s `reconcilePoolCalendarOnActivation`) lookup'ede den
aktive saeson med `.eq("status","active").maybeSingle()`. PostgREST's `maybeSingle()`
kaster haardt hvis forespoergslen returnerer mere end 1 raekke.

`transitionToNextSeason` (`seasonTransition.js`) udfoerer overgangen i to faser:
faese 1 saetter S2 til `active`, fase 2 saetter S1 til `completed`. Fejler faese 2's
UPDATE (netvaerksfejl, timeout, proces doer midt i), staar man i et vindue med 2
raekker med `status='active'` indtil naeste manuelle rettelse. Ethvert
`.maybeSingle()`-forbrugende sted kastede derefter en uhaandteret fejl HVERT tick
(5-min cron-kadence for stage-scheduleren) indtil nogen rettede det manuelt.

Moensteret der loeste det samme problem KORREKT fandtes allerede i
`resolveTransitionSourceSeason` (`seasonTransition.js`, ~linje 657): SQL-lag LIMIT 1
via `.order("number",{ascending:false}).limit(1)` FOER `.maybeSingle()`, saa
PostgREST aldrig kan levere >1 raekke til `maybeSingle()` uanset hvor mange raekker
der reelt matcher i databasen.

## Fix
Udtrukket moensteret til en delt helper `backend/lib/activeSeasonLookup.js`
(`loadSingleActiveSeason`), brugt af alle tre call-sites:
1. `.eq("status","active").order("number",{ascending:false}).limit(1).maybeSingle()`
   - tager den nyeste aktive saeson, kaster aldrig paa >1 raekke.
2. En SEPARAT, best-effort taelle-forespoergsel (`count:"exact", head:true`). Findes
   der faktisk >1 aktiv saeson, captures en Sentry-advarsel (fast fingerprint pr.
   call-site-tag) saa tilstanden stadig bliver OPDAGET af nogen - uden at daekke
   race-motoren ned mens den venter paa manuel rettelse.
3. Dobbelt best-effort: baade en fejl i taelle-queryen OG en fejlende
   `captureExceptionFn` selv er indpakket, saa alarm-mekanikken aldrig kan traekke
   selve lookuppet ned med sig.

## Forebyggelse (forward-guard)
Naeste gang et sted i koden skal finde "den aktive saeson", brug
`loadSingleActiveSeason` fra `activeSeasonLookup.js` - IKKE et raat
`.eq("status","active").maybeSingle()`. Et rent `maybeSingle()`-lookup paa et felt
der IKKE er database-unikt-constrained (status='active' er en applikations-invariant,
ikke en DB-constraint) er generelt et faresignal: `.order()+.limit()` foerst goer
lookuppet robust mod invariant-brud i stedet for at lade det krascheh.

## Verifikation
- 7 nye tests i `activeSeasonLookup.test.js` (single/multi/query-fejl/best-effort
  paa taelle-fejl/captureExceptionFn-der-selv-kaster).
- 1 ny #2743-test tilfoejet i hver af `stageScheduler.test.js`,
  `raceEntryGeneratorSweep.test.js` og `tierCalendarMaterializer.test.js`, der
  reproducerer 2-aktive-saesoner-scenariet mod den faktiske call-site og verificerer
  ingen kast + korrekt Sentry-alarm (tag/count/fingerprint).
- Hele backend-suiten: 7371 tests, 0 fejl.
