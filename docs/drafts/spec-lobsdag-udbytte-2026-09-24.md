# Spec: udbytte på løbsdagen, variant A (etapens profil som et "mellem"-pas)

> Cloud-session 24/9. Byggeklar spec, ingen kode. Refs #4850 (TRAINING_RULES §8 pkt. 1). Mål: klar til flip 28/9 sammen med `training_tick_per_race_day`.
> Linjenumre er fra `main` @ `03f3da9`.

## Formål (én linje)

En rytter der kører løb på en løbsdag, udvikler sig som efter et "mellem"-træningspas i de evner etapens profil kræver, under reglen maks +1 pr. evne pr. dag, uden at træningsplanen spiller ind.

## Ejer-beslutninger (citeret)

- **24/9 kl. ca. 10:30** ([#4850-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4850#issuecomment-5810442376)):
  > "A NU: etapens profil (bjergetape → klatring, flad → spurt/fladt, enkeltstart → tempo osv.) i et fast tempo svarende til et 'mellem'-træningspas, under reglen maks +1 pr. evne pr. dag. Planen er IKKE input (ejer-dom 24/8). Skal virke med v3 fra 28/9; tallene simuleres og vises ejeren før merge. B SENERE: dagens intention (grupetto → all-out, #4632) lægges ovenpå som modifikator, når v4 tændes. Uden dette ville træning pr. løbsdag give ryttere, der kører løb, hvile og ingen udvikling (dailyTrainingEngine.js ca. :497-511), i strid med roadbooken. Bygges i næste bølge; race_day_development_enabled flippes sammen med training_tick_per_race_day 28/9 på ejer-go."
- **6/9** ([#4850-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4850#issuecomment-5561066685)): "haardt loft paa maks +1 pr. evne pr. tick for alle ryttere, og overskydende fremdrift skal baeres videre til naeste tick (aldrig klippes)". Ejerens ord 5/9: "Det skal aldrig vaere muligt at stige x2 samme dag i en evne."
- **18/9** (#5267, låst): "løbsdag = én dato · ét løb ELLER træning".

- **24/9, efter simuleringen (#5640): S1 valgt**: mellem-pas med off-fokus 0,35, ingen ×1,15. Median-udvikling fra løbsdage 0,61 point/sæson; ryttere med 31-60 løbsdage 1/5 → 2/11 (median/p90); +1-loftet binder 0 %. C1 + C3 er bygget i #5640; C2 + help.json + TRAINING_RULES.md mangler.

## Hvad der sker i dag (flag `race_day_development_enabled` = off i prod, SELECT 24/9)

- `backend/lib/dailyTrainingEngine.js:497-511`: en rytter der er bundet/kørte i dag og hvor udviklingen er slukket, får `boundRestToday` → **hvile: intet tick, ingen udvikling, kun restitution**.
- Med flaget on (D2-stien) kalder motoren `applyRaceDevelopmentTick` (:596-613, `backend/lib/dailyTraining.js:332-426`). Den beregner "det erstattede pas" ud fra rytterens **plan** (:365-380). En hvile-plan giver 0 udvikling (TRAINING_RULES §6.2). Det er præcis det ejeren har afvist: planen må ikke være input.
- `hardDailyCap` (+1-loftet) sendes kun på løbsdags-stien (`dailyTrainingEngine.js:216`); på den gamle dags-sti er der intet loft.
- Motoren læser flaget **uden** `engineWrite` (:282-285), så "beta" tæller som off i motoren, mens API'et (`backend/routes/api.js:2837-2844`) evaluerer beta pr. bruger. De to er uenige i beta.

## Design (variant A)

**Løbsdagen er et mellem-pas med en fast fokus-liste fra etapens profil:**

```
program = { focus: "race_day", intensity: "normal", focusAbilities: RACE_PROFILE_ABILITY_MAP[profileType] }
```

- Intensitet `normal` = mellem (`TRAINING_SESSIONS_BY_LEVEL.normal = ["tempo"]`, `backend/lib/trainingDayTypes.js:55-62`; `focusGrowthMult.normal = 1.35`, `backend/lib/training.js:37`).
- Fokus-evner = den eksisterende profil-mapning `RACE_PROFILE_ABILITY_MAP` (`dailyTraining.js:37-50`): flat → flat/sprint/acceleration · mountain → climbing/endurance/durability · high_mountain → +recovery · hilly → climbing/punch/tempo · rolling → punch/tempo/endurance · itt → time_trial/tempo · ttt → time_trial/tactics/positioning · cobbles · gravel · classic.
- Off-fokus-evner får `offFocusMult` 0,35 (`training.js:57`), som ved ethvert rigtigt pas. **Arkitekt-valg**: det gør løbsdagen til "et mellem-pas" i bogstavelig forstand. Simuleringen viser også varianten uden off-fokus, så ejeren kan vælge.
- Udbyttet beregnes med **`applyDailyTick`** (`dailyTraining.js:238`), ikke `applyRaceDevelopmentTick`. Så arver løbsdagen hele den eksisterende kæde: alder, potentiale, rolle-rate, træningsscore-kobling, staff, fremdrifts-bar med carry-over (`settleProgressBar` :216-221) og +1-loftet.
- **`hardDailyCap = 1` sendes altid** på løbs-grenen, uanset tick-enhed (i dag kun når `useRaceDayKey`, `dailyTrainingEngine.js:216`).
- **Ingen `devMult`** (1,15 i `RACE_DEV_CONFIG`, `dailyTraining.js:56`): ejerens ord er "svarende til et 'mellem'-træningspas". Simuleringen viser 1,00 mod 1,15.
- **Træthed:** uændret. `effectiveIntensity = "race"` (:529-535) giver 0 trænings-load; løbets træthed lægges af `raceRunner.applyRaceFatigue` (`raceRunner.js:70`, `raceFatigue.js:13-31`). Ingen skaderisiko fra træning (kun "hard" ruller skade, `riderCondition.js:86-91`).
- **Træningsscore-rækken:** uændret `score: null, was_race_day: true` (:771-784).
- **Variant B (senere)**: `effortDevelopmentMultiplier(effort)` (`raceRoles.js:404`) ganges på som modifikator, når `race_day_intention_enabled` og v4 er on. Sømmen findes allerede i `applyRaceDevelopmentTick`; i variant A tilføjes den som valgfri parameter til den nye hjælper, default 1,0.

## Kodeændringer (fil:linje, i rækkefølge)

1. **Ny** `backend/lib/raceDayYield.js` (ren):
   - `raceDayProgram(profileType)` → programmet ovenfor. Ukendt profil → `rolling` (samme fallback som i dag, `dailyTrainingEngine.js:385-388`).
   - `RACE_DAY_YIELD_CONFIG = { intensity: "normal", includeOffFocus: true, devMult: 1.0 }` (fryst; simuleringen kan injicere andre værdier).
2. `backend/lib/dailyTraining.js:89-106` `abilityMult`: `const focusAbilities = program.focusAbilities ?? TRAINING_FOCUSES[program.focus] ?? [];`. Uden `focusAbilities` er alt bit-identisk.
3. `backend/lib/trainingScore.js:121`: samme override (`program.focusAbilities ?? TRAINING_FOCUSES[focus]`). Verificér at `sessionForProgram` (importeret i `trainingScore.js:61`) og `dayTypeForProgram` (`trainingDayTypes.js:104-111`) giver "training" (ikke "skill") for `focus: "race_day"`; ellers rammer løbsdagen håndværks-loftet (`dailyTraining.js` rolle-rate for skill-dage).
4. `dailyTraining.js:37-50` `RACE_PROFILE_ABILITY_MAP`: tilføj `itt_hilly` (mangler i dag og falder tilbage til rolling, så en bakket enkeltstart træner ingen time_trial). **Arkitekt-forslag**: `["time_trial", "climbing", "tempo"]`.
5. **Præcis etape-opslag, ny** `backend/lib/raceDayStageLookup.js`: `race_results (result_type='stage')` ⋈ `race_stage_schedule` på `(race_id, stage_number)` hvor `game_day = raceDay` ⋈ `race_stage_profiles.profile_type`. Erstatter kalenderdags-opslaget `loadRacedRiderIdsToday` / `loadRaceStageProfiles` (:78-130) på løbsdags-stien. I dag vinder "sidste række" hvis en rytter har flere etaper samme dato (:385-388).
6. `backend/lib/dailyTrainingEngine.js`:
   - :282-285: læs `race_day_development_enabled` med samme beta-semantik som API'et (pr. hold), eller dokumentér at beta = off i motoren. **Anbefaling:** flip direkte off → on 28/9 (ejerens plan), så beta-uenigheden ikke rammer.
   - :497-511 `rodeToday`: brug opslaget fra punkt 5 (se risiko 1 om bindingen).
   - :596-613: når `racedToday` → `applyDailyTick({ ...sharedTickArgs, program: raceDayProgram(profileType), hardDailyCap: 1 })`. `applyRaceDevelopmentTick` bliver stående til variant B.
   - Rapport/historik: `source: "race_development"` (:751) beholdes, så UI og målinger kan skelne.
7. `docs/PROGRESSION_RULES.md` (registry-SSOT for `race-day-development`, `FEATURE_REGISTRY.yml:178-187`): beskriv variant A. **`docs/TRAINING_RULES.md` §6.2, §8 pkt. 1 + 6 og §2.2 bliver forældede, men er låst**; orkestratoren retter dem i flip-PR'en.
8. **Hjælp-tekst:** `help.json` siger i dag, at løbsdagen ikke ændrer træningen (#5485-kommentar 23/9). Den er låst for cloud-sessionen og **skal rettes før flip** (EN først, DA under).

## Simuleringen (vises ejeren før merge)

**Ny** `backend/scripts/dev/raceDayYieldSim4850.mjs` (read-only; mønster: `backend/scripts/dev/trainingScoreHarness4851.mjs`, der kører den rigtige `applyDailyTick` på et prod-udtræk, :31, :93).

- **Population:** read-only udtræk af alle aktive menneske- og AI-ryttere (alder, potentiale, evner, lofter, typer, staff/facilitet) + deres S3-løbsdage (`race_entry_days`) og etape-profiler. Skrives kun til `balance-internals/`.
- **Scenarier (samme seed, samme 140 løbsdage):**
  | # | Løbsdag giver | Formål |
  |---|---|---|
  | S0 | hvile (flag off i dag) | baseline: hvad racere mister |
  | S1 | variant A, mellem, off-fokus 0,35, devMult 1,00 | **anbefalet** |
  | S2 | som S1 uden off-fokus | ejer-valg |
  | S3 | som S1 med devMult 1,15 (gammel D2-værdi) | sammenligning |
  | S4 | rytterens plan-pas (gammel D2-sti) | det ejeren har afvist, til reference |
- **Tal til ejeren (én tabel pr. scenarie):**
  1. Evnepoint pr. sæson, median og p90, pr. aldersgruppe (≤ 19, 20-22, 23-25, 26+) og pr. potentiale 1-6.
  2. Samme for en rytter med 0, 30, 60 og 90 løbsdage ud af 140 (kører man meget, taber man så udvikling i forhold til en der træner?).
  3. Pr. profil: hvilke evner vokser (klatrer på bjergetaper, sprinter på flade).
  4. Hvor tit +1-loftet binder (andel af rytter-dage). Ejeren vil have det som sikkerhedsnet, ikke norm (#4850 6/9).
  5. Ændring i synlig rating over sæsonen (samme skala som `ratingGolden.5321.json`, uden at røre den).
- **Gate for merge:** ejeren har set S0-S4-tabellen og valgt S1 eller S2 (og devMult). Ingen tal er fundet på forhånd her.

## Tests

- `backend/lib/raceDayYield.test.js`: program pr. profil; ukendt profil → rolling; `itt_hilly` træner time_trial.
- `backend/lib/dailyTraining.test.js`: `abilityMult` med `focusAbilities` (fokus 1,35 × vægt, off-fokus 0,35); uden override bit-identisk (eksisterende tests :382-490 skal stå grønne).
- `backend/lib/dailyTrainingEngine.test.js` (eksisterende blokke D1/D2 :950-1273, #4846 :1358-1476, #4847 :1566-1698):
  - racer med **hvile-plan** udvikler sig alligevel (planen er ikke input);
  - racer på bjergetape får klatring, ikke sprint;
  - aldrig +2 samme dag i én evne, og overskud bæres videre (carry-over, jf. `dailyTraining.test.js:641-798`);
  - flag off → uændret hvile (:497-511);
  - skadet racer → intet tick;
  - rytter på GT-hviledag (bundet, ingen etape) → hvile (regel 3, #4847).
- `backend/lib/raceDayStageLookup.test.js`: to løbsdage samme dato → hver rytter får sin egen etapes profil; afsluttet endagsløb findes stadig (risiko 1).
- `backend/lib/trainingScore.test.js`: `focus: "race_day"` er dagtype "training".
- e2e (frontend er bygget, `training-race-day.spec.js`): kun hvis UI-tekst ændres.

## Risici

1. **Bindingen forsvinder ved afsluttet løb (skal verificeres).** `race_entry_days_rebuild` sætter binding false ved status `completed` (`database/2026-08-24-4191-race-entry-days-diff-rebuild.sql:52-61`), og triggeren fyrer ved statusskift (`database/2026-08-18-3934-sweep-batch-rpc-deferrable.sql:218-223`). Sweepen kører efter dagens sidste finalisering. Hvis rækkerne er væk, bliver `boundToday` false for endagsløb og sidste etape, `rodeToday` false (:499), og racere får **almindelig træning** oven i løbet (regel 2 brudt). Punkt 5 (opslag via `race_results` + `race_stage_schedule`) fjerner afhængigheden. Ingen evidens her for at det sker i prod; testen i `raceDayStageLookup.test.js` skal vise det.
2. **Beta-uenighed** mellem motor og API (se ovenfor). Flip direkte off → on.
3. **Låste filer:** `backend/lib/trainingRaceDay*.js` (loft-konstanten `abilityGainCapPerRaceDay`, `trainingRaceDayTick.js:37`, kan importeres uden at ændre filen), `trainingDayCloseTrigger*.js` (ikke nødvendig), `docs/TRAINING_RULES.md` og `help.json` (skal rettes af orkestratoren før flip).
4. **Ungdomsryttere:** motoren accepterer kun trup "senior" (`dailyTrainingEngine.js:176`). Ungdomsløbs-spec'en (`spec-ungdomslob-2026-09-24.md`, risiko 2) skal have løbsdags-aksen pr. trup; indtil da gælder variant A kun seniorer.
5. **Rating-reglen (17/9):** synlige ratings må aldrig falde uden ejerens vidende. Variant A giver kun plus; simuleringens punkt 5 viser størrelsen.
6. **v3 og v4:** begge skriver samme `race_results` og læser samme `race_stage_profiles.profile_type` (`engine/v4/timeline.ts:50`), så variant A er motor-uafhængig. Kun variant B (effort) kobler til v4.

## Spor-opdeling (parallelt, uden fil-overlap)

| Spor | Filer (eneste ejer) | Afhænger af |
|---|---|---|
| **C1** udbytte-kernen | `raceDayYield.js` (ny), `dailyTraining.js`, `trainingScore.js`, `trainingDayTypes.js` (kun hvis punkt 3 kræver det) + deres tests | intet |
| **C2** etape-opslag + motor | `raceDayStageLookup.js` (ny), `dailyTrainingEngine.js` + `dailyTrainingEngine.test.js` | C1's `raceDayProgram` (kan stubbes; merge efter C1) |
| **C3** simulering | `backend/scripts/dev/raceDayYieldSim4850.mjs` (ny), output i `balance-internals/` | C1 (bruger `raceDayProgram` + `applyDailyTick`) |
| **C4** docs | `docs/PROGRESSION_RULES.md`, `docs/FEATURE_REGISTRY.yml` (kun `race-day-development`-blokken) | C1 |

Ingen af filerne overlapper med `spec-s4-struktur-2026-09-24.md` eller `spec-ungdomslob-2026-09-24.md`. Orkestratoren ejer bagefter `help.json` og `docs/TRAINING_RULES.md` (låst for cloud-sessionen).
