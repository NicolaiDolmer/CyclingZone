# Træningens regler - SSOT

> **Læs denne FØR enhver opgave der rører træning: det daglige tick, assistent-sweepen,
> dagstyper og sessioner, ugerytme, restitution, form, skader fra træning, træner- og
> facilitets-effekt, eller løbsdages forhold til træning.** Ejer-direktiv 25/8
> ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)) · områdedokument oprettet
> under ejer-direktivet om et SSOT-dokument pr. kernefunktion (frist 1/9).
>
> **Denne fil beskriver TRÆNINGSMASKINEN: hvornår den kører, hvad den læser, og hvad den
> skriver.** Den beskriver IKKE hvor højt en rytter kan komme, hvordan lofter dannes, hvad
> potentiale gør, eller hvordan rating beregnes. Alt det bor i
> [`PROGRESSION_RULES.md`](PROGRESSION_RULES.md), og de to filer må ikke duplikere hinanden.
> Grænsen er §2: træningen leverer en daglig delta pr. evne, progressionen bestemmer hvor
> stor den delta må være og hvor den stopper.
>
> **Præcise vægte, rater, multiplikatorer og tærskler står IKKE i denne fil** - samme regel
> som `PROGRESSION_RULES.md` (hard rule 17,
> [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436): repoet er offentligt
> læsbart). Hvor et tal hører til, står konstant-navnet og filen med linjenummer. Kadence,
> feature-flag-tilstande, datoer og målte prod-tal er derimod ikke balance-hemmeligheder og
> står ordret.
>
> Verificeret mod kode på `main` og mod prod **30/8 2026** (Europe/Copenhagen). To åbne PR'er
> rører området lige nu - se §9. **Ejerens retning for det næste (Discord 2/9) står i §12** og er
> hensigt, ikke bygget adfærd.

---

## 1. Kadencen: hvornår træningen faktisk kører

Der er **ét trænings-tick pr. hold pr. dansk kalenderdag**, og der findes ingen anden.

| Regel | Værdi | Kilde |
|---|---|---|
| Tick-enheden | ét hold, én `tick_date` (dansk dato) | `backend/lib/dailyTrainingEngine.js:129` (`copenhagenDateString(now)`) |
| Idempotens-lås | `UNIQUE(team_id, tick_date)` i `training_day_runs`, reservation-first: INSERT af en `{pending:true}`-række er selve mutexen; Postgres 23505 → `alreadyRan` | `dailyTrainingEngine.js:132-147` |
| Manuel udløser | `POST /api/training/run-today`, `executedBy: "manager"` | `backend/routes/api.js:2733-2760` |
| Automatisk udløser | assistent-sweep, `executedBy: "assistant"` | `backend/lib/trainingSweep.js` |
| Sweep-vindue | **fra kl. 22:00 dansk tid og resten af døgnet** | `trainingSweep.js:17` (`SWEEP_FROM_HOUR = 22`), `shouldSweepNow` |
| Sweep-frekvens | cron-jobbet tikker **hvert 5. minut**; `shouldSweepNow` er porten, så det første tick efter kl. 22 gør arbejdet og resten er no-op | `backend/cron.js:1441-1444` |
| Hvem sweepes | hold hvor `is_bank=false`, `is_frozen=false`, `is_test_account=false`. `is_ai=false` er **fjernet** så længe `race_day_engine_enabled` er on (D4) | `trainingSweep.js:78-82` |
| Master-flag | `daily_training_enabled` i `app_config`, fail-safe off | `backend/lib/dailyTrainingFlag.js` |

**Manager-klikket er ikke en ekstra dag, det er den samme dag taget tidligere.** Klikker
manageren "Træn i dag", tager han dagens ene tick og får en bonus-multiplikator
(`DAILY_TRAINING_CONFIG.bonusMult`, `backend/lib/dailyTraining.js:15`); sweepen kl. 22 finder
så en optaget `tick_date` og springer holdet over. Sweepen giver ikke bonus
(`bonus = executedBy === "manager"`, `dailyTrainingEngine.js:130`).

**Målt i prod 30/8** (Supabase, `training_day_runs`): 2.695 kørsler de sidste 7 dage, heraf
**398 manager-udløste og 2.297 assistent-udløste**. Dagsvolumen ligger stabilt på 346-360
kørsler, hvoraf ca. 50 er manager-klik. Under 15 % af alle trænings-dage tages altså af en
spiller; resten er assistenten.

### 1.1 Rækkefølgen inde i sweepen

1. Portene: kl. 22-vinduet → `daily_training_enabled` → aktiv sæson findes.
2. `runTeamTrainingDay` kaldes **sekventielt pr. hold**, hver i sin egen try/catch, så ét
   hold der fejler ikke stopper resten (`trainingSweep.js:113-134`).
