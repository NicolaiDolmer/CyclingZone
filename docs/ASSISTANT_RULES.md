# Assistentens regler - SSOT

> **Læs denne FØR enhver opgave der rører assistenten: auto-udtagelse, auto-udfyld, sen redning
> ved afvikling, peak-forslag, automatisk træningsfokus eller assistent-sweepene.**
> Ejer-direktiv 25/8 2026 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).
>
> Assistenten havde indtil 30/8 intet SSOT-dokument. Den eneste nedskrevne regel stod som
> §4 i [`PLANNING_CENTER_RULES.md`](PLANNING_CENTER_RULES.md), og den dækker kun holdudtagelse.
> Assistenten rører i praksis fire ting: udtagelse, sen redning, peak-planer og træningsfokus.
>
> Denne fil beskriver **hvad koden gør i dag**, ikke hvad der er besluttet. Hvor de to er
> uenige, står det i §11 som en afvigelse med issue-reference - aldrig som en regel.
>
> Grænsefladen mod Planning Center er bevidst tynd: fladen (Z1/Z2, gemme-veje, linser,
> rate limits) bor i [`PLANNING_CENTER_RULES.md`](PLANNING_CENTER_RULES.md), bindingen i
> [`CALENDAR_RULES.md`](CALENDAR_RULES.md) §2b + §8, rolle-vokabularet i
> [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) §1. Duplikér dem ikke her.
>
> Verificeret mod kode og prod 30/8 2026 (Europe/Copenhagen).

---

## 0. Hvad assistenten er

Assistenten er ikke ét modul. Det er **fem kodeveje der deler ét navn i spiller-teksten**, og
de har hver deres regler, hver deres gates og hver deres udløser.

| # | Kodevej | Fil | Skriver | Udløses af |
|---|---|---|---|---|
| A | Auto-udtagelse pr. løb | `backend/lib/selectionAutoFill.js` | `race_entries` (`is_auto_filled=true`) | spilleren, `POST /races/:raceId/selection/auto` |
| B | Auto-udfyld pr. løbsdag | `backend/routes/api.js:5676` | `race_entries` (`is_auto_filled=true`) | spilleren, `POST /races/distribution/regenerate` |
| C | Sen redning ved afvikling | `backend/lib/raceRunner.js:812` `fillMissingTeamEntries` | `race_entries` (`is_auto_filled=true`) | motoren, ved etape 1 |
| D | Peak-forslag | `backend/lib/peakSuggestions.js` | **intet** (rene forslag) | `GET /peak-plans/board` |
| E | Træningsvalg | `backend/lib/training.js:303` `smartDefaultFocus` | intet ved auto-stien; `training_plans` ved smart-bulk | dagligt tick + spilleren |

**A, B og C deler samme udvælgelseskerne:** `autopickTeamSelection` i
`backend/lib/raceAutopick.js:79`. A og B går gennem `assignTeamAcrossRaces`
(`backend/lib/raceEntryGenerator.js:30`), som lægger binding og strategi-præference ovenpå.
C kalder `autopickTeamSelection` direkte. **Der findes ingen sjette udvælgelsessti - opfind
ikke en.**

**D og E har intet med A-C at gøre.** De deler kun ordet "assistent" i spiller-teksten
(`frontend/public/locales/en/planner.json:71-88`, `.../training.json:214`).

---

## 1. Grundreglen: pull, ikke push

> Ejer 25/8 2026, ordret i `raceEntryGenerator.js:160-163`:
> *"Vil du være sød at lade være med hele tiden at lave nye udtagelser på vegne af spillerne?
> ... De vil hellere selv udtage."*

**Assistenten udtager aldrig proaktivt for et hold med en ejer.** Grænsen går ved ejerskab,
ikke ved en markering:

```js
const eligibleTeams = (allTeams || []).filter((t) => !t.is_frozen && !t.user_id);
```
`backend/lib/raceEntryGenerator.js:223`

