# Race Hub — redesign af løbs-oversigt, planlægning, taktik & assistent (design)

> **Status:** udkast til review · **Dato:** 2026-06-23 · **Branch:** `worktree-feat+race-hub-redesign` (isoleret worktree)
> Brainstormet visuelt med ejeren (wireframes inline). Wireframe-varianter: kerne-skærm v1, Variant A (løb-centrisk), Variant B (trup-board), IA-navigationskort, taktik-lag.

## 1. Formål

Den nuværende race-oplevelse er spredt over fire løsrevne flader (`/races` med faner, `/resultater`, `/standings`, `/races/:id`). Spilleren har **intet sted** hvor man planlægger hvilke ryttere der kører hvilke løb, ser ruteprofiler, sætter taktik, og hurtigt skelner "mine løb" fra "min divisions løb" fra "andre divisioner".

Dette redesign samler det til **én Løb-hub** bygget op om en ny kernemekanik: **løb overlapper i tid, en rytter kan kun køre ét løb ad gangen, og deltagelse er frivillig** — så fordelingen af truppen bliver et strategisk spil. En **proaktiv assistent** auto-genererer et komplet forslag til hele kalenderen ud fra managerens stående præferencer, så man kan nøjes med at finjustere — eller bygge sit eget fra bunden.

## 2. Baggrund (verificeret mod prod 2026-06-23)

- **Sæson:** Sæson 1 aktiv, 60 race-dage, gen-seedet 22/6. Første etaper afvikles 23/6 kl. 12:30/15:00 dansk via stage-scheduleren.
- **Liga:** 4-tier pyramide (`league_divisions`: `tier` + `pool_index` + `label`), puljer 1/2/4/8 = 15. Tier 1-3 er befolket (7 aktive puljer à 24-25 hold); tier 4 (8 puljer) er tom i sæson 1.
- **Overlap er reelt:** hver division kører typisk **2 løb samme dag** (fx Division 1: Hamburger Klassiker 12:30 + La Corsa dei Due Mari etape 1/7 kl. 15:00). Stage races binder ryttere over flere dage.
- **Trupper er små:** median **8 ryttere** (max 23); ~96 % af hold har under 12.
- **Træthed findes** (`backend/lib/raceFatigue.js`): akkumulerer pr. etape (flad +10 → high_mountain +20, clamp 0-100) og indgår i resultatet (`raceSimulator.js`: `− fatigue`, `FATIGUE_RACE_WEIGHT = 0.030`, dæmpet af `durability`). Effekten er pt. **lille** (~3 % af terrænscore); fuld fysiologi er #1021 (post-launch). `form` er næsten neutral (0.012).
- **Autopick i dag** (`raceRunner.js` → `fillMissingTeamEntries`): tvangs-tilmelder **alle** hold uden udtagelse til **hvert** løb ved afvikling. `SELECTION_SIZE`: default `{min:6,max:8}`, TourFrance/GiroVuelta `{min:8,max:8}`. Roller: `captain` / `sprint_captain` / `helper` (+ `hunter`/`breakaway` i simulatoren).
- **Eksisterende udtagelse:** `GET/PUT /api/races/:raceId/selection` (6-8 ryttere + roller); `RaceSelectionPanel.jsx`. Tabeller: `races` (`league_division_id`, `race_class`, `race_type`, `stages`, `stages_completed`, `status`), `race_entries` (`rider_id`, `team_id`, `race_role`, `is_auto_filled`), `race_stage_profiles`, `race_stage_schedule`, `rider_condition` (`form`, `fatigue`, `injured_until`).

## 3. Låste beslutninger (game-design)

1. **Overlap som spil.** En rytter kan kun køre **ét løb ad gangen**, inkl. hele et etapeløbs varighed. Løbene overlapper bevidst → fordeling af truppen er kernen.
2. **Frivillig deltagelse.** Man er ikke tvunget med. Man kan **afmelde** sig et løb, og har man ikke nok ledige ryttere, kører man det bare ikke (gyldig tilstand — auto-no-show).
3. **Opportunity cost = binding + træthed** (eksisterende systemer; **ingen ny gebyr-/pengemekanik**). Hård pris: en rytter brugt her er væk fra det overlappende løb. Blød pris: han bliver træt til de næste dages løb.
4. **Proaktiv assistent.** Ved **hver sæsonstart OG hver ny kalender** auto-genererer assistenten et **komplet forslag til alle løb** (trupper + roller), under overlap-binding. Manageren finjusterer eller bygger fra bunden. Erstatter den nuværende "fyld ved afvikling".
5. **Stående præferencer (Holdstrategi) styrer assistenten:**
   - **A-kæde** — managerens foretrukne kerne-trup; assistenten prioriterer dem til mål-løbene.
   - **Faste rolle-regler** pr. rytter — fx "altid kaptajn", "altid sprint-kaptajn hvis med".
   - **Kaptajn 1/2/3 pr. terræntype** — rangordnede kaptajn-kandidater for flad / bakke / bjerg / brosten / ITT; assistenten vælger den højest-rangerede tilgængelige til terrænet.
   - **Mål-løb** — manageren markerer hvilke løb der betyder mest; assistenten sætter sin stærkeste, friske trup dér og fylder de øvrige med svagere/friske ryttere.
   - "Prioriteter" = **både** reglerne (HVEM får roller) **og** mål-løbene (HVOR de bedste sættes).
