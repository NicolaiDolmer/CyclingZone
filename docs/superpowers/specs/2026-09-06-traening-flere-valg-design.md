# Træning: flere valg (belastning, holdpas, træthedsgrænse), design 6/9 2026

> **Status: design-spec til ejer-godkendelse. Intet er bygget, ingen flag flippes, ingen prod-data røres.**
> SSOT for området er [`docs/TRAINING_RULES.md`](../../TRAINING_RULES.md). Reglerne bor der, ikke her.
> Rammen (løbsdagen som tick-enhed, program, træningsscore) er
> [`2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md`](2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md)
> plus `TRAINING_RULES.md` §13. Denne pakke bygger på den NUVÆRENDE session-model og skal virke uændret
> når tick-enheden bliver løbsdagen.
> **Præcise vægte, rater, multiplikatorer og tærskler står IKKE her** (hard rule 17,
> [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436): repoet er offentligt læsbart).
> Hvor et tal hører til, står konstant-navnet og filen med linjenummer.
> Mål: med i det nye træningssystem til sæson 4, live 28/9 2026.

---

## 1. Hvad dette dokument beslutter

Spilleren får tre nye valg i træningen: **belastning** (Let, Normal, Hård på samme session), **holdpas** (ét rollefordelt pas for en gruppe ryttere) og en **træthedsgrænse med reservepas** (holdregel plus undtagelse pr. rytter), alle bygget som ægte per-rytter-sessioner uden nye lag oven på rytterens eget valg.

---

## 2. Ejerens beslutninger 6/9

