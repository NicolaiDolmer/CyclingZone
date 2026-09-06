# 2026-09-07: Absolutte konstanter mod en evne-relativ skala (tredje gang)

**Issue:** #4885 (feltet komprimeres, tidsgrænsen inert). PR #4935. Natbølge 6-7/9.

## Hvad skete

v4's fart-model (`segmentLoop.computeSegmentSpeedKmh`) målte en gruppes styrke som en absolut CP-forskel mod en konstant kalibreret for et midt-skala felt. Mod den ægte population (median-evne ~10 af 99) kunne stærkeste og svageste tænkelige gruppe højst skille sig ~4 % i fart, uanset hvilken mekanik der blev koblet på. Samtidig læste `riderCpForSegment` aldrig W': en tom anaerob reserve kostede kun retten til at blive hægtet af, aldrig fart. Konsekvens: 0 OTL af 177.120 rytter-etaper, tidsgrænsen (ejerbeslutning 6/9) var inert, og bagerste gruppe hentede 286 s på én nedkørsel fordi størrelses-læ vejede tungere end styrke.

## Mønstret

Det er samme fejlfamilie tre gange på tre uger:

1. #4604 (2/9): kravet i `tickGroupRiders` var absolut, rettet til gruppens eget tempo.
2. #4615 række 13 (3/9): sen-etape-uro og udbruddets størrelses-bonus er absolutte konstanter; en naiv relativisering forværrede bjerg-ankeret og blev rullet tilbage.
3. #4885 (7/9): fart-siden af samme model.

Fælles rod: konstanter blev valgt mod et forestillet felt med evner omkring 50, mens den ægte population ligger omkring 10 (prod målt 7/9: p50 7-12, p90 23-31). Alt der er "evne minus konstant" eller "forskel i CP-point" er dermed en brøkdel af sin tiltænkte størrelse.

## Forward-guard

- Hale-spredning måles nu pr. etapetype med p50/p90/p99 og uden uheldsramte (`backend/scripts/v4TailSpread.js`), og OTL-rate rapporteres. Et nyt absolut led vil vise sig som en hale der ikke skalerer med feltets spredning.
- Regel til reviews af v4-tuning: enhver ny konstant der sammenlignes med en evne eller en CP-forskel skal være udtrykt relativt (andel af gruppens/feltets eget niveau), eller have en kommentar der forklarer hvorfor absolut er rigtigt.
- Populations-snapshottet til harnessen er selv skævt (#4936); kalibrér ikke konstanter mod det før det er re-eksporteret.

## Læring om måling

Issuets maks-tal (6 %) var forældet allerede samme aften: uheldstrappen (#4882) gav enkelte 25 %-outliers, som skjulte at feltets egen hale stadig var 3-4 %. Genmål altid før dispatch, og skil uheld fra fysiologi i målingen.

Refs #4885 #4604 #4615 #4936 #4914
