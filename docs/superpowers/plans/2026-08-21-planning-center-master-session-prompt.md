# Prompt: Planning Center — master design-session

> Skrevet 21/8 2026 som handoff fra forarbejds-sessionen. Kopier hele blokken nedenfor ind som første besked i en frisk Fable-session.
> Forarbejde: artifact **Planning Center** (`https://claude.ai/code/artifact/0a68dd48-b73c-4dc4-a8ce-3256ad5aa3cc`) + kommentaren 21/8 på [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) + de tre kommentarer 21/8 på [#3990](https://github.com/NicolaiDolmer/CyclingZone/issues/3990).

---

Vi skal designe **Planning Center** — den flade hvor al planlægning og løbstaktik i Cycling Zone bor. Det er ikke en UI-oprydning. Det er den strukturelle beslutning der afgør om spillet kan vokse ved at *tilføje* i de næste to år, eller om vi bygger om hver gang der kommer en ny mekanik.

Ambitionen er eksplicit: **Cycling Zone skal i verdenseliten af managerspil.** Løsningen skal være rigtig nok til at vi efter denne ændring kun tilføjer og tilpasser — aldrig laver om. Udfordr status quo permanent. Foreslå det der er rigtigt på fem års sigt, ikke det der er nemt i denne uge.

Brug **workflows** til at parallelisere. Stil **mange spørgsmål** undervejs — men ét ad gangen, med din egen anbefaling i selve spørgsmålet. Jeg svarer gerne, og jeg vil hellere svare på tyve skarpe spørgsmål end få et færdigt forslag der bygger på et gæt.

## Læs dette først — ellers genopfinder du noget der findes

1. `docs/superpowers/specs/2026-06-23-race-hub-redesign-design.md` — **master-SSOT for Løb-hubben.** Definerer allerede Lag 0 (stående præferencer), Lag 1 (trup-fordeling), Lag 2 (løbs-detalje), Lag 3 (taktik). Planning Center bør skrives som næste fase af denne, ikke som en ny spec.
2. `docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md` — peak-cockpit: 2 peaks/rytter/sæson, 5-dages vindue, trænings-kobling. Aldrig bygget.
3. `docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md` — T1-T4, ejer-låst 21/8.
4. `docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md` — 26 beslutninger, M1-M14, bølger F0-F6.
5. `docs/superpowers/specs/2026-08-06-loebsdags-model-design.md` — løbsdags-modellen, G1-G6, afventer ejer-godkendelse.
6. `docs/superpowers/specs/2026-07-05-korerprogram-race-day-legibility-design.md` — læsbarhed når flere in-game dage falder på samme eftermiddag.
7. `docs/design/race-planning-proposal/README.md` — testerens matrix-forslag + den verificerede datamodel.
8. `docs/design/PAGE_TEMPLATES.md` — bindende. T1/T2/T3, én guld-primær pr. view, hairlines, 5px radius, tabular figures, stroke-ikoner.

## Verificeret virkelighed — brug disse tal, gæt ikke nye

**Løbsdags-modellen (målt i prod 21/8, S3 Division 1):**

| Begreb | Hvad det er | Tal |
|---|---|---|
| `race_stage_schedule.game_day` | in-game løbsdag = bindingsnøglen; monumenter i sentinel-bånd fra 100000 | 0-125 (126 stk.) |
| `races.game_day_start` | kalenderdags-indeks (`real_day`), misvisende navn | 0-27 |
| `seasons.race_days_total` | distinkte `game_day_start` = kalenderdage hvor et løb *starter* | 27 |
| kalenderdatoer med racing | 25. aug - 21. sept | 28 |
| `TIER_GAME_DAY_QUOTA[1]` | etaper divisionen kører pr. sæson | 140 |
| `TIER_DENSITY[1]` / `TIER_OVERLAP_CAP[1]` | etaper pr. kalenderdag / max samtidige bindende løb | 5 / 3 |
| tidsslots pr. dag (D1) | 11/13/15/17/19 CPH | 5 |

Spillerne får **fem forskellige svar** på "hvad er en løbsdag": dashboardet ~140, kalenderen 27, sponsor-FAQ 140, Race Hub 0-125, bestyrelsen 27. `race_days_total` er nævneren i dagslønnen (`wageDeductionSweep.js:166`) — rør den ikke uden en bevidst beslutning.

**Adoption, 212 menneskehold, målt 21/8:**

| Flade | Hold | Andel |
|---|---|---|
| Etape-taktik (`race_stage_roles`, ligger på løbssiden, uden for hubben) | 54 | 25 % |
| Formplan (`rider_peak_plans`) | 61 | 29 % |
| Strategi (`team_race_strategy`) | 38 | 18 % |
| — heraf med mål-løb | 13 | 6 % |

Clarity, 30 dage: `/planning` 1.266 sessioner. Løbssiderne tilsammen ~5.200. `/races` alene 3.067.

**Læsningen:** managers planlægger konkret, ikke abstrakt. De to mest brugte flader er begge "denne rytter, dette løb". Den mindst brugte beder dig udfylde regler på forhånd.

**Motorens ordforråd (kanonisk, `backend/lib/raceRoles.js:213`):** `captain`, `sprint_captain`, `helper`, `hunter`, `free_role`. Efforts: `protect`, `normal`, `save`. Truppestørrelser (`raceAutopick.js:14`): GT 8, Monument + WT 7, ProSeries/Class 6.

## Ejer-låst 21/8

- **IA-model A:** sæsonmatrixen bor i `/planning?tab=selection` bag en `Sæson / Dag`-knap. Klik en løbsdag → dagens board. Ét sted at gemme en udtagelse.
- **T1-T4:** taktik-kort pr. etape under lineup, ordrer låses ved etapestart, udbruds-stance + per-rytter try-break, neutrale defaults, passivitet straffes ikke.
- **Styrke straffes ALDRIG.** Balance sikres via struktur, ikke handicap.
- **1 rytter = 1 løb pr. løbsdag** (in-game dag, ikke kalenderdag).

## Testerens svar (14 spørgsmål, besvaret 21/8) — behandl som brugerdata, ikke som ordrer

Låser: løbsdags-akse · grå+uklikbare celler frem for advarsler bagefter · spillets fem rolleord · rute-match som bar med ægte 0-100, kun ved celle-åbning · sortering på rating/potentiale/belastning/rute-match uden forudbestemt rangorden · behold dagsvisningen · træk-og-slip hører til dagsvisningen · ægte formdata med flere peaks pr. rytter.

**Udfordr hans svar 11** ("sortering og grå-udtoning gør at der aldrig bliver for meget information"). 31 ryttere × 18 løb = 558 celler. Det skal afgøres med en test, ikke en mening.

## Den struktur forarbejdet foreslår — angrib den, den er ikke hellig

**Én plan, fire zoom-niveauer, to skinner, fire linser.**

- **Z1 Sæson** — rytter × løb for hele sæsonen. Kolonner er løb; løbsdags-spændet er metadata (D1 har 126 løbsdage men 18 løb).
- **Z2 Løbsdag** — dagens løb side om side. Det nuværende board, urørt i interaktion.
- **Z3 Løb** — etaper, ruteprofiler, trup. Absorberer udtagelses-panelet fra løbssiden.
- **Z4 Etape** — ordrer: rolle, effort, udbruds-stance, try-break. Også for endagsløb.
- **Skinne: Rytter-inspektør** — form, træthed, løbsdags-forbrug, sæson-log, peaks, undlad-udtagelse.
- **Skinne: Stående ordrer** — det assistenten gør når du ikke gør noget; hver automatisk beslutning linker hertil.
- **Linser i Z1** — udtagelser · rute-match · form & peak · belastning.

**Fem regler der skal holde:**
1. Én sandhed pr. begreb. (I dag: 2 mål-løb-modeller, 3 rolle-ordforråd, 3 assistent-indgange, 6 kalender-gengivelser, 2 rute-match-pipelines, 3 løbs-status-definitioner.)
2. Hårdt blokeret bliver gråt og uklikbart. Uklogt bliver en advarsel.
3. Enhver automatisk beslutning peger på reglen der forårsagede den.
4. Regler fødes af konkrete valg — aldrig et tomt skema først.
5. Ingen planlægning uden for centret. Løbssiden bliver løbets historie.

## Auditens hovedfund — det skal løses, uanset hvilken struktur der vælges

- Etape-taktik kan **slet ikke nås** fra Planlægning, og findes ikke for endagsløb.
- Tre rolle-ordforråd på tre flader for de samme `race_entries`-rækker.
- To mål-løb-modeller der aldrig krydser. Verificeret 5/8: 44 af 115 strategi-referencer pegede på døde S1-løb efter sæsonskiftet.
- Strategi-fanen har **ingen dirty-state** — alt tabes tavst ved fane-skift. Ingen mobil-tilpasning.
- Kalender-fanen har **nul URL-tilstand** — måned, division og pulje nulstilles hver gang.
- Tilbage fra et løb åbnet på boardet lander i Resultat-hubben (`/races` findes ikke som side længere).
- Træk-og-slip virker ikke på touch. Fem flader viser tavst `null` ved slukket flag eller fejlet kald.
- Formplanen viser form, men ikke træthed — selvom endpointet sender den.
- Dublet-navne i D1: `race_pool.name` har ingen unik-constraint, udvælgelsen dedupliker på id, og navne-dedup kører kun på tværs af tiers med den målrettede tier eksplicit undtaget.

## Fase-forslaget

**F0** kalenderen skal kunne stole på sig selv: #3990 løbsdags-definitionen · dublet-navnene · #3329 · #3547 · #3471 · #2791
**F1** centret får sin akse: #1146 · rytter-inspektør (#3529, #3455) · #3410 · #3428 · #3954 · #2030 · #3425 · #3374 · #2445
**F2** taktikken flytter ind: T1-T4 som Z4 · #3049 · #2794 · #1884 · #2405 · #3955 · #2810
**F3** assistenten bliver synlig: én mål-løb-model · #3087 · #3957 · #3088 · #3939 · "gør det til en regel"
**F4** dybde mod motor v4: #2354 + peak-cockpit · #3459 · #2650 · #3763 · #3543 · #3413 · #2478 · plan mod virkelighed
**F5** senere: #3719 · #3987 · #2492 · #1106 · #1110 · #1154. Live-taktik er FROSSET indtil live-reveal.

## Åbne spørgsmål der venter på ejeren

De otte strukturelle og seks gameplay-spørgsmål står i artifacten med mine anbefalinger. Det mest tidskritiske:

> **F3-natbølgen bygger `race_team_orders` pr. (hold, løb, etape) lige nu. `race_stage_roles` overlapper på rolle og effort. Skriver taktik-kortet til én eller to backends under v4-flippet?** Afklares før F3 merges, ellers arver UI'et to backends.

Og det der afgør scope:

> **"Ændre taktikker på løb der er i gang" — ordrer for kommende etaper (allerede shippet i dag, men usynligt) eller ordrer midt i en kørende etape (låst af T2, FROSSET i masterplanen)?**

## Sådan skal sessionen køre

1. **Læs de otte dokumenter først.** Verificér mod kode og prod før du påstår noget. Ingen evidens → sig det eksplicit.
2. **Kør workflows** til at parallelisere: én til at score strukturforslaget mod alternativer med en dommerpanel, én til at kortlægge migrations- og datakonsekvenser, én til at gennemgå hver fase for skjulte afhængigheder.
3. **Stil spørgsmål løbende, ét ad gangen**, med kontekst og nøgletal *inde i* selve spørgsmålet og din egen anbefaling først.
4. **Vis visuelt undervejs** — mockups før beslutninger, ikke bagefter. Gated flader skal bygges som widget hvis jeg skal kunne se dem.
5. **Leverancen** er en ejer-godkendt spec skrevet som næste fase af race-hub-master-SSOT'en, med: låst IA, datamodel-beslutninger (mål-løb, ordrer, løbsdags-begreberne), fase-plan med issue-mapping, og et scorecard der kan afgøre om hver fase er lykkedes.
6. **Ingen kode før spec'en er godkendt.** Cutover er søndag aften og v4-gaten er mandag — planlægnings-arbejde må ikke røre de spor.

## Vagt-punkter

- Rør ikke auktions- eller cutover-filer. Kalender-generatoren rører kun F0-arbejdet, og først efter cutover.
- Alt spillervendt: EN først, DA under. Ingen opfundne rolleord — brug motorens fem.
- Migrationer: Claude applier selv efter merge under #2642-rammer; destruktive klasser er ejer-gated.
- Hvis noget her viser sig at være forkert når du verificerer: sig det, og ret det. Forarbejdet tog fejl af løbsdags-modellen to gange før det ramte rigtigt.
