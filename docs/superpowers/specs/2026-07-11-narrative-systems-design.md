# Narrative meta-systemer: recap v2, rytterhistorier, verdenshistorik, living-world-feed

> Design — 2026-07-11. Dækker doktrin-kravene i [Living World Product Doctrine](2026-06-08-living-world-product-doctrine-design.md)
> sektionerne "Core Player Loop", "History and recognition" og "Market and social world".
> Relaterede issues: [#1147](https://github.com/NicolaiDolmer/CyclingZone/issues/1147) (living-world-feed),
> [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) (rytterpersonligheder),
> [#1997](https://github.com/NicolaiDolmer/CyclingZone/issues/1997) (verdensklasse palmares),
> [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) (resultat-hub), [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021) (race-engine-dybde).
> Content-batch (klar-til-brug copy, EN+DA): [`docs/superpowers/drafts/2026-07-11-narrative-content-batch.md`](../drafts/2026-07-11-narrative-content-batch.md).

## Kerneidé

Simulationen producerer allerede troværdige tal. Det narrative lag oversætter tallene til
historier spillere husker og taler om — uden nogensinde at påstå noget simulationen ikke
gjorde. Fire systemer, én fælles regel:

> **Narrativ-invarianten: fortæl KUN hvad simulationen faktisk producerede.**
> Ingen skabelon må interpolere andet end persisterede eller deterministisk afledte data.
> Findes et fænomen ikke i motoren (fx styrt), findes det heller ikke i copy-puljen.

## Verificeret nuværende tilstand (2026-07-11)

- **Ingen diskret event-log i motoren.** `raceSimulator.js` beregner pr. rytter pr. etape en
  score-dekomposition `{ terrain, noise, form, fatigue, team, breakaway, finale }`
  (raceSimulator.js:345-350) — men komponenterne er **in-memory only**; kun to booleans
  persisteres: `race_results.in_breakaway` + `breakaway_caught`.
- **Recap v1 er live** (#1311, frontend-only): `frontend/src/lib/raceRecap.js` udleder maks 5
  momenter klient-side af `race_results` (sejr/margin, udbrud, holdets dag, trøjer) og renderer
  via `races.json` `detail.recap.*` (EN+DA). Ingen persistering, ingen variation, ingen
  personlig vinkel.
- **Hjælperytter-arbejde** modelleres som skalar `helperSupport` der booster kaptajnens
  `team`-komponent; roller ligger i `race_entries.race_role` (`captain`, `sprint_captain`,
  `helper`/`hunter`). Intet pr.-hjælper-event persisteres.
- **Form** findes pr. entrant (0-100, 50=neutral) og indgår med `FORM_RACE_WEIGHT = 0.012`;
  persisteres ikke i resultater.
- **Reproducérbarhed:** `race_simulation_runs` gemmer `seed`, `engine_version`,
  `entrant_snapshot` pr. (race, etape) — deterministisk genafspilning er mulig i princippet.
- **Ingen personligheds-/karrieremål-felter** på ryttere. Kun stats, `primary_type`/`secondary_type`
  (7 typer), `potentiale`, `popularity`, `is_u25`.
- **Ingen palmarès-tabel.** Karriereresultater kan kun udledes ad hoc af `race_results`.
- **Hall of Fame** (`HallOfFamePage.jsx`) er team/manager-centrisk: rekord-kategorier
  (`most_points_season`, `most_stage_wins_season`, `most_div1_titles`), manager-XP-leaderboard
  (10 titler), Div 1-historik. Læser en **ikke-committet** `hall_of_fame`-tabel + `season_standings`.
  Doktrinen kræver den erstattet af ægte verdenshistorik; manager-XP skal væk som progression.
- **`activity_feed` findes** (schema.sql:508-518): fri-form `type`, `team_id/name`, `rider_id/name`,
  `amount`, `meta JSONB`. Skrives i dag kun med `transfer_in/out`, `academy_signing`.
  Notifications-fladen har allerede en "League"-tab. Dette er feed-substratet.
- **Sæsonhistorik pr. hold** findes (`season_standings`); pr. rytter findes kun udviklings-
  snapshots (`rider_derived_ability_history`), ikke resultater.
- Doktrin-krav der styrer scope: "Every important race should produce a useful report, replay,
  or two-to-five-minute recap" · personlighed "should create decisions and stories without
  becoming a dialogue simulator" · feed "must not reveal private strategy" · achievements/museum
  er kosmetik, aldrig magt.

## Grundprincipper (gælder alle fire systemer)

1. **Sandhedslag (event-tiers).** Narrativ bygger på tre lag, og copy-puljen er partitioneret
   efter lag:
   - **Tier 0 — persisteret i dag:** finish-orden, tids-gab, klassementer, trøje-dage,
     `in_breakaway`/`breakaway_caught`, holdklassement, `profile_type`/`finale_type`, roller
     i `race_entries`, sæsonstillinger, transfers/auktioner.
   - **Tier 1 — beregnet i dag men ikke persisteret:** score-komponenter (form-bidrag,
     team/hjælper-bidrag, terræn-selektion). Persisteres fremover som **afledte momenter**
     (ikke rå komponenter) ved etape-afvikling. Muliggør hjælper-ofring, form-peak,
     favorit-nedtur.
   - **Tier 2 — findes ikke i motoren endnu:** styrt, mekanisk uheld, angrebs-timing,
     positionering i finalen. **Ingen copy før motoren modellerer dem** (efterårets
     race-engine-dybde #1021/#1176/#2034). Spec'en definerer nøglerne på forhånd, så
     motor-arbejdet ved hvad narrativ-laget venter på.
2. **Determinisme.** Al variation seedes af `(race_id, stage_number, moment_index)` — samme
   etape giver samme fortælling ved hvert besøg, på begge sprog. Ingen LLM-genereret tekst
   runtime: skabeloner + interpolation, altid oversætbart, altid auditérbart.
3. **Strukturerede momenter, ikke strenge.** Backend persisterer `{ key, params, significance }`;
   AL tekst bor i i18n (EN-først, DA-under) og renderes klient-side — samme kontrakt som
   recap v1. Ingen em-dashes, intet opdigtet indhold, ingen løfter.
4. **Ærlig degradering.** Tynde data (PCM-fallback, gamle løb) → færre momenter, aldrig
   udfyldning. 0 momenter → ingen blok.
5. **Privatliv.** Verdensvendte flader viser kun offentlige udfald: resultater, gennemførte
   handler, milepæle. Aldrig bud-caps, træningsplaner, taktik, saldi, board-tilstand, aktive
   forhandlinger.
6. **Kosmetik-grænsen.** Intet i disse systemer giver sportslig eller økonomisk fordel.
   Museum, titler, historik = anerkendelse.
7. **Migrations-protokol.** Alle nye tabeller som committede `database/*.sql`; PR med SQL
   auto-merges ALDRIG — ejer merger og applier separat.

---

## System A — Race-recap v2: fra resultatliste til løbsfortælling

**Mål (doktrin):** hver vigtig løbsdag producerer en brugbar 2-5-minutters recap. v1 giver
3-5 tørre sætninger; v2 giver en struktureret **etaperapport** med dramaturgi, variation og
personlig vinkel — stadig 100 % afledt af sim-data.

### A1. Moment-ekstraktion flyttes til afviklingstidspunktet

Nyt modul `backend/lib/raceNarrative.js`, kaldt fra `raceRunner.js` umiddelbart efter
`apply_stage_result` (hvor score-komponenterne stadig er i memory). Output persisteres i ny
tabel:

```
race_stage_moments (
  id, race_id, stage_number,
  moment_key TEXT,          -- se vokabular
  params JSONB,             -- interpolations-data (navne, gaps, counts)
  significance SMALLINT,    -- 0-100, se A3
  rider_ids BIGINT[],       -- involverede (til rytter-sider/palmarès-kobling)
  team_ids BIGINT[],
  created_at
)
```

Idempotent delete-then-insert pr. `(race_id, stage_number)` — samme mønster som
`apply_stage_result`. PCM-fallback-løb får ingen rækker; frontend falder tilbage til v1-udledning
(uændret adfærd for gamle løb).

### A2. Moment-vokabular

**Tier 0 (kan skrives fra dag 1, delvist = v1-momenterne flyttet om bag persistering):**

| key | trigger (data) | params |
|---|---|---|
| `sprint_win` | gap til nr. 2 < 3s, finale bunch/reduced | rider, team |
| `reduced_sprint_win` | som over, finale_type=reduced_sprint | rider, team, count(front group) |
| `solo_win` | gap ≥ 10s | rider, team, marginText |
| `close_win` | gap 3-9s | rider, team, marginText |
| `breakaway_survived` | vinder in_breakaway && !caught | count, rider |
| `breakaway_caught` | nogen breakaway_caught | count |
| `team_day` | holdklassement-vinder m. ≥2 i top 10 | team, count |
| `gc_takeover` | leader-række skifter rytter ift. forrige etape | rider, previousLeader, gapText |
| `gc_hold` | leader forsvarer på hård etape (profile mountain/high_mountain) | rider, gapText |
| `jersey_change` | *_day-række skifter indehaver | rider, classification |
| `youth_first_win` | vinder-rytter uden tidligere rank-1 i palmarès && is_u25 | rider, age |
| `first_win` | vinder uden tidligere rank-1 (ikke-u25) | rider, seasons |
| `final_gc` | sidste etape: GC top 3 + margener | riders[3], gaps |

**Tier 1 (kræver komponent-adgang i raceRunner — hovedgevinsten ved v2):**

| key | trigger | params |
|---|---|---|
| `helper_shift` | kaptajn top-5 && ≥2 hold-hjælpere (race_role helper) uden for top 25 && team-komponent > tærskel | captain, helpers[], team |
| `form_peak` | vinders form ≥ 75 (entrant-snapshot) | rider, formLabel |
| `favorite_off_day` | højeste terrain-score i feltet slutter uden for top 15 | rider, rank |
| `terrain_selection` | bjergetape: top 5 udelukkende climber/gc-typer | profileLabel |
| `fatigue_toll` | ≥3 ryttere m. fatigue-komponent under tærskel slutter sidst-kvartil | count |

Tærskler er start-kandidater og kalibreres mod en harness-kørsel over eksisterende
`race_simulation_runs`-snapshots FØR ship (simulér-før-ship gælder også narrativ:
momentet skal fyre på 10-40 % af etaper, ikke 0 % eller 100 %).

**Tier 2 (reserverede nøgler — INGEN implementering, ingen copy før motor-støtte):**
`crash`, `mechanical`, `late_attack`, `positioning_fail`, `echelon_split`. Dokumenteres her
så #1021/#2034 kan skrive dem direkte ind i vokabularet når mekanikken lander.

### A3. Significance-score: hvad er "en vigtig løbsdag"?

`significance = klassevægt (race_points-klassen, 0-40) + drama (margin/gc-skifte/udbrud, 0-30)
+ kontekst (rivalisering aktiv, rekord, gennembrud, 0-30)`.

Bruges til: (1) rapportlængde — fuld rapport ≥ 40, kort recap < 40; (2) feed-promovering
(System D) ≥ 60; (3) verdenshistorik-kandidat (System C) ≥ 80. Én skala, tre forbrugere.

### A4. Rapport-dramaturgi (frontend)

Ny komponent `RaceReport` (afløser `RaceRecap`-blokken på kørte etaper; v1-koden genbruges som
fallback-udleder). Struktur — alle dele udelades ærligt hvis momenter mangler:

1. **Rubrik** — 1 linje, valgt af det højest-vægtede moment (fx solo_win → 3 rubrik-varianter).
2. **Lede** — 1-2 sætninger: vinder, hold, måde (finale_type-farvet).
3. **Sådan foldede det sig ud** — 2-4 beats i kronologisk logik: udbrud → selektion/hjælperarbejde
   → finale → konsekvens (GC/trøjer). Beats er momenter sorteret efter fast fase-orden, ikke
   significance.
4. **Dit hold** — klient-side personalisering (kræver ingen ny persistering): bedste placering,
   ryttere i udbrud, hjælper-indsats hvis `helper_shift` matcher spillerens team_id, GC-bevægelse.
   Ingen spiller-data forlader klienten.
5. **Tal-strib** — margin, feltstørrelse, udbrudslængde (kun felter der findes).

**Variation:** hver moment-key har 2-4 skabelon-varianter pr. sprog i i18n
(`report.<key>.v1..v4`). Valg = `hash(race_id, stage_number, key) % antal` — deterministisk,
sprog-uafhængigt indeks. Content-batchen leverer varianterne.

**2-5-minutters-kravet** opfyldes af rapport + klassements-tabeller + dit-hold-blok på samme
flade (RaceDetailPage er allerede naturlig vært) — recap'en er læsestoffet, tabellerne dybden.

### A5. Replay (afgrænsning)

Ægte replay (tick-for-tick) er doktrin-"Research". `race_simulation_runs.seed +
entrant_snapshot` gør det MULIGT senere uden ny gæld. v2 leverer i stedet "etape-forløbet som
beats" (A4.3), hvilket dækker rapport-behovet. Beslutning: replay udskydes til efterspørgsel
er dokumenteret (doktrinens egen bar).

---

## System B — Rytterpersonligheder, karrieremål, rivaliseringer

**Mål (doktrin):** "role wishes, dissatisfaction, ambition, loyalty, and a few career goals.
It should create decisions and stories without becoming a dialogue simulator."

### B1. Personlighed: to persisterede akser, deterministisk seedet

Ny tabel `rider_traits (rider_id PK, ambition SMALLINT 1-5, loyalty SMALLINT 1-5,
seeded_at)`. Seedes deterministisk af `hash(rider_id)` skævet af `potentiale` (høj potentiale
→ ambition-bias) og alder (ældre → loyalty-bias). Ingen løbende mutation i v1.

- **Ambition** styrer: hvilke karrieremål der trækkes, hvor hurtigt utilfredshed (senere slice)
  bygger op ved manglende rolle, og ordvalg i flavor-copy.
- **Loyalty** styrer: transfer-interesse-flavor (senere mekanisk kobling), museum-copy
  ("klubmand"), og karrieremål af typen "100 løbsdage for samme klub".
- Bevidst IKKE flere akser i v1. Temperament/medie-personlighed er dialog-simulator-territorium.

Vises på rytterprofilen som to diskrete etiketter (fx "Driven" / "Loyal to the core") — ikke
tal. Etiket-kataloget (5×2 niveauer, EN+DA) ligger i content-batchen.

### B2. Karrieremål: katalog-drevne, detekterbare, fortællbare

Ny tabel `rider_career_goals (id, rider_id, goal_key, target_params JSONB,
status TEXT CHECK (active|achieved|expired), season_set, season_resolved)`.

- Hver senior-rytter har **maks 1 aktivt mål**; akademiryttere har implicit målet "debut".
- Mål trækkes ved sæsonstart af regler over type + alder + evne + ambition (ingen tilfældighed
  uden seed). Katalog v1 = 18 mål i content-batchen, fx: første sejr, etapesejr i et bestemt
  terræn (matcher primær-type), top-10 i klassement, kaptajnsrolle i N løb, X løbsdage,
  klassement-trøje, sejr for klubben i rytterens hjemland (kun hvis kalenderdata understøtter
  det — ellers udgår målet af puljen), karriere-sejr nr. 10/25.
- **Detektion** sker ved race-finalisering (samme sted som palmarès-skrivning, System C):
  ren SQL/JS mod persisterede data. Mål der ikke kan detekteres objektivt kommer ikke i kataloget.
- **Beslutninger uden dialog-simulator:** målet VISES på rytterprofil + holdudtagelses-fladen
  (lille markør: "goal: needs a captaincy"). Manageren beslutter med fødderne — udtagelse,
  rolle, program. Opfyldt mål → feed-item + palmarès-linje + museums-kandidat. Uopfyldt ved
  sæsonslut → `expired` + neutral story-linje. **Ingen mekaniske konsekvenser i v1** —
  morale/utilfredsheds-kobling er en separat, balance-gated slice (kræver harness, jf.
  simulér-før-ship).

### B3. Rivaliseringer: detekterede, aldrig authorede

Ny tabel `rivalries (id, kind TEXT CHECK (rider|manager), a_id, b_id, intensity SMALLINT,
origin_key TEXT, last_event_at, season_started)`.

- **Rytter-rivalisering** detekteres af: ≥3 fælles top-5-placeringer med indbyrdes gap < 15s
  inden for rullende 20 løbsdage, eller gentagne 1-2-placeringer i klassementer. Intensity
  stiger ved nye møder, henfalder pr. sæson.
- **Manager-rivalisering:** point-naboer i divisionen over ≥2 målinger + direkte auktions-dueller
  (≥2 auktioner hvor begge var top-2-bydende — kun AFSLUTTEDE auktioner, aldrig aktive).
- Rivalisering er **krydderi, ikke system**: den farver recap-beats (`rival_clash`-moment når
  begge er i top 5), giver feed-items ved eskalering, og vises på head-to-head-siden (naturlig
  eksisterende vært). Ingen buffs, ingen tvungne events.
- Detektions-tærskler kalibreres mod prod-data FØR ship (samme harness-princip): mål = 5-15 %
  af aktive ryttere har en rivalisering, ikke 0 % eller 60 %.

---

## System C — Verdenshistorik + klub-museum (erstatter Hall of Fame)

**Mål (doktrin):** "Replace the current Hall of Fame concept with true world history:
seasonal champions and records; legendary riders and clubs; important transfers and rivalries;
memorable race moments; club museums with trophies and season stories."

### C1. Datafundament: palmarès-write-through (forudsætning for ALT ovenfor)

Ny tabel `palmares (id, rider_id, team_id, race_id, season_number, result_type, rank,
race_class, stage_number, achieved_at)`. Skrives ved race-finalisering i `raceRunner.js`
(rank ≤ 3 for `stage`/`gc` + rank 1 for øvrige klassementer) — samme transaktionelle sted som
resultat-skrivning. **Backfill-script** over eksisterende `race_results` committes sammen med
migrationen (dry-run-tal til ejer før kørsel; ejer applier).

Dette ene fundament driver: rytter-karrieresider (#1997), gennembruds-detektion (A2),
måldetektion (B2), legender (C3), klub-trofæer (C4).

### C2. `world_records` + `season_honours`

- `world_records (category, holder_kind rider|team|manager, holder_id, holder_name, value,
  season_number, race_id?, set_at)` — superset af HoF-kategorierne plus: største sejrsmargin,
  flest sejre i én sæson (rytter), yngste vinder, længste overlevende udbrud. Opdateres ved
  sæson-slut + ved rekord-brud under sæsonen (rekord-brud = feed + moment).
- `season_honours (season_number, division, champion_team_id, promoted[], relegated[],
  top_rider_id, jersey_winners JSONB, biggest_transfer JSONB)` — skrives af
  `processDivisionEnd` (eksisterende sæson-slut-flow). Den nuværende ikke-committede
  `hall_of_fame`-tabel afløses; migration committes så skemaet endelig er i repo.

### C3. Verdenshistorik-fladen (afløser HallOfFamePage)

Faner: **Sæsoner** (season_honours-tidslinje: mestre, oprykkere, trøjer, største transfer pr.
sæson) · **Rekorder** (world_records) · **Legender** (ryttere rangeret efter palmarès-vægt:
sejre × klassevægt; aktive OG pensionerede — pensionering gør listen til historie) ·
**Øjeblikke** (world_moments: momenter med significance ≥ 80, fx "udbrud på 3 holdt hjem i
[Monument], sæson 4").

**Manager-XP-tabben fjernes** (doktrin: "Manager levels should become subtle cosmetic
reputation"). Manager-anerkendelse flytter til season_honours (mesterskaber) + klub-museet.
De 10 titel-niveauer genbruges IKKE som progression; evt. som kosmetisk profiletikette i en
senere, separat beslutning.

### C4. Klub-museum (pr. hold, offentligt)

Ny side (link fra holdsiden): klubbens egen historie, bygget 100 % af eksisterende +
ovenstående data — ingen ny skrivelogik ud over C1/C2:

1. **Trofæsalen** — divisionsmesterskaber, oprykninger, løbssejre grupperet pr. klasse
   (palmarès m. team_id-filter), holdklassement-sejre.
2. **Sæsonhistorier** — én skabelon-genereret afsnit pr. afsluttet sæson
   (season_standings + honours: placering, retning, største resultat, største handel).
   6 skabelon-varianter efter sæsonens facit (mester/oprykning/midt/nedrykning/genopbygning/debut).
3. **Klublegender** — ryttere med flest palmarès-point FOR klubben (loyalty-flavor når
   rytteren har høj loyalty og lang anciennitet).
4. **Milepæle** — første sejr, sejr nr. 50/100, første D1-sæson, rekord-handler
   (fra eksisterende transfer-data).
5. **Øjeblikke** — world_moments filtreret på klubben.

Museet er også **retention-ankeret for dynastifølelsen**: det er her 10 sæsoners arbejde kan
SES. Tomme sektioner har ærlige empty-states (content-batch) — en ny klub ser sit museum som
noget der skal fyldes, ikke som en fejl.

---

## System D — Living-world-feed

**Mål (doktrin):** "The public world feed highlights results, large transfers, breakthroughs,
rivalries, form, club milestones, and season stories. It must not reveal private strategy."

### D1. Genbrug substratet, udvid vokabularet

`activity_feed` beholdes som tabel (type + meta JSONB er allerede rigtigt). `logActivity`
konsolideres til ÉN helper i `backend/lib/` (i dag duplikeret i cron.js + api.js — kendt
tech-debt, fixes i samme PR). Nye typer:

| type | kilde | betingelse |
|---|---|---|
| `race_winner` | raceRunner-finalisering | significance ≥ 40 (ellers støj ved ~5 etaper/dag) |
| `gc_winner` | final_gc-moment | altid ved etapeløbs-afslutning |
| `breakthrough` | first_win/youth_first_win-moment | altid |
| `record_broken` | world_records-opdatering | altid |
| `rivalry_flare` | rivalry intensity-hop | maks 1 pr. par pr. uge (anti-spam) |
| `club_milestone` | museums-milepæle (C4.4) | altid |
| `transfer_record` | sæsonens hidtil største handel | ved overhaling |
| `season_champion` | season_honours | sæson-slut, pr. division |
| `goal_achieved` | B2-detektion | kun mål med significance-vægt (første sejr, trøje) |

Eksisterende `transfer_in/out` beholdes uændret (beløb på gennemførte handler er allerede
offentlige i spillet i dag).

### D2. Privatlivs-kontrakt (håndhævet, ikke bare aftalt)

Feed-skrivning sker KUN via den konsoliderede helper, som har en **whitelist af typer +
pr.-type param-skema**. Ukendt type eller ukendt felt → afvist + logget. Det gør "afslør aldrig
privat strategi" til kode i stedet for disciplin. Eksplicit forbudt i feed-params: saldi,
bud-caps, aktive bud, træningsdata, taktik/roller FØR løb, board-tilstand.

### D3. Flader

1. **League-tabben i Inbox** (findes) — får de nye typer gratis via `feed.*`-i18n-nøgler.
2. **Dashboard-modul "Verden lige nu"** — de 5 seneste items med significance-vægt; binder
   feedet til doktrinens Today-flade uden at bygge Today-fladen nu.
3. Discord-broadcast genbruger samme items for de højeste significance-niveauer (eksisterende
   discordNotifier; posts på ejers vegne kræver som altid forhåndsgodkendt skabelon-tekst —
   skabelonerne i content-batchen ER teksten til godkendelse).

---

## Rollout-slices (hver = én PR-serie, ejer merger SQL)

| Slice | Indhold | Afhænger af |
|---|---|---|
| **S1 Fundament** | `palmares`-migration + write-through + backfill (dry-run til ejer) + `hall_of_fame`/`season_honours`-skema committes | — |
| **S2 Recap v2** | `race_stage_moments` + `raceNarrative.js` (Tier 0+1) + tærskel-harness + `RaceReport` + content-batch-i18n | S1 (gennembruds-detektion) |
| **S3 Historik** | world_records + verdenshistorik-fladen (HoF-afløser, XP-tab fjernes) + klub-museum | S1 |
| **S4 Feed** | logActivity-konsolidering + whitelist + nye typer + dashboard-modul | S2 (momenter), S3 (rekorder) |
| **S5 Personer** | rider_traits + career_goals + profil/udtagelses-UI + detektion | S1 |
| **S6 Rivaliseringer** | detektion + head-to-head-integration + recap/feed-kobling | S2+S4 |
| **S7 (gated)** | Morale/utilfredsheds-mekanik på mål/traits | S5 + balance-harness + ejer-go |

S2 er den spillervendte hurtigste gevinst; S1 er billigst og låser alt op. Anbefalet start: S1+S2.

## Ikke-mål (YAGNI, eksplicit)

- Ingen LLM-tekstgenerering runtime (determinisme + oversættelse + audit).
- Ingen tick-for-tick-replay (Research-bucket; seed-fundamentet består).
- Ingen dialog-træer, interviews eller "pressemøder".
- Ingen mekaniske effekter af traits/mål/rivaliseringer i v1 (S7, gated).
- Ingen Tier 2-copy (styrt osv.) før motoren modellerer fænomenet.
- Ingen ændring af points/præmie/klassements-beregning (GAME_INVARIANTS urørt).
- Ingen fjernelse af kalender-overlap eller 1-rytter-1-løb-reglen (narrativ omtaler aldrig
  "manglende" ryttere som fejl).

## Motor-mapping + adfærdsmål (doktrin-krav pr. system)

| System | Styrker motor | Adfærd der skal ændre sig | Evidens |
|---|---|---|---|
| A Recap v2 | **1 Løb** (primær), 4 socialt (delbare historier) | Spillere ÅBNER kørte løb i stedet for kun at skimme point; race-rapporter læses efter fravær ("hvad skete der?") | `player_events`: report-view-rate pr. kørt løb; tid på RaceDetailPage; Discord-citater af rapporter |
| B Personer/mål | **2 Træning + 3 Ungdom** (attachment), 1 (udtagelses-beslutninger) | Managere planlægger program/roller EFTER rytteres mål; taler om ryttere ved navn, ikke som stat-rækker | Mål-markør-klik i udtagelse; goal_achieved-rate; interviews |
| C Historik/museum | **3 Ungdom/dynasti** (primær), alle (varig anerkendelse) | Flersæsoners-spillere vender tilbage for at BYGGE historie; museums-links deles; pensioneringer bliver begivenheder | Museum-besøg pr. WAU; D30-retention for spillere m. ≥2 sæsoner |
| D Feed | **4 Transfer/marked + socialt lim** for alle | "Hvad sker der i verden" bliver et return-hook mellem egne løbsdage; transfers/gennembrud diskuteres på Discord | League-tab-åbninger; feed-item-klik; Discord-tråde pr. feed-story |

## Risici

- **Skabelon-træthed:** 2-4 varianter pr. moment er minimum; content-batchen er bygget til at
  udvide (nye varianter = ren i18n-PR uden kode). Mål: ingen identisk rubrik to dage i træk.
- **Moment-tærskler rammer skævt** (alt fyrer / intet fyrer) → harness-gate FØR ship (A2).
- **Feed-støj ved 5 etaper/dag** → significance-gate + anti-spam-regler (D1).
- **Backfill-fejl i palmarès** → dry-run-tal til ejer, idempotent script, ejer applier (memory:
  store destruktive/data-ops kræver ejer-syn).
- **Museum føles tomt for nye klubber** → ærlige, fremadrettede empty-states (content-batch).
