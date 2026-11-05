# Postmortem · 2026-11-05 · enable_mergejoin = off fik REFRESH CONCURRENTLY til at time ud

## Hvad skete der?
#7667 satte `enable_mergejoin = off` og `work_mem = '32MB'` paa `refresh_team_race_points_mv(boolean)`. I prod timede funktionen derefter ud hver gang efter 60 s ("canceling statement due to statement timeout"; Railway-log 5/11 07:02-08:40 UTC, edge 500), mens de fire andre refresh-RPC'er lykkedes. Ingen spillere ramt (sidste race_results 4/11 18:00 UTC). Rollback koert i prod 5/11 med ejer-go (`RESET` af begge indstillinger).

## Root cause
Faktum: timeout opstod efter migrationen, ikke foer. Slutning (ikke bevist): CONCURRENTLY-diff-trinnet blev meget langsommere under indstillingen. Designet maalte matview-SELECT'en og et Hash Full Join, men ikke den rigtige `REFRESH ... CONCURRENTLY`-koersel.

## Fix
Migration `database/2026-11-05-7664-reset-team-race-points-settings.sql` (RESET af begge indstillinger) og fjernet forward-guarden i `backend/lib/refreshRankingMatviews.test.js`. Permanent loesning er #6765 (laeseskift til skyggetabel).

## Forhindret-fremover
- En planner-aendring skal maales paa den rigtige koersel, her `REFRESH ... CONCURRENTLY` med prod-volumen, ikke kun paa den underliggende SELECT.
- Post-verify skal vente paa en gennemfoert refresh, foer aendringen erklaeres ok.

## Læring
At en query-plan er hurtig isoleret siger intet om den statement-sti der faktisk koerer i prod. Maal den sti.