| # | Beslutning | Ejerens ord (ordret hvor citeret) | Konsekvens |
|---|---|---|---|
| 1 | **Belastning** i tre niveauer på SAMME session. Ordet "tempo" er afvist, fordi det kolliderer med sessionen og evnen Tempo | *"Måske skal vi bruge et helt andet ord end tempo generelt her?"* | Ny akse `load` på planen. Samme evner trænes. Let giver lidt mindre udbytte, lille træthed, ingen skaderisiko. Normal er som i dag. Hård giver lidt mere udbytte, stor træthed, højere skaderisiko. Session vælges først, belastning bagefter. Programmets default er Normal |
| 2 | **Holdpas, variant 2 (rollefordelt)**. Alle fem pas godkendt. Variant 1 ("samme pas til alle") er udskudt | *"Vent! 2 nu og så måske 1 senere"* | Fem holdpas med roller foreslået ud fra ryttertype og evner, spilleren kan bytte. Belastning vælges for hele passet. Udbytte pr. rytter er PRÆCIS den individuelle session for hans rolle. Ingen skjult bonus, ingen ny evne. Sættes både i dag fra rytterlisten og som fast programdag med gemt gruppe |
| 3 | **Træthedsgrænse med reservepas**: ÉN holdregel plus valgfri undtagelse pr. rytter | Ejer-direktiv 31/8 ([#4522](https://github.com/NicolaiDolmer/CyclingZone/issues/4522)): knapper der styrer hvad der sker på spillerens vegne, aldrig automatik motoren finder på | "Over træthed X: kør dagens pas på Let belastning, Aktiv restitution eller Hvile i stedet". Rytterens regel slår holdets, samme stige som `TRAINING_RULES.md` §4. Evalueres af motoren FØR dagens session køres, på rytterens træthed ved tick. Dage hvor reglen slog til markeres i ugestriben og rapporten |
| 4 | **Afvist: "Sæsonens udviklingsmål"** (ønskeliste der skifter session når loftet er nået) | *"Jeg synes faktisk ikke det her lyder som en særligt god ide til spillet. Jeg vil have mere fog of war inde på spillet."* | Princip for hele pakken: **ingen mekanik må gøre lofter eller skjult information synlige, og ingen mekanik må automatisere rundt om dem.** Det gælder også visninger, advarsler og assistent-tekster i denne pakke |

**Uændret fra tidligere beslutninger:** princip B (`TRAINING_RULES.md` §12.1), altså flere valg i stedet for håndholdt omfordeling. Motoren flytter aldrig spildt udbytte et andet sted hen.

---

## 3. Modellen pr. feature

### 3.1 Belastning (Load)

**Datamodel.** `training_plans` (kolonner i dag: `id, team_id, rider_id, season_id, focus, intensity, created_at, updated_at`, `database/schema-snapshot.json`) får `load text NOT NULL DEFAULT 'normal'` med `CHECK (load IN ('light','normal','hard'))`. Defaulten gør migrationen bit-identisk for alle eksisterende rækker: ingen rytter vågner op til en anden dag end i går. `training_week_plans.days[<ugedag>]` får et valgfrit `load` ved siden af `intensity`.

**Motor.** Belastningen er et NYT LED i faktor-kæden i `dailyAbilityDelta` (`backend/lib/dailyTraining.js:120-159`, kæden dokumenteret i `TRAINING_RULES.md` §2.1), ikke en ændring inde i `abilityMult` (`dailyTraining.js:87-103`).

- Ledet ganges ind efter fokus-multiplikatoren og er **præcis 1,0 for `normal`**, så nul-regression er bevisbar.
- Ledet rører IKKE `focusAbilityWeight` (`backend/lib/training.js:119-122`). Fordelingen mellem evnerne i en pakke er derfor bit-identisk på tværs af de tre belastninger, og `focusWeightSum` (`training.js:126-129`) er uafhængig af `load`. Det er invarianten der gør belastning til et valg og ikke til power creep: den skalerer HELE dagen, den omfordeler ikke inden for dagen.
- Trætheden: `DAILY_TRAINING_CONFIG.fatigueLoad` (`dailyTraining.js:23`) er i dag nøglet på intensitet alene. Den får en belastnings-dimension, hvor `normal` er identitet. `nextFatigue` (`backend/lib/riderCondition.js:31-45`) får `load` med i sin signatur.
- Skaderisikoen: `injuryRisk` (`riderCondition.js:86-91`) kræver i dag `intensity === "hard"` OG træthed over `injuryFatigueFloor`. Gaten omtolkes til belastning:

| Belastning | Skaderisiko |
|---|---|
| Let | Præcis 0, altid, uanset session og træthed |
| Normal | Som i dag: kun hvis sessionens intensitet er hård OG træthed over gulvet |
| Hård | Åben på enhver trænings-session, hvis træthed over gulvet |

- Hvile og Aktiv restitution har INGEN belastning. `programForChoice` (`backend/lib/trainingDayTypes.js:144-158`) returnerer `load: null` for dem, og skrivestien afviser en belastning på en dagstype der ikke har en session. Om færdighedsdage skal have belastning er åbent, se §7.
- Træningsscoren (`TRAINING_RULES.md` §13 beslutning 4) afgør om valget var klogt på dagen: Hård på en træt rytter giver lav score. Scoren er ikke bygget endnu, så belastningen skal kunne bygges uden den og kobles på når den lander.

**API-kontrakt.**

| Endpoint | Ændring |
|---|---|
| `POST /api/training/:riderId` (`backend/routes/api.js:3043`) | Body får `load`, valideres mod `programForChoice`. Udeladt felt betyder `normal` |
| `POST /api/training/bulk` (`api.js:2804`) | Samme felt, samme guard, samme partitionering (`partitionBulkTrainingTargets`, `training.js:203`) |
| `PUT /api/training/week-plan/:riderId` (`api.js:2972`) | `days`-entries accepterer `load`. `isValidWeekPlanDays` (`training.js:383-396`) udvides, stadig med kravet om alle 7 ugedage |
| `GET /api/training/me` (`api.js:2624-2751`) | `plans[riderId]` bærer `load` (fra `deriveTrainingState`, `training.js:157-174`). `condition[riderId].risk` beregnes med den PLANLAGTE belastning, ikke kun intensiteten (i dag `api.js:2723-2732`) |

**UI.** Træningssiden er T2 wide data (`docs/design/PAGE_TEMPLATES.md`) og har efter #4613 faner, hvor overblikket er `TabPanel value="today"` og tabellens egne kontroller ligger i toolbar-slotten inde i hairline-rammen (`origin/feat/4613-training-overview-first`, `frontend/src/pages/TrainingPage.jsx`).

- Tre chips **under sessionsvælgeren** i `frontend/src/components/training/FocusPanel.jsx`, i rækkefølgen Let, Normal, Hård. Sessionen vælges først, belastningen bagefter, så pakkelisten ikke bliver tre gange så lang.
- På rytterrækken vises belastningen som en kort markør i dags-cellen ved siden af sessions-segmentet (branch-linjerne omkring dags-cellen i `TrainingPage.jsx`), ikke som en fjerde knap. Chevron-menuen "Andet" åbner samme panel som i dag.
- Bulk-vælgeren i toolbaren får belastning som andet felt ved siden af dags-vælgeren, så en markering aldrig kan give en kombination en enkelt rytter ikke kunne få.
- Bindende: hairline-borders, tabular figures på numerik, stroke-ikoner, ingen emoji, én gold primary pr. view (den bliver siddende i sidehovedet).

**i18n (EN først, DA under), `frontend/public/locales/{en,da}/training.json`, ny blok `load`:**

| Nøgle | EN | DA |
|---|---|---|
| `load.label` | Load | Belastning |
| `load.light` | Light | Let |
| `load.normal` | Normal | Normal |
| `load.hard` | Hard | Hård |
| `load.note_light` | Same session, taken easy. Less gain, little fatigue, no injury risk. | Samme pas, kørt roligt. Mindre udbytte, lille træthed, ingen skaderisiko. |
| `load.note_normal` | The session as intended. | Passet som det er tænkt. |
| `load.note_hard` | Same session, pushed hard. More gain, much more fatigue, higher injury risk. | Samme pas, kørt hårdt. Mere udbytte, meget mere træthed, højere skaderisiko. |
| `load.bulkLabel` | Set load | Sæt belastning |

### 3.2 Holdpas (Team session)

**Datamodel.** Ny tabel `team_session_groups`:

| Kolonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `team_id` | uuid, fk `teams` | RLS: kun holdets ejer læser og skriver, samme mønster som `training_day_runs_select` |
| `kind` | text | `sprint_train` · `team_time_trial` · `mountain_train` · `cobbles` · `race_craft` |
| `rider_roles` | jsonb | `[{ rider_id, role }]`, roller valideres mod passets rolle-liste |
| `load` | text | `light` · `normal` · `hard`, gælder hele passet |
| `program_day` | text nullable | ugedagsnøgle (`WEEKDAY_KEYS`, `training.js:377`) når passet er en fast programdag, ellers NULL |
| `created_at`, `updated_at` | timestamptz | |

De fem pas og deres roller (rolle er ikke en ny evne, kun en opslagsnøgle til den individuelle session):

| Pas | Roller og deres session | Krav |
|---|---|---|
| Sprinttog | sprinter: `sprint` · sidste mand: `sprint` · hjælpere: `tempo` | mindst 1 sprinter |
| Holdtidskørsel | motorer: `threshold` · aero-mænd: `aero` | 4 til 6 ryttere |
| Bjergtog | kaptajn: `vo2max_climb` · bjerghjælpere: `threshold` | mindst 1 klatrer |
| Brostenstræning | kaptajn: `technique` · hjælpere: `loebslaere` | ingen |
| Løbslære i gruppe | alle: `loebslaere` | ingen |

**Motor.** Gruppen er en SKRIVESTI, ikke et lag. Der kommer INTET nyt led i `dailyTrainingEngine.js`'s pr-rytter-loop (`backend/lib/dailyTrainingEngine.js:283-465`).

- Sat i dag: `apply` skriver ægte `training_plans`-rækker pr. rytter gennem `programForChoice` (`trainingDayTypes.js:144-158`), præcis som et individuelt valg. Udbyttet er derfor pr. konstruktion identisk med at sætte hver rytter for sig.
- Som programdag: gruppen materialiseres til rytternes EGNE per-dag-entries i `training_week_plans` (`rider_id` sat), altså trin 1 i stigen i `resolveDayIntensity` (`training.js:422-436`). Det kræver at en dags-entry kan bære en SESSION og ikke kun en intensitet, se faseplanens PR 3. `resolveDayIntensity` får en søster, `resolveDaySession`, med SAMME prioritetsstige, så de to ikke kan divergere.
- Læringen 16/7 (`.claude/learnings/2026-07-16-training-routine-overrode-individual-setting.md`) holdes: gruppen SKRIVER rytterens egne rækker, og redigerer spilleren derefter en rytters dag manuelt, vinder den manuelle ændring indtil gruppen anvendes igen. Der findes ingen sti hvor holdet overtrumfer rytteren ved læsning.
- Løbsdag: kører en i gruppen løb den dag, springes han over (han kører løb), og de øvrige kører passet uden ham. Han får sin egen dags session. Manglende krav (fx sprinttog uden sprinter) giver en ADVARSEL ved anvendelse, og passet køres med de roller der kan fyldes.

**API-kontrakt.**

| Endpoint | Formål |
|---|---|
| `GET /api/training/team-sessions` | Gruppens definitioner til fladen |
| `POST /api/training/team-sessions` | Opret eller opdatér gruppe (kind, ryttere plus roller, load, program_day) |
| `DELETE /api/training/team-sessions/:id` | Fjern gruppe. Allerede skrevne planer røres ikke |
| `POST /api/training/team-sessions/:id/apply` | Skriv gruppens sessioner i dag. Svarer `{ applied, skippedRacing, warnings }` |
| `GET /api/training/me` | Response får `teamSessions: [...]` og `plans[riderId].groupId` til kædeikonet |

Rolle-forslag beregnes på serveren ud fra ryttertype og evner, aldrig i frontend, samme regel som `smartDefaultFocus` (`training.js:353-369`). Der eksponeres ingen caps eller potentiale-tal (server-hidden, #1162, fog of war jf. beslutning 4).

**UI.**

- **Holdpas** som handling i tabellens toolbar ved siden af bulk-bjælken (branchens toolbar-slot i `TrainingPage.jsx`): vælg ryttere med afkrydsning, vælg pas plus belastning, godkend roller, anvend. Ryttere der kører løb den dag er grå og kan ikke vælges.
- **Kædeikon** (stroke, ikke emoji) på de rækker der hører til samme gruppe, med gruppens navn i `title`.
- **Programdag** vises i Program-fanen som "Dag 4: Sprinttog" med gruppens ryttere foldet ud.
- Dialogen har sin egen primary-knap; sidens ene gold primary bliver i sidehovedet.

**i18n, ny blok `teamSession`:**

| Nøgle | EN | DA |
|---|---|---|
| `teamSession.label` | Team session | Holdpas |
| `teamSession.kind_sprint_train` | Sprint train | Sprinttog |
| `teamSession.kind_team_time_trial` | Team time trial | Holdtidskørsel |
| `teamSession.kind_mountain_train` | Mountain train | Bjergtog |
| `teamSession.kind_cobbles` | Cobbles session | Brostenstræning |
| `teamSession.kind_race_craft` | Race craft group | Løbslære i gruppe |
| `teamSession.role_sprinter` | Sprinter | Sprinter |
| `teamSession.role_last_man` | Last man | Sidste mand |
| `teamSession.role_helper` | Helper | Hjælper |
| `teamSession.role_engine` | Engine | Motor |
| `teamSession.role_aero` | Aero rider | Aero-rytter |
| `teamSession.role_captain` | Captain | Kaptajn |
| `teamSession.role_climbing_helper` | Climbing helper | Bjerghjælper |
| `teamSession.warnMissingRole` | No {{role}} in the group. The session runs with the roles you can fill. | Ingen {{role}} i gruppen. Passet køres med de roller du kan fylde. |
| `teamSession.skippedRacing` | {{n}} riders race today and keep their own day. | {{n}} ryttere kører løb i dag og beholder deres egen dag. |

### 3.3 Træthedsgrænse med reservepas (Fatigue limit)

**Datamodel.** Ny tabel `team_training_rules`:

| Kolonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `team_id` | uuid, fk `teams` | RLS team-scoped |
| `rider_id` | uuid nullable | NULL er holdreglen. Partielt unique-index pr. `(team_id)` når NULL og pr. `(team_id, rider_id)` ellers, så der findes præcis én holdregel og højst én undtagelse pr. rytter |
| `fatigue_threshold` | int | 0 til 100, spillerens eget tal |
| `fallback` | text | `light` · `recovery` · `rest` |

**Motor.** Reglen evalueres i `dailyTrainingEngine.js` mellem `preFatigue`-snapshottet (`dailyTrainingEngine.js:347`) og `effectiveIntensity` (`dailyTrainingEngine.js:360`), altså EFTER `resolveDayIntensity` (`:301-307`) og FØR tick'et.

- Ren funktion `resolveFatigueRule({ fatigue, riderRule, teamRule })` i `training.js`, uden `Date`, uden `Math.random`. Rytterens regel slår holdets, samme prioritet som stigen i §4.
- Input er rytterens træthed VED TICK (`preFatigue`), ikke resultatet af dagen. Det er samme grund som skaderisikoen har i dag: reglen skal svare på den tilstand spilleren kunne se.
- Udfaldet er ét af tre: samme session på Let belastning, Aktiv restitution, eller Hvile. Reglen ændrer ALDRIG `training_plans` (G5-invarianten: en skadet rytter og nu også en trætheds-udløst dag lader planen stå urørt).
- Skadede ryttere rammes ikke: `injuredToday` har fortsat forrang (`dailyTrainingEngine.js:334, 360`).
- Dage hvor reglen slog til stemples i rapport-rækken (`reportRiders`, `dailyTrainingEngine.js:280`) så ugestriben og rapporten kan markere dem.

**API-kontrakt.**

| Endpoint | Formål |
|---|---|
| `PUT /api/training/rules` · `DELETE /api/training/rules` | Holdreglen |
| `PUT /api/training/rules/:riderId` · `DELETE /api/training/rules/:riderId` | Undtagelsen pr. rytter |
| `GET /api/training/me` | Response får `rules: { team, riders: { <riderId>: ... } }` og `condition[riderId].ruleWouldApply` (bool), så fladen kan vise det FØR dagen køres |

**UI.** Én linje i Program-fanen: "Over træthed X: kør Let belastning i stedet". Undtagelsen sættes på rytterens dag i FocusPanel som en foldet linje under belastnings-chippene. Dage hvor reglen slog til markeres i ugestriben.

**i18n, ny blok `fatigueRule`:**

| Nøgle | EN | DA |
|---|---|---|
| `fatigueRule.label` | Fatigue limit | Træthedsgrænse |
| `fatigueRule.teamLine` | Above {{n}} fatigue, run this instead: | Over træthed {{n}}: kør dette i stedet: |
| `fatigueRule.fallback_light` | Same session, light load | Samme pas på Let belastning |
| `fatigueRule.fallback_recovery` | Active recovery | Aktiv restitution |
| `fatigueRule.fallback_rest` | Rest | Hvile |
| `fatigueRule.riderException` | Own limit for this rider | Egen grænse for denne rytter |
| `fatigueRule.appliedBadge` | Limit applied | Grænsen slog til |

### 3.4 help.json (kort, en plus da)

Tre korte afsnit under den eksisterende `dailytraining`-sektion (`/help?section=dailytraining`), efter reglen "kort på fladen, manualer i Hjælp":

1. **Load / Belastning:** hvad de tre niveauer gør ved udbytte, træthed og skaderisiko, og at samme evner trænes.
2. **Team sessions / Holdpas:** at passet skriver rigtige sessioner pr. rytter, at en rytter i løb beholder sin egen dag, og at rytterens eget valg altid vinder.
3. **Fatigue limit / Træthedsgrænse:** at reglen er spillerens egen, at rytterens undtagelse slår holdets, og at planen aldrig ændres.

Ingen tal fra motoren i hjælpen (hard rule 17), og ingen formuleringer der afslører lofter (beslutning 4).

### 3.5 Assistenten (#4522)

Assistentens forslag (`frontend/src/lib/assistantTrainingSuggestions.js`, panel i `frontend/src/components/training/AssistantSuggestionsPanel.jsx`) skal:

- foreslå **Normal** belastning som default og aldrig foreslå Hård på en rytter hvor træthedsgrænsen ville slå til,
- vise den foreslåede belastning i forslags-rækken, så "Accept selected" er et informeret klik,
- respektere en aktiv holdregel: et forslag der ville blive omskrevet af reglen præsenteres som det pas reglen ville køre,
- aldrig anvende noget selv. Forslag, spilleren accepterer, præcis som i dag.

---

## 4. Hvad der IKKE ændres

| Uændret | Hvorfor det står her |
|---|---|
| Lofterne (`ability_caps`, klip i `dailyTraining.js:210-217`) | Belastning skalerer kun deltaen. En evne på sit loft giver stadig nul, uanset belastning |
| Udbytte-fordelingen inden for en pakke (`FOCUS_ABILITY_WEIGHT`, `training.js:113-116`) | Belastningen er én skalar for hele dagen. Ingen automatisk omfordeling, princip B |
| Fokus-vægte og `focusWeightSum` (`training.js:126-129`) | Invarianten fra #4631 skal fortsat kunne pinnes uændret |
| Tick-kadencen (`TRAINING_RULES.md` §1) | Pakken tilføjer ingen ekstra ticks og ingen ekstra writes pr. rytter pr. dag. Den virker uændret når tick-enheden bliver løbsdagen |
| `smartDefaultFocus` og `SMART_DEFAULT_FOCUS_KEYS` (`training.js:140-142`) | Frossen liste. Belastning er en anden akse og må ikke flytte assistentens fokus-valg |
| Træner- og facilitets-invarianterne (`backend/lib/staffTrainingBonus.js:11-16`) | Nul regression, træning straffer aldrig, bonus kan aldrig udvide et loft |
| G5: en skadet rytter får `rest` og planen røres ALDRIG (`dailyTrainingEngine.js:334, 360`) | Træthedsreglen lægger sig ved siden af, ikke ovenpå |
| RLS-mønsteret på træningsdata | De to nye tabeller er team-scopede efter samme mønster |

---

## 5. Gates og test

| Gate | Hvor | Hvad den beviser |
|---|---|---|
| Vægtsum-invariant pr. belastning | `backend/lib/training.test.js` | `focusWeightSum(focus)` er identisk for `light`, `normal` og `hard`. Belastning skalerer, den omfordeler ikke |
| Nul-regression på Normal | `dailyTraining.test.js` | `load: "normal"` giver BIT-IDENTISK delta med i dag for hver session og hver evne |
| "Let giver aldrig 0" | `dailyTraining.test.js` | Belastnings-ledet er strengt over 0 for alle sessioner. Let er ikke hvile |
| Skaderisiko-truthtabel | `riderCondition.test.js` | Let giver 0 uanset træthed og session. Normal er præcis dagens regel. Hård åbner risiko på enhver trænings-session over gulvet |
| Holdpas skriver identiske sessioner | ny `teamSessionGroups.test.js` | For hver rolle er den skrevne `(focus, intensity, load)` identisk med `programForChoice` for det individuelle valg |
| Holdpas overtrumfer aldrig rytteren | `training.test.js` | `resolveDaySession` rangerer rytterens egen entry over gruppens, samme stige som `resolveDayIntensity`. Regression-vagt for 16/7 |
| Regel-evaluering deterministisk | ny `fatigueRule.test.js` | Ren funktion, samme input giver samme output, ingen `Date`, ingen `Math.random`. Rytterens regel slår holdets |
| Regel rører aldrig planen | `dailyTrainingEngine.test.js` | Efter et tick hvor reglen slog til er `training_plans`-rækken uændret |
| Ugeplan-validering | `training.test.js` | `isValidWeekPlanDays` accepterer `session` og `load`, kræver stadig alle 7 ugedage, afviser ukendte nøgler |
| e2e for de tre flader | `frontend` Playwright | (a) sæt belastning på en rytter, (b) opret og anvend et holdpas fra rytterlisten, (c) sæt holdregel plus undtagelse. Visuelle ændringer køres i ALLE 3 playwright-projekter (#536) |

**Verifikations-tier:** backend plus delte lib-hooks plus i18n plus over 6 filer betyder **TIER FULL**, altså `scripts/verify-local.ps1` samt `npm run lint`, `node --test` og build i `frontend/`, plus hele `npm run test:e2e` lokalt fordi i18n røres. `pwsh -File scripts/preflight-pr.ps1` før hver push.

**Ny vagt mod main:** invariant-testene køres mod `main` FØR merge, ikke kun mod egen branch.

---

## 6. Faseplan i PR-kø

Rækkefølgen er belastning, så regel, så holdpas. Hver PR er selvstændigt shipbar og efterlader spillet i en gyldig tilstand.

| # | PR | Størrelse | Indhold | Afhænger af |
|---|---|---|---|---|
| 1 | `feat(training): belastning Let/Normal/Hård på samme session` | **M** | Migration (`load` på `training_plans`), faktor-kæde-led, træthed, skaderisiko-omtolkning, `programForChoice`, `POST /training/:riderId` og `/bulk`, `GET /training/me`, chips i FocusPanel plus bulk, i18n, help, tests | ingen |
| 2 | `feat(training): træthedsgrænse med reservepas` | **S** | Tabel `team_training_rules`, `resolveFatigueRule`, evaluering før `effectiveIntensity`, rapport-stempel, endpoints, linje i Program-fanen plus undtagelse på rytterens dag, i18n, help, tests | PR 1 (fallback `light`) |
| 3 | `feat(training): ugeplanens dag kan bære en session, ikke kun en intensitet` | **M** | `training_week_plans.days` udvides, `isValidWeekPlanDays`, `resolveDaySession` med samme stige, `PUT /training/week-plan/:riderId`, tests | PR 1 |
| 4 | `feat(training): holdpas, rollefordelt, sat fra rytterlisten` | **M** | Tabel `team_session_groups`, rolle-forslag på serveren, de fem pas, `apply`-endpointet, toolbar-handling plus kædeikon, løbsdags-håndtering, advarsler, i18n, help, tests | PR 1 |
| 5 | `feat(training): holdpas som fast programdag` | **M** | `program_day` på gruppen, materialisering til rytternes egne dags-entries, visning i Program-fanen, tests | PR 3 og PR 4 |

**Patch notes samles ved close-out** (bølge-reglen: ingen patch note i de enkelte PR'er, én samlet note i `frontend/src/data/patchNotes.js` når pakken er landet). Samme for `help.json` i en og da.

**Ejer-gate:** hver PR med UI merges først efter ejerens visuelle go. Et svar om retning er ikke et go på PR'en.

---

## 7. Åbne spørgsmål

Ét pr. linje. Ingen af dem må gættes på plads i kode.

1. Skal Let og Hård også findes på færdighedsdage (`technique`, `aero`, `loebslaere`), eller kun på trænings-sessioner? Færdighedsdage er lav belastning pr. definition (`trainingDayTypes.js:41-43`) og rammes af håndværks-raten (`dailyTraining.js:135-138`).
2. Skal en holdpas-gruppe kunne gemmes med et navn spilleren selv skriver, eller kun bære passets navn?
3. Hvad ser andre hold af et holdpas eller en træthedsregel? Forslag: intet, fog of war, jf. beslutning 4.
4. Skal træthedsreglen kunne sættes til at gælde KUN på hårde belastninger, eller altid?
5. Hvor mange holdpas-grupper må et hold have samtidig, og må en rytter være med i to grupper på to forskellige programdage?
6. Hvad sker der med en gemt gruppe når en rytter sælges eller pensioneres midt i sæsonen?
7. Skal Hård belastning kunne vælges i bulk på hele truppen, eller kræve en bekræftelse?
8. Skal træthedsreglens udfald tælle som en "trænet dag" i historikken og i træningsscoren, eller som en afbrudt dag?
9. Skal belastningen indgå i `smartDefaultFocus`-stien for ryttere helt uden plan, eller er Normal altid svaret der?
10. Når tick-enheden bliver løbsdagen: skal træthedsgrænsen evalueres pr. løbsdag eller pr. kalenderdag?

---

## 8. Kilder

**Beslutninger og retning**
- `docs/TRAINING_RULES.md` §2 (faktorkæden), §3 og §3.1 (dagstyper, sessioner, `FOCUS_ABILITY_WEIGHT`-invarianten), §4 (`resolveDayIntensity`-stigen), §5.3 og §5.4 (form og skader), §7 (træner og facilitet), §12 (ejerens principper A til D), §13 (beslutninger 6/9)
- `docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md` (rammen: løbsdag som tick, program, træningsscore)
- `docs/audits/discord-training-choices-2026-09-06.md` §A og §B (spillernes behov, kortene 2, 4 og 8)
- `docs/design/PAGE_TEMPLATES.md` (T2 wide data) og `docs/design/TASTE.md` (dommer-tjeklisten)
- `.claude/learnings/2026-07-16-training-routine-overrode-individual-setting.md`

**Kode verificeret mod `main` 6/9 2026**
- `backend/lib/trainingDayTypes.js` (dagstype- og session-modellen, `SESSION_INTENSITY:59-72`, `programForChoice:144-158`)
- `backend/lib/training.js` (`TRAINING_FOCUSES:76-90`, `FOCUS_ABILITY_WEIGHT:113-116`, `focusWeightSum:126-129`, `isValidWeekPlanDays:383-396`, `resolveDayIntensity:422-436`)
- `backend/lib/dailyTraining.js` (`fatigueLoad:23`, `abilityMult:87-103`, `dailyAbilityDelta:120-159`, cap-løkken `:210-217`)
- `backend/lib/riderCondition.js` (`nextFatigue:31-45`, `nextForm:61-72`, `injuryRisk:86-91`)
- `backend/lib/dailyTrainingEngine.js` (pr-rytter-loop `:283-465`, `preFatigue:347`, `effectiveIntensity:360`, skade-rul `:447-459`)
- `backend/routes/api.js` (`GET /training/me:2624-2751`, `POST /training/bulk:2804`, ugeplan `:2904-3038`, `POST /training/:riderId:3043`)
- `frontend/src/pages/TrainingPage.jsx` og `origin/feat/4613-training-overview-first` (faner, toolbar-slot, dags-celle), `frontend/src/components/training/FocusPanel.jsx`, `AssistantSuggestionsPanel.jsx`
- `database/schema-snapshot.json` (`training_plans`, `training_week_plans`, `training_day_runs`, `race_entries`)