| Regel | Værdi | Hvor låst | Fil |
|---|---|---|---|
| Proaktiv sweep rører kun hold **uden** bruger | `!t.user_id` | ejer-direktiv 25/8, [#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217) | `raceEntryGenerator.js:223` |
| AI-hold fyldes fortsat | uændret | samme | `raceEntryGenerator.js:215` |
| Flaget der styrer sweepen | `auto_entry_generator_enabled` = **`on`** | målt i prod 30/8 (`app_config`, sat 27/8 00:18 CET) | `backend/lib/autoEntryGeneratorFlag.js:7` |

**Flaget er `on`, og det er ikke en modsigelse.** Sweepen kører hver time for AI-hold; ejer-hold
er udelukket af filteret ovenfor, ikke af flaget. At slukke flaget ville efterlade AI-holdenes
løb tomme.

**Målt i prod 30/8** (aktiv sæson, `race_entries` × `races` × `teams`):

| | Antal |
|---|---:|
| Auto-udfyldte entries i alt | 27.425 |
| Manuelle entries i alt | 3.887 |
| Auto-udfyldte på **manager-hold** | 4.219 |
| Manuelle på manager-hold | 3.887 |
| Manager-hold med mindst én entry | 226 |
| Aktive `race_entry_clears`-markeringer | 42 |

`select count(*) filter (where e.is_auto_filled) ... from race_entries e join races r on r.season_id=(select id from seasons where status='active') join teams t on t.id=e.team_id`

**52 % af alle entries på manager-hold er assistentens.** De 4.219 stammer fra spillerens egne
knapper (A/B) og fra den sene redning (C) - ikke fra en proaktiv sweep.

---

## 2. De indgange der findes

| Indgang | Flade | Kalder | Scope |
|---|---|---|---|
| "Auto-udfyld" i rytterpuljen | `frontend/src/components/racehub/AvailableRidersPool.jsx:39` | B, `mode=missing` | dagens overlap-løb |
| "Auto-udfyld igen" / overskriv | `frontend/src/components/racehub/RaceHubBoard.jsx:476` | B, `mode=missing\|all` | dagens overlap-løb |
| Strategi-siden | `frontend/src/pages/StrategyPage.jsx:148` | B, `mode=missing`, **uden `day`** | fokus-dagen (`resolveSeasonDay`, `backend/lib/seasonDay.js:119-126`) |
| Løbssidens udtagelses-panel | `frontend/src/components/race/RaceSelectionPanel.jsx:354` | A | ét løb |
| Indbakke-varslet (36 t) | `backend/lib/selectionWarningSweep.js` → samme knap | A | ét løb |
| "Accept all" for peaks | `frontend/src/components/planner/PlannerAssistantCard.jsx:29` | D → `POST /peak-plans` | rytterens sæson |

**`PLANNING_CENTER_RULES.md` §4 regel 5 siger tre indgange. Der er fire knapper.**
Strategi-siden rammer samme endpoint som boardet, men uden `day`-parameter, så den skriver til
den dag `resolveSeasonDay` beregner - ikke nødvendigvis den dag spilleren kigger på. Se §11.

**`mode=all` er den eneste vej hvor assistenten overskriver en manuel udtagelse**, og den
kræver et `window.confirm` i klienten (`RaceHubBoard.jsx:470-473`). Der er ingen serverside-gate
mod det: `partitionRegenTargets` (`backend/lib/raceDistribution.js:105`) springer kun manuelle løb over i `mode=missing`.

---

## 3. Auto-udtagelsens konstanter

| Regel | Konstant | Værdi | Hvor låst | Fil |
|---|---|---|---|---|
| Startfelt-størrelse pr. klasse | `SELECTION_SIZE` | se nedenfor | spec 8.1, race-hub Fase 0a; **markeret KALIBRERBAR i koden** | `backend/lib/raceAutopick.js:14-25` |
| Fallback for løb uden klasse | `SELECTION_SIZE.default` | `{min:6, max:8}` | samme | `raceAutopick.js:15` |
| Deltagelses-gulv | `MIN_RACE_ENTRIES` | **6** | ejer-beslutning 27/8, [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295) | `raceAutopick.js:47` |
| Trætheds-dæmpning | `AUTOPICK_FATIGUE_DAMPING` | **0,3** (træthed 100 → egnethed × 0,7) | ikke dateret i koden | `raceAutopick.js:49` |
| Felt-cap (hold pr. løb) | `POOL_TARGET_SIZE` | **24** | [#1608](https://github.com/NicolaiDolmer/CyclingZone/issues/1608) (pulje-target = felt-cap) | `backend/lib/economyConstants.js:136` |
| Evne-max i score-normaliseringen | `ABILITY_MAX` | **99** | - | `backend/lib/raceSimulator.js:58` |
| Varslings-vindue | `SELECTION_WARNING_HOURS` | **36** | [#2180](https://github.com/NicolaiDolmer/CyclingZone/issues/2180) | `backend/lib/selectionWarningSweep.js:41` |
| Skrive-limiter | `marketWriteLimiter` | 30 pr. 60 s | - | `backend/lib/rateLimiters.js:64-68` |

**`SELECTION_SIZE` udfoldet** (`raceAutopick.js:14-25`):

| `race_class` | min | max |
|---|---:|---:|
| `Class2` · `Class1` · `ProSeries` | 6 | 6 |
| `OtherWorldTourA/B/C` · `Monuments` | 7 | 7 |
| `GiroVuelta` · `TourFrance` | 8 | 8 |
| ukendt/legacy (`default`) | 6 | 8 |

**Gulvet på 6 og feltstørrelsen er to forskellige tal.** For Class1/2/ProSeries falder de sammen.
For WorldTour (7) og Grand Tours (8) ligger gulvet lavere, så en trup på 6 til en Grand Tour er
lovlig og starter. Kommentaren i `raceAutopick.js:31-46` er den kanoniske prosa; SSOT-teksten
bor i `CALENDAR_RULES.md` §8.

**Forveksl ikke med `marketUtils.MIN_RIDERS_FOR_RACE` (8).** Det er transfermarkedets trup-gulv
(du må ikke sælge dig under 8 ryttere), ikke antallet på en startliste.

---

## 4. Sådan vægter assistenten løbsprofil mod ryttertype

Dette er hele modellen. Der er ingen anden vægtning, og ingen rytter-**type** indgår nogen
steder - kun rytterens evner mod etapens efterspørgsels-vektor.

**Trin 1 - rå etape-score** (`backend/lib/raceSimulator.js:475-484`):

```js
export function terrainScore(abilities, demandVector) {
  let s = 0;
  for (const k of ABILITY_KEYS) {
    const w = demandVector[k];
    if (!w) continue;
    const a = Number(abilities?.[k]) || 0;
    s += (a / ABILITY_MAX) * w;
  }
  return s;
}
```

**Trin 2 - løbs-egnethed = uvægtet gennemsnit over løbets etaper**
(`raceAutopick.js:51-56`). Alle etaper tæller lige meget; en 21-etapers Grand Tour vægter ikke
sine bjergetaper højere end sine flade.

**Trin 3 - trætheds-dæmpning** (`raceAutopick.js:86-89`):

```
freshness = 1 − clamp(fatigue, 0, 100)/100 × 0,3
score     = suitabilityScore × freshness
```

**Trin 4 - sortering, og så tages de `sizeRule.max` bedste.** Tiebreak er `rider_id`-streng, så
udvælgelsen er deterministisk (`raceAutopick.js:91`, `:107`).

**Trin 5 - strategi-præference, kun hvis holdet har en strategi-række.** Ved et **mål-løb**
sorteres A-kæden først (rang → score → id), så managerens kerne-ryttere garanteres pladser
(`raceAutopick.js:96-105`). `preference == null` eller ikke-mål-løb → uændret score-rækkefølge.

**Efterspørgsels-vektorerne er persisterede pr. etape**, ikke afledt runtime
(`race_stage_profiles.demand_vector`). Målt i prod 30/8:

| `profile_type` | etaper | eksempel-vektor |
|---|---:|---|
| `flat` | 1.056 | `sprint 0,61 · acceleration 0,15 · positioning 0,08 · randomness 0,08 · flat 0,06 · endurance 0,02` |
| `mountain` | 723 | `climbing ~0,50 · endurance ~0,14` |
| `hilly` | 662 | `climbing ~0,06 · endurance ~0,06` |
| `high_mountain` | 321 | `climbing ~0,52 · endurance ~0,18` |
| `classic` | 125 | `endurance ~0,18 · climbing ~0,12 · flat ~0,06 · positioning ~0,06` |

`select profile_type, count(*), avg((demand_vector->>'climbing')::numeric) ... from race_stage_profiles group by 1`
Den viste `flat`-vektor er Københavns Klassikers egen (`OtherWorldTourC`, `finale_type=bunch_sprint`).

**Tre egenskaber ved modellen, som er faktiske og skal kendes før nogen rører den:**

1. **`randomness` scores ikke.** Den er ikke i `ABILITY_KEYS` (`raceSimulator.js:49-56`), så den
   vægt er død i egnethedsberegningen. Det er tilsigtet - den bruges af selve motoren.
2. **Scoren er ikke normaliseret mod vektorens vægtsum.** Det er uden betydning inden for ét
   løb (alle ryttere måles mod samme vektor), men to løbs scorer kan ikke sammenlignes.
3. **Assistenten fylder altid op til `sizeRule.max`.** Der findes ingen tærskel hvor den hellere
   lader en plads stå tom end at sende en dårligt matchet rytter. Det er rod-mekanikken bag
   [#3957](https://github.com/NicolaiDolmer/CyclingZone/issues/3957) - se §11.

---

## 5. Roller assistenten må sætte

Assistenten sætter **tre af de fem** roller i motorens vokabular. `hunter` og `free_role`
sætter den aldrig (`raceAutopick.js:114-119`).

| Rolle | Hvordan assistenten vælger | Fil |
|---|---|---|
| `captain` | 1) `always_captain`-regel · 2) terræn-prioritet fra `captains`-listen · 3) fallback: bedst på **non-flat** etaper | `raceAutopick.js:130-144` |
| `sprint_captain` | 1) `always_sprint_captain_if_present`-regel · 2) fallback: højeste `sprint`-evne, kun hvis løbet har mindst én `flat`-etape og feltet er > 1 rytter | `raceAutopick.js:148-164` |
| `helper` | alle andre | `raceAutopick.js:118` |