3. **Kun om søndagen** kører derefter værdi-genberegningen (`refreshChangedRiderValues`) og
   markedsblendet (`runMarketValueSundaySweep`), i den rækkefølge
   (`trainingSweep.js:154-181`). Selve træningen er uændret daglig; det er kun værdisiden der
   er søndags-gated (#3448, 6/8). **PR #4421 flytter dette skridt ud af sweepen** - se §9.

---

## 2. Hvad et tick gør ved én rytter

Rækkefølgen i `dailyTrainingEngine.js`'s pr-rytter-loop (linje 281-465) er bindende, fordi
flere af trinene læser en værdi fra FØR et senere trin ændrer den.

| # | Trin | Detalje | Kilde |
|---|---|---|---|
| 1 | Program opløses | `resolveProgram(plan, primary_type)`; ingen plan → `smartDefaultFocus` for rytterens type, ikke længere altid `endurance` (#1894) | `dailyTraining.js:59-66` |
| 2 | Dagens intensitet opløses | lagdelt, se §4. Rører **kun** intensiteten, aldrig fokus | `dailyTrainingEngine.js:301-307` |
| 3 | Loftet genberegnes | `buildCapsForRider(abilities, {...rider, age}, primary, secondary)` - hver tick, aldrig lazy | `riderProgression.js:591-606` |
| 4 | Skade-status | `injured_until >= tickDate` → dagens effektive intensitet bliver `"rest"`, ingen gevinst, planen røres ALDRIG (G5-invarianten) | `dailyTrainingEngine.js:334, 360` |
| 5 | Løbsdag? | kun hvis `race_day_development_enabled` er on. **Off i S3**, se §6 | `dailyTrainingEngine.js:344` |
| 6 | Pre-tick snapshots | `preFatigue` og `preProgress` tages FØR tick'et, fordi skaderisikoen skal bruge gårsdagens træthed, ikke dagens resultat | `dailyTrainingEngine.js:350-357` |
| 7 | Selve tick'et | `applyDailyTick` **eller** `applyRaceDevelopmentTick`, gensidigt udelukkende grene i samme if/else - dobbelt-kredit er umulig by construction | `dailyTrainingEngine.js:365-421` |
| 8 | Træthed og form | `nextFatigue` derefter `nextForm(form, nyTræthed)` | `dailyTrainingEngine.js:430-440` |
| 9 | Skade-rul | kun for raske ryttere, på `preFatigue` | `dailyTrainingEngine.js:447-459` |
| 10 | Skade ryddes | når `injured_until < tickDate` | `dailyTrainingEngine.js:462-465` |

### 2.1 Faktor-kæden i den daglige delta

Én evnes daglige tilvækst er et produkt af led der hver er 1,0 når deres feature ikke er i
brug. Rækkefølgen står i `dailyAbilityDelta` (`dailyTraining.js:113-159`):

```
base(gap, alder)  ×  fokus-multiplikator  ×  rolle-rate  ×  kondition
                  ×  ungdomsfaktor(alder) ×  potentiale-rate
                  ×  manager-bonus        ×  dagsstøj
                  ×  træner-bonus         ×  facilitets-multiplikator
```

- `base` er gap-proportional: `gap × growthFractionForAge(age) × dailyBudgetBoost / daysPerSeason`
  (`dailyTraining.js:123`). `gap` er afstanden til loftet, så en evne på sit loft giver nul,
  uanset resten af kæden.
- **Fokus-multiplikatoren** kommer fra `abilityMult` (`dailyTraining.js:84-100`): evner i
  dagens fokus får `TRAINING_CONFIG.focusGrowthMult[intensitet]`, resten får
  `TRAINING_CONFIG.offFocusMult` (`backend/lib/training.js:37, 57`).
- **`rest`-intensitet giver 0 for ALLE evner** (`dailyTraining.js:85`). Det er den enkelt-linje
  der forårsager afvigelsen i §6.2.
- **Aktiv restitution rører kun sessionens egen evne** (`restitution` → `recovery`); alle andre
  evner får præcis 0, ikke off-fokus-multiplikatoren (`dailyTraining.js:92-95`). Uden den gren
  var restitution bare den billigste træningsdag.
- **Rolle-raten** (`roleRateFactor`, `ROLE_CLASS_RATE` i `riderProgression.js:179-185`) hører
  til progressionen, ikke træningen - se `PROGRESSION_RULES.md` §1. Træningen forbruger den.
- **En færdighedsdag trænes ALTID til håndværks-raten**, også når evnen er rytterens signatur
  (`dailyTraining.js:135-138`, ejer-besluttet 14/8, #3762). Uden det loft var en
  lavbelastnings-færdighedsdag strengt bedre end en hård dag for de roller hvor
  færdigheds-evner bærer halvdelen af ratingen.
- **Dagsstøjen** er seeded på `(rytter, dato)` (`dtick:`-namespace), ikke tilfældig
  (`dailyTraining.js:193`). Samme rytter samme dag giver samme støj ved gen-kørsel.

### 2.2 Fra delta til point: hvordan vækst-cappet håndhæves

Deltaen er en lille float. Den lægges i en fremdrifts-bar pr. evne
(`rider_derived_abilities.ability_progress`), og hver gang baren passerer 1,0 konverteres den
til ét helt evnepoint (`dailyTraining.js:205-217`).

**Der er præcis to lofter i produktionsstien:**

| Loft | Hvad det gør | Hvor |
|---|---|---|
| `min(99, ability_caps[evne])` | while-løkken stopper med at udbetale point når evnen rammer sit livstidsloft eller 99. Baren beholder resten (klippet ved 0,999) | `dailyTraining.js:210-217` og `:295-302` |
| `gap = 0 → return 0` | en evne på sit loft får slet ingen delta beregnet | `dailyTraining.js:118-119` |

**Der findes IKKE længere et dagligt spring-loft.** `hardDailyCap` er stadig en valgfri
parameter i signaturen, men **produktionsstien sender den aldrig** - søg efter `hardDailyCap`
i `dailyTrainingEngine.js` og der er nul forekomster. Ligeledes er `academyRateMult`
(interim-knappen fra #2437) og `computeAcademySeasonCeiling` ude af produktionsstien:
`tickCaps = caps`, altså livstidsloftet for alle aldre (`dailyTrainingEngine.js:331`). Begge
blev fjernet i #3709 trin 5 (ejer 14/8) med den begrundelse at de bremsede en model der
mættede, og at trin 4 fjernede mætningen ved roden.

**Konsekvens der skal kendes:** træner- og facilitets-bonusserne kan aldrig udvide et loft.
De skalerer kun deltaen; while-løkken klipper stadig ved `ability_caps`
(`backend/lib/staffTrainingBonus.js`, invariant 3).

---

## 3. Dagstyper og sessioner (den model spilleren ser)

Ejer-besluttet 14/8 (#3762). Trin 1: hvilken slags dag. Trin 2: hvilken session - kun de
sessioner der findes på den dagstype. **Intensiteten er ikke et valg, den er en egenskab ved
sessionen** (`SESSION_INTENSITY`, `backend/lib/trainingDayTypes.js:71-83`).

| Dagstype | Sessioner | Intensitet | Note |
|---|---|---|---|
| Hvile (`rest`) | ingen | `rest` | Ingen udvikling overhovedet. Fokus bevares i kolonnen så valget ikke går tabt |
| Aktiv restitution (`recovery`) | ingen | `recovery` | Egen fokus-nøgle `restitution` → kun evnen `recovery`. Sænker træthed, men mindre end hvile |
| Færdighed (`skill`) | `technique`, `aero`, `loebslaere` | `easy` | Rammes af håndværks-loftet på raten, §2.1 |
| Træning (`training`) | `endurance` (let) · `tempo` (normal) · `vo2max`, `threshold`, `sprint` (hård) | følger sessionen | Niveauet ER intensiteten |

**Hvorfor modellen blev vendt om:** de gamle 6 fokus × 4 intensiteter gav 24 kombinationer,
hvoraf mindst en tredjedel var meningsløse, og spillet lod dig vælge dem. Målt 14/8 mod 4.588
planer: **623 planer (13,6 %) stod på fokus + hvile**, hvor motoren ignorerede fokusset hver
eneste dag; 178 stod på `endurance` + hård; 71 på `sprint` + let
(`trainingDayTypes.js:5-25`).

**Ingen skema-ændring:** `training_plans` bærer stadig `(focus, intensity)`. Dagstype og
session **udledes** af parret, ét sted (`dayTypeForProgram`, `sessionForProgram`), så der ikke
opstår to sandheder. Skrivestien går gennem `programForChoice`, som afviser ugyldige
kombinationer; læsestien gennem `normalizeProgram`.

**Migrations-reglen var: bevar EVNERNE, ikke intensiteten** (ejer 14/8). Målt konsekvens over
de 4.588 planer: 0 ryttere skiftede hvad de trænes med, 516 planer skiftede intensitet. Og
`migrationTargetFor` satte planer der ville rykke OP i belastning på hvile først, fordi 1.928
af 4.589 planer flyttede opad og 1.085 af de ryttere allerede havde træthed ≥ 70 (median 80)
- altså ca. 109 skader dag 1 hos managere der aldrig havde valgt hård træning
(`trainingDayTypes.js:206-232`).

**Målt fordeling i prod 30/8** (aktive `training_plans` i indeværende sæson, 2.391 rækker):

| Intensitet | Antal | Andel |
|---|---|---|
| hard | 808 | 33,8 % |
| **rest** | **750** | **31,4 %** |
| easy | 477 | 19,9 % |
| recovery | 217 | 9,1 % |
| normal | 139 | 5,8 % |

Næsten hver tredje aktive plan står på Hvile, og det er forudsætningen for at forstå §6.2.

> **Ikke samme tal som #4192.** #4192 målte 1.520 ryttere på 103 hold 24/8 på en **bredere
> definition**. Snittet her (`training_plans.intensity = 'rest'` i aktiv sæson, krydset mod mindst
> ét S3-løb) giver 656 pr. 30/8, genmålt til 657 pr. 31/8. Forskellen er en faktor 2,3, så de to
> tal må ikke bruges i flæng. Skal §8 punkt 5 afgøres på et tal, er det snittet her, fordi
> definitionen står skrevet.

---

## 4. Ugerytme: hvem vinder når to lag siger noget forskelligt

`resolveDayIntensity` (`backend/lib/training.js:372-386`) er ÉN ren funktion, delt mellem
motoren og frontendens visning. Prioritet, højeste vinder:

| # | Lag | Kilde |
|---|---|---|
| 1 | Rytterens EGEN pr-dag-override | `training_week_plans` med `rider_id` sat |
| 2 | Rytterens egen eksplicitte plan (`hasExplicitPlan`) | `training_plans.intensity` |
| 3 | Holdets ugerytme | `training_week_plans` med `rider_id IS NULL` |
| 4 | Allerede resolvet plan-/default-intensitet | `resolveProgram` |
| 5 | `"normal"` | sidste sikkerhedsnet |

**Trin 2 er en fejlrettelse, ikke et design-valg fra starten.** Før #2438 (16/7) vandt
holdrytmen ubetinget over rytterens egen intensitet. En spiller satte holdets rytme til hård
og enkelte ryttere til hvile; alle trænede hård alligevel, og han droppede feature'en med
ordene "Now my entire racing team is dead". Ejerens præcedens: **en individuel
rytter-indstilling overtrumfer den ugentlige rutine** (postmortem:
`.claude/learnings/2026-07-16-training-routine-overrode-individual-setting.md`).

En ugeplan kræver **alle 7 ugedage** - ingen delvis rytme (`isValidWeekPlanDays`,
`training.js:333-346`).

**Målt i prod 30/8:** 23 hold har en holdrytme, og der findes 45 pr-rytter-overrides. Begge
lag er altså tyndt brugt i forhold til de 2.391 aktive planer.

**Slot-loftet er inert.** `TRAINING_CONFIG.slotsPerSeason = 3` findes stadig, men
`unlimitedSlots: true` gør at hele truppen kan have en plan (`training.js:20-24`). UI'et
skjuler slot-tælleren når `slots.total === null`.

---

## 5. Restitution, form og skader

### 5.1 Restitutionen kører KUN i det daglige tick

Dette er områdets vigtigste og mest misforståede regel.

```
recovery = recoveryBase + recoveryFromAbility × (recovery-evne / 99) + recoveryFraction × aktuel træthed
næste træthed = clamp(0, 100, aktuel + intensitets-load + løbs-load − recovery)
```

`backend/lib/riderCondition.js:11-46`. Konstanterne står i `CONDITION_CONFIG` samme sted.

**Der findes ikke noget nat-tick.** Restitutionen er hængt op på trænings-tick'et og intet
andet. De tre led er der for at træthed aldrig kan sidde fast på 100: et fast gulv alle får,
et evne-afhængigt bidrag, og et proportionalt led der giver en ligevægt UNDER 100 selv under
hård daglig belastning.

**Timings-problemet er åbent og har høj prioritet:**
[#3461](https://github.com/NicolaiDolmer/CyclingZone/issues/3461), rapporteret af tre spillere
i Discord 6/8. Etaper afvikles i faste dags-slots mellem kl. 11 og 19 og skriver
løbstrætheden med det samme (`applyRaceFatigue`, `backend/lib/raceFatigue.js:98`), mens
restitutionen kun kommer én gang i døgnet. Klikker manageren "Træn i dag" om morgenen, har
han brugt døgnets eneste restitution før etaperne, og rytterne står på 100 næste morgen.
**Issuet er åbent og ikke rettet på main 30/8.**

Undtagelser hvor træthed også flytter sig uden for det daglige tick:

| Sti | Hvad | Kilde |
|---|---|---|
| Løb | `applyRaceFatigue` skriver etapens belastning ved afvikling | `raceFatigue.js:98` |
| Grand Tour-hviledage | `restDayFatigue` / `applyGrandTourRestDayFatigue` - samme model, N dage | `raceFatigue.js:146, 175` |
| AI-hold uden løbsdags-motoren | `aiRecoverySweep` gav AI-ryttere ren restitution i samme kl. 22-vindue | `backend/lib/aiRecoverySweep.js` |
| Sæsonskifte | `applySeasonFatigueReset` | `backend/lib/seasonFatigueReset.js` |

**`aiRecoverySweep` er en no-op i dag.** Den er stadig wiret i cron
(`backend/cron.js:1447-1450`), men returnerer straks `skipped: "race_day_engine_on"`, fordi
`race_day_engine_enabled` er on og AI-hold nu kører gennem samme `dailyTrainingEngine` som
menneskehold (D4). Filen skulle slettes i en opfølgnings-PR efter 23/8-verifikationen; det er
ikke sket (`aiRecoverySweep.js:144-154`). Historikken bag den: målt 3/8 sad 61 % af
AI-rytterne på trætheds-loftet 100, fordi sweepens `is_ai=false`-filter var arvet fra
bestyrelses-notifikationer (`.claude/learnings/2026-08-03-ai-rider-recovery-filter.md`).

### 5.2 Sæsonskiftets nulstilling

| | Træthed | Form |
|---|---|---|
| Modul | `seasonFatigueReset.js` | `seasonFormReset.js` |
| Flag / mode | `season_fatigue_reset_enabled` = **on** (sat 26/7 08:59 dansk tid) | `season_form_reset_mode` = **`decay`** (sat 3/8 22:59 dansk tid) |
| Aktiv mode | `MODE: "full"` - alle ryttere på 0 | mod `decay_target`, med `decay_factor` |
| Ejer-beslutning | 26/7: valgte "full" selvom harnesset anbefalede `rest_days`/3, fordi princippet "alle starter sæsonen lige" vejede tungere end at AI-hold vandt 3,9 procentpoint af top-10-pladserne | parametrene ligger i `app_config`, ikke i kode |
| Idempotens | "full" er idempotent (f → 0, 0 → 0), derfor ingen claim-tabel. Låst af test | - |

Målt i `app_config` 30/8. De øvrige `season_form_reset_*`-parametre står også i `app_config`
og blev sidst rørt 3/8.

Bemærk at de to blev bevidst adskilt: `seasonFatigueReset` rører **ikke** form, fordi
`nextForm` kobler form til træthed, og en reset der skrev begge ville flytte to
balance-håndtag på én gang (`seasonFatigueReset.js:14-16`).

### 5.3 Form

`nextForm(form, fatigue)` (`riderCondition.js:64-76`): form bygges i en trætheds-**sweet-zone**
(`formSweetLo`–`formSweetHi`), tabes over zonen, og vokser let under den. Formen ganges
derefter ind i dagens trænings-effekt via `conditionMultiplier`
(`riderCondition.js:79-87`), som er klemt mellem et gulv og et loft, så hverken perfekt form
eller total udmattelse kan gøre en dag ekstrem.

**Målt i prod 30/8** (`rider_condition`, 6.807 rækker): gennemsnitlig træthed **38**, median
**41**. Det ligger under det 40-60-mål #4277 refererer til for menneskeholdenes median, og
under den median på 57 der blev målt efter D3-rekalibreringen. Tallet er ikke opdelt på
menneske- og AI-hold her, så det er **ikke** en verifikation af at D3-målet holder - det er
et øjebliksbillede af hele bestanden.

### 5.4 Skader fra træning

| Regel | Kilde |
|---|---|
| Skaderisiko kræver **hård** intensitet OG træthed over `injuryFatigueFloor`. Alt andet giver præcis 0 | `riderCondition.js:88-91` |
| Risikoen er `injuryBaseRisk + (træthed − floor) × injuryRiskPerPoint` | `riderCondition.js:90` |
| Rullet er seeded på `(rytter, dato)`, ikke tilfældigt | `riderCondition.js:93-99` |
| Varighed: 1 til `injuryMaxDays` dage, også seeded | `riderCondition.js:96-98` |
| Skaden starter EFTER dagens session (`injured_until = tickDate + dage`) | `dailyTrainingEngine.js:454` |
| Årsagen skrives som `injury_cause = "training_overload"` | `dailyTrainingEngine.js:456` |
| **Ingen trænings-skaderisiko på en løbsdag**: `effectiveIntensity` bliver `"race"`, og `injuryRisk` kræver `"hard"` | `dailyTrainingEngine.js:360` + `riderCondition.js:89` |
| En skadet rytter får `"rest"`, ingen gevinst, og planen røres ALDRIG | `dailyTrainingEngine.js:360` |

`GET /api/training/me` beregner og udstiller `risk` pr. rytter med den **planlagte**
intensitet, så spilleren kan se risikoen før dagen køres (`backend/routes/api.js:2687-2696`).

**Målt i prod 30/8:** 69 ryttere har `injured_until >= i dag`. Kolonnen skelner ikke mellem
trænings- og løbsskader i denne optælling.

---

## 6. Træning og løbsdage

### 6.1 Datosat tilstand, ikke en permanent regel

> **Løbsdags-UDVIKLINGEN er slukket i sæson 3 og planlagt tilbage i sæson 4.**
> `race_day_development_enabled` = **`off`**, sat **26/8 2026 kl. 22:46 dansk tid**
> (`app_config`, målt 30/8). Ejer-beslutning 26/8, `#4277`: *"Modellen er ikke god nok endnu."*
> Dette er en tilstand med en dato, ikke en regel om hvordan spillet skal virke.

#3459 samlede oprindeligt fire ting bag ét flag. #4277 splittede dem:

| | Hvad | Flag efter #4277 | Tilstand 30/8 |
|---|---|---|---|
| D1 | Løbsdags-gaten: en racende rytter springer dagens pas over | `race_day_development_enabled` | **off** siden 26/8 |
| D2 | Løbet udvikler rytteren i etapens relevante evner | `race_day_development_enabled` | **off** siden 26/8 |
| D3 | Rekalibrerede restitutions-konstanter | `race_day_engine_enabled` | **on** siden 7/8 13:04 dansk tid |
| D4 | AI-hold kører samme `dailyTrainingEngine` som menneskehold | `race_day_engine_enabled` | **on** siden 7/8 |

De to flag er **bevidst uafhængige** og skal kunne stå i alle fire kombinationer. Netop
koblingen var fejlen: at slukke hele flagget ville have rullet træthedsmedianen tilbage fra
57 til 67 for alle spillere og frosset 137 AI-holds udvikling
(`backend/lib/raceDayDevelopmentFlag.js:1-30`).

**Hvad flag-off betyder konkret i S3:** motoren kender ikke løbskalenderen, løbsdags-lookuppet
kører slet ikke (ingen spildt query), en racende rytter kører sit **normale træningspas** den
dag, og løbstrætheden lægges oven i træningstrætheden. Det er S2-adfærd.

Når udviklingen er ON, gælder følgende, og det er hvad der skal genbesøges før S4:

| Regel | Konstant | Fil |
|---|---|---|
| Løbet udvikler mere end det pas det erstatter | `RACE_DEV_CONFIG.devMult` (bånd `devMultLo`–`devMultHi`, ejer-valgt 6/8) | `dailyTraining.js:52` |
| Kun løbsprofilens relevante evner udvikles | `RACE_PROFILE_ABILITY_MAP`, 9 profiltyper | `dailyTraining.js:35-45` |
| Ukendt profil → `rolling` | samme fallback som `raceFatigueLoad` | `dailyTrainingEngine.js:255` |
| Budgettet fordeles JÆVNT over de relevante evner | `perAbility = devTotal / relevant.length` | `dailyTraining.js:289` |
| En evne på sit loft springes over, og dens andel **går tabt** (omfordeles ikke) | `dailyTraining.js:296` |
| UI'ets løbsdags-badge følger UDVIKLINGS-flaget, ikke motor-flaget | `racingToday` udelades helt fra `/api/training/me` når off | `backend/routes/api.js:2606-2612` (rettet i #4375) |

### 6.2 Den kendte afvigelse: planen er stadig input på en løbsdag

**Spec 6/8 siger: på løbsdage udføres det planlagte pas ikke. Koden gør noget andet.**
`applyRaceDevelopmentTick` beregner løbets udbytte som *"det erstattede pas"* × `devMult`, og
det erstattede pas beregnes med rytterens faktiske program. Da `abilityMult` returnerer 0 for
`rest` (`dailyTraining.js:85`), får en rytter hvis plan står på Hvile eller Aktiv restitution
**nul udvikling af at køre løb**.

Ejerens dom 24/8, ordret: *"Hvis man kører løb eller træner, så kan man ikke begge dele. Du
træner enten. Eller kører løb. Du kan ikke deltage i et løb og en hviledag på samme tid."*

Målt i prod 24/8 (#4192): 1.520 ryttere på 103 hold var sat til Hvile OG tilmeldt et S3-løb,
og Hvile har den højeste løbsandel af alle indstillinger (89 %), fordi assistenten udtager de
friske. Målt igen 30/8 står 750 af 2.391 aktive planer (31,4 %) stadig på Hvile.

**Afvigelsen er ikke rettet, den er kun gjort inaktiv:** med
`race_day_development_enabled = off` kører den kode ikke i S3. Den vender tilbage sammen med
flaget medmindre modellen laves om først. **Hvad der SKAL bestemme udbyttet i stedet er en
åben ejer-beslutning** - se §8.

---

## 7. Hvad træneren og faciliteten påvirker

Begge er live: `facilities_enabled` = **on** siden 6/7 (`app_config`, målt 30/8).

De to led har bevidst forskellig semantik og ganges hver for sig ind i den daglige delta:

| Led | Hvad det er | Varierer med | Fil |
|---|---|---|---|
| `facilityTrainingMultiplier` | **magnitude**: `1 + effectiveBonus("training", tier, staff)`. Præcis den procent Klub-fladen viser | facilitets-tier og chefens samlede kvalitet - **ens for hele truppen** | `staffTrainingBonus.js:30-33` |
| `staffTrainingBonus` | **specialisering**: chefens dimension × niveau matchet mod den konkrete evne og rytterens niveaubånd (u23/senior) | **pr. rytter og pr. evne** | `staffTrainingBonus.js:54-66` |

Tre invarianter, alle bevist i test (`staffTrainingBonus.js:11-16`):

1. **Nul regression:** `staff == null` ELLER facilitets-tier 0/null → præcis 1,0.
2. **Træning straffer aldrig.** Kun en ægte specialiserings-fordel løfter; en miss giver
   præcis 1,0, aldrig under. En chef gør en rytter bedre eller neutral, aldrig værre.
   (`Math.max(0, match − 1)`.)
3. **Bonussen kan aldrig udvide et loft.** Den skalerer kun deltaen; cap-løkken klipper stadig
   ved `ability_caps`.

Rytterens niveaubånd afgøres af `riderLevelBand({ is_academy, age })`
(`dailyTrainingEngine.js:409`). Akademi-ryttere adskiller sig herefter KUN ved
`youthMultiplier(alder)`, som `dailyAbilityDelta` allerede ganger ind - alle andre
akademi-specifikke knapper er fjernet (#3709 trin 5, se §2.2).

Kalibrerings-konstanterne (`STAFF_TRAINING_BONUS_CONFIG.k`, `facilityScale` pr. tier) står i
`staffTrainingBonus.js:39-42` og er markeret som konservative startværdier der skulle
kalibreres i Task 8.

---

## 8. Hvad der IKKE er fastlagt - kræver ejer-beslutning

Hver post er ÉN ting der mangler at blive afgjort. Ingen af dem må gættes på plads i kode.

| # | Spørgsmålet | Hvorfor det er åbent |
|---|---|---|
| 1 | **Hvad skal bestemme en rytters udbytte på en løbsdag, når planen ikke længere må være input?** Ejerens dom 24/8 siger planen ikke skal gælde; koden bruger den som input. Der er ingen besluttet erstatning (etapens profil alene? en fast løbs-rate? rytterens rolle i udtagelsen?) | §6.2, #4192. Skal afgøres FØR `race_day_development_enabled` tændes igen til S4. **Retning fra ejeren 2/9 (ikke besluttet spec): en intention pr. rytter pr. løbsdag, fem trin fra grupetto til all-out, er dagens "session"**, se §12 og [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632) |
| 2 | **Skal restitutionen have sit eget tidspunkt i døgnet, adskilt fra trænings-tick'et?** I dag er der ét tick, og et manager-klik kl. 08 bruger døgnets eneste restitution før etaperne kl. 11-19 | #3461, åben, priority:high. Ingen besluttet retning: nat-tick, to-delt tick, eller restitution løsrevet fra træning |
| 3 | **Skal `aiRecoverySweep.js` slettes?** Den er en garanteret no-op så længe `race_day_engine_enabled` er on, men står stadig i cron og forbruger et 5-minutters slot | `aiRecoverySweep.js:144-154` lover sletning "i en opfølgnings-PR efter 23/8-verifikation". Sletningen kræver en beslutning om hvorvidt `race_day_engine_enabled` nogensinde skal kunne slukkes igen |
| 4 | **Hvad er den rigtige måldistribution for træthed, og gælder den hele bestanden eller kun menneskehold?** Målt 30/8: hele bestandens median er 41, mens D3 blev kalibreret mod en menneske-median på 57 i 40-60-båndet | §5.3. Uden en besluttet definition kan ingen vagt måle om D3 stadig holder |
| 5 | **Skal 31 % af alle aktive planer stå på Hvile?** Tallet kan være et rationelt spillervalg (friske ryttere bliver udtaget) eller et symptom på at træning ikke betaler sig nok | §3, målt 30/8. Kræver en ejer-udmelding om hvad den ønskede fordeling er, før nogen kan kalde tallet forkert |
| 6 | **Skal `slotsPerSeason` og `hardDailyCap` slettes, eller er de reserveret til noget?** Begge er inerte i dag (`unlimitedSlots: true`; `hardDailyCap` sendes aldrig fra produktionsstien), men står stadig i signaturer og konfiguration | `training.js:20-24`, `dailyTraining.js:206`. Død kode eller planlagt genbrug er ikke afgjort |
| 7 | **Er `STAFF_TRAINING_BONUS_CONFIG` nogensinde blevet kalibreret?** Konstanterne er selv-markeret som "konservative start-værdier; Task 8 kalibrerer dem mod scorecardet" | `staffTrainingBonus.js:35-42`. Jeg har ikke fundet evidens for at Task 8 er kørt. **Ikke verificeret negativt** - det kan findes et sted jeg ikke har set |

**Ikke undersøgt inden for tidsbudgettet** (og derfor hverken bekræftet eller afvist her):
peak-planner-stien (`peak_planner_enabled` = on siden 21/7, `POST /api/peak-plans/:id/accept-training`
skriver ind i `training_week_plans`), akademi-graduering, og trænings-UI'ets egen visning i
`TrainingPage.jsx` / `RiderTrainingTab.jsx` ud over de felter API'et leverer.

---

## 9. Kommende ændringer (åbne PR'er 30/8)

Begge er **OPEN**, ikke merged. Beskrivelsen ovenfor er `main`.

| PR | Titel | Hvad den flytter i træningen |
|---|---|---|
| [#4421](https://github.com/NicolaiDolmer/CyclingZone/pull/4421) | `feat(economy): vaerdier opdateres soendag kl. 06 i eget job, ikke ved manuel traening (#4419)` | Rører `backend/lib/trainingSweep.js` og `backend/routes/api.js`. Flytter værdi-genberegningen ud af trænings-sweepen og manager-klikket til et selvstændigt søndagsjob (`sundayValueSweep.js`). §1.1 punkt 3 ændrer sig, når den merges |
| [#4422](https://github.com/NicolaiDolmer/CyclingZone/pull/4422) | `fix(race): skadet rytter registreres som ikke-startende i stedet for bare at forsvinde (#4418)` | Rører `raceRunner.js`, `raceIncidents.js`, `riderEligibility.js`. Ændrer **ikke** trænings-motoren, men ændrer hvad en skade betyder for løbssiden. §5.4's skade-model er stadig kilden til skaden |

---

## 10. Hvad området historisk har lavet af fejl

Alle med postmortem i `.claude/learnings/` eller audit i `docs/audits/`.

| Dato | Fejl | Rod-årsag | Lære |
|---|---|---|---|
| 5/7 | Trænings-kalibreringsgaten validerede ikke det system der kørte i prod (manglende `potentiale`-param, 28 sim-dage mod ~60 reelle, intet akademi-segment) | Harnesset kaldte `applyDailyTick` med en anden kontrakt end motoren | En gate der ikke spejler produktionsstien er ikke en gate. `2026-07-05-daily-training-season-length-unbounded.md` |
| 15/7 | Akademi-ryttere udviklede sig næsten ikke midt i sæsonen | `dailyTrainingEngine` sendte SÆSON-loftet som `caps` i stedet for livstidsloftet. `gap` faldt fra ~17,9 til ~2,0 og dagsraten kollapsede ~9x | Issue-tekstens egen diagnose (pulje-udtømning) var forkert. Verificér rod-årsagen selv. `2026-07-15-academy-training-rate-collapse.md` |
| 16/7 | Holdets ugerytme overtrumfede rytterens egen indstilling; en spiller mistede hele sit hold til hård træning | `resolveDayIntensity` rangerede rytme over individuel plan ubetinget | Individuel indstilling vinder over rutine. `2026-07-16-training-routine-overrode-individual-setting.md` |
| 3/8 | 61 % af AI-rytterne sad fast på træthed 100 | `is_ai=false`-filteret blev arvet fra bestyrelses-notifikationer ind i en ren fysiologisk mekanik | En diskriminator der er rigtig ét sted er ikke automatisk rigtig et andet. `2026-08-03-ai-rider-recovery-filter.md` |
| 3/8 | Trænings-fladens "Begrænset"-label modsagde rytterens viste potentiale | `focusTrainability` brugte en model der var konsolideret væk 15/7, og kendte kun `primary_type` | UI-labels der genimplementerer motorlogik divergerer. `2026-08-03-training-trainability-legacy-model.md` |
| 11/8 | 117 ryttere trænede et fokus hvor ALLE evner stod på loftet; 741 med mindst én død evne; 110 af 197 spillerhold ramt | Fladen aggregerede fokusset til ét tal, så en død evne var usynlig. Tre spillere måtte rapportere det, og det havde stået i ugevis | Fejlen var ikke at loftet fandtes, men at ingen MÅLTE det. Vagten `trainingSlotHealthWatch.js` blev bygget som svar (`backend/cron.js:1600`) |
| 14/8 | 623 planer (13,6 %) stod på fokus + hvile og blev ignoreret hver dag | Fokus og intensitet blev præsenteret som frie akser, hvoraf en tredjedel af kombinationerne var meningsløse | Modellen blev vendt om til dagstype-før-session (#3762) |
| 24/8 | En rytter på Hvile får nul udvikling af at køre løb | Planen er stadig input på en løbsdag, i modstrid med spec 6/8 og ejerens dom | Åben, se §6.2 og §8 punkt 1 |
| 30/8 | En kadence-omlægning ramte ikke alle kaldesteder | (postmortem i PR #4421: `.claude/learnings/2026-08-30-kadence-omlaegning-ramte-ikke-alle-kaldesteder.md`) | Endnu ikke merged; læs den når PR'en lander |

**Mønsteret på tværs:** seks af de ni er *stille* fejl. Systemet kørte, skrev rækker og
returnerede 200, mens det gjorde noget andet end det designet sagde. Kun to blev fundet af en
vagt; resten blev fundet af spillere eller ved en tilfældig gennemlæsning. Det er samme hul
som `PROGRESSION_RULES.md` §8 beskriver: der er **ingen tilbagevendende måling mod prod** af
trænings-motorens output, i modsætning til kalenderens
`.github/workflows/calendar-invariant-audit.yml`. Den eneste daglige vagt i området er
`trainingSlotHealthWatch`, og den måler ét symptom (døde fokus-slots), ikke motoren.

---

## 11. Kildedokumenter og kode

**Læs FØRST, altid:**
- [`PROGRESSION_RULES.md`](PROGRESSION_RULES.md) - lofter, potentiale, rolleklasser, rating.
  Træningen forbruger dem; den definerer dem ikke.
- `docs/audits/2026-08-24-4192-traening-beslutningsliste.md` - 38 beslutninger fra de tre
  design-specs, hver med bygget-status verificeret mod kode og prod 24/8. **Kilden til hvad
  der er BYGGET.** Duplikér den ikke.

**Design-specs (hensigt, ikke facit):**
- `docs/superpowers/specs/2026-08-06-loebsdags-model-design.md` - løbsdags-modellen (D1-D4)
- `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md` - dagstyper,
  rolleklasser, ejer-beslutningerne 14/8

**Kode (verificér altid mod denne, aldrig mod en spec alene):**

| Fil | Ansvar |
|---|---|
| `backend/lib/trainingSweep.js` | assistent-sweepen, kl. 22-vinduet, søndags-pipelinen |
| `backend/lib/dailyTrainingEngine.js` | orkestratoren: ét hold, én dag, alle writes |
| `backend/lib/dailyTraining.js` | ren matematik: delta pr. evne, de to tick-typer |
| `backend/lib/trainingDayTypes.js` | dagstype-stigen, session→intensitet, migrations-reglen |
| `backend/lib/training.js` | fokus→evner, `resolveDayIntensity`, ugeplan-validering, slots |
| `backend/lib/riderCondition.js` | træthed, form, konditions-multiplikator, skader |
| `backend/lib/raceFatigue.js` | løbets trætheds-belastning og Grand Tour-hviledage |
| `backend/lib/staffTrainingBonus.js` | træner-specialisering + facilitets-magnitude |
| `backend/lib/seasonFatigueReset.js` · `seasonFormReset.js` | sæsonskiftets nulstillinger |
| `backend/lib/trainingSlotHealth.js` · `trainingSlotHealthWatch.js` | den eneste daglige vagt |
| `backend/lib/dailyTrainingFlag.js` · `raceDayEngineFlag.js` · `raceDayDevelopmentFlag.js` | de tre flag |
| `backend/routes/api.js:2591-3070` | `/api/training/*` |
| `frontend/src/pages/TrainingPage.jsx` · `frontend/src/components/rider/profile/RiderTrainingTab.jsx` | fladerne |

**Tests der håndhæver reglerne** (required CI-check `backend-tests`):
`dailyTraining.test.js` · `dailyTrainingEngine.test.js` · `trainingSweep.test.js` ·
`trainingDayTypes.test.js` · `riderCondition.test.js` · `training.test.js` ·
`staffTrainingBonus.test.js` · `seasonFatigueReset.test.js` · `aiRecoverySweep.test.js` ·
`trainingSlotHealth.test.js` · `apiTrainingMeRaceDay.routes.test.js` ·
`frontend/…/TrainingPage.raceDay.test.js`

---

## 12. Ejerens retning for træningen (Discord 2/9 2026)

> **Status: retning, ikke spec.** Ejeren skrev det åbent til spillerne i #dansk-strategi 2/9 kl. 12:20-13:20
> (dansk tid) som svar på "hvad mangler I i træningen?". Alt her er hensigt der endnu ikke er bygget,
> og intet af det ændrer §1-§7 før en PR gør det. Hvert punkt har et issue; issuet er stedet
> beslutninger træffes. Spillerne har fået en engelsk udgave i #the-roadbook
> (`docs/discord/2026-09-02-roadbook-traening-en.md`). Wireframes ejeren kan sende med:
> `docs/design/wireframes-training-2026-09-02/`.

### 12.1 De fire principper ejeren slog fast

| # | Princip | Ejerens ord (ordret) | Konsekvens for design |
|---|---|---|---|
| A | **Lofter skal føles fraværende; hastighed er begrænsningen** | "Jo yngre din rytter er, jo bedre træner han. Jo længere fra rytterens 'max' i sin evne han er, jo bedre træner han. Jo lavere evnen er, jo hurtigere træner rytteren." · "Begrænsninger er tiltænkt - Hårde (låste) begrænsninger er ikke." | Bund-lofter (det hårde sikkerhedsnet ved dobbelt svaghed) hæves eller blødgøres; GC-rytterens punch-loft hæves. [#4634](https://github.com/NicolaiDolmer/CyclingZone/issues/4634). Matcher `PROGRESSION_RULES.md`: raten er det væsentlige, loftet det uvæsentlige |
| B | **Flere valg, ikke håndholdt omfordeling** | "Umiddelbart er det ikke planlagt at jeg vil 'håndholde' spillerne på den måde, fordi så synes jeg faktisk, at man gør valget af træning mindre vigtig ... Jeg vil hellere give langt flere muligheder for spilleren, selv at undgå at det sker i første omgang." | Spildt træning på en evne på loftet løses ved at splitte pakker og give flere sessioner, ALDRIG ved at motoren flytter udbyttet til en anden evne. Afviser den "overflow"-løsning tre spillere foreslog samme dag. Første split: punch og climbing, [#4631](https://github.com/NicolaiDolmer/CyclingZone/issues/4631) (refs #3705) |
| C | **Program i stedet for dagligt klik** | "Jeg regner med, at vi på sigt går over mod, at man laver et 'træningsprogram' i stedet for at man behøver at ændre træningen hver eneste dag." · "Indenfor en månedstid, cirka." (om ugeplan med session pr. dag) | Ugeplanen bærer en SESSION pr. ugedag (ikke intensitet, som §4 beskriver i dag), og et program er en navngivet 7-dages skabelon. 10-25 default-programmer ("Sprinter", "Bakkerytter", "Brostensrytter"...). [#4629](https://github.com/NicolaiDolmer/CyclingZone/issues/4629) (lukker #4116). Egne programmer + deling i en community-workshop: [#4630](https://github.com/NicolaiDolmer/CyclingZone/issues/4630) |
| D | **Løb ELLER træning er dagens ene valg; inde i løbet vælger man hvor dybt man går** | "Fordi du vælger jo træning eller løb. Det er 1 valg. Og inde i løbet tror jeg det giver sig selv - Jeg har bjergdag og vil gerne angribe .. Eller 'jeg har flad etape idag og vil slappe af med min kaptajn'." | Ejerens skitse til dagens valg: Hvile · Træning (aktiv restitution / let-teknisk / mellem / hård) · Løb (grupetto / stille og roligt / normal / arbejd-angrib-udbrud / voldsom aggressivitet). Det er retningen for §8 punkt 1. [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632) (refs #3459, #4192) |

### 12.2 Øvrige tilsagn samme dag

| Tilsagn | Ejerens ord | Issue |
|---|---|---|
| Formtræning for alle, ikke kun ældre ryttere | "Det tænker jeg kommer for alle (Y)" | [#4633](https://github.com/NicolaiDolmer/CyclingZone/issues/4633) (refs #3763, #4271) |
| Evner skal kunne trænes i flere pakker | "Også noget jeg arbejder på kommer med ind i spillet (Y)" | noteret i #3705 |
| Assistenten foreslår træning, spilleren accepterer alle/udvalgte/kun ryttere uden plan | ejer-direktiv 31/8 (#feedback-from-dolmer) | [#4522](https://github.com/NicolaiDolmer/CyclingZone/issues/4522) (eksisterede) |
| 25 %-bonussen for selv at klikke "Træn i dag" forsvinder en dag | "Jeg forventer at de 25% ekstra træning ved selv at trykke på knappen, en dag bliver slettet af spillet." (#løse-informationer 26/8) | ingen dato, ingen issue. `DAILY_TRAINING_CONFIG.bonusMult` i §1 er derfor en midlertidig mekanik |

### 12.3 Hvad spillerne bad om (samme tråd), og hvad ejeren svarede

| Ønske | Fra | Ejerens svar |
|---|---|---|
| Formtræning for ryttere der ikke jager evner | thelamba | kommer for alle (12.2) |
| Færdigheder i flere pakker | thelamba | arbejdes på (12.2) |
| Overskydende træning flyder over i andre evner når én er på loftet | thelamba, knud_r_flink | **afvist**, princip B |
| Træn en ryttertype (alle relevante evner på én gang) i stedet for et sæt evner | egomadsen, knud_r_flink, robsteren | imødekommes af default-programmer navngivet efter typen (princip C), ikke af en ny fokus-akse |
| Ugeplan med komplet session pr. dag, ikke kun intensitet | egomadsen, friisisch | ja, ca. en måned (princip C) |
| De gamle tre intensitetsniveauer tilbage | robsteren | "på vej mod" flere valg, både i træning og i løbet (princip D) |
| Blødt loft: træn videre over loftet, bare 10x langsommere | robsteren | findes allerede i princippet; de hårde net er det der skal væk (princip A) |

**Hvad dette afsnit IKKE ændrer:** kadencen (§1), tick-rækkefølgen (§2), dagstype-stigen (§3),
ugerytmens prioritet (§4), restitution/form/skader (§5), løbsdags-flaget (§6), træner/facilitet (§7).
Når et af issuerne merges, flyttes indholdet ind i det relevante afsnit, og rækken her slettes.
