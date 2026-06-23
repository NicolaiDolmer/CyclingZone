# Race Hub — redesign af løbs-oversigt, planlægning & taktik (design)

> **Status:** udkast til review · **Dato:** 2026-06-23 · **Branch:** `worktree-feat+race-hub-redesign` (isoleret worktree)
> Brainstormet visuelt med ejeren (wireframes inline). Wireframe-varianter: kerne-skærm v1, Variant A (løb-centrisk), Variant B (trup-board), IA-navigationskort, taktik-lag.

## 1. Formål

Den nuværende race-oplevelse er spredt over fire løsrevne flader (`/races` med faner, `/resultater`, `/standings`, `/races/:id`). Spilleren har **intet sted** hvor man planlægger hvilke ryttere der kører hvilke løb, ser ruteprofiler, sætter taktik, og hurtigt skelner "mine løb" fra "min divisions løb" fra "andre divisioner".

Dette redesign samler det til **én Løb-hub** bygget op om en ny kernemekanik: **løb overlapper i tid, en rytter kan kun køre ét løb ad gangen, og deltagelse er frivillig** — så fordelingen af truppen bliver et strategisk spil.

## 2. Baggrund (verificeret mod prod 2026-06-23)

- **Sæson:** Sæson 1 aktiv, 60 race-dage, gen-seedet 22/6. Første etaper afvikles 23/6 kl. 12:30/15:00 dansk via stage-scheduleren.
- **Liga:** 4-tier pyramide (`league_divisions`: `tier` + `pool_index` + `label`), puljer 1/2/4/8 = 15. Tier 1-3 er befolket (7 aktive puljer à 24-25 hold); tier 4 (8 puljer) er tom i sæson 1.
- **Overlap er reelt:** hver division kører typisk **2 løb samme dag** (fx Division 1: Hamburger Klassiker 12:30 + La Corsa dei Due Mari etape 1/7 kl. 15:00). Stage races binder ryttere over flere dage.
- **Trupper er små:** median **8 ryttere** (max 23); ~96 % af hold har under 12. To overlappende løb à 6-8 ryttere kan altså ikke begge fyldes fuldt med dagens trupper.
- **Træthed findes** (`backend/lib/raceFatigue.js`): akkumulerer pr. etape (flad +10 → high_mountain +20, clamp 0-100) og indgår i resultatet (`raceSimulator.js`: `− fatigue`, `FATIGUE_RACE_WEIGHT = 0.030`, dæmpet af `durability`). Effekten er pt. **lille** (~3 % af terrænscore); fuld fysiologi er #1021 (post-launch). `form` er næsten neutral (0.012).
- **Autopick i dag** (`raceRunner.js` → `fillMissingTeamEntries`): tvangs-tilmelder **alle** hold uden udtagelse til **hvert** løb. Roller i motoren: `captain` / `sprint_captain` / `helper` (+ `hunter`/`breakaway` i simulatoren).
- **Eksisterende udtagelse:** `GET/PUT /api/races/:raceId/selection` (6-8 ryttere + roller); `RaceSelectionPanel.jsx`. Tabeller: `races` (har `league_division_id`, `race_class`, `race_type`, `stages`, `stages_completed`, `status`), `race_entries` (`rider_id`, `team_id`, `race_role`, `is_auto_filled`), `race_stage_profiles`, `race_stage_schedule`, `rider_condition` (`form`, `fatigue`, `injured_until`).

## 3. Låste beslutninger (game-design)

1. **Overlap som spil.** En rytter kan kun køre **ét løb ad gangen**, inkl. hele et etapeløbs varighed. Løbene overlapper bevidst → fordeling af truppen er kernen.
2. **Frivillig deltagelse.** Man er ikke tvunget med. Man kan **afmelde** sig et løb, og har man ikke nok ledige ryttere, kører man det bare ikke (gyldig tilstand — auto-no-show).
3. **Opportunity cost = binding + træthed** (eksisterende systemer; **ingen ny gebyr-/pengemekanik**). Den hårde pris: en rytter brugt her er væk fra det overlappende løb. Den bløde: han bliver træt til de næste dages løb. Risk/reward = "bruger jeg min stjerne nu eller gemmer jeg ham".
4. **Frivillig dybde.** Vil man kunne fylde flere overlappende løb, henter man selv flere ryttere (transfers/academy). Ikke tvunget.
5. **To lag (ejer-valgt).** Hubben har en **trup-fordelings-hjemmebase** (makro) + en **løbs-detalje** man klikker ind i (mikro: ruteprofil + taktik).

## 4. Informations-arkitektur

Et **delt kontekstbånd** (konstant) + tre lag + én read-only sidegren:

- **Delt bånd:** scope-skift `Mine løb / Min division / Andre divisioner` + sæson-tidslinje (dag X af 60, navigerbar). Gælder alle views.
- **Lag 1 — Trup-fordeling (hjemmebase):** dagens (og kommende dages) overlappende løb som kolonner; fordel truppen; bundne ryttere er låst til ét løb; ledige ryttere i en pulje; knaphed gjort eksplicit ("8 af 9 i brug", "5 af 6-8 valgt"). (Variant B)
- **Lag 2 — Løbs-detalje:** klik et løb → ruteprofil (pr. etape ved stage races) + opstilling. (Variant A / nuværende `RaceDetailPage` udvidet med ruteprofil for kommende løb)
- **Lag 3 — Taktik:** når truppen er sat, tildel roller pr. rytter (kaptajn / sprint-kaptajn / jæger / hjælper) med profil-hint. Bygger på motorens eksisterende roller.
- **Sidegren — Andre divisioner:** read-only overblik over hvad de øvrige puljer i pyramiden kører. Ingen udtagelse.

