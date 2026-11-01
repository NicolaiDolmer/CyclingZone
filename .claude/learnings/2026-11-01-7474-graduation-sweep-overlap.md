# 2026-11-01 · #7474 · Graduerings-sweep: to samtidige ticks afgjorde samme ryttere

**Symptom:** Sentry CYCLINGZONE-AV "graduation sweep: 6 ryttere fejlede" (not_pending) kl. 21.07 UTC, og 7 managere fik "Academy graduate resolved" to gange.

**Rod-årsag:** 701 graduerings-rækker havde samme deadline (20:42 UTC). Sweepet kører hvert 5. minut via `trackedTick`, som kun tæller in-flight og ikke forhindrer overlap. Et tick tog over 5 min, næste tick læste samme pending-liste. `finishGraduation` opdaterede med `.eq("id")` uden `status='pending'`-vagt, så begge afgørelser gik igennem og sendte besked.

**Fix (PR #7475):** single-flight i `runAcademyGraduationSweep`, compare-and-set i `finishGraduation` (`.eq("status","pending").select("id")`, 0 rækker = ingen besked), `not_pending` tælles som `alreadyResolved`.

**Læring:**
- Ethvert cron-sweep, der kan få en stor batch på én gang (fælles deadline, sæsonskifte), skal have single-flight; `trackedTick` giver det ikke.
- En status-overgang skal være compare-and-set (`where status = <fra>`), ellers kan to skrivere begge "vinde".
- En "fejl" der betyder "allerede gjort" må ikke ende i Sentry som fejl; den skjuler de rigtige.
- Låsen gælder kun én proces; på tværs af processer (deploy-overlap) er det compare-and-set, der beskytter.
