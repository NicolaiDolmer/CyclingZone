# Undersøgelse #8026: ingen skjult holdplan, rytterens faste træning (design)

Undersøgelsesspor (kind: investigate, #5220), 23/11. Kun læsning: kode på `main` og SELECT mod prod. Ingen kode, ingen DB-skrivning. Regel fra ejeren 23/11 (PC1, ordret på #7456): ingen holdplan som skjult lag. En rytter med "Intet program" har én fast træning, som manageren vælger i I dag; den gælder hver dag, til den ændres. "Tilbage til holdets program" fjernes. "Fjern program" er den eksisterende menu i PROGRAM-kolonnen. Overgang: rytteren beholder den træning, holdplanen giver ham på tændingsdagen.

Dette dokument dækker leverancen, der i briefen hed `2026-11-23-8026-ingen-skjult-holdplan-design.md`. Bølgens leveranceregel (#8233) kræver dette filnavn.

## 1. Målt baseline i prod (SELECT, 23/11)

Population: aktive menneskehold (ikke AI, bank, test, parkeret eller nedlagt) og deres ikke-pensionerede ryttere i den aktive sæson. Kolonner er slået op i `database/schema-snapshot.json`. Kun andele, ingen spillertal.

| Måling | Andel |
|---|---|
| Hold med en holdrække (`training_week_plans.rider_id IS NULL`) | ca. 20 % af holdene |
| ... heraf med programceller (session) eller rotation | 0 % (alle er rene intensitetsrytmer) |
| ... heraf ændret de seneste 30 dage | under 10 %; ingen de seneste 7 dage |
| Ryttere med egen række (program/egen ugeplan) | ca. 30 % |
| Ryttere i en gruppe der følges | ca. 8 % (gruppen kopieres ind i rytterens egen række) |
| Ryttere uden egen række, men med egen plan (`training_plans`) | ca. 52 % |
| Ryttere uden egen række og uden plan | ca. 18 % |
| **... heraf på et hold med holdrække: følger i dag den skjulte holdplan** | **ca. 1 % af rytterne, fordelt på ca. 6 % af holdene** |
| Ryttere med egen plan på et hold med holdrække (holdrækken rører dem ikke, lag 2 vinder) | ca. 14 % |

Holdene, hvor ryttere følger den skjulte holdplan:
- ca. tre fjerdedele har en blandet rytme (forskellig intensitet på ugedagene),
- ca. tre ottendedele har mindst én hviledag i rytmen,
- ingen af rytterne er i en gruppe eller har en halv plan.

**Konklusion:** den skjulte holdplan findes og virker i motoren, men rammer en lille gruppe. Sådan rammer den: en rytter, der står som "Intet program" og "No day" i I dag, træner alligevel holdrækkens intensitet for ugedagen med assistentens fokus. Det står ingen steder på hans række. Desuden kan en rytter, der mister sin egen plan via "Back to team program", falde ned i laget uden at se det.

## 2. Hvor motoren læser holdlaget, og hvad der skal ændres

### Læsestier (main 23/11)

| Fil | Sted | Hvad den gør i dag | Ændring |
|---|---|---|---|
| `backend/lib/dailyTrainingEngine.js` | load (`training_week_plans` `.eq(team_id)`, ca. l. 1409) og `teamWeekDays` (ca. l. 1810), sendt til `resolveDayProgram` (ca. l. 1878) | Henter hold- og rytterrækker i ét kald. Holdrækken bliver lag 3 | Bag kontakten: `teamWeekDays = null`, og `programsOn` regnes kun på rytterrækker. Loadet kan blive (ingen skema-afhængighed) |
| `backend/lib/trainingPrograms.js` | `resolveDayProgram`, "Lag 3: holdets raekke" (ca. l. 430) | Holdets celle/intensitet, når rytteren hverken har egen række eller plan | Laget fjernes, når kontakten er tændt (parameter `teamLayer=false`). Stigen bliver: egen række, så egen plan, så default |
| `backend/lib/training.js` | `resolveDayIntensity` trin 3 (ca. l. 488) | Samme som ovenfor (intensitet) | Samme parameter. Funktionen er delt med visningen |
| `frontend/src/lib/training.js` | `resolveDayIntensity` + `resolveDayIntensitySource` (l. 110-135) | Visningen siger "holdets" som kilde | Spejles: kilden "team" udgår |
| `backend/lib/trainingWeekPlanForecast.js` | `teamWeekDays` (l. 118, 151, 348) | Ugeprognosen regner holdlaget med | Samme flag, **samme PR som motoren**. Ellers viser prognosen noget andet end det, motoren gør |
| `backend/lib/trainNow.js` | l. 697-698 (`teamRow`) | Train now læser holdrækken som fallback | Samme flag |
| `backend/lib/trainingWeekPlanCells.js` | `seedProgramWeekDays` l. 74 | Et nyt program podes fra holdrækken, når rytteren intet har | Podes fra rytterens faste træning (`training_plans`) i stedet |
| `backend/routes/trainingPrograms.js` l. 169, `backend/routes/trainingGroups.js` l. 110 | `teamDays` sendt til seed | Som ovenfor | Som ovenfor |
| `backend/routes/api.js` | `PUT`/`DELETE /training/week-plan` (l. 3648-3708) | Skriver/sletter holdrækken | Bag kontakten: 410 med forklaring. "Hele holdet" er `POST /training/bulk` (massehandling, skriver `training_plans` pr. rytter) og findes allerede |

### Regelteksten
`docs/TRAINING_RULES.md` §4: tabellen får fire lag. Lag 3 (holdets ugerytme) strøges med en dato-note: "fjernet #8026, ejer 23/11: ingen skjult holdplan; hele holdet = massehandling". Teksten om #2438 bliver stående som historik.

### Dommer-scenarie ROT-9 (`docs/audits/7456-program-dommer-scenarier.md`)
ROT-9 ("holdets række har rotation, rytter har egen eksplicit plan, egen plan vinder") mister sin forudsætning. Ingen holdrække har rotation i prod (0 %), og efter skiftet læses holdrækken ikke. Den erstattes af ROT-9b: "Rytter uden program, holdrækken findes stadig i tabellen: motoren træner rytterens faste træning. Holdrækken har ingen virkning."

### Det, der allerede virker
`training_plans` (focus, intensity pr. rytter pr. sæson) er allerede "fast træning". Den gælder hver dag (lag 2), vinder over holdlaget, og sæsonskiftet kopierer den (`seasonCarryOver.js`, flade 1, COPY). I dag skriver valget i R5 for en rytter uden program netop dertil (`POST /training/:riderId`). Motoren mangler altså ikke en ny datakilde. Den skal kun holde op med at læse den skjulte.

## 3. Datamodel og overgang

### Model
Der kommer **ingen ny tabel**. Rytterens faste træning er `training_plans`-rækken. Én additiv, idempotent migration til sporbarhed:

```sql
alter table public.training_plans add column if not exists origin text;           -- 'manager' | 'transition_8026'
create table if not exists public.training_week_plans_team_backup_8026
  (like public.training_week_plans including all);                                  -- arkiv (regel 38)
```

Holdrækkerne slettes ikke ved tænding. De arkiveres i backup-tabellen og bliver liggende uden virkning. Sletning er et senere, ejer-gated skridt.

### Overgangsscript (`backend/scripts/transition8026FixedTraining.mjs`)
1. **Dry-run (standard):** for hver rytter uden egen række og uden plan på et hold med holdrække beregnes det, `resolveDayProgram` giver ham på tændingsdagen (assistentens fokus + holdrækkens intensitet for ugedagen). Udskriften viser pr. hold (anonymiseret) og pr. rytter: dagens resultat, og om det er hvile.
2. **Backup:** holdrækkerne kopieres til `training_week_plans_team_backup_8026` (`insert ... on conflict do nothing`).
3. **Skriv (kun med `--apply` og ejer-go):** `training_plans` upsert `(team_id, rider_id, season_id)` med `origin='transition_8026'`, kun hvor der ingen række er (`on conflict do nothing`). Scriptet er idempotent og kan køres igen uden virkning.
4. **Verifikation:** derefter skal andelen af ryttere uden egen række og uden plan på hold med holdrække være 0.

**Risiko, der kræver et ejer-svar før tænding:** ca. tre ottendedele af de berørte hold har en hviledag i rytmen. Falder tændingsdagen på en hviledag, får rytteren "hvile hver dag" som fast træning. Det er en tavs nedlukning. Anbefaling: dry-run vælger en tændingsdag, der ikke er hviledag for nogen af de berørte hold. Findes der ingen, tager rytteren rytmens hyppigste træningsintensitet. Begge varianter står i dry-run-udskriften til ejeren.

Ryttere uden plan på hold **uden** holdrække (ca. 17 %) rører scriptet ikke. De har i dag assistentens dag, og I dag viser dem allerede som "No day · Use assistant's X". Det er synligt og ikke et skjult lag.

## 4. UI-ændringer

**TodayR5** (`frontend/src/components/training/r5/TodayR5.tsx`):
- `YourDayLine` (l. 321-340): ved `program.kind === "none"` fjernes knappen `program.backToTeam`. Linjen bliver "Din dag: Sprint, Hård · gælder hver dag" (ny nøgle `yourDay.everyDay`, en+da). For ryttere med program bliver `yourDay.backToProgram` ("mit tryk vinder i dag", ejer 12/11).
- `ProgramButton` (l. 239-262): menupunktet `program.backToTeam` omdøbes til "Intet program" / "No program" (= "Fjern program"). Handlingen er ny: fjern kun rytterens egen række (program/gruppe-kopi) og skriv dagens træning fra programcellen som fast træning (`training_plans`), så rytteren aldrig står uden en dag. I dag sletter `handleResetToTeamProgram` (`TrainingPage.jsx` l. 1472) både rækken og `training_plans`, og så falder rytteren ned i holdlaget eller assistentens default.
- `frontend/src/components/training/ResetToTeamProgram.tsx` (gammel side) følger samme regel eller udgår med R5.
- i18n: `program.backToTeam` udgår begge steder. Patch note-linje (EN først, DA under), fx: "Riders with no program now keep one standing training you pick in Today; there is no hidden team plan any more. Riders who followed the old team rhythm keep the training it gave them on [dato]."

**Program** (R5): det skjulte emne "holdet" bliver ikke genindført. "Hele holdet" er massehandlingen (vælg alle eller valgte, sæt samme træning). Den findes som `POST /training/bulk`. Den gamle sides "Plan for: holdet"-redigering (`PUT /training/week-plan`) slås fra bag kontakten.

Ejeren har krævet et før/efter-skærmbillede af netop disse rækker (I dag-rækken for "Intet program" og PROGRAM-menuen) før merge (#7456, 15:36). UI-beslutninger tages kun på billeder, der ligner spillet.

## 5. Dommer-scenarier til Fable

| Id | Opsætning | Forventet |
|---|---|---|
| FT-1 | Intet program, fast træning Sprint/Hård, holdrække med hvile søndag | Sprint/Hård hver dag, også søndag. Holdrækken har ingen virkning |
| FT-2 | Intet program, løbsdag (kører eller bundet) | Løb er løb: `racedToday`/`boundRestToday` som i dag. Den faste træning gælder igen næste dag |
| FT-3 | Intet program, skadet | Skadereglen vinder som i dag (ingen træning). Den faste træning er uændret efter skaden |
| FT-4 | Train now trykket, intet program | Samme resultat som aftenkørslen for den faste træning. `trainNow.js` læser ikke holdrækken |
| FT-5 | Program med rotation/ugeblokke, "Intet program" vælges i PROGRAM-menuen | Rækken fjernes. Dagens celle bliver fast træning. Næste dag samme træning (ingen rotation) |
| FT-6 | Program, manageren trykker en anden træning i I dag | Dagens felt i programmet rettes (ejer 12/11, A). Resten af ugen står uændret |
| FT-7 | Ny rytter (transfer/akademi) uden plan | Assistentens dag, synlig som "No day · Use assistant's X". Ingen arv fra holdrækken |
| FT-8 | Træthedsreglen (#4854) slår til på en rytter med fast træning | Reglen retter dagen, ikke den faste træning |
| FT-9 | Sæsonskifte | `training_plans` kopieres (seasonCarryOver flade 1). Den faste træning overlever |
| FT-10 | Overgang, tændingsdag = hviledag i holdrytmen | Dry-run flager det. Ejeren vælger dag eller hyppigste intensitet før `--apply` |
| ROT-9b | Afløser ROT-9 (se §2) | Holdrækken har ingen virkning |

## 6. Risiko og rækkefølge (bag én kontakt `training_no_team_layer`, standard OFF)

1. **PR 1 (motor + prognose + train now, ingen UI):** `teamLayer`-parameter i `resolveDayIntensity`/`resolveDayProgram` (backend og frontend), `dailyTrainingEngine`, `trainingWeekPlanForecast`, `trainNow`, seed-stierne. Flag OFF = bit-identisk (golden-test mod #7982-facit og `trainingWeekPlanForecastGolden7801`). Fable-dom før merge (motor). Opdatér TR §4 og ROT-9b.
2. **PR 2 (migration + overgangsscript):** additiv migration (origin-kolonne, backup-tabel). Scriptet med dry-run som standard. Migration apply post-merge (#2642). `--apply` kun efter ejer-go på dry-run-udskriften (destruktivt, ejer-gated).
3. **PR 3 (UI R5 + i18n + patch note):** `YourDayLine`, `ProgramButton`, ny "Intet program"-handling, `week-plan`-ruterne slås fra bag kontakten. Før/efter-billede til ejeren før merge.
4. **Tænding (ejer-go):** kør scriptet (backup → apply → verify), og tænd kontakten samme dag. Ellers er der et vindue, hvor de berørte ryttere står uden dag.

| Risiko | Afbødning |
|---|---|
| Hviledag frosset som fast træning | Dry-run-flag + valg af tændingsdag (§3) |
| Prognose og motor er uenige | Samme PR og samme flag. Golden-test på begge |
| "Intet program" efterlader rytteren uden dag | Ny handling skriver dagens celle til `training_plans` |
| Gammelt bundle kalder `PUT /training/week-plan` | 410 med forklaring bag kontakten. Ingen tavs skrivning |
| Holdrækker slettes for tidligt | Arkiv-tabel. Rækkerne bliver liggende uden virkning. Sletning er ejer-gated senere |

## Dom

Problemet er bekræftet. `resolveDayProgram`/`resolveDayIntensity` har et lag 3, der læser holdrækken (`training_week_plans.rider_id IS NULL`) for ryttere uden egen række og plan. I prod rammer laget ca. 1 % af rytterne på ca. 6 % af holdene, og ingen af dem kan se det på I dag-rækken. Fix-planen står i §2-§6.

bekraeftet + fix-plan