**Routing (forslag):** `/races` = hubben (Lag 1 default). `/races/:raceId` = Lag 2. `/races/:raceId/tactics` = Lag 3. Scope = `Andre divisioner` filtrerer til read-only. Tidslinje + scope holdes i URL-params så state bevares ved skift.

## 5. Views i detaljen

### Delt bånd
Scope-toggle (3 pills) + sæson-tidslinje med profil-glyffer (terræn) langs banen og "du er her"-markør. Skift af division/scope må **ikke** miste det valgte løb.

### Lag 1 — Trup-fordeling
Dagens overlappende løb som kolonner med deres udtagne ryttere + "+ tilføj fra ledige". Hver rytter vises i præcis ét løb; valg i ét løb gråer rytteren i de andre samme dag (binding visualiseret). "Ledige ryttere"-pulje nederst med friskhed. Per-løb-status: antal valgt vs. 6-8, samt "underbemandet"/"afmeldt".

### Lag 2 — Løbs-detalje
Løbs-header (navn, klasse, type, tid, status) + ruteprofil (højdeprofil; etape-vælger ved stage races) + opstilling med rolle og friskhed. Indgang til Lag 3. For afsluttede løb: resultater (som i dag).

### Lag 3 — Taktik
Liste over udtagne ryttere; hver får en rolle (kaptajn / sprint-kaptajn / jæger / hjælper) via en vælger. Profil-hint kobler taktik til ruteprofil ("bjerge → klatrer som kaptajn"). Roller skrives til `race_entries.race_role` (eksisterende felt). "Jæger" = udbruds-villig (motorens `hunter`/`breakaway`).

### Sidegren — Andre divisioner
Read-only: vælg en pulje i pyramiden → se dens kommende løb + (efter afvikling) resultater/standings. Genbruger `league_divisions` + `StandingsPage`-data.

## 6. Mekanik-ændringer (backend)

1. **Binding-håndhævelse.** Selection (`PUT /selection`) **og** autopick må ikke placere en rytter i to tidsoverlappende løb. Kræver et overlap-begreb: et løbs "tidsvindue" = dets etape-tider i `race_stage_schedule` (et stage race binder fra første til sidste etape). Valideres ved udtagelse og respekteres af autopick.
2. **Autopick vendes fra tvang til valg.** `fillMissingTeamEntries` skal ikke længere tvangs-fylde alle hold i alle løb. Ny adfærd (afklares i plan): assistenten fylder kun som **standard-deltagelse** der respekterer (a) afmelding og (b) bundne/utilstrækkelige ryttere → auto-no-show. AI-hold + passive managers skal stadig give fyldte felter hvor muligt.
3. **Deltag/afmeld-state.** Et hold↔løb kan være: deltager (entries findes) / afmeldt / no-show (for få ledige ryttere). Persisteres (nyt felt eller via fravær af entries + et afmeldings-flag — afklares i plan).
4. **Felt-konsekvens.** Med frivillig deltagelse kan felter blive mindre end i dag. Race-engine tolererer allerede <6 ryttere (autopick tager `min(max, available)`), men balance-effekten skal vurderes (simulér-før-ship).

## 7. Afgrænsning (ud af scope for dette projekt)

- **Omkostnings-tal / økonomi-kalibrering:** der er ingen pengemekanik (kun binding+træthed). Trup-størrelses-balance (skal trupper vokse mod 12-20 for at overlap er spilbart?) er en **separat, koblet balance-strøm** med simulér-før-ship — UI'et antager den løses der.
- **Fuld fysiologi (#1021):** træthedens effekt forbliver lille indtil #1021 (post-launch). Designet viser træthed nu; styrken kalibreres senere.
- **Selve race-afviklingen** (scheduler, resultat-pipeline) er uændret.

## 8. Åbne punkter

- Præcis persistens-model for afmelding/no-show (nyt flag vs. afledt state).
- Autopickens nye standard-adfærd for AI + passive managers (fyld vs. ikke-fyld).
- Tidsvindue-definition for binding ved stage races (hele løbet vs. pr. etape-dag).
- Hvor meget af `RaceDetailPage` der genbruges vs. nybygges til ruteprofil-på-kommende-løb.

## 9. Fasning (foreløbig)

- **Fase 0 — mekanik-backend:** binding-validering + tidsvindue + deltag/afmeld-state + autopick-ændring. (Balance-følsom → simulér-før-ship.)
- **Fase 1 — Lag 1 (trup-fordeling) + delt bånd:** hjemmebasen + scope + tidslinje.
- **Fase 2 — Lag 2 (detalje + ruteprofil på kommende løb).**
- **Fase 3 — Lag 3 (taktik/roller).**
- **Fase 4 — Andre divisioner (read-only).**

## 10. Wireframe-reference

Wireframes blev udviklet inline i brainstorm-sessionen (Cycling Zone navy/guld/Bebas-stil): kerne-skærm v1, Variant A (løb-centrisk), Variant B (trup-board → Lag 1), IA-navigationskort (denne struktur), og taktik-laget (Lag 3). De er reference for det visuelle udtryk; den endelige styling bygges i frontendens eget design-system.
