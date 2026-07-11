# Race Engine v3 — Depth & Credibility (dominans-fix, roller, form-peaks, styrt, læsbarhed)

**Status:** Design-spec til ejer-review — INTET er implementeret, ingen migrationer anvendt.
**Dato:** 2026-07-11
**Ejer-issues:** [#2224](https://github.com/NicolaiDolmer/CyclingZone/issues/2224) (dominans/varians) · [#2034](https://github.com/NicolaiDolmer/CyclingZone/issues/2034) (roller pr. etape) · [#1176](https://github.com/NicolaiDolmer/CyclingZone/issues/1176) (form/startliste/styrt) · [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021) (motor-dybde)
**Fundament:** `docs/decisions/race-engine-architecture-v1.md` (ADR) · `docs/decisions/rider-ability-system-v2.md` (§0.1 A′: motor scorer evner; fysiologi driver seams) · `docs/audits/2026-06-20-race-engine-quality.md` (0 korrekthedsbugs — determinisme/idempotens/evne-drevne resultater verificeret) · Living World Product Doctrine (explainable simulation, no single solved spreadsheet answer)

---

## 1. Bundlinje

Motoren er **korrekt men for deterministisk og rolle-blind**: feltets bedste rytter på dagens terræn vinder 80-88 % af sine løb, og stærke hold parkerer 4+ ryttere i top 10 i hvert fjerde løb. Begge dele bryder doktrinens "no single solved spreadsheet answer" og gør løbene forudsigelige i stedet for diskuterbare.

Dette design tilføjer **fem søjler** oven på den frosne, gate-kalibrerede kerne — uden at røre determinisme, idempotens eller evne-drevne resultater:

1. **Roller med pris (S1):** hjælper-arbejde koster placeringer og køber kaptajn-beskyttelse → fixer samme-hold-dominansen strukturelt.
2. **Varians med navn (S2):** dagsform + sjælden "jour sans" (kollapsdag) → fixer gentagne vindere uden at gøre svage ryttere kunstigt stærke.
3. **Roller pr. etape + effort-instrukser (S3, #2034):** taktik-skift undervejs, protect/normal/save som energistyring.
4. **Styrt/uheld + DNF (S4, #1176):** sjældne, forklarede katastrofer — historiernes råstof.
5. **Form-peaks som spillerens våben (S5) + læsbarhedslaget (S6):** hvornår du topper er en beslutning; hvorfor et resultat skete kan altid forklares.

Alt balancefølsomt kalibreres i det eksisterende dry-run-harness (`race:gate` / `simulateSeasonDryRun.js`) udvidet med et **dominans/varians-scorecard (S0)** mod et snapshot af den ægte prod-population — FØR noget shippes.

---

## 2. Evidens (prod, målt 2026-07-11, aktiv sæson, read-only)

**Vinder-koncentration (113 afviklede GC-resultater):**

| Rytter (felt-bedste i egen pulje) | Starter | Sejre | Win-rate | Podier | Gns. GC-plads |
|---|---|---|---|---|---|
| Topvinder 1 | 11 | 9 | **82 %** | 9 | 2.7 |
| Topvinder 2 | 8 | 7 | **88 %** | 8 | 1.1 |
| Topvinder 3 | 6 | 5 | **83 %** | 6 | 1.2 |
| Topvinder 4 | 6 | 4 | 67 % | 6 | 1.3 |

IRL-baseline: den mest dominante sæson i moderne cykelsport (Pogačar 2024) toppede ~35-40 % win-rate; en normal dominant WorldTour-kaptajn ligger på 15-25 %. **Vores felt-favoritter vinder 2-4× oftere end historiens største outlier.** Top-10-vinderne tager 35 % af alle sejre; podium-raten for felt-favoritter er ~100 % — favoritten skuffer aldrig, så der er intet at diskutere.

**Samme-hold-koncentration i top 10 (GC):** gennemsnit 2.83 fra samme hold (max), kun 6.7 distinkte hold i top 10, og **28 af 113 løb (25 %) har 4+ ryttere fra samme hold i top 10**. IRL sker 4+ fra samme hold i top 10 praktisk taget aldrig (kræver total dominans à la Jumbo/Vuelta 2023).

**Population (5.684 rostered ryttere):** climbing #1=88, #5=82, #10=77, #25=70. Gap #1→#5 = 6 point ≈ **0.032 terrain-score** på high_mountain (vægt 0.52).

## 3. Rod-årsag (c) — hvorfor motoren låser toppen fast

`finalScore = terrain + noise + form − fatigue + team + breakaway + finale` (`raceSimulator.js`). Komponenternes faktiske skala afslører problemet:

| Komponent | Skala i praksis | Kommentar |
|---|---|---|
| terrain (evner) | gaps på **0.03-0.06** mellem felt-top-1 og top-5 | Deterministisk, lineær, dominerer alt |
| noise | sd = randomness × 0.16 → **0.013-0.032** (bjerg 0.016, flat 0.013) | Favoritens gap til #5 er ~2σ på bjerg → taber sjældent |
| form | **±0.012 teoretisk max**; realistisk drift (form 30-70) ±0.005 | ≈ ±1 ability-point. Reelt usynlig |
| fatigue | −0.030 max, durability-dæmpet | Differentierer kun sent i etapeløb |
| team | +0.024 × helperSupport, realiseret median ~0.005 | Kun kaptajnen; **hjælpere er 100 % gratis** |
| breakaway | 1-3 ryttere, maxBonus·u² | Eneste kilde til outsider-sejre i dag |

Fire strukturelle huller:

1. **Variansen er for lille ift. evne-gaps.** P(#5 slår #1 på bjerg) ≈ 8 % pr. løb. Ingen mekanisme (dagsform, peaks, uheld) omfordeler mellem løb — hvert løb er samme lotteri med samme odds, så den samme rytter vinder igen og igen.
2. **Hjælper-arbejde er gratis.** `teamComponent` booster kun kaptajnen; helpers er score-neutrale ("ingen straf i v1"). Et tophold får derfor alle 6-8 ryttere placeret på fuld individuel styrke → 4+ i top 10. Autopick sætter i forvejen alle ikke-kaptajner som `helper`, så fixet slår igennem overalt, også for AI-hold.
3. **Form-kanalen er død.** `nextForm` bygger form i trætheds-sweet-zonen, men FORM_RACE_WEIGHT=0.012 gør den betydningsløs i løb. Spillerens vigtigste våben (formtiming) findes ikke.
4. **Prædikterbarhed (anti-exploit-hul):** seeds er `stableSeed(race.id:stage)` og repoet er publicly viewable. En dedikeret spiller kan i princippet beregne resultatet FØR løbet ud fra kendt startfelt + synlige abilities. Det er den ultimative "solved spreadsheet".

**Designprincip for fixet:** variansen skal komme fra navngivne, forklarlige kilder (roller, form, dagsform, uheld) — ikke fra at skrue den anonyme `noise` op. Skruer vi bare noise op, bliver ITT et lotteri, gate-kalibreringen (type-integritet) vælter, og spilleren lærer intet af et resultat.

---

## 4. Benchmark — og hvad vi gør bedre end PCM

| | Pro Cycling Manager | Football Manager | OOTP | **CyclingZone v3 (dette design)** |
|---|---|---|---|---|
| Simulationsmodel | 3D positions-sim med energibarer | Skjult vægtet match-engine | Statistisk sim, fuld box-score | Seeded komponent-sum, dekomponerbar pr. rytter |
| Forklarbarhed | Ingen — man ser løbet, gætter årsagen | Ratings + highlights + analysefane | Fuldt efterprøvelige tal | **Why-rapport pr. rytter: navngivne komponenter i klartekst** |
| Reproducerbarhed | Nej | Nej | Delvis | **Seed + input_checksum persisteret; hvert resultat kan genafspilles** |
| Roller/taktik | Mikro-styring i 3D (joystick-krav) | Instruks-lag (roller, mentalitet) | Manager-beslutninger | **Beslutnings-lag: roller + effort pr. etape, målbar konsekvens** |
| Varians-styring | Ustyret (difficulty-arcade) | Skjult | Kalibreret mod MLB-statistik | **Variansbudget pr. kilde med målbånd i offentligt scorecard** |
| Multiplayer-fairness | Berygtet svag | — | — | **Provably fair: commit-reveal seed-salt (§10)** |

**Konkret bedre end PCM på fem punkter:** (1) hvert resultat kan forklares og efterprøves — PCM er en black box man stirrer på; (2) roller er et manager-beslutningslag med målt effekt (kaptajn-delta i harness), ikke joystick-arbejde; (3) varians er designet og bounded — PCM svinger mellem forudsigelig og arcade; (4) asynkron multiplayer med delte, citerbare historier (story-tags) — PCM er single-player-first; (5) provably fair afvikling — intet andet spil i genren kan bevise at løbet ikke var rigget. FM-lånet er why-rapportens sprog; OOTP-lånet er transparens + sæson-almanak-følelsen i recaps.

---

## 5. Arkitektur-overblik

**Frosne kontrakter bevares:** `simulateStage({entrants, stageProfile, seed}) → {seed, ranked}` udvides kun additivt (nyt return-felt `abandons`, nye nøgler i `components`). Result-pipelinen (`applyRaceResults`, `race_results`-kontrakten, points via `buildRacePointsLookup`) røres ikke. Stage-by-stage-stien (#2072-akkumulering) er den kanoniske afviklingssti og gør per-etape-roller arkitektonisk naturlige.

**Score-modellen v3:**

```
finalScore = terrain + noise + form(↑vægt) + peak − fatigue + team(↑vægt)
           + breakaway + finale + dayform − jour_sans − work_cost
stageGap   = gapModel(deficit) + incident_time_loss   (incidents efter-rangeres på endeligt gap)
```

**Determinisme-regler (ufravigelige):**
- Hver ny stokastisk komponent får sin **egen scrambled rng-strøm eller per-rytter-hash** (mønster: breakaway `seed ^ 0xb4ea0ff5`). Den eksisterende noise-sekvens er bit-identisk når v3-flaget er off.
- Dagsform/jour-sans/incidents hashes **per rytter** (`stableSeed(salt:kind:rider_id:race_id:stage)`) — én tilmelding mere i feltet må ikke flytte en anden rytters dagsform. Det giver også ren forklarbarhed ("din rytters dag", ikke "feltets terning").
- `ENGINE_VERSION` bumpes 1→2; runs stempler versionen som i dag.
- Idempotens: alle nye persisterede artefakter (incidents, rider_scores, abandons) skrives delete-then-insert pr. `(race_id, stage_number)` — præcis som `race_results`.
- Feature-flag `race_engine_v3_scoring` i `app_config` er en **kill-switch** (on for alle, jf. ejer-politik om ingen beta-gates) — flag-off = bit-identisk dagens motor.

---

## 6. Søjle S1 — Roller med pris: work-cost + kaptajn-beskyttelse

Fixer samme-hold-dominansen dér hvor den opstår: **arbejde for holdet skal koste egen placering.**

**Mekanik (`backend/lib/raceRoles.js`, ny):**
- `work_cost(rolle, etapeprofil, effort)` trækkes fra hjælpernes score:
  - `helper` på GC-relevante profiler (rolling/hilly/mountain/high_mountain/classic): **−0.03 til −0.06** (kandidat; ≈ −6 til −11 ability-point → −10 til −30 pladser i et tæt felt). På flat: leadout-arbejde −0.04 efter afsat spurt.
  - `hunter`: −0.01 (kører eget løb, men bruger kræfter); beholder udbruds-fordelen.
  - `free_role` (NY rolle): 0 cost, 0 holdbidrag — "kør dit eget løb".
  - `captain`/`sprint_captain`: 0.
- Modydelsen: `TEAM_RACE_WEIGHT` hæves 0.024 → **~0.05** (kandidat), så kaptajnen reelt køber noget for holdets ofre. Hjælpernes work-cost og kaptajnens boost kalibreres SAMMEN så kaptajn-deltaet (roles vs. neutral i harnesset) forbliver positivt og vokser.
- Trætheds-kobling: en hjælper der arbejder (`protect`-effort, §8) akkumulerer +20 % race-fatigue den dag; `save` −30 %. Kobler roller til den eksisterende intra-race-akkumulering (`stageEnteringFatigues`).

**Anti-exploit-oracle (obligatorisk harness-gate):** det må ikke være optimalt for TOPHOLD at sætte alle 8 på `free_role` (= reproducerer dagens dominans). Oraklet sammenligner forventede sæsonpoint for et tophold under all-free_role vs. kaptajn-setup; kravet er at kaptajn-setup ≥ på point OG sejre. race_points er top-tunge (rank 1 ≫ rank 10), så en boostet kaptajn-sejr skal slå 6× rank 6-12 — kalibreres til at holde. For mid-tier hold uden kaptajn-kandidat er free_role gerne rationelt: det er en ægte beslutning, ikke en exploit.

**Effekt på #2224-metrikkerne:** et hold med 4 klatrere i top 10 i dag får fremover 1 beskyttet kaptajn højere oppe + 3 hjælpere spredt 15-40 — samme holdstyrke, realistisk aftryk, og trup-sammensætning bliver en beslutning (8 stjerner uden roller ≠ gratis).

## 7. Søjle S2 — Varians med navn: dagsform + jour sans + form-vægt

**Dagsform (`backend/lib/raceDayForm.js`, ny):** per (rytter, race, etape) seeded normal-komponent, sd **0.012-0.018** (kandidat) — svarer til ±2-4 ability-point. Bevidst en NAVNGIVET komponent frem for højere `noise`: den optræder i why-rapporten ("stærk dag" / "tung dag"), er per-rytter-hashet, og NOISE_SD_SCALE (gate-kalibreret) røres ikke.

**Jour sans (kollapsdagen):** Bernoulli pr. (rytter, etape), p = **2-5 %** (kandidat), udfald −0.05 til −0.10 (uniform, seeded). Asymmetrien er pointen: cykelsports overraskelser er favoritter der KNÆKKER (ikke svage ryttere der flyver). Når favoritten kollapser, vinder #2-#5 — som er samme specialist-type, så type-integriteten (sprinter ≥90 % på flat som GRUPPE) bevares. **Form-kobling:** p_jour_sans skaleres med form (fx 5 % ved form<40, 2 % ved form>70) — god formstyring køber forsikring mod kollaps, ikke kun topfart. Det giver form en rolle variansen ikke kan udvande.

**Form-vægt:** FORM_RACE_WEIGHT 0.012 → **~0.035** (kandidat). Med peaks (S5) bliver form-intervallet i drift bredere og spiller-styret.

**Regnestykke (sanity):** favorit-gap 0.032 på bjerg; kombineret per-rytter-varians √(0.016² + 0.015²) ≈ 0.022 → parvis σ ≈ 0.031 → P(#5 slår #1) ≈ 15 % pr. løb; med 5-10 udfordrere inden for 0.03-0.05 plus 2-5 % kollaps-risiko lander favorit-win-raten i målbåndet 25-40 % — uden at én eneste svag rytter er blevet stærkere. GC over 21 etaper udligner dagsform (√21-effekt) men straffer én jour sans på en bjergetape — præcis som virkeligheden.

## 8. Søjle S3 — Roller pr. etape + effort-instrukser (#2034)

**Datamodel:** `race_stage_roles` (§11) med `(race_id, stage_number, rider_id) → race_role + effort`. Fallback-kæde ved resolution: stage-række → `race_entries.race_role` → ingen rolle. Kørte etaper er persisteret og LÅSTE (#2072 re-simulerer aldrig) — kun etaper ≥ næste kan redigeres. `input_checksum` pr. run indeholder allerede dagens roller, så auditsporet følger med gratis.

**Effort pr. rytter pr. etape:** `protect` (fuldt arbejde: fuld work-cost + fuldt kaptajn-bidrag + 20 % ekstra dags-fatigue) · `normal` · `save` (spar kræfter: halv work-cost, halvt bidrag, −30 % dags-fatigue). Kombineret med akkumulerende træthed bliver et etapeløb ressource-styring: hvem arbejder i dag, hvem spares til i morgen — en beslutningsflade uden facit, fordi det afhænger af parcours, klassement og modstandernes valg.

**UI (RaceHub løbs-detalje):** rolle-matrix ryttere × etaper; kørte etaper viser låst historik (hvem arbejdede), kommende er redigerbare. Genvej: "Gør førertrøje-rytteren til kaptajn for resten af løbet" (#2034's ønske) + assistent-forslag ved terrænskift (sprint-kaptajn på morgendagens flade etape). AI-/manager-løse hold: autopick lægger allerede roller pr. løb; udvides til at variere kaptajn pr. etape-bucket (sprint_captain på flat findes).

## 9. Søjle S4 — Startlister, styrt/uheld, DNF (#1176)

**Startliste + favoritter (læsbarhed, ingen motor-ændring):** når feltet fryses (etape-1-snapshot findes allerede i `race_simulation_runs.entrant_snapshot`), publiceres en startliste-flade med favorit-BÅND pr. rytter (★★★/★★/★/outsider) afledt af terrain-percentil i DAGENS felt + form-pil. Kvalitative bånd, aldrig rå tal (anti-solved, §12). Forventning → resultat → forklaring er læsbarhedens kerneloop. Ægte kvalifikation/organizer-invitationer forbliver "Later" (doctrine) — division/pulje-gatingen ER v1-kvalifikation.

**Styrt/uheld (`backend/lib/raceIncidents.js`, ny):**
- Risiko pr. (rytter, etape): `p = base(profil) × finale_mult × (1 − positioning_reduktion)`. Kandidat-baser: flat 0.8 % (massespurt), cobbles 2.5 %, descent-finale ×1.5, itt 0.2 %. Positioning-evnen reducerer op til 40 % (endnu en grund til at evnen findes; læsbar: "god feltplacering = færre styrt"). Vejr-kobling udskydes (race_stage_profiles har ingen vejr-kolonner i prod — verificeret 11/7).
- Udfald (seeded, per-rytter-hash): **75 % time_loss** (30-300 s lagt på stageGap EFTER gap-modellen, derefter re-rang på endeligt gap — tids-aritmetikken forbliver ærlig og #2072-akkumuleringen ren) · **25 % abandon** (DNF + `injured_until` 1-5 dage via eksisterende skade-mekanik).
- Bounded: max ~5 % af feltet pr. etape rammes; Grand Tour-favoritter er IKKE beskyttede (det er historierne — Ocaña 1971), men raten holdes lav og alt forklares.
- **DNF-kontrakt:** DNF-ryttere får INGEN 'stage'-række (race_results forbliver "kun finishers", som PCM-import-semantikken); i stedet `race_incidents`-række + optagelse i abandons-filteret så `loadEntrantsForRace` udelader dem fra resterende etaper (filtreres FØR `freezeEntrantsToStartField` så #1844-warnings ikke støjer). Klassementerne håndterer manglende etaper allerede (`filterCompletedEntrants`). Etape-/recap-UI viser DNF-sektion fra incidents.

## 10. Søjle S5+S6 — Form-peaks, why-rapporten og provably fair

**Peak-planer (spillerens våben):** manager udpeger pr. rytter op til **2 peak-vinduer pr. sæson** (dato-interval, fx 4-6 dage, låses senest 3 dage før start). Effekt: `peak = +0.02` (kandidat) på etaper i vinduet, **payback −0.01 i N dage efter** (formhul — tapering er et lån, ikke en gave). Anti-solved: alle kan ikke peake altid; kalenderen tvinger valg med opportunity-cost, og to managere der peaker mod samme løb neutraliserer hinanden. V1 er ren kalender-mekanik + UI på træningssiden (#1895-ugerytmen); V2 (senere) kobler peak-kvalitet til trænings-adfærd i vinduet.

**Why-rapporten (læsbarhedens kerne, d):**
- `race_simulation_rider_scores` (ADR'ens debug-tabel, nu med produkt-formål) persisterer komponenterne pr. rytter pr. etape (§11). Volumen er ufarlig: ~200 rækker/etape.
- Spillervendt: "Hvorfor blev Jensen nr. 14?" → komponentbaseret klartekst: *"Næstbedste terræn-match i feltet (★★), men han kørte for Larsen (hjælper-arbejde, −18 pladser) og havde en tung dag."* Komponenter vises som kvalitative bånd (−− / − / · / + / ++), ALDRIG som tal (anti-reverse-engineering); admin ser rå tal.
- **Story-tags** genereres deterministisk af komponenterne og føder recaps/world feed/Discord: `outsider_win` (vinder uden ★★★), `favorite_collapse` (jour sans hos ★★★), `breakaway_survived`, `crash_ruined` (incident hos top-5-favorit), `helper_sacrifice` (hjælper med top-3-terrain endte 20+), `perfect_peak` (sejr i peak-vindue). Det er OOTP-almanakken oversat til cykelsport: hvert løb producerer en sætning der kan citeres og diskuteres.
- Pre-race: startliste + favorit-bånd + form-pile. Post-race: forventning vs. udfald + why. Spillerens mentale model kan dannes OG testes — doktrinens ordret krav.

**Provably fair (anti-exploit, lukker §3-hul 4):** et server-side `race_engine_seed_salt` (secret i Infisical, aldrig klient-eksponeret, versioneret) blandes i alle resultat-seed-inputs: `stableSeed(saltV1:race.id:stage)`. Parcours-seeds (stageProfileGenerator) saltes IKKE — etapeprofiler skal være offentlige. Determinisme + idempotens bevares (salt er stabil), men ekstern pre-computation bliver umulig. Runs stempler `salt_version`. **Commit-reveal:** hash af salt publiceres; salt reveales ved sæsonslut → enhver kan efterregne at ingen resultater blev rigget. Ingen konkurrent i genren kan det. **Ejer-beslutning 11/7: aktiveres OMGÅENDE som selvstændig første PR (før S0)** — flip lægges natten mellem to løbsdage; kørte løb er persisteret og røres ikke; et evt. igangværende etapeløbs resterende etaper får blot nye (stadig deterministiske) seeds. Commit-reveal-publiceringen (UI/announce) forbliver S6.

---

## 11. Datamodel — migrations-UDKAST (committes som .sql, anvendes KUN af ejer post-merge)

```sql
-- database/2026-07-XX-race-engine-v3-depth.sql (UDKAST — ejer anvender manuelt)

-- 1) Roller + effort pr. etape (#2034). Fallback: race_entries.race_role.
CREATE TABLE IF NOT EXISTS race_stage_roles (
  race_id      uuid    NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  rider_id     uuid    NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  race_role    text    NOT NULL CHECK (race_role IN ('captain','sprint_captain','helper','hunter','free_role')),
  effort       text    NOT NULL DEFAULT 'normal' CHECK (effort IN ('protect','normal','save')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, stage_number, rider_id)
);
-- RLS: SELECT for holdets ejer (join teams.owner_id) + service_role write; spejl race_entries-policies.

-- 2) Styrt/uheld + DNF-registret (S4). Idempotent delete-then-insert pr. (race_id, stage_number).
CREATE TABLE IF NOT EXISTS race_incidents (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id           uuid    NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  stage_number      integer NOT NULL,
  rider_id          uuid    NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  kind              text    NOT NULL CHECK (kind IN ('crash','mechanical')),
  outcome           text    NOT NULL CHECK (outcome IN ('time_loss','abandon')),
  time_loss_seconds integer,
  injury_days       integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id, stage_number, rider_id)
);

-- 3) Komponent-persistens (why-laget + kalibrering). run_id → race_simulation_runs.id (verificeret PK 11/7).
CREATE TABLE IF NOT EXISTS race_simulation_rider_scores (
  run_id     uuid    NOT NULL REFERENCES race_simulation_runs(id) ON DELETE CASCADE,
  rider_id   uuid    NOT NULL,
  rank       integer NOT NULL,
  components jsonb   NOT NULL, -- {terrain,noise,form,peak,fatigue,team,breakaway,finale,dayform,jour_sans,work_cost,incident}
  PRIMARY KEY (run_id, rider_id)
);
-- RLS: SELECT authenticated (why-rapport læser bånd via API der oversætter tal→bånd); rå tal kun admin-API.

-- 4) Peak-vinduer (S5).
CREATE TABLE IF NOT EXISTS rider_peak_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id     uuid NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id    uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  window_start date NOT NULL,
  window_end   date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start)
);
-- Partiel unique: max 2 pr. (rider, season) håndhæves i API (count-check) + harness-oracle.

-- 5) Flag + salt-version (ingen secrets i DB — selve salten bor i Infisical/env).
INSERT INTO app_config (key, value) VALUES ('race_engine_v3_scoring', 'off')
  ON CONFLICT (key) DO NOTHING;
```

`race_results` ændres IKKE (DNF = fravær af stage-række + incident-række). `rider_condition` ændres ikke (form/fatigue-semantik bevaret, #931-CTL/ATL bygger senere ovenpå).

## 12. Harness + scorecard (S0 — bygges og køres FØR alt andet)

**Udvidelser af `backend/scripts/simulateSeasonDryRun.js`-familien:**
1. `scripts/exportPopulationSnapshot.js` (ny, read-only): eksporterer prod-abilities + hold + condition til JSON; harnesset får `--population=<fil>` så alle bånd måles mod den ÆGTE population, ikke kun genereret (memory-krav: ægte population).
2. `backend/lib/raceDominanceMetrics.js` (ny, ren): win-rate-fordeling pr. rytter over sæsonen (max/p95/histogram), favorit-win-rate (favorit = højeste terrain i dagens felt), podium-rate, samme-hold-top-10-fordeling, distinkte hold i top 10, hjælper-placeringstab, gini over sejre.
3. A/B-tvillinger pr. komponent (work-cost only / dayform only / …) for attribution i kalibrerings-loggen, samme mønster som `--roles`-tvillingen.
4. Nye oracles: **role-exploit** (§6), **peak-neutralitet** (to modsatte peak-planer må ikke begge dominere), **incident-bounds**.

**Scorecard v3 (kandidat-bånd — ejer godkender før kalibrering):**

| Metrik | Målt i dag (11/7) | Målbånd v3 |
|---|---|---|
| Favorit-win-rate pr. løb (felt-bedste terrain) | ~80-88 % | **25-40 %** |
| Sæson-max win-rate pr. rytter (≥5 starter) | 88 % | ≤45 %; p95 ≤35 % |
| Favorit-podium-rate | ~100 % | 55-75 % (skill-signalet BEVARES) |
| Løb med ≥4 samme hold i top-10 | 25 % | **≤5 %** |
| Gns. distinkte hold i top 10 | 6.7 | ≥7.5 |
| Hjælper-placeringstab (median, GC-etaper) | 0 | −10 til −30 pladser |
| Kaptajn-delta (roles vs. neutral, sejre) | +9..+20 pr. 2.100 | positivt og voksende |
| Type-integritet (eksisterende TARGETS: flat sprinter ≥90 % osv.) | grøn | **uændret grøn** (gruppe-niveau) |
| Udbruds-bånd (BREAKAWAY_TARGETS) | grøn (rapport) | uændrede bånd |
| ITT favorit-win | højest | 45-65 % (TT SKAL forblive mest deterministisk) |
| Jour-sans-rate | 0 | 2-5 % af rytter-etaper |
| DNF-rate pr. etape | 0 | 0.3-1.5 % af feltet (profil-afhængig) |
| Determinisme/idempotens | verificeret | bit-identisk flag-off; samme seed → samme output |

Kalibrerings-protokol pr. slice: 3 seeds (2026/7/42, som race:gate) × neutral/condition/roles × prod-population-snapshot; alle EKSISTERENDE bånd skal forblive grønne samtidig med at de nye rammes. Resultat → kalibrerings-log i scriptet (mønsteret fra 2026-06-11/12-loggene) → ejer-go → ship.

## 13. Byggerækkefølge, filer, fase-gates

| Slice | Indhold | Primære filer | Gate |
|---|---|---|---|
| **S0** | Dominans-metrikker + population-export + BASELINE-rapport | `raceDominanceMetrics.js`*, `exportPopulationSnapshot.js`*, `simulateSeasonDryRun.js` | Baseline dokumenteret; ingen motor-ændring |
| **S1** | Work-cost + free_role + TEAM_WEIGHT-rebalance + rider_scores-persistens (admin) | `raceRoles.js`*, `raceSimulator.js`, `raceRunner.js`, migration §11.1+3 | Scorecard: hold-koncentration + role-exploit-oracle grøn; ejer-go |
| **S2** | Dagsform + jour sans + FORM_WEIGHT-rebalance | `raceDayForm.js`*, `raceSimulator.js` | Scorecard: win-rates i bånd, type-integritet grøn; ejer-go |
| **S3** | Roller/effort pr. etape (#2034): API + UI + motor-wiring + fatigue-kobling | `raceRoles.js`, `raceRunner.js`, `raceFatigue.js`, `api.js`, RaceHub-UI | UI-verify på preview m. seed-data; harness-regression grøn |
| **S4** | Styrt/uheld + DNF + abandons-filter + recap/Discord-integration | `raceIncidents.js`*, `raceSimulator.js`, `raceRunner.js`, migration §11.2 | Incident-bounds-oracle; ejer ser sample-recaps |
| **S5** | Peak-planer: API + trænings-UI + motor-komponent | `racePeaks.js`*, `raceRunner.js`, TrainingPage, migration §11.4 | Peak-neutralitets-oracle; ejer-go |
| **S6** | Why-rapport (bånd-oversættelse) + startliste/favoritter + story-tags + salt/commit-reveal | API + frontend, `raceStoryTags.js`* | UI-verify; salt-flip ved sæsongrænse |

(* = ny fil.) Hver slice er selvstændigt shipbar bag `race_engine_v3_scoring` og følger PR-flow (branch+PR, migrationer anvendes KUN af ejer manuelt post-merge). S1+S2 er kernen der løser #2224; S3-S6 er dybden der løfter til genre-førende. Patch notes + help/FAQ (en+da) ved hver spillervendt slice.

## 14. Risici

| Risiko | Mitigering |
|---|---|
| Variansen føles som terning-tyranni | Alt forklares i why-rapporten; asymmetrien rammer kun toppen; podium-båndet (55-75 %) beviser at skill stadig styrer |
| Work-cost gør hjælper-rollen til ren straf | Kaptajn-delta-gate + effort-instrukser giver hjælpere agens; story-tag `helper_sacrifice` gør ofret synligt og ærefuldt |
| Kalibrerings-eksplosion (11 komponenter) | A/B-attribution pr. komponent i S0-harnesset; én slice ad gangen; alle konstanter i én tunings-flade pr. fil |
| Re-kalibrering vælter eksisterende gates | Eksisterende bånd er hard-gates i hver slice; flag-off bit-identisk |
| #2034-UI'et bliver micromanagement | Default = løbs-roller kopieres til alle etaper; kun afvigelser redigeres; assistent-forslag |
| Salt-indførelse bryder recovery af igangværende løb | Flip kun ved sæsongrænse; salt_version stemplet pr. run |

## 15. De 3 mest usikre antagelser + evidens der afgør dem

1. **"Favorit-win-rate 25-40 % er det rigtige troværdighedsbånd."** Kan vise sig for lavt (spillerne oplever deres stjerne som devalueret) eller for højt (dominans-klagerne fortsætter). **Evidens for:** PCS-data pr. terræn-kategori (bedste sprinters win-rate i WT-massespurter ~30-40 %, GC-favoritter i GT'er lavere); spillertest efter S2: dominans-klager (à la ejer-observationen 5/7) forstummer, Discord-diskussion skifter fra "riggget/kedeligt" til løbs-indhold. **Evidens imod:** NPS/feedback der nævner "min stjerne vinder aldrig mere"; win-rate-fordeling hvor INGEN rytter når 25 % (= identitetsløst felt).
2. **"Work-cost på −10..−30 pladser kan kalibreres uden at gøre roller forhadte."** Hjælper-ejere skal opleve mening, ikke straf. **Evidens for:** role-exploit-oraklet holder (kaptajn-setup optimalt for tophold); andel af manager-satte lineups der aktivt bruger helper/effort stiger efter S3; kvalitativ feedback på `helper_sacrifice`-historierne. **Evidens imod:** managere flytter systematisk ALT til free_role efter at have prøvet roller (revealed preference = rollerne opleves som tab); support-henvendelser om "min rytter blev ødelagt af en rolle han ikke valgte" (AI-autopick-hold).
3. **"Seeded, forklaret uheld (jour sans + styrt) opleves som fair sport, ikke som skjult terning."** Hele styrt-søjlen står og falder med det. **Evidens for:** why-rapport-åbningsrate på løb med incidents; klage-rate pr. incident-ramt løb ≤ klage-rate generelt; story-tags citeres i Discord (historie-værdi realiseret). **Evidens imod:** spillere trækker ryttere fra brosten/descent-løb i målbar grad (risiko-aversion æder kalenderen); gentagne "refund"-krav efter DNF'er; incidents nævnt negativt i churn-svar. Fallback er defineret på forhånd: halvér raterne og fjern abandon-udfaldet (kun time_loss) uden at røre resten.

## 16. Ejer-beslutninger — ALLE LÅST 11/7 ✓ (spec klar til eksekvering)

1. **Målbånd-tabellen (§12): GODKENDT.**
2. **Work-cost-styrke: A — MARKANT** (−10..−30 pladser); endelig størrelse låses i harnesset mod målbåndene.
3. **Styrt i Grand Tours: GODKENDT** — GC-favoritter kan DNF'e, lav rate; fallback (kun time_loss) står klar.
4. **Peak-vinduer: GODKENDT** — 2 pr. rytter pr. sæson, ren kalender-mekanik i v1.
5. **Salt: A — hemmeligt salt, aktiveres OMGÅENDE** som selvstændig første PR (før S0, se §10). Fravalgte alternativer: privat repo (imod building-in-public, løser ikke prædikterbarhed reelt), tilfældigt-men-persisteret seed (bryder ren input→output-determinisme).

**Eksekverings-rækkefølge (ejer 11/7: udføres i SEPARATE sessions, intet påbegyndt i design-sessionen):**
salt-PR → S0 (harness + baseline) → S1 → S2 → S3 → S4 → S5 → S6 (jf. §13). Hver slice: eget PR-flow, harness-gate, ejer merger migrationer manuelt.
