# Race Hub — kalender-overlap via parallelle spor (design)

> **Status:** udkast til review · **Dato:** 2026-06-23 · **Branch:** `feat/race-hub-0c-base-riders`
> Forudsætning for bund-rytter-fasen (oprindeligt kaldt "Fase 0c"). Brainstormet datadrevet med ejeren.
> SSOT for hele redesignet: [`2026-06-23-race-hub-redesign-design.md`](2026-06-23-race-hub-redesign-design.md). Memory: [[project-race-hub-redesign]].

## 1. Formål

Race-hub-redesignet hviler på én låst kerne-mekanik: **løb overlapper i tid → en rytter kan kun køre ét løb ad gangen → fordeling af truppen er spillet** (SSOT §3.1). Fase 0a byggede bindingen, 0b den proaktive entry-generator. Men en empirisk verifikation mod prod 2026-06-23 afslørede at **kalenderen ikke producerer overlap**: bindingen er korrekt bygget, men praktisk talt inaktiv.

Dette projekt indfører ægte tids-overlap i sæson-kalenderen, så binding/fordeling bliver et reelt spil — og så vi kan måle hvor stort bund-rytter-behovet faktisk er, når overlap er aktivt.

## 2. Baggrund (verificeret mod prod 2026-06-23)

Tre fund fra read-only prod-analyse (`backend/scripts/dev/snapshot-0c-population.mjs`, `diag-0c-overlap.mjs`, `diag-0c-season-state.mjs`):

