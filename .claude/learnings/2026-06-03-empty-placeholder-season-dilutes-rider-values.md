# Tom placeholder-sæson fortyndede alle rytterværdier

**Dato:** 2026-06-03
**Område:** Rytterværdi / updateRiderValues / sæson-vindue
**Relateret:** [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893), #895 (R3), #998

## Symptom

Top-ryttere (Pogacar, Vingegaard m.fl.) havde `prize_earnings_bonus = 0` trods at
deres hold tjente millioner i sæson 1; de der havde en bonus, så ~38% for lav ud.

## Rod-årsag

`updateRiderValues` bygger et rullende gennemsnit over aktiv + op til 3 *completed*
sæsoner. Prod har en seed/placeholder "sæson 0" (`status='completed'`,
`race_days_total=0`, 0 løb). Completed-season-queryen filtrerede kun på status, så
sæson 0 kom med i vinduet med **vægt 1** og **0 optjening** → den blæste divisoren op
og trak ALLE rytter-bonusser ned (her: divisor 1.0 → 1.617, dvs. ~38% fortynding).

## Fix

`.gt("race_days_total", 0)` på completed-season-queryen (filtreres før `.limit(3)`, så
en placeholder ikke spiser en af de 3 pladser). En sæson bidrager kun til gennemsnittet
hvis den faktisk havde racing. `race_days_total>0` er diskriminatoren — robust mod
fremtidige seed-sæsoner uden at hardkode id/number.

## Læring

Et "gennemsnit over sæsoner" skal definere hvad der *tæller som en sæson*. Status alene
er ikke nok når der findes seed-/placeholder-rækker med samme status men uden data. Når
en aggregering dividerer med et antal, så verificér at hver divisor-bidragyder er reel —
ellers fortynder tomme rækker stille resultatet. Generelt mønster, jf.
[match-ui-filter-for-capacity-logic]: tælle-/gennemsnits-logik skal ekskludere de samme
"ikke-rigtige" rækker som domænet ellers ignorerer.

**Guard:** ny test `updateRiderValues excludes empty placeholder seasons (race_days_total=0)`
(`economyEngine.riderValues.test.js`) — bonus 1067 (seed ude) vs 640 (seed inde).