`FLAT_PROFILES = new Set(["flat"])` (`raceAutopick.js:68`) - kun `profile_type === "flat"` regnes
som spurt-terræn. `rolling` og `classic` gør ikke, uanset hvad deres finale hedder.

**GC-fallbacken bruger kun non-flat etaper**, og falder tilbage til alle etaper hvis løbet er
100 % fladt (`raceAutopick.js:70-73`).

**Databasen håndhæver unikhed:** `uq_race_entries_captain` / `_sprint_captain` / `_hunter` -
maks én af hver pr. `(race_id, team_id)`, på tværs af manuelle og auto-rækker
(`database/2026-06-12-race-entries-roles.sql`, citeret i `raceEntryGenerator.js:78-80`).
Manager-satte special-roller ejer slottet; assistenten må aldrig tage det.

---

## 6. Sen redning ved afvikling

**Kører ved etape 1** (`raceRunner.js:1128`), efter at spilleren har haft hele vinduet.
Ejer-beslutning 26/8, [#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174),
implementeret i [PR #4301](https://github.com/NicolaiDolmer/CyclingZone/pull/4301).

To forskellige jobs bag samme løkke (`raceRunner.js:965-991`):

| Holdets entries | Hvad redningen gør | Roller |
|---|---|---|
| **0** | udtager en HEL trup op til `sizeRule.max` | `captain` + evt. `sprint_captain` + `helper` |
| **1-5** | fylder præcis op til `MIN_RACE_ENTRIES` (6) | **kun `helper`** |
| **≥ 6** | rører ikke holdet | - |

```js
const rule = isRescue
  ? { min: MIN_RACE_ENTRIES - existingCount, max: MIN_RACE_ENTRIES - existingCount }
  : sizeRule;
```
`raceRunner.js:977-979`

**Redningen sætter aldrig en anden kaptajn end den spilleren selv valgte**
(`race_role: isRescue ? "helper" : pick.race_role`, `raceRunner.js:988`).

**Når gulvet ikke kan nås, skrives intet:**
```js
if (existingCount + picks.length < MIN_RACE_ENTRIES) continue;
```
`raceRunner.js:984`. Begrundelsen står i koden: auto-entries der ikke rækker til et startfelt
ville binde rytterne på løbsdagen for et løb de aldrig kommer i.

**Hold der springes over:** frosne · afmeldte (`race_withdrawals`) · eksplicit ryddede
(`race_entry_clears`) · hold uden for løbets pulje (når `race.league_division_id` er sat) ·
hold der allerede er på/over gulvet (`raceRunner.js:863-872`).

**Felt-cap'et rammer kun hold der TILFØJES.** Et hold under gulvet er allerede i feltet med
sine egne picks; at cappe det væk ville skære manageren ud af sit eget løb
(`raceRunner.js:888-892`).

---

## 7. Gates assistenten aldrig må bryde

Hver række er verificeret i koden. Bryder en ny kodevej én af dem, er det en fejl, ikke en
afvejning.

| # | Gate | Hvad den forhindrer | Hvor |
|---|---|---|---|
| 1 | **Ejerskab** - proaktiv sweep rører kun `user_id IS NULL` | at spillerens plan overskrives i søvne | `raceEntryGenerator.js:223` |
| 2 | **Afmeldt** (`race_withdrawals`) | at et bevidst fravalg tilmeldes igen | `api.js:5323-5329`, `raceRunner.js:849` |
| 3 | **Ryddet** (`race_entry_clears`) | at en bekræftet-tom trup fyldes ud igen | `raceRunner.js:857`, `raceEntryGenerator.js:286-300`, semantik i `raceEntryClears.js` |
| 4 | **Manuel udtagelse findes** → `409 selection_already_exists` | at A overskriver en kurateret trup | `api.js:5335-5337` |
| 5 | **Frosset startfelt** (`stages_completed > 0`) | at et igangværende løbs felt genskrives | `api.js:5318`, `:5787`, `raceEntryGenerator.js:152` |
| 6 | **Løbet skal være `scheduled`** | udtagelse i et afsluttet løb | `api.js:5317` |
| 7 | **Pulje** (`teamInRacePool`) | hold fra anden pulje i feltet | `api.js:5319-5321`, `raceRunner.js:868-870` |
| 8 | **Skade** (kanonisk `isRiderInjured`) | at en skadet rytter auto-udtages | `api.js:5352-5355`, `:5750-5753`, `raceRunner.js:917-922`, `raceEntryGenerator.js:344-357` |
| 9 | **Eligibility** (ikke akademi, ikke pensioneret, ikke parkeret salg) | akademiryttere i senior-felt ([#1742](https://github.com/NicolaiDolmer/CyclingZone/issues/1742)/[#1800](https://github.com/NicolaiDolmer/CyclingZone/issues/1800)) | `applyRiderEligibilityFilter`, alle fire stier |
| 10 | **Binding: 1 rytter = 1 løb pr. `game_day`** | dobbeltbooking på tværs af løb | `excludeBoundRiders` + `loadFieldBindingContext`, `raceRunner.js:962-968`; `assignTeamAcrossRaces`, `raceEntryGenerator.js:47-51` |
| 11 | **DB-backstop** `no_rider_double_booking` | at en overset konflikt skrives alligevel | `isRiderDayInvariantViolation`, `raceRunner.js:1001-1005`, `api.js:5401-5405` |
| 12 | **Special-rolle-unikhed** | at auto-rækken stjæler managerens kaptajns-slot | `uq_race_entries_*`, `raceEntryGenerator.js:78-80` |
| 13 | **Felt-cap 24 hold** | urealistisk stort startfelt | `raceRunner.js:895-912` |
| 14 | **Gulvet skrives kun hvis det nås** | auto-entries der binder ryttere til et felt de ikke kommer i | `raceRunner.js:984` |
| 15 | **Flag** `race_engine_v2_enabled` | assistent-skrivning bag en slukket motor | `api.js:5306-5308`, `:5681-5683` |
| 16 | **Rate limit** `marketWriteLimiter` | 30 skrivninger pr. 60 s | `rateLimiters.js:64-68` |

**Gate 3 har to håndhævere der skal blive ved med at være enige.** `raceEntryGenerator.js`
(sweepen) og `raceRunner.js` (afviklingen) læser samme tabel hver for sig; koden siger det
eksplicit ([#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200),
`raceEntryGenerator.js:288-289`).

**Markeringen i gate 3 er altid omgørlig.** Den slettes i samme øjeblik spilleren udtager
manuelt eller selv beder om auto-fill (`api.js:5386-5388`, `:5726-5729`).

---

## 8. Peak-forslag (D)

**Forslag er aldrig beslutninger.** De er *aldrig* persisterede `rider_peak_plans`-rækker; de
beregnes on-demand ved hvert `GET /peak-plans/board`-kald og forsvinder automatisk den dag
manageren opretter en ægte plan (`peakSuggestions.js:6-14`).

| Regel | Konstant | Værdi | Fil |
|---|---|---|---|
| Peaks pr. rytter pr. sæson | `MAX_PEAK_PLANS_PER_SEASON` | 2 | `backend/lib/riderPeakPlans.js:53` |
| Ung rytter → ét sæsonmål | `YOUNG_AGE_THRESHOLD` / `YOUNG_RIDER_PEAK_COUNT` | 23 år / 1 | `peakSuggestions.js:32-33` |
| Voksen rytter | `ADULT_RIDER_PEAK_COUNT` | `min(2, MAX_PEAK_PLANS_PER_SEASON)` = 2 | `peakSuggestions.js:34` |
| Ukendt alder | fail-open til voksen | - | `peakSuggestions.js:76` |
| Min. afstand mellem peak-centre | `minPeakSpacingDays` | `leadupDays + 2 × windowRadiusDays` | `peakSuggestions.js:47-49` |
| Alder regnes sæson-forankret | `ageForSeason` | ikke wall-clock | `peakSuggestions.js:52-62` |

**Heuristikken er deterministisk og forklarlig - ingen ML** (`peakSuggestions.js:16-27`):
1. Kandidater = holdets egen divisions **fremtidige** løb i den aktive sæson.
2. Foretræk løb rytteren allerede er **manuelt** tilmeldt (`is_auto_filled=false`) - et
   auto-fyldt entry er ikke et program-valg.
3. Fyld resten med bedst egnede løb (`normalizedSuitability`, samme `terrainScore` som §4).
4. Håndhæv minimums-afstand mellem peak-centre.
5. Alder modulerer **antallet** af forslag, aldrig hvilke løb.

**"Ingen yderligere peak" er også et forslag.** `shouldRecommendNoPeak` er sand når der er nul
forslag og rytteren allerede har mindst én peak (`peakSuggestions.js:200-202`). Den sendes som
en ghost-anbefaling, aldrig som en række, og afvises via samme sæson-scopede dismiss-mekanisme
(`peak_suggestions_dismissed_season_id`).

**Et afvist forslag forbliver afvist** ([#4212](https://github.com/NicolaiDolmer/CyclingZone/issues/4212),
[PR #4359](https://github.com/NicolaiDolmer/CyclingZone/pull/4359)) og optager aldrig en plads.

---

## 9. Assistentens træningsvalg (E)

**Assistenten vælger fokus for enhver rytter uden aktiv plan** - den vælger ikke intensitet.

**Målt i prod 30/8:** af 3.508 ikke-pensionerede, ikke-akademi-ryttere på manager-hold har
**1.526 (43,5 %)** ingen `training_plans`-række i den aktive sæson. For dem er det assistenten
der bestemmer hvad der trænes hver dag.

`select count(*), count(*) filter (where p.rider_id is null) from riders ... left join training_plans p on p.rider_id = ri.id and p.season_id = (select id from seasons where status='active')`

### 9.1 Fokus-valget

```js
export function smartDefaultFocus(primaryType, cfg = PROGRESSION_CONFIG) {
  const trainability = legacyPrimaryTypeTier(primaryType, cfg);
  for (const focusKey of SMART_DEFAULT_FOCUS_KEYS) {
    if (trainability[focusKey] === "strength") return focusKey;
  }
  ...
```
`backend/lib/training.js:303-318`

| Regel | Værdi | Fil |
|---|---|---|
| Kandidat-rækkefølge | `SMART_DEFAULT_FOCUS_KEYS` = `vo2max · threshold · sprint · endurance · technique · aero` | `training.js:90-92` |
| Valg | **første** fokus i den rækkefølge hvor typen har `"strength"` | `training.js:305-307` |
| Alt `"limited"` (ukendt/manglende type) | `"endurance"` | `training.js:313-314` |
| Ellers | første ikke-`"blocked"`, endeligt fallback `"endurance"` | `training.js:315-318` |
| Intensitet ved auto-stien | `DEFAULT_PROGRAM.intensity` = `"normal"` | `backend/lib/dailyTraining.js:27`, `:61` |

**Kun `primary_type` læses. Sekundær type, alder, træner, faciliteter og løbsprogram indgår
ikke.** Det er en bevidst fastfrosset egenskab: `legacyPrimaryTypeTier` er en kopi af #1974's
oprindelige model, holdt uden for #3195's rettelse netop for at outputtet skulle være
100 % uændret (`training.js:270-278`), og pinnet i en test for alle otte typer
(`backend/lib/training.test.js:306-316`).

Pinnede værdier fra testen: `sprinter → sprint` · `climber → vo2max` · `tt → threshold` ·
`gc → vo2max` · `rouleur → endurance` · ukendt → `endurance`.

### 9.2 Assistentens træningskørsel

| Regel | Værdi | Fil |
|---|---|---|
| Sweep kører fra | **kl. 22 dansk tid** (`SWEEP_FROM_HOUR = 22`) | `backend/lib/trainingSweep.js:18` |
| Bonus når manageren selv trykker | `bonusMult` = **1,25** | `dailyTraining.js:15` |
| Bonus når assistenten kører | **ingen** (`bonus = executedBy === "manager"`) | `backend/lib/dailyTrainingEngine.js:130` |
| Hold-diskriminator | ikke AI, ikke bank, ikke frosset, ikke testkonto | `trainingSweep.js:5-7` |
| Idempotens | `UNIQUE(team_id, tick_date)` som mutex | `trainingSweep.js:2-3` |

**Prisen for at lade assistenten køre er præcis 25 % af dagens udbytte** - ikke et dårligere
fokus. Det er den eneste målbare forskel mellem manager og assistent på træningssiden i dag.

### 9.3 Smart-bulk (spiller-initieret)

`POST /api/training/bulk` med `focus="smart"` skriver **faktiske** `training_plans`-rækker
(`api.js:2772-2848`):

- Ryttere der allerede har en plan **springes over** - smart-mode overskriver aldrig
  (`api.js:2817-2820`).
- Intensiteten er en egenskab ved sessionen, ikke et frit valg
  (`SESSION_INTENSITY[smartFocus]`, `api.js:2842`).

`SESSION_INTENSITY` (`backend/lib/trainingDayTypes.js:56-67`):
`technique/aero/loebslaere/endurance → easy` · `tempo → normal` · `vo2max/threshold/sprint → hard`.

---

## 10. Når spilleren og assistenten er uenige

Præcedensen er forskellig pr. kodevej. Det er den vigtigste ting at kende før man rører noget.

| Konflikt | Hvem vinder | Hvor |
|---|---|---|
| Manuel entry findes vs. auto-udtagelse (A) | **spilleren** - `409` | `api.js:5335-5337` |
| Manuel entry findes vs. auto-udfyld `mode=missing` (B) | **spilleren** - løbet springes over | `partitionRegenTargets`, `raceDistribution.js:105` |
| Manuel entry findes vs. auto-udfyld `mode=all` (B) | **assistenten** - men kun efter `window.confirm` i klienten | `RaceHubBoard.jsx:470-473` |
| Manuel entry findes vs. sen redning (C) | **spilleren** - kun huller op til gulvet fyldes, roller røres ikke | `raceRunner.js:975-989` |
| Spilleren har ryddet vs. enhver auto-sti | **spilleren** - `race_entry_clears` | gate 3, §7 |
| Spilleren har afmeldt vs. enhver auto-sti | **spilleren** - `race_withdrawals` | gate 2, §7 |
| Spillerens kaptajn vs. redningens picks | **spilleren** - redningen sætter kun `helper` | `raceRunner.js:988` |
| Rytterens egen plan-intensitet vs. holdets ugerytme | **rytterens plan** | `resolveDayIntensity`, `training.js:372-386` |
| Rytterens pr-dag-override vs. rytterens plan | **override** | `training.js:375-376` |
| Peak-forslag vs. manager-plan | **manageren** - forslaget forsvinder | `peakSuggestions.js:6-14` |

**Præcedensen `rytter-override > rytter-plan > holdets ugerytme > default` er ejer-fastlagt**
efter [#2438](https://github.com/NicolaiDolmer/CyclingZone/issues/2438) - se
`.claude/learnings/2026-07-16-training-routine-overrode-individual-setting.md`. Før den fix vandt
holdrytmen ubetinget, og en spiller mistede reelt sit hold til overtræning.

**Der er ét sted hvor assistenten vinder over spilleren: `mode=all`.** Gaten er en
browser-dialog, ikke serverkode. Se §12.

---

## 11. Kendte afvigelser (ÅBNE issues - ikke regler)

### 11.1 [#3957](https://github.com/NicolaiDolmer/CyclingZone/issues/3957) - auto-udtagelsen matcher ikke løbsprofilen (ÅBEN, `type:bug`, `priority:med`)

Spiller-rapport, Discord 18/8: *"Sender bjergryttere og ungdomsryttere til København"*
(Københavns Klassiker, flad klassiker).

**Den faktiske adfærd, verificeret 30/8:** modellen i §4 vægter korrekt - Københavns Klassikers
vektor er `sprint 0,61 · acceleration 0,15`, og `climbing` har **ingen** vægt overhovedet. En
bjergrytter kan derfor ikke udkonkurrere en sprinter på selve match-scoren. De tre mekanismer
der faktisk kan producere symptomet er:

1. **Ingen bundgrænse.** Assistenten fylder altid op til `sizeRule.max` (7 for
   `OtherWorldTourC`). Har holdet kun 2-3 sprintere, tages nr. 4-7 fra resten af truppen uanset
   hvor dårligt de matcher. Der er ingen kode der hellere lader en plads stå tom
   (`raceAutopick.js:107`).
2. **Bindingen fjerner de bedste.** Ryttere der allerede er committet i et tidsoverlappende
   løb er filtreret ud af kandidatlisten før scoringen (`raceRunner.js:965-968`).
3. **Trætheds-dæmpningen kan vende rækkefølgen.** En rytter med træthed 100 taber 30 % af sin
   score; en frisk, dårligere matchet rytter kan overhale ham (`raceAutopick.js:86-89`). Det er
   også forklaringen på "ungdomsryttere": unge ryttere kører færre løb og er derfor friskest.

**Ingen af de tre er nedskrevet som en regel nogen har godkendt.** Dette afsnit beskriver
mekanikken; hvilken af dem der skal ændres er ikke afgjort - se §12.

### 11.2 [#3743](https://github.com/NicolaiDolmer/CyclingZone/issues/3743) - træningsvalget afhænger ikke af træneren (ÅBEN, `type:feature`, `priority:high`)

Ejer-beslutning 15/8, ordret: *"Assistenten skal være bedre, jo bedre hans evner er ... men det
bedste valg skal være at finpudse tingene selv."*

**Den faktiske adfærd i dag:** `smartDefaultFocus` læser **kun** `primaryType`
(`training.js:303-304`). Et hold uden nogen træner og et hold med en tier 5-specialist får
nøjagtig samme automatiske valg. Træneren påvirker i dag kun **hvor hurtigt** en rytter vokser
(`staffTrainingBonus` / `facilityTrainingMultiplier`, `dailyTraining.js:10`), aldrig **hvad**
der trænes.

Målt under #3709 trin 4 (1.200 simulerede karrierer, 16-30 år), citeret i issuet: rotation 28 ·
**standard/assistenten 28** · spids 27 · forkert 20. Assistenten er altså lige så god som det
bedste manuelle spil.

**Den fastfrosne egenskab i §9.1 er ikke en fejl - den er guarden.** `smartDefaultFocus`
afgør live hvad 1.526 ryttere trænes med hver dag; koden advarer eksplicit mod at ændre den som
sideeffekt (`training.js:270-278`), og #3709 pinnede outputtet i en test. En ændring kræver egen
dry-run + ejer-godkendelse.

### 11.3 [#4192](https://github.com/NicolaiDolmer/CyclingZone/issues/4192) - hvile-fælden, hvor assistenten er medvirkende årsag (ÅBEN, `priority:high`)

Godkendt spec `2026-08-06-loebsdags-model-design.md` D1 siger: *"på løbsdage udføres det
planlagte pas ikke"*. **Koden gør noget andet.** `applyRaceDevelopmentTick` beregner løbets
udbytte som "det erstattede pas" × `devMult` (`dailyTraining.js:271-283`), og `abilityMult`
returnerer 0 for intensitet `rest` (`dailyTraining.js:85`). En rytter hvis plan står på Hvile
får derfor **nul** udvikling af at køre løb.

**Assistentens rolle i det:** trætheds-dæmpningen (§4, trin 3) gør at assistenten systematisk
udtager de friskeste ryttere - og de friskeste er dem der hviler.

**Målt i prod 30/8:** 750 ryttere på 89 hold har `training_plans.intensity = 'rest'` i den
aktive sæson; **656 af dem (87,5 %) er tilmeldt mindst ét S3-løb.**

`select count(distinct p.rider_id), count(distinct p.rider_id) filter (where exists (select 1 from race_entries e join races r on r.id=e.race_id and r.season_id=(select id from seasons where status='active') where e.rider_id=p.rider_id)) from training_plans p where p.season_id=(select id from seasons where status='active') and p.intensity='rest'`

Fælden ejes af #4192 og `TRAINING_RULES.md` (endnu ikke skrevet). Den står her fordi
assistentens udvælgelseskriterium er den ene halvdel af koblingen.

### 11.4 Fjerde indgang på strategi-siden

`PLANNING_CENTER_RULES.md` §4 regel 5 låser tre indgange til auto-udfyld. Der er fire knapper
(§2), og strategi-sidens (`StrategyPage.jsx:148`) sender ingen `day`-parameter, så den skriver
til den dag `resolveSeasonDay` beregner - ikke nødvendigvis den dag spilleren ser på. Dette er
et fund fra kode-gennemgangen 30/8, ikke et rapporteret symptom. Hører til
[#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201).

---

## 12. IKKE FASTLAGT - kræver ejer-beslutning

Hver post er ÉN ting der mangler at blive afgjort. Ingen af dem må gættes på plads.

1. **Skal assistenten kunne lade en plads stå tom?** I dag fylder den altid op til
   `sizeRule.max` (7 til Københavns Klassiker) uanset hvor lav match-scoren er. Skal der være en
   egnetheds-bundgrænse, og hvad er tallet? Uden svar kan #3957 ikke lukkes.
   *(§4 trin 4, `raceAutopick.js:107`)*

2. **Er `AUTOPICK_FATIGUE_DAMPING = 0,3` det rigtige tal?** Den er hverken dateret eller
   issue-refereret i koden, og den er stærk nok til at en frisk, dårligt matchet rytter kan
   overhale en træt specialist (træthed 100 = −30 % score). Skal den ned, op eller væk?
   *(`raceAutopick.js:49`)*

3. **Skal `mode=all` have en serverside-gate?** Det er den eneste vej hvor assistenten
   overskriver en manuel udtagelse, og den eneste beskyttelse er et `window.confirm` i browseren.
   Skal serveren kræve en eksplicit bekræftelses-parameter?
   *(`api.js:5676` vs. `RaceHubBoard.jsx:470-473`)*

4. **Hvor dårlig må "ingen træner" være?** #3743's egen åbne afklaring: skal et trænerløst hold
   kunne udvikle ryttere meningsfuldt, eller skal det gøre ondt? Og må assistenten vælge et
   direkte skadeligt fokus (rating 20 mod 28), eller kun et suboptimalt?

5. **Gælder trænerens indflydelse kun fokus, eller også intensitet og ugerytme?** #3743 spørger
   det eksplicit; i dag rører assistenten kun fokus (`training.js:303`, intensitet kommer fra
   `DEFAULT_PROGRAM` / ugerytmen).

6. **Skal `SELECTION_SIZE` kalibreres?** Koden markerer selv tabellen som **KALIBRERBAR** og
   siger at de præcise klasse→antal skal bekræftes i simulér-før-ship (Fase 0c). Det er ikke
   sket. *(`raceAutopick.js:11`)*

7. **Skal etaperne vægtes ulige i egnetheds-snittet?** I dag er det et uvægtet gennemsnit over
   alle etaper (`raceAutopick.js:51-56`), så en Grand Tours bjergetaper tæller det samme som
   dens flade. Skal afgørende etaper veje tungere?

8. **Må assistenten sætte `hunter`?** Rollen findes i motorens vokabular og har sin egen
   DB-constraint, men ingen assistent-sti sætter den nogensinde. Er det tilsigtet, eller et hul?
   *(`raceAutopick.js:114-119` vs. `RACE_ENGINE_RULES.md` §1)*

9. **Hvad er kontrakten for hvad spilleren får at vide?** Der findes ingen forklaring på hvorfor
   assistenten valgte netop de ryttere. `PLANNING_CENTER_RULES.md` §4 lister "én forklarende
   linje på boardet" som kendt rest i P3, men der er ingen besluttet tekst.

---

## 13. De fejl området historisk har lavet

Alle er verificerede postmortems i `.claude/learnings/` eller lukkede issues. Læs dem før du
rører en assistent-sti - fem af de otte er samme fejlklasse.

| Dato | Hvad gik galt | Fejlklasse | Kilde |
|---|---|---|---|
| 25/6 | `selectInChunks` trunkerede tavst ved 1000 rækker → manuelle entries blev overskrevet, kaptajns-constraint brød | tavs paginerings-trunkering | `2026-06-25-entry-generator-selectinchunks-1000-row-truncation.md` |
| 25/6 | Runtime auto-fill manglede binding → **142 dobbeltbookinger** (Tour des Alpes Suisses fyldt med den igangværende La Corsas ryttere) | binding ikke håndhævet | `raceRunner.js:958-961` |
| 4/7 | `loadFieldBindingContext` hentede `scheduled_at` men ikke `game_day` → bindingen driftede til kalenderdag → tomme startfelter, `No start list` i Sentry | to nøgle-rum for samme begreb | `2026-07-04-race-autofill-binding-gameday-drift.md` |
| 12/7 | `.range()` uden `ORDER BY` dublerede rytter-rækker mellem sider → autopick valgte samme rytter to gange → PK-crash i prod | ustabil paginering | `raceEntryGenerator.js:106-112` |
| 16/7 | Holdets ugerytme overtrumfede rytterens egen intensitet → *"Now my entire racing team is dead"* | forkert præcedens mellem lag | `2026-07-16-training-routine-overrode-individual-setting.md` |
| 17/7 | Sweepen auto-udtog for HELE sæsonen, og manuelt ryddede trupper kom tilbage | ryddet kunne ikke skelnes fra "aldrig rørt" | `2026-07-17-race-entry-clear-marker-missing.md`, [#2599](https://github.com/NicolaiDolmer/CyclingZone/issues/2599) |
| 27/7 | Peak-assistenten regnede alder på wall-clock → 121 ryttere fik ét peak i stedet for to. **Ingen spiller opdagede det** | to alders-formler | `2026-07-27-peak-assistant-wall-clock-age-3081.md` |
| 5/8 | "Spring over"-gren ryddede ikke op → residual auto-entry holdt en dobbeltbooking i live i 7 dage trods konvergeret sweep | skip-gren uden oprydning | `2026-08-05-fullmanual-unit-skipped-leaves-residual-auto-entry.md` |
| 20/8 | "Mangler udtagelse"-varslet talte kun manuelle entries → 26 falske notifikationer på FULDE auto-udfyldte trupper | to definitioner af "mangler" | `2026-08-20-selection-warning-counted-manual-only.md`, [#4038](https://github.com/NicolaiDolmer/CyclingZone/issues/4038) |
| 24-25/8 | Tre spillere fik ryddede trupper fyldt igen; to brugte over en time på planer sweepen overskrev. Den proaktive assistent blev slået fra | push i stedet for pull | [#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200), [#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217) |

**Det gennemgående mønster: to steder definerer samme begreb, og de driver fra hinanden.**
"Mangler udtagelse", "ryddet", "bindingsdag", "alder" og "løbsdag" har alle kostet en
spiller-rapport netop fordi to kodeveje svarede forskelligt. Enhver ny assistent-regel skal
have ét sted den bor.

---

## 14. Kildedokumenter

- [`PLANNING_CENTER_RULES.md`](PLANNING_CENTER_RULES.md) §4 - de fem låste assistent-regler
  (ejer-bekræftet, nedskrevet 28/8, [#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201)).
  **Overordnet denne fil for alt der rører fladen.**
- [`CALENDAR_RULES.md`](CALENDAR_RULES.md) §2b + §8 - binding, `game_day`, trupgrænser, gulvet på 6.
- [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) §1 - rolle-vokabularet (fem værdier).
- `TRAINING_RULES.md` - **findes ikke endnu**; leverance 1 i
  [#4192](https://github.com/NicolaiDolmer/CyclingZone/issues/4192). §9 og §11.3 her skal flytte
  eller pege derhen når den skrives.
- `backend/lib/raceAutopick.js` - udvælgelseskernen. Topkommentaren er den mest præcise
  eksisterende prosa om assistenten og bør ikke slettes.
- `backend/lib/raceEntryClears.js` - ryd-markeringens semantik, ét sted.
- [PR #4301](https://github.com/NicolaiDolmer/CyclingZone/pull/4301) - sen redning + copy-kontrakten
  for `partialSquadOutlook`.

---

## 15. Hvad denne fil IKKE dækker

Ærlig mærkat, jf. tidsbudgettet. Følgende er assistent-nært, men **ikke** verificeret i denne
omgang, og må ikke antages dækket:

- **AI-holdenes autofill i detaljer.** §1 fastslår at de fyldes; hele `runRaceEntryGeneratorSweep`s
  diff-/staging-logik (`applyUnitDiff`, TOCTOU-retries) er ikke gennemgået her.
- **`partialSquadOutlook`-copy-kontrakten** - den bor i PR #4301 og er ikke efterprøvet mod
  den kørende frontend.
- **`aiRecoverySweep.js` og `boardAutoAccept.js`** - to andre automatiske systemer der bruger
  ordet "assistent" i kommentarer, men hører til AI-hold og bestyrelsen
  ([`BOARD_RULES.md`](BOARD_RULES.md)).
- **Hjælp/FAQ-teksterne** (`help.json` en+da) om assistenten er ikke gennemgået for om de
  stemmer med adfærden dokumenteret her.