1. **Bund-ryttere findes allerede.** `starterSquadAllocator.js` (#1103/#1487/#1563) giver hvert hold 8 bevidst svage ryttere (stat-vindue 50-57 → afledte top-evner ~5-21; 4 unge + 4 domestiques) ved både relaunch og signup. Bund-rytter-FASEN handler derfor om *antal/styrke*, ikke indførelse.

2. **Nul tids-overlap i den nuværende kalender.** `planRaceSchedules` (i `backend/scripts/backfillRaceScheduledFor.js`) pakker hver puljes etaper i **én sekventiel stream** (global `stageCursor`, `STAGES_PER_DAY=2` på slots 12:30+15:00). Hvert løbs etaper er konsekutive → løbene står i kø efter hinanden. Peak samtidige løb = **1 i alle 7 puljer**. SSOT'ens antagelse "2 løb samme dag = overlap" var forkert: binding er tids-baseret, og to løb på 20:00 vs 21:00 samme dag overlapper ikke.

3. **Fyldnings-baseline (uden overlap):** 0b-generatoren fylder i dag **≥1 rytter på 89%** og **fuldt hold på 72%** af hold×løb-slots. De manglende 28% skyldes hold med for få ryttere *totalt* (især AI-hold med 0-5; nogle ægte hold på 5-7) — ikke binding. Ægte hold: median 8 ryttere, alle 27 under 12. Med overlap aktivt vil fuldt-hold-graden falde markant — det er det vi vil måle.

4. **Sæson 1 er frisk:** 0/102 løb har afviklede etaper; alle 312 etape-tider er fremtidige (efter incident-recovery 23/6). 72 manuelle (manager-udtagne) entries eksisterer.

## 3. Låste beslutninger

1. **Retning:** Indfør overlap nu som selvstændig mangel; bund-rytter-kalibrering følger som separat fase mod de ægte overlap-tal. (Ejer-valg 23/6.)
2. **Overlap-niveau: 2 spor (moderat).** To samtidige løb pr. pulje det meste af tiden. Et 8-rytters hold kan fylde ét løb fuldt + et reduceret/svagere hold i det andet → tydeligt fordelings-valg uden at være umuligt. (Ejer-valg 23/6.)
3. **Grand tours kører i deres eget spor** og binder kerne-truppen i hele varigheden; nabosporet fortsætter. Den eneste sammenhængende mekanik (et grand tour ER et stort commitment). Ingen særbehandling.
4. **Uændret tempo/sæson-længde.** 2 spor × 1 etape/dag = stadig 2 etaper/dag/pulje. `STAGES_PER_DAY` og `MAX_STAGES_PER_DAY` er uændret.
5. **Anvendelse:** byg mekanik + materializer-integration (alle fremtidige sæsoner) + simulér effekten + re-schedule den live sæson 1. Selve prod-skrivningen kræver ejerens eksplicitte go. (Ejer-valg 23/6.)

## 4. Mekanik — parallelle spor

### 4.1 Kernen (`planRaceSchedules`)

Udskift den globale sekventielle `stageCursor` med **N parallelle spor** (N=2):

1. Sortér puljens løb deterministisk (uændret: `name`, så `id`).
2. **Fordel løb på spor balanceret på etape-sum** (greedy: tildel hvert løb til sporet med færrest kumulative etaper). Dette holder sporene nogenlunde lige lange, så de afsluttes omtrent samtidig (minimerer "hale" hvor kun ét spor stadig kører).
3. **Pr. spor, planlæg løbene sekventielt, 1 etape/dag, på sporets faste slot:** spor 0 → slot 12:30, spor 1 → slot 15:00 (de første N slots i `STAGE_SLOTS_CET`). Spor `t`, kumulativ etape-index `k` i sporet → `dag = from + k + 1`, `slot = STAGE_SLOTS_CET[t]`.
4. `races.scheduled_for` = løbets etape-1-tid (uændret semantik).

**Resultat:** spor 0 og spor 1 kører parallelt fra dag 1. På en given dag har spor 0 én etape (12:30) og spor 1 én etape (15:00) — to forskellige løb aktive samtidig. Et stage race i spor 0 (vindue dag X–dag X+6) overlapper hvert spor-1-løb der falder i det span → binding aktiveres.

**Determinisme bevares:** ingen `Date.now()`/random i kernen; spor-fordelingen er en ren funktion af den sorterede løbsliste. Dry-run == apply.

**Bagudkompatibel signatur:** behold `planRaceSchedules({ races, from, slots, stagesPerDay })`; tilføj `tracks = STAGES_PER_DAY` (antal parallelle spor, default 2). `tracks=1` reproducerer nøjagtigt den nuværende sekventielle adfærd (regressions-sikkerhed + escape hatch).

### 4.2 Edge-cases

- **Asymmetriske etape-summer:** greedy-balancering håndterer det; et spor kan slutte få dage før det andet → de sidste dage har kun ét aktivt løb. Acceptabelt (overlap = "det meste af tiden").
- **Pulje med 1 løb:** ét spor, intet overlap. Trivielt korrekt.
- **`tracks > antal slots`:** clamp til `slots.length` (defensivt).

## 5. Materializer-integration

`seasonCalendarMaterializer.js` kalder allerede `planRaceSchedules({ races: insertedRaces, from })` pr. pulje (§5b). Når kernen får `tracks=2` som default, får **alle fremtidige sæsoner** overlap automatisk uden yderligere ændring. Verificér at `from`-ankeret er pr-pulje-konsistent (det er det — samme `from` pr. kald).

## 6. Sæson 1 re-scheduling

Et idempotent script (`backend/scripts/dev/reschedule-overlap.mjs`, dry-run default) der:

1. Læser sæson 1's `scheduled` løb pr. pulje (samme filter som materializeren).
2. Kalder den nye `planRaceSchedules({ tracks: 2 })` pr. pulje fra et fælles anker (fx i morgen, eller bevar nuværende start-dag).
3. **Dry-run:** rapporterer ny peak-concurrency pr. pulje + binding-konflikt-scan (se §6.1) + intet skrives.
4. **Live (ejer-go):** opdaterer `races.scheduled_for` + erstatter `race_stage_schedule` (delete+insert pr. løb, som backfill-scriptet allerede gør). Kun `scheduled`-løb (0 afviklet → ufarligt).

### 6.1 Binding-konflikt i de 72 manuelle entries

De manuelle udtagelser blev lavet under den sekventielle kalender (ingen binding). Efter reschedule kan en manager have samme rytter i to nu-overlappende løb.

- **Detektor:** pr. (team), saml manuelle entries' (rider, race-vindue); flag ryttere i overlappende vinduer.
- **Default-resolve (bevarer binding-invarianten):** fjern den konfliktende rytter fra det **kronologisk senere** løb (holdet bliver underbemandet dér, ikke dobbeltbooket). Holdet kan re-udtage via UI.
- Dry-run rapporterer antallet **først**; resolve køres kun i live-kørslen. Givet at managere typisk udtager forskellige hold til forskellige løb, forventes få/ingen konflikter (måles, ikke antages).

## 7. Simulér-før-ship — scorecard

Read-only harness (`backend/scripts/dev/simulate-overlap-fill.mjs`) der genbruger de rene byggeklodser (`assignTeamAcrossRaces`, `selectionSizeForRace`, `autopickTeamSelection`):

1. Læs prod-population: eligible hold, ryttere + abilities + fatigue, races (stages, race_class, league_division_id).
2. Generér **overlap-kalender in-memory** (ny `planRaceSchedules`, tracks=2) → vinduer pr. løb.
3. Pr. pulje, pr. hold: byg teamRaces med overlap-vinduer, kald `assignTeamAcrossRaces`, mål picks vs. `selectionSizeForRace`.
4. Kør samme mod den **sekventielle baseline** (tracks=1) for direkte sammenligning.

**Scorecard (overlap vs. baseline):**
| Metrik | Baseline (sekventiel) | Mål-signal |
|--------|----------------------|------------|
| Felt-fyldning ≥1 rytter | 89% | falder med overlap |
| Felt-fyldning **fuldt hold** | 72% | **primær** — hvor slemt bliver det? |
| Andel auto-no-shows (hold der slet ikke kan stille til et overlappende løb) | ~0 ved peak=1 | stiger |
| Styrke-spredning i felterne (p10–p90 holdstyrke) | — | forbliver konkurrencedygtig? |
| Peak-concurrency pr. pulje | 1 | ~2 |

Output bliver baseline-input til bund-rytter-fasen (hvor mange ekstra svage ryttere skal til for at løfte fuldt-hold-graden tilbage mod et acceptabelt niveau).

## 8. Afgrænsning (ud af scope)

- **Bund-rytter-antal/styrke:** næste fase, kalibreret mod scorecardet her.
- **Selve race-afviklingen** (scheduler, resultat-pipeline): uændret — den læser `scheduled_at` som før; overlap er blot en anden fordeling af tider.
- **3+ spor / variabel intensitet:** parameteren `tracks` understøtter det, men kun `tracks=2` ships nu.
- **Mål-løb solo-kørsel (Lag 0):** fremtidig finjustering; alle løb er i spor-rotationen nu.

## 9. Test-strategi

- **`planRaceSchedules` enheds-tests:** `tracks=1` == nuværende output (regression); `tracks=2` → to løb på samme dag forskellige slots; balancering; determinisme (samme input → samme output); grand tour binder hen over nabospor (vindue-overlap assertion).
- **Materializer-test:** verificér at default nu giver tracks=2 uden at bryde eksisterende idempotens-tests.
- **Reschedule-script:** dry-run mod prod-klon/capture; binding-konflikt-detektor enheds-testet.
- **Simulér-harness:** kør mod prod (read-only) — verdict-tal, ingen writes (capture-mønster som `dry-run-entry-generator-prod.mjs`).
- Fuldt CI-gate-sæt før PR (verify-local + lint + i18n + warning-budget).

## 10. Risici

- **Prod-data-mutation (sæson 1 reschedule):** ikke SQL/schema, men muterer `scheduled_at` + `scheduled_for`. Mitigering: 0 afviklet, idempotent delete+insert, dry-run-først, ejer-go på live-kørsel, verificeret backup (`cyclingzone-20260622-153339`) + PITR.
- **Binding-konflikt i manuelle entries:** §6.1 detektor+resolve; måles før resolve.
- **Scheduler-throughput:** uændret (2/dag/pulje); MAX_STAGES_PER_DAY rører vi ikke.
- **Loop-guard:** 2 CI-fails på samme symptom → STOP + spørg.

## 11. Relation til bund-rytter-fasen ("0c")

Dette projekt er forudsætningen: det gør overlap ægte og leverer det empiriske scorecard. Bund-rytter-fasen bruger scorecardet til at kalibrere hvor mange ekstra bevidst-svage ryttere `starterSquadAllocator` skal tildele (antal/styrke/påfyldning — fødsel/akademi/free agents), så hold *kan* dække overlappende løb men stadig har incitament til at bygge eget. Den fase følger samme simulér-før-ship-disciplin.
