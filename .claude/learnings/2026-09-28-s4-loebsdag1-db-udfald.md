# 28/9 S4 løbsdag 1: ungdomsløb sprunget over, to DB-udfald, sen træning

## Hvad skete
- 19:30: 0/20 U23-/juniorløb kørte. `emptyPoolPolicy` talte kun `teams.league_division_id`; ungdomspuljer (16-35) så tomme ud (stille skip, 0 Sentry). Fix #5890.
- 19:52: U23 pulje 19 kunne ikke starte. `loadFieldBindingContext` brugte default-senior-filter → junior-entries usynlige → dobbeltbooking afvist af DB (CYCLINGZONE-71). Fix #5891.
- 19:53-19:56 og 20:12-20:20: DB-udfald. Board-weekend kørte fuld genberegning for ALLE hold pr. afsluttet løb (880 kald / 23 s pr. løb); 20 ungdomsløb + 10 seniorløb tæt → storm. Hotfix-deploy fejlede, fordi `/health` afhænger af DB. Fix #5892 (ungdom ud + én RPC). Scheduler pauset 20:30-21:12.
- 21:03: træningslukningen døde på ~19 KB URL (`.in()` med ~500 race-id). Fix #5896 (+ #5909 pagination-markør). Træning kørte 21:38-21:56.
- #5880 (regel A + ungdoms-løbsudvikling) var klar men ikke merget før aftenkørslen.

## Lektier
1. **Nye puljer/trupper = gennemgå alle "pulje"- og "trup"-filtre.** Tre af aftenens fejl var samme klasse: en helper der antog senior-kolonnen.
2. **Stille skip er farligt.** Et bevidst skip uden alarm skjulte 20 uafviklede løb. Tæl skips pr. tick og alarmér når de er uventet mange.
3. **O(alle hold) pr. løb skalerer ikke.** Enhver finalization-hook skal være set-baseret eller koalesceret pr. tick.
4. **Store id-lister hører ikke hjemme i URL'er.** Brug join-filter.
5. **Fallback må ikke genskabe stormen.** Review fandt at RPC-timeout → række-for-række ville ramme en presset DB.
6. **Tidskritiske PR'er skal merges FØR den kørsel de retter.** #5880 lå klar i timer.
7. **Load-test en fuld løbsdag før sæsonskifte** (#5904) ville have fanget alle fire.

Refs #5893 #5879
