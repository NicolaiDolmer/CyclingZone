# En tidsbaseret tærskel som proxy for "strukturelt problem" er skrøbelig

**Dato:** 2026-07-14
**Issue:** [#2434](https://github.com/NicolaiDolmer/CyclingZone/issues/2434) · Sentry CYCLINGZONE-31
**Symptom:** `AI-trim persistent stall: hold <id> udskudt 49t` — 200+ handled events, eskalerende (~4/min).

## Hvad skete der

`aiTeamTrimHealSweep` flaggede et pending AI-hold som "stale" (→ Sentry-alarm) udelukkende ud fra alder: `pending_removal_at` ældre end `STALE_PENDING_HOURS = 48`. Kommentaren begrundede det med "48t er længere end noget realistisk etapeløb varer".

Antagelsen holdt ikke. Et multi-dag etapeløb (Vuelta a los Picos, Tour Arctique, ...) holder LOVLIGT rytterne inflight længere end 48t. 65 AI-hold blev blokeret af sådanne kørende løb, krydsede 48t-grænsen og udløste hver især en falsk alarm — pr. hold, pr. 5-min-tick.

## Rod-årsag

En **tidsbaseret tærskel brugt som proxy** for en tilstand ("noget er strukturelt galt"). Proxien fejler så snart den lovlige normal-proces kan vare længere end tærsklen. Her: "trim udskudt >48t" ≠ "trim reelt fastlåst".

## Fix

Gjorde detektionen **tilstands-bevidst** i stedet for tids-baseret: alarmér kun når det *blokerende løb selv er stallet* (samme "en etape hænger"-definition som stall-watchdogen), med en høj `STALE_BACKSTOP_HOURS = 120` som defense-in-depth mod ukendte fejlklasser. Plus: aggregér til én Sentry-capture pr. tick med fast fingerprint.

## Meta-lektion (mindst lige så vigtig)

Jeg antog først at det VAR en ægte stall (24 løb stod i status `scheduled` med kun 1-2 af 4-5 etaper kørt — klassisk stall-signatur). Havde jeg stoppet der, ville jeg have råbt "race-scheduleren hænger" og måske foreslået indgreb i en **sund live-motor**.

Det rene tjek (findes der *lige nu* en forfalden, uafviklet etape? + hvornår kørte sidste resultat?) viste det modsatte: 0 forfaldne etaper, seneste resultat importeret 38 min før måling. Løbene ventede lovligt på deres næste etape.

**Verificér mod live-tilstand FØR du kalder noget en stall.** "Sentry-issue resolved" ≠ "prod OK", og "delvist afviklet løb" ≠ "hængende løb". `label ≠ live-state` (jf. [[feedback_runtime_verify_first]]).

## Forward-guard

Når en alarm bruger en tidstærskel som proxy for en fejltilstand: spørg "kan den lovlige normal-proces vare længere end tærsklen?" Hvis ja → detektér selve fejltilstanden, ikke forløbet tid.