6. **Frivillig dybde + svage bund-ryttere.** Alle hold får **flere ryttere**, men de der kommer ind fra bunden er **bevidst svagere** — nok til at man *kan* stille hold til overlappende løb, men dårlige nok til at man hurtigt vil bygge sit eget hold (via transfers/academy).
7. **6 / 7 / 8 ryttere efter løbs-kategori** — som i virkeligheden. `SELECTION_SIZE` udvides til en `race_class → max (6/7/8)`-mapping.

## 4. Informations-arkitektur

Et **delt kontekstbånd** (konstant) + et strategi-lag + tre arbejdslag + én read-only sidegren:

- **Delt bånd:** scope-skift `Mine løb / Min division / Andre divisioner` + sæson-tidslinje (dag X af 60, navigerbar). Gælder alle views.
- **Lag 0 — Holdstrategi (stående præferencer):** a-kæde, faste rolle-regler, kaptajn 1/2/3 pr. terræntype, mål-løb-markering. Fodrer auto-genereringen. Sættes sjældent.
- **Lag 1 — Trup-fordeling (hjemmebase):** assistentens auto-genererede forslag vist som dagens/kommende dages overlappende løb i kolonner; fordel/omfordel truppen; bundne ryttere låst til ét løb; ledige i en pulje; knaphed eksplicit. (Variant B)
- **Lag 2 — Løbs-detalje:** klik et løb → ruteprofil (pr. etape ved stage races) + opstilling. (Variant A / `RaceDetailPage` udvidet)
- **Lag 3 — Taktik:** roller pr. rytter (kaptajn / sprint-kaptajn / jæger / hjælper) med profil-hint.
- **Sidegren — Andre divisioner:** read-only overblik over hvad de øvrige puljer kører.

**Auto-gen-flow:** Holdstrategi (Lag 0) → assistenten genererer forslag for hele kalenderen → manageren redigerer i Lag 1-3 → afmelder/justerer hvor ønsket.

**Routing (forslag):** `/races` = hubben (Lag 1 default) · `/races/strategy` = Lag 0 · `/races/:raceId` = Lag 2 · `/races/:raceId/tactics` = Lag 3 · scope `Andre divisioner` = read-only. Tidslinje + scope i URL-params.

## 5. Views i detaljen

### Delt bånd
Scope-toggle (3 pills) + sæson-tidslinje med terræn-profil-glyffer og "du er her". Skift af division/scope må ikke miste det valgte løb.

### Lag 0 — Holdstrategi
- **A-kæde:** vælg/marker dine foretrukne kerne-ryttere.
- **Faste roller:** pr. rytter et valgfrit fast rolle-flag ("altid kaptajn" / "altid sprint-kaptajn hvis med").
- **Kaptajn-prioritering:** for hver terræntype (flad / bakke / bjerg / brosten / ITT) en rangordnet liste af kaptajn-kandidater (1/2/3).
- **Mål-løb:** marker løb i kalenderen som vigtige.
Ændringer her regenererer (eller foreslår at regenerere) assistentens forslag.

### Lag 1 — Trup-fordeling
Assistentens forslag som udgangspunkt. Dagens overlappende løb som kolonner med udtagne ryttere + "+ tilføj fra ledige". Hver rytter i præcis ét løb; valg i ét løb gråer rytteren i de andre samme dag (binding). "Ledige ryttere"-pulje med friskhed. Per-løb-status: antal valgt vs. kategoriens 6/7/8, samt "afmeldt"/"underbemandet". "Auto-udfyld igen"-handling der kalder assistenten.

### Lag 2 — Løbs-detalje
Løbs-header (navn, klasse, type, tid, status) + ruteprofil (etape-vælger ved stage races) + opstilling med rolle og friskhed. Indgang til Lag 3. Afsluttede løb: resultater (som i dag).

