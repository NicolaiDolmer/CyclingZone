# 2026-10-01 — Trænings-datolukning genkørte alle hold hvert tick (#6004)

## Hvad skete der
Ét hold (Hold A) blev stående `partial` i `training_date_work` for 30/9 (manglende race load, data-sporet under #5928). `loadTrainingDateIndex` giver en dato med ufærdigt arbejde `forceRetry: true` hvert 5. min, og `runNormalizedTrainingDateSweep` kørte så HELE datoen igen. Legacy-grenen (division-løse hold uden work-række) kaldte `runDay` for hvert menneskehold uden division; deres `(team_id, tick_date, game_day IS NULL)`-række fandtes allerede, så reservationen ramte unique-indexet → 23505 → `alreadyRan`. Ingen dobbelt-træning, men titusinder af spildte skrive-forsøg i Supabase-loggen pr. døgn og ét Sentry-event pr. tick (CYCLINGZONE-80, eskalerende).

## Rodårsag
`forceRetry` betød både "bypass completed-cachen" og "kør hele datoen". Retry-semantikken var aldrig afgrænset til det durable arbejde der faktisk var ufærdigt, og legacy-grenen havde ikke det already-ran-opslag som `trainingDayCloseTrigger.js` (`alreadyRanLegacyTeamIds`) allerede har. Unique-indexet var eneste værn, så fejlen var usynlig som spil-bug og kun synlig som log-støj.

## Fix
- Et forced retry af en forgangen dato, der allerede har haft en fuld pass i processen, er retry-only: kun hold med `pending`/`partial` work-rækker. En fuld pass gentages kun hvis en fejl ramte et hold uden durable work (ellers ville det hold aldrig blive fundet igen). I dag (før midnat) beholder fuld pass, så nye hold stadig kommer med.
- Legacy-grenen slår eksisterende legacy-rækker op i ét opslag pr. dato før `runDay` (dækker også første pass efter en genstart).
- `cron.js runTrainingDayCloseCron` capturer kun til Sentry når `(dato, hold, besked)`-sættet ændrer sig; fejlen logges stadig hvert tick.

## Læring
- En retry-sti skal afgrænses til det arbejde der er ufærdigt, ikke genbruge normal-pass-stien med et "force"-flag.
- Et unique-index der fanger dubletter er et værn, ikke en kontrolstruktur: hvis koden rutinemæssigt rammer det, er det en bug (409-spam i Supabase-loggen er signalet).
- Per-tick Sentry-captures på en vedvarende fejl skal dedupliceres på fejlens identitet, ellers drukner nye fejl i eskaleringen.
