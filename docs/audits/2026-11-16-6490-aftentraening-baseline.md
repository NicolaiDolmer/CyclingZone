# #6490 Hurtigere aftentræning: målt baseline + teknisk design (16/11)

Kun læsning i prod (SELECT på `training_day_runs`, `training_date_work`, `teams`, `app_config`, `cron_checkins`, `action_timing_windows`, `pg_stat_statements` siden reset 8/11 15:17 UTC). Kode læst på `dea78fc6a` (main 16/11). Ingen kodeændring, ingen prod-skrivning.

## 1. Baseline: de seneste 8 aftener (assistent-afregningen)

| Dato | Hold | Afregninger | Første | Sidste | Varighed |
|---|---:|---:|---|---|---:|
| 8/11 | 249 | 1.245 | 20:00:30 | 23:15:33 | 195 min* |
| 9/11 | 244 | 1.220 | 20:06:01 | 20:53:59 | 48,0 min |
| 10/11 | 245 | 1.225 | 20:00:31 | 20:46:55 | 46,4 min |
| 11/11 | 248 | 1.240 | 20:00:31 | 20:55:39 | 55,1 min* |
| 12/11 | 247 | 1.235 | 20:00:30 | 20:49:08 | 48,6 min |
| 13/11 | 244 | 1.220 | 20:00:31 | 20:47:47 | 47,3 min |
| 14/11 | 249 | 1.245 | 20:00:31 | 20:43:28 | 42,9 min |
| 15/11 | 245 | 1.225 | 20:00:30 | 20:45:06 | 44,6 min |

\* 8/11: to menneskehold afregnet 21:05 og 23:15 efter huller på 22 og 130 min (venter på datoens afklaring, ikke langsom kørsel); hovedkørslen sluttede ca. 20:42. 11/11: ét hold efter et hul på 12 min. 9/11: ét AI-hold brugte 427 s (enkeltstående).

Alle datoer endte `complete` i `training_date_work` (260-262 hold pr. dato). Ca. 60 % af holdene i aftenkørslen er AI-hold (144-149 pr. aften, 33 ryttere pr. afregning mod 22-23 for menneskehold).

**Pr. hold (1.971 hold-datoer, 5 afregninger hver):** p50 8,4 s, p90 10,0 s fra første til femte afregning, plus ca. 2,3 s fra forrige hold til første afregning = **ca. 10,7 s pr. hold, ca. 2,1 s pr. løbsdag**.

**Seriel kørsel bevist:** 0 overlap mellem hold på alle 8 aftener (intet hold starter før det forrige er færdigt). `app_config`-nøglen `training_day_close_team_concurrency` findes ikke i prod, så `resolveTeamConcurrency` giver 1 (`backend/lib/trainingDayCloseTrigger.js:121-156`, `trainingDateClose.js:288/361`).

**Spillervendt:** åbning af træningssiden (`action_timing_windows`, `training_open`) kl. 20-21: vægtet p50 1.960 ms og **28 % over 3 s**; øvrige timer: p50 1.375 ms og 5,9 % over 3 s.

## 2. Hvor tiden går (langsomste trin)

| Trin | Målt | Andel af ca. 10,7 s pr. hold |
|---|---|---:|
| `commit_training_date_tick` (DB) | 10.151 kald, snit 124 ms, 265 KB WAL pr. kald | ca. 0,6 s (6 %) |
| Øvrige læsninger pr. løbsdag | ca. 20-25 sekventielle `await` i `runTeamTrainingDay` (flag, `training_day_runs`, `training_date_work`, riders, kvitteringer, `training_race_loads`, curve B, rolle-udbytte, XP, holdrække, løbsfakta, etapeprofiler, celler/katalog-flag, træthedsregler, stab, læge, sygdomshistorik, skade-kalender) | resten, ca. 9-10 s |
| Gentagelse | Alle hold-niveau-læsninger gentages for hver af de 5 løbsdage | x5 |

