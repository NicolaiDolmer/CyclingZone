# U23-holdet: kalender, trup-datamodel og pyramide (slice 1+2 af #2492) - designudkast 15/9 2026

> **Status:** UDKAST til ejer-review (skrevet af planlægger-agent 15/9, orkestrator Fable). Ingen beslutning truffet i dette dokument ud over de arkitekt-valg der er markeret som sådan. §10 er de eneste punkter der kræver ejeren; de stilles ét kort ad gangen.
> **SSOT for området:** [`docs/YOUTH_RULES.md`](../../YOUTH_RULES.md) §2, §2.3, §4, §6. Reglerne bor der; denne spec er hensigt + byggeplan (hard rule 30b).
> **Issues:** slice 1 [#4619](https://github.com/NicolaiDolmer/CyclingZone/issues/4619) · slice 2 [#4620](https://github.com/NicolaiDolmer/CyclingZone/issues/4620) · epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492) · slice 3 [#4621](https://github.com/NicolaiDolmer/CyclingZone/issues/4621) (ingen deadline).
> **Bygger på PR [#5169](https://github.com/NicolaiDolmer/CyclingZone/pull/5169)** (`feat/4845-calendar-packs-equal-race-days`, IKKE merged 15/9; verificeret: `backend/lib/calendarRaceDayTargets.js` findes ikke på `main`).
> **Verifikationsniveau:** hver påstand er mærket **[V]** = verificeret i kode/skema på `main` eller i PR-diff, **[A]** = antagelse/skøn der skal måles før build.

---

## 1. Hvad dokumentet beslutter

Dokumentet beskriver hvordan U23-holdet får sin egen løbsdags-akse, sin egen kalender og sin egen pyramide, uden at røre seniorkalenderens form, og hvordan det kan skæres så kun den kalender-kritiske del skal stå færdig før S4 genereres (#4270 apply).

Det afgør konkret:

1. Hvordan en trup repræsenteres på rytteren (`riders.squad`) og hvordan de eksisterende `is_academy`-stier overlever overgangen.
2. Hvordan en U23-pulje repræsenteres (`league_divisions.squad` + holdets medlemskab pr. trup) uden at bryde `UNIQUE (tier, pool_index)` og `CHECK (tier IN (1,2,3,4))`.
3. Hvordan kalenderpakkeren kører **to** akser med samme 140-mål uden at seniorkalenderens løb, kvote eller tæthed ændrer sig.
4. Hvor udtagelses-, taktik-, points- og op/nedryknings-stierne skal have en trup-dimension, og hvor de bevidst ikke skal.
5. Hvad der SKAL være klar før S4-generering, og hvad der kan lande i uge 1 af S4.
6. Hvad U23 koster i lane-timer, og hvad der så ikke når med i Bane 1 (§11).

Det afgør IKKE: præmiepenge (ejer-låst væk i v1), juniorkalenderen (#4621), landshold (#934), eller de balance-følsomme tal (lofter, drift, antal divisioner); de er §10 og økonomi-sim.

---

## 2. Ejerens låste beslutninger (ordret, med kilde)

Genåbnes ikke.

| # | Ordret | Kilde |
|---|---|---|
| 1 | *"Spillet skal have Senior løb, U23 løb og Junior løb. Ligesom i virkeligheden. Hvert hold har et akademi med nye årgange der løbende kommer ind."* | ejer 16/7, `docs/YOUTH_RULES.md:75` |
| 2 | *"**U23-kalenderen (#4620) bygges MED i S4-cutover**; én løbsdags-akse pr. trup (senior/U23/junior), samme 140-mål"* | ejer 15/9, `docs/TRAINING_RULES.md:651` (§13.3 beslutning 5) |
| 3 | *"**140 løbsdage pr. sæson i alle divisioner**, ikke 80. Antal LØB pr. division er urørt"* | ejer 15/9, `docs/TRAINING_RULES.md:648` |
| 4 | *"Det skal være samme antal dage ind i spillet. Men divisionerne behøves ikke nødvendigvis at køre lige mange løb."* | ejer 6/9 (#4845), citeret i PR #5169 |
| 5 | *"Spilleren skal som udgangspunkt selv vælge hvor rytterne er. [...] Man kan behandle alle sine ryttere ens. Ens kontrakter, lønninger, alle kan sælges på auktioner [...] Og det skal være muligt selv at flytte rytterne rundt."* | ejer 2/9, `docs/YOUTH_RULES.md:97` |
| 6 | *"Ikke nødvendigvis præmiepenge fra start af"* | ejer 2/9, `docs/YOUTH_RULES.md:117` |
| 7 | **Svar 5 = B:** *"egen ungdomspyramide pr. tier med op/nedrykning på egne resultater"* | ejer 2/9, akademi-spec `2026-09-02:22` |
| 8 | **D-032:** samme grundloft pr. trup for alle klubber, ekstra pladser købes som facilitetstrin, aldrig af division | ejer 10/9, #4619/#4620 |
| 9 | **D-033:** udlån fravalgt; overskydende unge beholdes, sælges eller byttes | ejer 10/9, #4620 |
| 10 | *"Jeg vil ikke have dage uden løb. I den nye sæson skal der være løb hver dag."* (kalenderdage, pr. division) | ejer 25/8, `docs/CALENDAR_RULES.md:120` |
| 11 | *"På en løbsdag må en rytter ikke køre mere end et løb."* | ejer 25/8, `CALENDAR_RULES.md` §2b |
| 12 | *"To regenereringer er forbudt."* | ejer 30/8, `CALENDAR_RULES.md:154` (§2c) |
| 13 | *"Junior-løb for Junior team, U23-løb for U23 team, på samme race-motor som senior. Vil du have en U23-rytter i et seniorløb, flytter du ham til Senior team"* | ejer 2/9, `YOUTH_RULES.md:114` |
| 14 | Felt-gaten er HÅRD: *"Hvert ungdomsløb skal have et køreligt felt via AI-fyld i 100 % af simulerede løbsdage ved nuværende population. Fejler den, skæres antal divisioner, aldrig antallet af løb til nul"* | ejer 2/9, `YOUTH_RULES.md:119` |
| 15 | Ungdomsløb vises to steder: truppens egne faner OG en egen side "Youth races" under Results | ejer 2/9, `YOUTH_RULES.md:122` + `docs/design/youth-tiers/HANDOFF.md:13` |

**Modsigelse mellem #3 og PR #5169 som den står 15/9 formiddag [V]:** `SEASON_RACE_DAY_TARGET = { 4: 80 }` i PR-diffen, og `TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason: 80` i `backend/lib/trainingRaceDayTick.js:26`. Begge skal til **140** før S4 (bølge 1-lane 15/9 retter PR'en; tick-konstanten skal læse målet, ikke duplikere det, se #4845-kommentar 15/9). U23-aksen arver tallet.

---

## 3. Datamodel

### 3.1 Hvad der findes i dag [V, `database/schema-snapshot.json`]

| Tabel | Relevante kolonner i dag | Note |
|---|---|---|
| `riders` | `is_academy`, `is_u25`, `generation_tag`, `team_id`, `ai_team_id`, `birthdate`, `pending_academy_signing`, `salary`, `contract_length`, `contract_end_season` | **Ingen `squad`-kolonne** |
| `races` | `season_id`, `league_division_id`, `pool_race_id`, `race_class`, `race_type`, `stages`, `status`, `game_day_start`, `scheduled_for`, `finalize_state` | **Ingen `squad`-kolonne** |
| `league_divisions` | `id`, `tier`, `pool_index`, `label` | `CHECK (tier IN (1,2,3,4))` + `UNIQUE (tier, pool_index)`, `database/2026-06-21-league-divisions-pyramid.sql:31-37`. 15 rækker (1/2/4/8) |
| `teams` | `league_division_id`, `division`, `assistant_autopick_enabled` | Én puljetilknytning pr. hold |
| `race_entries` | `race_id`, `rider_id`, `team_id`, `is_auto_filled`, `race_role`, `binding_span` | |
| `race_entry_days` | PK `(race_id, rider_id, game_day)`, UNIQUE `(rider_id, season_id, game_day)` | `database/2026-08-24-4173-*.sql:55-77` |
| `season_standings` | `season_id`, `team_id`, `division`, `league_division_id`, `total_points`, `rank_in_division` | |
| `race_pool` | 214 rækker i `backend/lib/__fixtures__/racePoolCatalog.prod.json` | |
| `team_facilities` | `team_id`, `track`, `tier`, `purchased_season` | Bærer D-032's købte trin |
| `academy_graduation` | `team_id`, `rider_id`, `season_id`, `status`, `deadline`, `resolved_at` | Ingen `from_squad`/`to_squad` |
| `rider_career_events` | findes | `YOUTH_RULES.md:201` siger fejlagtigt at den ikke gør; rettes i samme PR |
| `training_day_runs` | UNIQUE `(team_id, season_id, game_day)` WHERE `game_day IS NOT NULL` | `database/2026-09-14-4846-*.sql` |

### 3.2 Nye kolonner og tabeller (alle additive + idempotente)

**Slice 1: `riders.squad`**

```sql
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';
ALTER TABLE public.riders ADD CONSTRAINT riders_squad_check CHECK (squad IN ('senior','u23','junior')) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_riders_team_squad ON public.riders (team_id, squad) WHERE squad <> 'senior';
```

Backfill (idempotent, snapshot-tabel først, mønster `riders_4587_is_u25_backup_20260902`): `is_academy = true` OG sæsonalder ≤ 18 → `junior`; 19-22 → `u23`; ≥ 23 → `u23` + pending `academy_graduation`-række; alt andet → `senior`. Sæsonalderen beregnes IKKE i SQL: `backend/lib/riderSeasonAge.js` er SSOT (`ageForSeason`, `LAUNCH_REFERENCE_YEAR = 2026`). Backfill'en er et Node-script (`--dry-run` default, `--apply --owner-go`), aldrig en femte kopi af aldersformlen (#3071/#3081).

**`is_academy` bliver afledt, ikke slettet [arkitekt-valg]:** kolonnen bliver stående og vedligeholdes som `squad <> 'senior'` i en overgangsperiode. Målt: 35+ kaldsteder i 12 filer, og RLS-policyen `"Public read riders"` hænger på `is_offered_intake_rider()` som læser `r.is_academy = false` (`database/2026-06-22-hide-intake-riders-from-db.sql:60-62`).

**Slice 2: pulje og løb**

```sql
ALTER TABLE public.league_divisions ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';
ALTER TABLE public.league_divisions ADD CONSTRAINT league_divisions_squad_check CHECK (squad IN ('senior','u23','junior'));
ALTER TABLE public.league_divisions DROP CONSTRAINT IF EXISTS league_divisions_tier_pool_index_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_league_divisions_squad_tier_pool ON public.league_divisions (squad, tier, pool_index);
```

`CHECK (tier IN (1,2,3,4))` **beholdes**: U23 får egne tier 1-N under `squad='u23'`, ikke tier 5-8, fordi `MIN_DIVISION`/`MAX_DIVISION` (`economyConstants.js:112,116`) og `DIVISION_BONUSES` (`:178`) kun kender 1-4.

```sql
ALTER TABLE public.races ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';
ALTER TABLE public.races ADD CONSTRAINT races_squad_check CHECK (squad IN ('senior','u23','junior'));
CREATE INDEX IF NOT EXISTS idx_races_season_squad ON public.races (season_id, squad);
```

`races.squad` er bevidst denormaliseret: `raceEntryGenerator.js:162` henter races uden join og grupperer på `league_division_id` (`:226-233`).

**Holdets medlemskab pr. trup:** se §10.2 (A: `teams.u23_league_division_id`; B: tabel `team_squad_divisions`).

**`academy_graduation` får to overgange:** `from_squad TEXT`, `to_squad TEXT`; eksisterende rækker backfilles `u23 → senior` [A, antal måles].

**`training_day_runs`, den ene reelle kollision [V, vigtig]:** `uniq_training_day_runs_team_season_game_day (team_id, season_id, game_day)` kolliderer når samme hold har tre akser der alle løber 0..139 (løbsdag 42 senior vs. løbsdag 42 U23 → tavst `alreadyRan`). Nøglen udvides:

```sql
ALTER TABLE public.training_day_runs ADD COLUMN IF NOT EXISTS squad TEXT;
DROP INDEX IF EXISTS uniq_training_day_runs_team_season_game_day;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_day_runs_team_season_squad_game_day
  ON public.training_day_runs (team_id, season_id, COALESCE(squad,'senior'), game_day) WHERE game_day IS NOT NULL;
```

`rider_ability_race_day_history` UNIQUE `(rider_id, season_id, game_day, source)` er OK uden ændring (én rytter = én trup = én akse). **Afhængighed fra #4620 ind i #4846/B4**, skal lukkes FØR flip (noteret i #4845 15/9).

### 3.3 RLS

- `riders.squad`: ingen ny policy; offentligt læsbar som `is_academy`. Fog of war-note: modstanderens U23-trup bliver lige så synlig som seniortruppen; #5107 rammer begge.
- `races.squad`, `league_divisions.squad`: `"Public read races"` er `USING (true)` (`supabase_setup.sql:383`); ingen ændring.
- Nye tabeller (hvis §10.2 = B): RLS on uden public policy, som `rider_ability_race_day_history`.
- `NOTIFY pgrst, 'reload schema';` sidst i hver migration.

---

## 4. Kalender: hvordan U23-aksen genereres

### 4.1 Hvad PR #5169 giver [V, `gh pr diff 5169`]

Aksens længde er en binding i søgningen: `calendarRaceDayTargets.js` (`SEASON_RACE_DAY_TARGET`, `summarizeRaceDayAxis`, `detectRaceDayEqualityViolations`, `maxEmptyGameDaysPerDate`); `raceCalendarLanePacker.js` R12 `emptyGameDayBudget`; `tierCalendarMaterializer.js` pakker først uden mål, så med; `buildSeasonCalendar.js` `--race-day-target` + sæson-dom "LØBSDAGE PR. DIVISION (§1d)". **U23-aksen kræver ingen ny pakker-mekanik**, kun ét kald mere med et andet katalog-udsnit og samme mål.

### 4.2 Arkitektur: to akser, ét kald pr. akse

```
buildSeasonCalendar --season 4 --first-day 2026-09-28 --race-days 28 --race-day-target 140
   ├── squad='senior' → materializeTierCalendars(squad:'senior', tiers 1..4)   katalog: race_pool WHERE squad='senior'; puljer: league_divisions WHERE squad='senior'
   └── squad='u23'    → materializeTierCalendars(squad:'u23', tiers 1..N)      U23-katalog (§4.4); puljer WHERE squad='u23'; 140 løbsdage, de fleste tomme
```

`buildTierMaterializationPlan` er ren (`tierCalendarMaterializer.js:238`); `materializeTierCalendars` (`:480`) læser `league_divisions` (`:514`) og skriver `races` (`:670`). Et `squad`-filter isolerer kørslerne; senior bliver bit-identisk.

**Cross-tier dedup-fælden [V, kritisk]:** `detectCalendarViolations` (`:155-163`, #2276 inv. 2; `:165-172`, #4075) akkumulerer navne på tværs af tiers i ÉN kørsel. To kørsler deler ikke sættet, så U23 og senior kunne bruge samme navn uden at gaten fælder det. Løsning: (a) squad-scoped dedup, skrevet i `CALENDAR_RULES.md`, eller (b) eget katalog (§10.3).

### 4.3 Overlap-regler og felt-gulve

Gulvene i `calendarTierCaps.js` (45/55/40/40 %) er kalibreret mod seniorform og er "regressionsvagter, ikke kvalitetsmål". En U23-akse med 140 løbsdage og fx 8 løb har overlap tæt på 0 % og ville fælde dem. **Arkitekt-valg:** gulvene får en squad-dimension; `u23` starter på 0 % og rapporteres som måling, ikke fejl (samme behandling som en sæson uden mål i PR #5169).

Uændret: `race_entry_days` UNIQUE bærer "1 rytter = 1 løb pr. løbsdag" (ingen kollision mellem akser for samme rytter, da `riders.squad` er én værdi); løbsdage i træk; én dato pr. løbsdag (#4236); **én regenerering pr. sæson (§2c)**, den skarpeste risiko.

### 4.4 Katalog og AI-fyld

**Katalog [V]:** 214 rækker (114 endags, 100 etape). S4 senior bruger 138 distinkte navne; ~76 i overskud, rigeligt til 1-2 løb/uge.

**AI-fyld, det egentlige problem [V + beregning]:** `riderEligibility.js:41,50` afviser `is_academy === true`; efter slice 1 matches `squad`. Men AI-holdene har ingen U23-trup: `AI_SQUAD.TOTAL_SIZE = 24` (`starterSquadAllocator.js:133-137`), alder `gaussian(27, 4.5)` clamped [18,39] (`fictionalRiderGenerator.js:382`) → ≈ 12,9 % i 19-22 ≈ **3,1 ryttere pr. AI-hold** [A, måles mod prod]. Gulv `MIN_RACE_ENTRIES = 6` (`raceAutopick.js:47`). **3,1 < 6: felt-gate C1 fejler ved dagens population.** Tre veje (§10.4): generér U23-ryttere til alle hold (~1.800-3.200 nye, fordobling af bestanden), flyt AI-holdenes 19-22-årige, eller skær pyramiden. C1 er en måling mod prod-klon, ikke et skøn.

---

## 5. Udtagelse og taktik

### 5.1 Ét sted at ændre [V]

| Sted | I dag | Efter |
|---|---|---|
| `riderEligibility.js:41` `applyRosterVisibilityFilter` | `.eq("is_academy", false)` | `.eq("squad", raceSquad)` |
| `riderEligibility.js:50` `isEligibleRider` | `if (rider.is_academy === true) return false;` | `if (rider.squad !== raceSquad) return false;` |
| `raceBinding.js:322` `teamInRacePool` | `teamDivisionId === racePoolId` | kalderen sender holdets pulje for løbets trup |

**Signaturen ændres, ikke default'es [arkitekt-valg]:** `squad` bliver påkrævet argument, så tests fælder hvert af de ~14 kaldsteder (lektien fra 25/6: 264 akademiryttere auto-valgt).

### 5.2 Assistentens auto-udtagelse

`runRaceEntryGenerator` (`raceEntryGenerator.js:151`) grupperer pr. `league_division_id` (`:226-233`, `:295`); med U23-puljer som egne rækker og holdets U23-pulje fanger den U23 automatisk, så længe pulje-opslaget er trup-bevidst. `assistant_selection_mode` uændret (proactive default, #4217). Gate C7 (0 ekstra klik) opfyldt af konstruktion.

### 5.3 Taktik via Planning Center

`team_race_strategy` er pr. hold med `target_race_ids` → ingen trup-dimension nødvendig. `race_team_orders`/`race_stage_roles` pr. løb. Linsen i PLANNING_CENTER_RULES §5 skal kunne vælge trup [A, flade-opgave].

### 5.4 Præmiepenge

Ingen i v1: ét `if (race.squad !== 'senior') return;` tæt på pengene, testet (gate C3). Drift pr. besat ungdomsplads (`ACADEMY.DRIFT_PER_SEASON = 5_000`) bevares som princip; beløb pr. trup = §10/økonomi-sim.

---

## 6. Pyramide og ranglister

### 6.1 Form

Start 1/2/4/8, skåret af C1 [A]. `league_divisions` seedes `squad='u23'`, `label` fx `'U23 Division 1'`. **Arkitekt-valg:** holdets U23-pulje spejler seniorpuljen ved S4-start, skåret ned hvis U23 har færre tiers.

### 6.2 Op- og nedrykning

`processSeasonEnd` (`economyEngine.js:1386`) løber 1..4 med `PROMOTION_SLOTS = 2`/`RELEGATION_SLOTS = 4`. **U23 kører som egen, parallel pass** over `squad='u23'`-træet, fordi `payDivisionBonuses` (`DIVISION_BONUSES`), `divisionAdjustment.js` (#4376), bestyrelsen og faldskærmen alle hænger på senior-divisionen. `season_standings` får `squad TEXT NOT NULL DEFAULT 'senior'` og ALLE filtreringer får `.eq('squad','senior')` (`grep -rn "season_standings" backend/` skal være udtømmende).

### 6.3 Ranglister

`global_rank_mv`/`rider_rankings_mv` har ingen trup-dimension [V]. **Arkitekt-valg:** U23-point holdes ude af den globale rangering i v1; U23-ranglisten er egen view over `race_results` × `races WHERE squad='u23'`. `race_points` genbruges uændret.

---

## 7. Flader

Skabeloner: T1 (max-w-4xl), T2 (1600 px), T3 (hero + tabs). Fold-disciplin: sidehoved + faner + maks 2 section cards før folden.

| Flade | Fil | Skabelon | Hvad der sker | Slice |
|---|---|---|---|---|
| U23 team-siden | `TeamPage.jsx` med `squad`-param | T2 | Faner Squad · Calendar · Results · Standings · Development. Guld: `Set tactics` på Calendar | 1+2 |
| Trup-Select i rostere | `TeamPage.jsx`, `RidersPage.jsx` | T2 | `Squad: Senior team / U23 team / All squads` | 1 |
| `Move to squad` | `RiderStatsPage.jsx` + rækkehandling | T3/T2 | `AcademyTransferConfirmModal`, sekundær, aldrig guld | 1 |
| Graduation Day | ny side | T1 | Ét kort pr. overgang; guld `Confirm all`; banner kun Academy + Inbox | 1 |
| Rytterens rejse | `RiderHistoryTab` | T3 | Kun ægte hændelser fra `rider_career_events` | 1 |
| Academy-siden | `AcademyPage.jsx` | T2 | `Youth squads`-kort (#4618) fjernes | 1 |
| **Youth races** | ny side under Results | T2 | Select U23 team; faner Calendar · Results · Standings · Rankings; eget hold `tr.cz-me`, aldrig guld | 2 |
| Kalender/Resultater/Standings/Rankings | `CalendarPage`, `ResultaterPage`, `StandingsPage`, `RankingsHubPage` | T2 | Filtrér `squad='senior'` eller tilbyd trup-valg. **Manglende filter = U23-løb i seniorlister uden fejl** | 2 |
| Planning Center | `PlanningHubPage.jsx` | T2 | Trup-linse (§5.3) | 2 |

Copy EN først, DA under, kort på fladen. `help.json:1151` lover allerede "Senior/U23/Junior squad structure" og rettes fra "coming soon". Fog of war: U23-flader går gennem samme visibilitets-lag som senior. Mobil: bundnav uændret; Playwright-snapshot alle 3 projekter; ejer-visuelt go før merge.

---

## 8. Faseplan med lane-estimater [A]

### Fase 0, forudsætninger

| # | Spor | Model | Timer |
|---|---|---|---|
| 0.1 | PR #5169 → 140 + merge; `trainingRaceDayTick.js:26` læser målet | opus | 4 (kører i bølge 1 15/9) |
| 0.2 | Overlap-gulve efterregnes mod 140 | opus | 3 |

### Fase A, SKAL være klar før S4-generering

| # | Spor | Model | Timer |
|---|---|---|---|
| A1 | `riders.squad` migration + backfill-script + dry-run-diff pr. hold | opus 2 + sonnet 5 | 7 |
| A2 | `league_divisions.squad` + `races.squad` + U23-pulje-seed + holdets U23-pulje | sonnet | 6 |
| A3 | Materializer + `--squad`; to kørsler, senior bit-identisk; squad-scoped dedup | opus 3 + sonnet 6 | 9 |
| A4 | U23-katalog (§10.3) | sonnet | 4-10 |
| A5 | `training_day_runs` squad-nøgle | sonnet | 3 |
| A6 | U23-rytterpopulation (§10.4) + C1-måling mod prod-klon | opus 3 + sonnet 7 | 10 |
| A7 | Dry-run, scorecard, go-kort, `CALENDAR_RULES.md` §1d+§15 | opus 2 + sonnet 3 | 5 |
| | **Fase A** | | **44-50** |

### Fase B, klar ved cutover hvis U23-løb skal køre fra dag 1

| # | Spor | Model | Timer |
|---|---|---|---|
| B1 | Eligibility trup-bevidst, ~14 kaldsteder | opus 2 + sonnet 6 | 8 |
| B2 | `raceEntryGenerator` trup-bevidst + AI-fyld | sonnet | 6 |
| B3 | `season_standings.squad` + U23-standings-pass | sonnet | 7 |
| B4 | Præmie-gren + C3-test | sonnet | 3 |
| B5 | Youth races-siden + trup-filtre | sonnet | 12 |
| B6 | U23 team-siden + trup-Select + `Move to squad` | sonnet | 8 |
| | **Fase B** | | **44** |

### Fase C, uge 1 af S4 (29/9-5/10)

C1 Graduation Day to overgange 12 · C2 loft pr. trup + D-032 + én kontraktmodel 10 · C3 op/nedrykning U23 8 · C4 ranglister 6 · C5 rytterens rejse 5 · C6 Planning Center-linse 4 · C7 docs/help/patch notes 6. **Fase C: 51.**

**Samlet slice 1+2: 139-145 lane-timer**, 44-50 hårdt før S4-generering.

**Den billigere vej [arkitekt-valg → §10.1 A]:** generér U23-kalenderen nu, hold løbene bag flaget `u23_racing_enabled` (default off) indtil Fase B er grøn. §2c respekteres (kalenderen ER genereret rigtigt, bare ikke tændt). Flag-mønsteret findes (`race_engine_v4`, `training_tick_per_race_day`, `academy_enabled`).

---

## 9. Gates og målinger før ship

| Gate | Hvad | Blokerer |
|---|---|---|
| G-M1 | Migration idempotent; snapshot-tabel før mutation | A1 |
| G-M2 | Dry-run-diff pr. hold; **ejer-go på netop det skridt** | A1 apply |
| G-K1 | Senior-kalender bit-identisk med kørsel uden U23 (golden snapshot) | A3 |
| G-K2 | Begge akser præcis 140 løbsdage; ingen tom løbsdag inde i et løbs spænd | A3 |
| G-K3 | Navne-dedup pr. trup pr. sæson (test rød i dag) | A3 |
| **C1 (ejer-låst, hård)** | Hvert U23-løb har køreligt felt i 100 % af simulerede løbsdage; fejler: skær divisioner | A6 → flip |
| C2 | Population + aldersfordeling stabil over 12 sæsoner | flip |
| C3 | Ingen ny guldkilde (præmier, divisionsbonus) | B4 |
| C7 | 0 ekstra obligatoriske klik | B2 |
| G-T1 | `training_day_runs` mutex kolliderer ikke på tværs af trupper (test rød uden §3.2) | A5 |
| G-E1 | Ingen rytter udtages til løb i anden trup (invariant-test) | B1 |
| G-S1 | `season_standings`-filtreringer udtømmende | B3 |
| G-P1 | `potentialeHiding` urørt (#1162) | alle |
| G-U1 | Ejer-visuelt go på screenshots, 3 Playwright-projekter | B5, B6, C1 |
| G-D1 | `GAME_INVARIANTS.md` §Akademi rettet, ejer godkender | C2 |

Målinger før build [A, read-only prod]: ryttere 19-22 pr. hold (menneske/AI); `is_academy=true` pr. alder; `academy_graduation` uden trup-felter; faktisk rytterbestand.

---

## 10. Åbne beslutninger til ejeren (6, ét kort ad gangen)

**10.1 Køre fra dag 1, eller genereres nu og tændes i uge 1?** **EJER-VALGT 15/9 kl. 11:1x: B, alt live 28/9.** Ordret tillæg: *"du skal ikke udskyde ting uden aftale. Det er mit område. Senere i dag skal vi lave en aftale om hvad der skal laves i denne uge og hvad der skal laves inden sæsonskiftet uanset hvad."* Dvs. §11's "hvad viger"-tabel er INPUT til ejerens ugeplan, ikke en beslutning Claude træffer. Fravalgt: A (flag i uge 1), C (S5).

**10.2 Holdets plads i to pyramider?** **Arkitekt-valg (Claude 15/9, teknisk, ikke stillet til ejeren): A**, `teams.u23_league_division_id` (spejler `league_division_id`, ét felt; junior får egen kolonne senere). B (tabel `team_squad_divisions`) fravalgt fordi den rører ~8 puljeopslag ni dage før cutover. Må udfordres i build hvis A viser sig at bryde et opslag.

**10.3 U23-løbenes navne?** **EJER-VALGT 15/9 kl. 11:5x: A**, eget U23-katalog (`race_pool.squad` + ~30-40 rækker) så tæt på virkeligheden som muligt, MEN med navnene let ændret som spillets øvrige løb (rettigheder). Ordret: *"så tæt på virkeligheden som vi kan med 1 - Men det skal nok være ligesom vi gør inde i spillet, hvor vi laver navnene lidt om, for ikke at blive sagsøgt angående rettigheder."* Byggesporet følger den eksisterende navne-konvention i `race_pool` (fx samme grad af omskrivning som seniorløbene). Fravalgt: suffiks-kopier (B), blanding (C).

**10.4 U23-ryttere til AI-holdene? (C1 fejler ved dagens population)** **EJER-VALGT 15/9 kl. 11:5x: A**, generér en U23-trup på 6-9 ryttere (19-22 år) til alle AI-hold ved cutover, født på spillets egne priors uden PCM (#3668-princippet). ~1.800-3.200 nye ryttere; træningssweep, værdiberegning og `rider_rankings_mv` måles mod fordoblingen (gate G6-klassen). Seniorfelterne røres ikke. Fravalgt: flyt af 19-22-årige (B), lavere gulv (C).

**10.5 "Løb hver kalenderdag" også for U23?** **EJER-VALGT 15/9 kl. 11:5x: A**, nej: 1-2 U23-løb om ugen, 140 løbsdage hvoraf de fleste er rene træningsdage. 25/8-reglen gælder seniorkalenderen. Fravalgt: hver dag (B), 3-4/uge (C).

**10.6 U23-grundloft?** **EJER-VALGT 15/9 kl. 12:0x: A**, U23 = 12 pladser som SIM-STARTPUNKT (migration + dry-run-diff bygges på det), kalibreres efter S4's første økonomidata sammen med facilitetstrinnene (D-032). Fravalgt: sim først (B).

**Status efter 15/9:** alle seks punkter er afgjort (10.2 som arkitekt-valg). Specen er klar til byggeplan når ejerens ugeplan (15/9 eftermiddag) har placeret U23 i forhold til resten af Bane 1.

---

## 11. "Hvad viger": ærligt skøn [A]

### 11.1 Bane 1 + brand + Bane 2 i dag (`docs/MASTERPLAN.md:11-19`)

| Punkt | Lane-timer | Kan udskydes? |
|---|---:|---|
| v4 før flip + flip (M12, #4915, #4948, #4916) | 14 | Nej |
| S4-kalender (#4845 → 140, #4270, #4203) | 10 | Nej, én generering |
| Træning pr. løbsdag #4850 (B4+G6, skader, program 7×5, B3, #4851, #4852-4854, #4848, B6) | 65 | Nej (ejer 6/9: senest S4) |
| Mandatet-flip #4857 → #4859 → #4858 | 8 | Delvist (#4858 efter flip) |
| Cutover-pakke #4592, #452, #4759, #4860, #4376 | 34 | #4860/#4376 låses ved sæsonstart |
| Brand (#5182, #4595/#5162, #5242, #4872, #5222, #5256) | 25 | Nej (ejer 10/9) |
| Bane 2 (#5259, #5257, #5130/#5211, #5240, #5235) | 26 | "Viger aldrig" |
| **I alt** | **≈ 182** | |

### 11.2 Kapacitet

12 dage × 4 laner, semafor 2, målt kadence 3-5 merge'de PR'er/dag ≈ **12-16 lane-timer/dag ≈ 145-190 i vinduet**. Bane 1 + brand + Bane 2 fylder allerede ≈ 182. **Ingen luft før U23 er talt med.**

### 11.3 Hvad U23 koster, og hvad der så ikke når

| Post | Timer | Konsekvens ved udskydelse til efter 27/9 | Kan udskydes? |
|---|---:|---|---|
| #4850 program 7×5 | 14 | Ugedags-program som i dag; de 5 løbsdage arver ugedagens session | Ja |
| #4850 skader i løbsdage | 8 | Skadesvarighed i kalenderdage, synligt skævt | Ja |
| #4852/#4853/#4854 + #4848 | 22 | Score-flader mangler; 8 kort kun halvt leveret | Ja |
| #4592 inaktive managere | 12 | Pladser frigøres ikke ved S4 | **Nej, sker VED skiftet** |
| #452 tilmeld-knap | 6 | Ingen knap til S4-tilmelding | Parret med #4592 |
| #4759 assistent-besked/late_fill | 8 | Ingen besked ved auto-udtagelse | Ja |
| #4860 sponsorpris S4 | 10 | ~3,0 mio. CZ$ udbetales forkert i S4, kan ikke kaldes tilbage | **Nej, sæsonstart-låst** |
| #4376 sponsor-base ved oprykning | 14 | 21 af 24 D1-hold på lavere base i S4 | **Nej, samme grund** |
| #4857 → #4859 Mandatet-flip | 6 | Bestyrelsen på gammel side | Ja (ejer-dato) |
| #4858 slet BoardPage | 2 | | Ja |
| #4915 TTT i v4 | 6 | Inert (0 TTT-etaper) | Ja |
| #4948 raceDay-hjælp | 3 | Hjælpetekst mangler | Ja |
| #5257 handelsliste (Bane 2) | 10 | Fastholdelse udskudt | Ejer |
| #5259 beta-adgang (Bane 2) | 8 | Samme | Ejer |
| #5240 hastighed split (Bane 2) | 8 | CWV udskudt | Ejer |

Kan udskydes uden at bryde en sæsonstart-låsning: **≈ 71 timer**. Kan IKKE udskydes (låses ved sæsonstart): **≈ 36 timer** (#4592, #4860, #4376). Bane 2: ≈ 26, ejer-beslutning.

| Scenarie | U23-timer | Skal viges | Rækker det? |
|---|---:|---|---|
| 10.1 = A (kalender nu, løb i uge 1) | 44-50 | ≈ 45 fra "kan udskydes" | **Ja, stramt** |
| 10.1 = B (alt live 28/9) | 88-94 | hele 71 + ≈ 20 fra sæsonstart-låste eller Bane 2 | **Nej** uden at skære i noget låst |
| 10.1 = C (S5) | 0 | intet | Ja, bryder 15/9 |

**Det ene tal der vejer tungest:** #4860 + #4376 er ≈ 3,0 mio. CZ$ plus 21 af 24 D1-holds sponsorbase, låst ved S4-start, 24 lane-timer. U23 Fase B alene er 44. Det er afvejningen ejeren rangerer.

---

## 12. Kilder

`docs/YOUTH_RULES.md` · `docs/CALENDAR_RULES.md` §0-§2d · `docs/RACE_ENGINE_RULES.md` · `docs/ASSISTANT_RULES.md` §1b, §3 · `docs/PLANNING_CENTER_RULES.md` §0, §4, §5 · `docs/TRAINING_RULES.md` §13.3 · `docs/design/PAGE_TEMPLATES.md` · `docs/design/youth-tiers/HANDOFF.md` · specs 2026-09-02 (akademi) §5-6 og 2026-07-16 (addendum) §1, §5, §7 · `docs/MASTERPLAN.md` Bane 1 · PR #5169 · #2492 #4619 #4620 #4621 #4845 #4846 #4850 #4270 #2064 #5107.

**Verificeret i kode/skema (ikke lav om uden nyt opslag):** ingen `squad`-kolonner findes i dag; `league_divisions` CHECK/UNIQUE; `rider_career_events` findes; `training_day_runs`-nøglen kolliderer; cross-tier dedup deles ikke mellem kørsler; `MIN_RACE_ENTRIES = 6`; AI-alder N(27; 4,5) → ~12,9 % i 19-22; PR #5169 står på 80 (rettes i bølge 1). **Skøn der skal måles:** alle lane-timer, U23-andel i prod, `academy_graduation`-rækker uden trup-felter, C1's faktiske feltstørrelser.