### Lag 3 — Taktik
Udtagne ryttere; hver får en rolle (kaptajn / sprint-kaptajn / jæger / hjælper). Profil-hint kobler taktik til ruteprofil. Roller skrives til `race_entries.race_role`. "Jæger" = udbruds-villig (motorens `hunter`/`breakaway`). Faste rolle-regler fra Lag 0 er forudfyldt.

### Sidegren — Andre divisioner
Read-only: vælg en pulje → dens kommende løb + (efter afvikling) resultater/standings. Genbruger `league_divisions` + `StandingsPage`-data.

## 6. Mekanik-ændringer (backend)

1. **Assistent = proaktiv forslags-generator.** Ny tjeneste der ved sæsonstart + ny kalender genererer `race_entries` (6/7/8 + roller, `is_auto_filled=true`) for alle holds alle løb i kalenderen, under disse regler:
   - **Binding:** ingen rytter i to tidsoverlappende løb. Et løbs tidsvindue udledes af `race_stage_schedule` (stage race binder fra første til sidste etape).
   - **Faste roller + kaptajn 1/2/3 pr. terræn** fra Holdstrategi.
   - **Mål-løb:** a-kæden + højest-prioriterede kaptajn til mål-løb; svagere/friske ryttere til de øvrige.
   - **Friskhed:** skån trætte ryttere (genbruger autopickens fatigue-dæmpning).
   - Deterministisk + idempotent (kan regenereres uden at overskrive managerens manuelle redigeringer — afklares: "lås redigerede løb").
2. **Afløser tvungen `fillMissingTeamEntries`.** Den gamle "fyld alle ved afvikling" erstattes. Ved afvikling bruges de allerede genererede/redigerede entries; afmeldte/underbemandede hold deltager ikke (auto-no-show).
3. **Deltag/afmeld-state.** Hold↔løb: deltager / afmeldt / no-show. Persisteres (nyt felt eller afledt — afklares i plan).
4. **`SELECTION_SIZE` → `race_class → max (6/7/8)`-mapping.** Min/max pr. kategori.
5. **Trup-økonomi:** bund-ryttere tildeles ved hold-oprettelse/relaunch så alle hold kan stille til overlappende løb, med bevidst lav `base_value`/abilities. Antal + styrke = **balance-kalibrering (simulér-før-ship)**, men modellen er besluttet.

## 7. Afgrænsning (ud af scope for dette projekt)

- **Eksakte tal/styrker:** hvor mange bund-ryttere, hvor svage, og de præcise 6/7/8-grænser pr. `race_class` = balance-kalibrering (simulér-før-ship), ikke design.
- **Fuld fysiologi (#1021):** træthedens effekt forbliver lille indtil #1021 (post-launch).
- **Selve race-afviklingen** (scheduler, resultat-pipeline) er uændret bortset fra at den læser de nye entries/afmeldings-state.

## 8. Åbne punkter

- Idempotens: hvordan beskytter regenerering managerens manuelle redigeringer (lås pr. redigeret løb? "behold mine ændringer"-prompt?).
- Persistens-model for afmelding/no-show (nyt flag vs. afledt state).
- Tidsvindue-definition for binding ved stage races (hele løbet vs. pr. etape-dag).
- A-kæde: fast sæt vs. rangordnet liste.
- AI-holds forslag: samme generator, eller en lettere variant?

## 9. Fasning (foreløbig)

- **Fase 0 — mekanik-backend:** binding/tidsvindue + 6/7/8-mapping + deltag/afmeld-state + proaktiv generator (afløser `fillMissingTeamEntries`) + bund-rytter-tildeling. (Balance-følsom → simulér-før-ship.)
- **Fase 1 — Lag 1 (trup-fordeling) + delt bånd.**
- **Fase 2 — Lag 0 (Holdstrategi: a-kæde, faste roller, kaptajn 1/2/3, mål-løb).**
- **Fase 3 — Lag 2 (detalje + ruteprofil på kommende løb).**
- **Fase 4 — Lag 3 (taktik/roller).**
- **Fase 5 — Andre divisioner (read-only).**

## 10. Wireframe-reference

Wireframes udviklet inline i brainstorm-sessionen (Cycling Zone navy/guld/Bebas-stil): kerne-skærm v1, Variant A (løb-centrisk → Lag 2), Variant B (trup-board → Lag 1), IA-navigationskort, taktik-laget (Lag 3) og Holdstrategi-laget (Lag 0). Kun "andre divisioner" (read-only genbrug af eksisterende kalender/standings) er ikke skitseret separat. Wireframes er reference for det visuelle udtryk; endelig styling bygges i frontendens eget design-system.
