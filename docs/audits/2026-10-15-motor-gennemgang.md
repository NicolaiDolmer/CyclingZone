# Motor-gennemgang 15/10: Discord, GitHub og prod mod virkelig cykelsport

Read-only. Kilder: Discord (dansk-snak, general, Q&A m.fl., 2/10-15/10; forum-tråde ikke dækket), alle åbne motor-issues, prod-data 28/9-15/10 (662 etaper, ~80.000 etaperesultater, 104 etapeløb). Benchmark: 315 rigtige GT-etaper 2021-2025 (`backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json`).

## Brænder (spillerne ser forkerte resultater nu)

| # | Fund | Tal | Kode | Issue |
|---|---|---|---|---|
| 1 | Managerens beskyt/spar overskrives til "normal" | 10.898 ordre-linjer, 0 med andet end "normal"; 4.132 valg tabt, 40 hold | `raceStageRoles.js:64`, `tacticsPlan.js` | #6647 (ny) |
| 2 | Kunstigt 3-sekunders trin i målet | Bjerg: nr. 2 på præcis +3 s i 84/137 etaper; højbjerg 47/85; top-5 som 0/3/5/8/10 | `engine/v4/finale.ts:819,849`, `tuning.ts:107,176-178` | ingen |
| 3 | Enkeltstart for tæt / betyder for lidt mod bjerg | gap10 41-45 s mod 60 s; spillere 13-15/10 | `mechanics/individualTimeTrial.ts` | #6645 (i gang), #6595 |
| 4 | GC vindes fra udbrud | GC-vinderen i udbrud i 53 % af løbene (virkelighed < 10 %); hunters top-10 i 44 % mod kaptajner 22 % | `gcThreat.ts`, `breakawayPermission.ts`, `teamChaseReaction.ts` | #5978 (delvist) |
| 5 | For stor dominans | De bedste vinder 46-57 % af starterne (Pogačar 2024 ~29 %); bedste klatrer vinder 56 % af korte etapeløb | `finale.ts` evneled, ingen dagsform | #2557 (v3), intet v4 |
| 6 | Feltet knækker urealistisk / gab forkert skaleret | Korte etapeløb: median 9 min til nr. 10 (virkelighed 1-3); GT-højfjeld kun 37-92 s; juniorer bakket gap10 220 s; 14 etaper med nr. 2 > 5 min | `groupClock.ts`, segmentLoop | #4914, #6464 (kun D2-D4 bjerg) |
| 7 | Udbrud vinder næsten aldrig på højbjerg | 8 % (virkelighed 30-40 %); bjerg 35-43 % | `breakaway.ts:1831-1835`, `tuning.ts:915` | #6201 (delvist) |

## Vigtigt

| # | Fund | Tal | Issue |
|---|---|---|---|
| 8 | Trøjerne samles på én rytter | GC-vinder tager bjergtrøjen 54 %; GC+point+bjerg 24 %; sprinter vinder pointtrøjen 33 % (virkelighed 60-70 %) | ingen |
| 9 | Ingen træthed over tre uger | Top-10 bliver bedre i uge 3; `training_race_loads` ens for alle pr. etape; GT 17 etaper over 28 spildage | #5928, #4850 |
| 10 | Formtoppe virker ikke i v4 | lovet +6 til +29; 854 brugte toppe | #6156, #6158 |
| 11 | AI-hold systematisk svagere | AI ~53 % af holdene, 21 % af GC-sejrene; AI-hjælpere taber dobbelt så mange pladser | ingen |
| 12 | For få udgåede | 1,5-2,4 % (GT 8-15 %); 0,27 % pr. etapestart | ingen |
| 13 | Flade etaper uden tidstab | hele feltet på +0:00 i mindst halvdelen; ingen vifter | #2476 |
| 14 | Løbsintentionens 5 niveauer ikke tændt | flag-række mangler i prod | #6641 |
| 15 | Sprinttog-UX | kræver kaptajn, ingen forklaring | #6321, #6462, #6552 |
| 16 | Tidslinje og resultat uenige om udbrud | 3/54 etaper efter #6632 | ingen |
| 17 | Skade uden kilde i klassikere | Discord 5/10 | ingen |

## OK (måler som virkeligheden)
Favorit vinder massespurt 43 % · gap10 bjergtop 91 s mod 102 · bakket/bølget gap10 · gennemsnitsfart pr. terræn · udbrud dannes i 95-99 % · 62 forskellige vindere i 84 seniorløb · rollen kaptajn/hjælper betyder noget · tidslinjens vinder = resultatets vinder 780/780.

## Spillernes brug af værktøjerne
64 % af udtagelserne er auto-udfyldt, 18,5 % af hold-etaperne har taktik, 0 af 1.101 peak-planer låst. Delvist en konsekvens af #1: valgene virker ikke, og effekten kan ikke ses.

## Verdensklasse-retning (forslag, ikke besluttet)
1. Kontinuerlig målfysik: gab fra watt/kg × resterende stigning og løsrivelse, ikke score-trin.
2. Dagsform/"jour sans" pr. rytter og dag, forklaret bagefter i løbsloggen.
3. Udbrud mod feltjagt som et rigtigt regnestykke mellem holdene (GC-fare koster snor).
4. Kumulativ udmattelse fra motorens egen arbejdsmængde gennem kalenderen med rigtige hviledage.
5. Trøjestrategi som egen beslutning (point/KOM/bonussekunder).
6. Beslutnings-kvittering efter hver etape + kontrafaktisk "hvad nu hvis" med samme seed.
7. Offentligt realisme-dashboard: motoren mod virkeligheden, dagligt.
