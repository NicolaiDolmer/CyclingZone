# Postmortem · 2026-08-18 · Dobbeltbookings-vagten (#3415, CYCLINGZONE-44)

## Hvad skete der?
`riderDoubleBookingWatch` gik 0 → 3 actionable brud 5/8 og 14 → 0 igen 11/8, uden at nogen rørte
noget. #3185 var lukket 3/8 på kriteriet "15 ticks i træk med count=4, actionable=0" — men det
kriterium målte 15 *dage* (vagten kørte kun hver 24. time), og bruddene opstod/forsvandt inden
for timer. Vagten alarmerede kun med et tal; den loggede aldrig HVILKE par der kom og gik, så en
triage kunne ikke afgøre om det var en reel datafejl eller selv-korrigerende støj.

## Root cause
To ting sammen:
1. **Forkert sample-rate.** Den eneste proces der proaktivt skriver `race_entries` (og dermed kan
   introducere/fjerne et binding-brud) er entry-generator-sweepen (`raceEntryGeneratorSweep.js`),
   som kører hver TIME. Vagten kørte hver 24. time — en prøvefrekvens der strukturelt ikke kan
   fange en oscillation der sker på sweep-kadence (bekræftet i prod 11/8: 14 par kl. 15:22 → 0
   kl. 21:43, samme dags sweep kl. 20:45).
2. **Ingen hukommelse mellem ticks.** Vagten sammenlignede aldrig "levende par nu" mod "levende
   par sidste tick" — kun aggregat-tal blev logget, så forsvinden var usynlig ("bruddene
   forsvandt uden spor", issuets egen ordlyd).

## Fix
- `backend/cron.js` (`runRaceEntryGeneratorSweepCron`): kæder nu vagten (`runRiderDoubleBookingWatchCron`)
  direkte efter enhver sweep-kørsel der rent faktisk skrev noget (`result.inserted > 0 ||
  result.removed > 0`) — best-effort, fejl der her vælter aldrig selve sweep-tick'et. Den
  uafhængige 24h+boot-planlægning bevares som bagstopper.
- `backend/lib/riderDoubleBookingWatch.js`: nye rene funktioner `diffLiveConflictKeys` +
  `trackConflictChurn` giver vagten et let, in-memory (proces-levetid, INGEN ny tabel — stadig
  read-only) churn-spor. `runRiderDoubleBookingWatch` returnerer nu `appeared`/`resolved` (par-
  niveau), og Sentry-capturen får `newlyAppeared` i `extra`.
- `backend/cron.js` (`runRiderDoubleBookingWatchCron`): logger churn ved ethvert tick der har
  noget at vise — `🆕 … OPSTÅET` / `✅ … RESOLVERET` med rytter/hold/løb, uafhængigt af om selve
  alarmen fyrede (et par kan forsvinde uden at `alerted` nogensinde var true i dette tick).

Data-reparation af de eksisterende historiske par er UDEN for denne PR's scope (hører til
#3120/#2642-rammen, ejer-gated) — kun vagt-/logikfixet er leveret her.

## Forhindret-fremover
27 tests dækker `diffLiveConflictKeys`/`trackConflictChurn` isoleret + to end-to-end-scenarier
gennem `runRiderDoubleBookingWatch` der replikerer prod-mønsteret (brud opstår → sweep retter det
→ churn er synlig i næste tick, uanset at alarmen aldrig fyrer i tick 2).

## Læring
Et lukke-kriterium der tæller "N ticks i træk" er kun en gyldig garanti hvis tick-kadencen
matcher kadencen på den proces der kan ændre tilstanden. En 24-timers vagt over en times-kadence
skrive-proces måler støj, ikke stabilitet — og uden par-niveau-churn-logning ser selv-korrigerende
støj identisk ud med en reel, uopdaget datafejl.
