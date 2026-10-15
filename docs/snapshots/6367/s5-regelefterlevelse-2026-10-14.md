# #6367 S5-generatoren overholder de låste kalenderregler (2026-10-14)

Ejer 14/10 kl. 21:40: "Ret generatoren" — ingen regel løsnes. Udgangspunkt: tørkørslen af S5 med det låste vindue onsdag 28/10 → lørdag 28/11 (`s5-dry-run-lordag-2026-10-14.md`).

> **Offentligt repo (hard rule 17).** Her kun kvalitative resultater. Fordelinger, før/efter-tal og robusthedsmålingen ligger i den gitignorerede `balance-internals/6367/` (filnavne nederst).

## Rodårsager

| Fund i tørkørslen | Rodårsag | Rettelse |
|---|---|---|
| §1d: D1 har klart flere løbsdage end D2-D4 | S5 havde intet mål i `SEASON_RACE_DAY_TARGET`, så aksen var pakkerens naturlige længde pr. division | **S5 = 160, ejer-go 14/10.** 32 løbsdatoer × 5 (samme regel som S4's 140, §1e-b) |
| §5: D1's bølget-familie under gulvet | Filler-terræn trukket frit pr. etape; ingen arketype garanterer bølget | Terræn-kvote pr. division (§7c) |
| §6: D1 bjerg over tolerancen, kuperet under; sæson-K-B uden for ±2 pp | S5's Grand Tours bygges af ejerens faste, bjergtunge kvoter, alle i D1, og intet i den frie filler kompenserede | Terræn-kvote pr. division |
| §6b: højbjerg og enkeltstart uden for ±2 pp i flere divisioner | Samme: en divisions andel var en stikprøve omkring vægtene, standardfejl på størrelse med tolerancen | Terræn-kvote pr. division |
| Bølgede etaper slutter i flad spurt, aldrig udbrud | Ikke en generator-fejl: S5 har ingen udbruds-afslutning (spec §3), og §7b dømmer ikke S5 (§7c) | Ingen kodeændring; ejer-spørgsmål (se nedenfor) |

## Hvorfor en kvote og ikke en ny vægt

Første forsøg var en søgt filler-tilt pr. division. Den kunne gøre S5's rigtige træk grønt, men på alternative parcours-træk af samme løbsudvalg faldt de samme regler igen: tilten flytter middelværdien, ikke spredningen. Det er præcis den klasse problem #5405 løste for finalerne (§7b, `balanceFinaleQuotas`). Kvoten fordeler derfor etapeløbenes filler-pladser over hele divisionens løbssæt, efter samme regler som gatesne dømmer.

## Resultat (offline, fixturen = prod-kataloget 14/10)

| Kørsel | Kommando | Resultat |
|---|---|---|
| Kalender-tørkørsel (samme kæde som `buildSeasonCalendar`) | `node scripts/dev/seasonCalendarGatesOffline.mjs --season 5 --first-day 2026-10-28 --last-day 2026-11-28` | Før rettelsen: reproducerer prod-tørkørslen 14/10 tal for tal. Efter, med `--race-day-target 160` (forslaget): §1d 160 i alle fire, §1e, §5, §6 pr. division, sæson-K-B og §6b grønne uden override. Eneste røde gate er benchmark-gatens del (4) motor (enkeltstart, #6362) |
| Robusthed | samme kæde over mange alternative parcours-træk | Før: ingen træk grønne. Efter: langt de fleste grønne; resterende fund ligger uden for filleren |
| Generator, 5 sæson-træk | `node scripts/dev/s5ProfileDryRun.mjs --first-day=2026-10-28 --last-day=2026-11-28 --seeds=5` | 0 etaper med type ≠ B+, 0 afslutninger uden for matrixen, alle tre Grand Tours rammer kvoten i alle træk |
| Golden diff | `node scripts/dev/calendarGoldenDiff.mjs --profile-model s5` | Placeringen identisk med den gyldne snapshot; benchmark del (1)-(3) grøn; del (4) rød (motor, som ovenfor) |
| S1-S4 | `node scripts/dev/calendarGoldenDiff.mjs` + pass1-golden | Uændret (v5-stien er bit-identisk) |

**Ikke kørt:** `buildSeasonCalendar --season 5` mod prod (read-only). Den offline kæde er den samme kode mod den samme katalog-snapshot; den bør køres mod prod før `--apply`.

## Åbent for ejeren

1. **§1d-tallet (ejer-beslutning, ikke sat i koden).** Briefen anbefalede 64 (D2-D4's tal). 64 kan ikke nås uden at løsne andre regler: D1 har langt flere naturlige løbsdage og padding kan kun tilføje, og et mål under 5 pr. dato bryder §1e's træningsrytme (målt: begge går røde). Forslag: 160, den samme regel som S4's 140. Tallet er spillervendt (træningens budget-deler, skader, sæsonskiftet), så `SEASON_RACE_DAY_TARGET` har intet S5-tal før ejerens ordrette go; indtil da har S5 intet mål, og uligheden (offline D1 91 · D2-D4 64) står i rapporten men stopper ikke `--apply` (scorecardet dømmer kun §1d med et mål), så S5 må ikke bygges med `--apply` før tallet er valgt.
2. **Benchmark del (4), enkeltstart.** Rød uafhængigt af kalenderen; ejer-valget fra #6362 (større ITT-spredning i motoren eller dom pr. distance) står stadig.
3. **Bølgede etapers afslutninger.** §7b's rolling-bånd forudsætter udbrud som afslutning; S5 har ingen (spec §3, #6368). Valg: (A) bliv ved benchmarken (flad spurt med en lille andel stigende spurt), udbrud måles på motorens udfald under #6368; (B) giv bølgede etaper en bakke-andel benchmarken ikke viser (spec-ændring). Anbefaling: A.

## Private filer (`balance-internals/6367/`, gitignoreret)

- `offline-gates-efter-6367.txt` — hele scorecardet efter rettelsen
- `generator-B-6367-quota.md` — s5ProfileDryRun, 5 træk
- `robusthed-40-traek-kvote.txt` — robustheden over alternative træk
- `s5-tilt-r*.json` — den forkastede tilt-søgning (dokumentation af hvorfor)

Refs #6367