Databasen er ikke flaskehalsen efter GIN-droppet (#6663). Det er antallet af sekventielle rundture backend → Supabase, gange 5 løbsdage, gange 245 hold i én kø.

**Bevis for at hukommelses-stien virker:** "Træn nu" bruger allerede `pressMemory` + `pressReads` (`backend/lib/trainNowWholeDay.js:176-189`, `dailyTrainingEngine.js:810-905`), som læser holdets data én gang og forudhenter løbsfakta parallelt. Samme 8 dage: manager-hold p50 **6,8 s for 5 løbsdage med 43 ryttere**, aftenkørslen p50 **8,4 s med 29 ryttere**. Pr. rytter ca. 2x hurtigere. Aftenkørslen kalder `runDay` uden `pressMemory`.

## 3. Designmuligheder

### A. Hold-parallelitet via eksisterende knap (ingen kode)
Sæt `training_day_close_team_concurrency` til 4 (hold er uafhængige; `forEachTeamBounded` og paritetstesten findes).
- Gevinst: ca. 45 min → ca. 12-15 min (skøn; Codex' lokale PG17-måling 10/11 gav 1,7-2,7x ved 4 i SQL-delen; rundtur-ventetid paralleliserer bedre end SQL).
- Risiko: lav-mellem. Firedobler samtidigt skrivetryk i 10-15 min; WAL i alt uændret. Træningssiden er allerede langsom kl. 20 (28 % over 3 s) og skal måles under forsøget. Rul tilbage ved at slette nøglen.
- Krav: ejer-go (prod-config, AGENTS: hæve tallet er ejer-skridt efter #5904). Første aften med 2, derefter 4.

### B. Aftenkørslen genbruger "Træn nu"-hukommelsen (lille kodeændring)
Lad `runNormalizedTrainingDateSweep` kalde løbsdagene for ét hold med `pressMemory`, `pressReads: true` og `pressRuns`, ligesom `trainNowWholeDay.js`.
- Filer: `backend/lib/trainingDateClose.js` (løkken linje ca. 437-450), evt. en lille hjælper delt med `trainNowWholeDay.js`; tests i `trainingDateClose*.test.js`.
- Gevinst: ca. 2x pr. hold (målt på manager-stien), dvs. ca. 45 → ca. 22-25 min alene; sammen med A ca. 6-8 min.
- Risiko: mellem. Hukommelses-stien falder allerede tilbage til fuld læsning, når den ikke kan planlægge en dag (`return null`), men aftenkørslen har deadline-/karantæne-/afgangsfelter som Træn nu ikke rammer. Kræver paritetstest (samme rapporter/kvitteringer med og uden hukommelse) og bag kontakt.

### C. Fjern AI-hold fra træningen (ejerens model 10/11)
Ejer 10/11: AI-hold skal slet ikke træne. I dag er 144-149 af ca. 247 hold i aftenkørslen AI-hold (ca. 60 % af holdene, ca. 70 % af rytter-afregningerne).
- Gevinst: ca. 45 → ca. 18 min uden andre ændringer, og ca. 70 % mindre WAL/plads fra træningstabellerne.
- Risiko: høj spildesign-effekt (AI-ryttere udvikler sig ikke længere; påvirker balance, transfermarked, løbsresultater). Kræver eget design og ejer-go; tilstandsvedligeholdelse (form/træthed) for AI-ryttere skal afklares særskilt.

### Anbefaling
A først (knap, kan måles i aften), så B (største tekniske gevinst, mindst designrisiko), C som separat ejerbeslutning. Mål efter hver: første→sidste afregning, kald > 2 s, WAL pr. kald, `training_open` over 3 s kl. 20-21.

## 4. Reproduktion
Forespørgslerne grupperer `training_day_runs` pr. `tick_date`, `executed_by` og `team_id` (min/max `created_at`), joiner `teams.is_ai`, og beregner huller med `lag(max(created_at)) over (partition by tick_date order by min(created_at))`. Øvrige tal: `pg_stat_statements` (reset 8/11) og `action_timing_windows` (action `training_open`).
