# Postmortem · 2026-07-16 · AI-trim over-markering + orphan-tal der målte forkert

## Hvad skete der?
To fejl der forstærkede hinanden (#2407): `removeAiTeams` markerede HELE puljen
`pending_removal_at` når alle kandidater var blokeret (65 hold i pulje 9/10/11, kun 5
reelt overskud), og heal-sweepen slettede hvert markeret hold så snart blokeringen
løftedes — uden at tjekke resulterende puljestørrelse. Kaskaden mod 4/4/4 hold blev
kun stoppet af et manuelt ejer-indgreb 15/7. Parallelt påstod #1847 en voksende læk
på 13.262 forældreløse race_results.

## Root cause
1. `aiTeamGenerator.js removeAiTeams`: loopet pushede ALLE passerede blokerede hold
   til `blockedIds` og markerede dem alle — ikke kun underskuddet (`count - toRemove.length`).
2. `aiTeamTrimHealSweep.js`: markøren blev behandlet som evig sandhed; ingen re-check
   af puljens aktuelle overskud før sletning.
3. #1847-tallet blandede 9.707 team-klassifikationsrækker (rider_id NULL **by design**)
   sammen med 4.100 ægte rytter-orphans (100% AI-churn, alle display-sikre via
   denormaliseret rider_name/team_name).

## Fix
- Fejl 1: markér kun `count - toRemove.length` blokerede hold (id-orden), `aiTeamGenerator.js`.
- Fejl 2: pr.-pulje trim-budget (`aiCount - targetAi`) som hard-gate i sweepen; budget 0
  → forældet markør RYDDES i stedet for at slette; ukendt pulje → fail-closed.
  Guard-events alarmeres via Sentry (fast fingerprint `ai-trim-invariant-guard`), `cron.js`.
- #1847: navne-snapshot før rytter/hold-sletning i JS (AI-trim-stierne) + DB-triggers
  for alle delete-stier (`database/2026-07-16-race-results-orphan-guard.sql`, ejer-applied).
  INGEN delete-oprydning — rækkerne er display-sikker historik.

## Forhindret-fremover
- Regressionstests for begge fejl (reproduceret RØDT først) i `aiTeamGenerator.test.js`
  + `aiTeamTrimHealSweep.test.js`.
- Sweepen er nu selv-helende mod fremtidig over-markering (rydder + alarmerer i stedet
  for at eksekvere den).

## Læring
En udskudt destruktiv handling ("slet når blokeringen løftes") skal ALTID re-validere
sin præmis ved eksekvering — tilstanden der retfærdiggjorde den kan være væk.
Og: verificér hvad en orphan-måling faktisk tæller, før der bygges oprydning oven på
den — 70% af #1847's tal var by-design-rækker hvis sletning ville have ødelagt
team-klassifikationen i hvert eneste afviklet løb.
