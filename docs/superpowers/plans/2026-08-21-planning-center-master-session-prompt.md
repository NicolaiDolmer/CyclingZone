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
- **Ordre-modellen:** `race_team_orders` er eneste sandhed for rolle + effort pr. etape; `race_stage_roles` migreres og udfases.

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

## Spørgsmål du SKAL stille ejeren i denne session

Ejeren har eksplicit bedt om at få alle spørgsmål her frem for i forarbejds-sessionen. **Stil dem ét ad gangen** via AskUserQuestion, med nøgletal og kontekst *inde i selve spørgsmålet* (ejeren ser ikke altid prosaen omkring kortet), og med din egen anbefaling som første valgmulighed. Gå ikke videre til byg før gruppe A og B er besvaret.

Rækkefølgen nedenfor er den anbefalede: A afgør hvad der bygges, B afgør hvad spillet er, C afgør hvor meget maskinen må, D afgør hvordan vi ved om det lykkedes.

**Afklaret 21/8, spørg ikke igen:** IA-model A (zoom-toggle i `?tab=selection`) · `race_team_orders` som eneste ordre-sandhed, `race_stage_roles` migreres og udfases · T1-T4 · styrke straffes aldrig · 1 rytter = 1 løb pr. løbsdag.

### Gruppe A — struktur (afgør hvad der overhovedet bygges)

**A1. "Ændre taktikker på løb der er i gang" — hvad menes der?**
Ordrer for *kommende* etaper i et kørende etapeløb virker allerede i dag (`stageTactics.help`: "Changes apply to upcoming stages only", `raceStageRolesApi.js:6-12` tillader det bevidst mens løbet er live) — det er bare usynligt fra Planlægning. Ordrer *midt i* en kørende etape er låst af T2 og står som FROSSET i masterplanen indtil live-reveal.
*Anbefaling: kommende etaper, men gjort synligt i centret. Hvis ejeren mener midt-i-etape, er det en ændring af v4-planen og skal behandles som sådan.*

**A2. Bliver løbssiden en ren historie-side?**
Al planlægning flytter ind i centret; `/races/:id` beholder ruteprofil, resultater og fortælling. Løser #2794 strukturelt.
*Anbefaling: ja. Ellers har vi permanent to steder at planlægge — rod-årsagen til halvdelen af auditens fund.*

**A3. Én mål-løb-model — må vi migrere?**
`team_race_strategy.target_race_ids` (hold-scopet, ingen `season_id`, 13 hold bruger den) og `rider_peak_plans.target_race_id` (rytter-scopet, sæson-scopet, 61 hold bruger den) smeltes sammen. Kræver migration og rører data hold allerede har lagt.
*Anbefaling: ja, med `rider_peak_plans` som det bærende — det er den model der faktisk bruges og allerede er sæson-scopet. Blokerer #3087 indtil det er gjort.*

**A4. Skal "Stående ordrer" være en flade man opsøger, eller kun noget der opstår af konkrete valg?**
18 % har rørt Strategi-fanen; 6 % har markeret et mål-løb — og fladen styrer auto-udtagelsen for alle.
*Anbefaling: begge, men fladen bliver kvitteringen ("her er de 6 regler du har lavet"), ikke indgangen. Reglerne fødes af "gør det til en regel" på konkrete valg.*

**A5. Hvad er designgrænsen for Z1?**
D1 har 18 løb; trupperne vokser. 31 ryttere × 18 løb = 558 celler. Testeren mener sortering og grå-udtoning gør tætheden til et ikke-problem — det er en påstand, ikke en måling.
*Anbefaling: sæt tallet nu — forslag 40 ryttere × 30 løb — og test det på mobil før byg.*

**A6. Kalenderen: datolineal i Z1, egen fane, eller begge?**
Testeren: kalenderdage er kun til "when to plan in real time". Kalenderfanen har i dag nul URL-tilstand og nul viden om trup eller binding.
*Anbefaling: datolineal i Z1 plus behold månedsgitteret, men omdefinér det til "hvornår låser hvad" frem for en anden planlægningsflade.*

**A7. Ny spec eller fase 2 af race-hub-master-SSOT'en fra 23/6?**
Den spec definerer allerede Lag 0-3 og meget af dette.
*Anbefaling: fase 2 af den eksisterende. Vi har brudt reglen om at læse eksisterende planer én gang for meget.*

**A8. Skal Planning Center være standard-landingssiden efter login?**
Dashboardet har 6.784 sessioner/30 dage; hele planlægningen har 1.266. Men planlægning er kerneloopet, og #3513/#4070 omdesigner dashboardet parallelt.
*Anbefaling: nej — men centret skal have en plads i dashboardets faste rygrad med "hvad kræver dig før næste lås".*

**A9. Hedder fladen stadig "Planning" over for spilleren?**
"Planning Center" er vores interne navn. I dag: EN "Planning", DA "Planlægning".
*Anbefaling: behold. Nyt navn koster muskelhukommelse uden at give noget.*

### Gruppe B — gameplay (afgør hvad spillet er)

**B1. Skal der være et loft over en rytters løbsdage pr. sæson?**
#1146 godkendte "~60 løbsdage som øvre arbejdsbyrde" ud af D1's 140. I dag findes intet loft — kun en tæller ingen validerer mod.
*Anbefaling: ingen hård grænse. Lad træthed være prisen og vis budgettet, så valget bliver synligt.*

**B2. Et monument binder rytteren hele kalenderdagen — er det med vilje?**
Fire løbsdage, ikke én. Konsekvens af sentinel-båndet (`MONUMENT_GAMEDAY_BASE`) og `deriveMonumentBindingWindow`. Usynligt i dag.
*Anbefaling: behold, det er sportsligt rigtigt — men skriv det på fladen.*

**B3. Skal endagsløb have hele taktik-kortet eller en reduceret udgave?**
#3049 (thelamba). I dag har endagsløb ingen taktikflade overhovedet.
*Anbefaling: hele kortet. En reduceret udgave er en ny asymmetri at forklare.*

**B4. Skal Z1 vise modstandernes udtagelser?**
Data findes i browse-scope. Ville gøre planlægning til et spil mod nogen frem for mod en kalender.
*Anbefaling: ja, men først efter fase 3, og kun for løb der er låst.*

**B5. Hvad skal "plan mod virkelighed" vise efter et løb?**
Rolle mod udført rolle, forventet mod faktisk placering, eller noget tredje?
*Anbefaling: vent til v4's why-rapport er live og byg ovenpå den frem for at opfinde et parallelt sprog.*

**B6. Hvor meget må assistenten vise af sin begrundelse uden at bryde fog-gaten (#1791)?**
Regel 3 i strukturen siger at enhver automatisk beslutning skal pege på reglen der forårsagede den. Fog-gaten forbyder at eksponere rå komponenter og vægte.
*Anbefaling: regler og rangordner må vises ("din A-kæde valgte ham"); tal fra motoren må ikke.*

**B7. Skal Z1 kunne vise næste sæson mens den planlægges?**
#1106 (multi-sæson-visning). Planneren har allerede en sæsonvælger og en "næste sæson"-nudge.
*Anbefaling: ja, men read-only indtil kalenderen er genereret.*

**B8. Er der noget i planlægningen du selv synes er decideret forkert i dag — som ikke står i noget issue?**
*Hvorfor: auditen finder det der er skrevet ned. Den finder ikke det ejeren har irriteret sig over uden at oprette et issue.*

### Gruppe C — assistent og automatik (afgør hvor meget maskinen må)

**C1. Må assistenten handle autonomt, eller kun foreslå?**
I dag top-fylder `raceEntryGenerator` automatisk ved race-tid, og der er tre forskellige auto-fyld-indgange med tre scopes.
*Anbefaling: behold auto-fyld ved race-tid (det beskytter passive spillere), men gør det til én indgang med ét scope-valg og en synlig kvittering.*

**C2. Hvad sker der når en løbsdag passerer uden udtagelse?**
I dag fyldes truppen automatisk. #3374 ønsker et "undlad udtagelse"-flag pr. rytter.
*Anbefaling: behold auto-fyld som default, tilføj både per-rytter-flag (#3374) og et bevidst "stå over dette løb" pr. løb.*

**C3. Skal "Ryd alt for sæsonen" overleve?**
Findes i dag med preview-dialog. Destruktiv og sjældent brugt.
*Anbefaling: behold, men flyt den til stående ordrer — det er en nulstilling af planen, ikke en daglig handling.*

**C4. Skal andre divisioners startlister blive i centret?**
`DivisionStartLists` bor i dag bag scope-skift i boardet og har sin egen pulje-parameter der taber dagen man stod på.
*Anbefaling: flyt til Resultater. Det er en kigge-flade, ikke en planlægningsflade — og scope-skiftet er en af auditens ti navigations-fælder.*

**C5. Onboarding-touren er forankret i boardet (tre trin: vælg løb, vælg ryttere, taktik) — hvor hører den til i den nye struktur?**
*Anbefaling: flyt til Z2, og tilføj et fjerde trin der viser Z1, så sæsonoverblikket bliver opdaget.*

**C6. Hvilke planlægnings-hændelser fortjener en indbakke-besked?**
I dag: varsel når et løb starter inden for 36 timer uden udtagelse. #2223 vil omorganisere indbakken.
*Anbefaling: hold det ved det ene varsel plus clash-opdagelse. Centrets attention-bar er stedet for resten.*

### Gruppe D — levering og måling

**D1. Hvad er minimums-mobiloplevelsen?**
Kan man planlægge en hel sæson på telefon, eller er mobil "se og rette småting"? Træk-og-slip virker ikke på touch i dag, og #3425 (planlægning i mobilbundbaren) venter på en beslutning.
*Anbefaling: fuld planlægning skal kunne lade sig gøre på mobil, men Z1 får en rytter-først-liste i stedet for et gitter.*

**D2. Hvad er scorecardet for om centret lykkedes?**
Baseline målt 21/8: etape-taktik 25 %, formplan 29 %, stående ordrer 18 %, mål-løb 6 %.
*Anbefaling: mål på (a) andel hold der rører taktik mindst én gang pr. sæson, (b) andel udtagelser der er manuelle frem for auto-fyldte, (c) andel hold med mindst én stående ordre. Sæt tallene FØR byg.*

**D3. Skal faserne bygges i rækkefølge, eller må F1 og F2 køre parallelt i natbølger?**
*Anbefaling: F0 alene efter cutover, derefter F1 og F2 parallelt — de rører forskellige flader.*

**D4. Hvornår må der bygges?**
Cutover er søndag aften, v4-gate mandag, S3 starter tirsdag.
*Anbefaling: intet planlægnings-byg før v4-flippet er afgjort. Spec'en kan godkendes i mellemtiden.*

## Sådan skal sessionen køre

1. **Læs de otte dokumenter først.** Verificér mod kode og prod før du påstår noget. Ingen evidens → sig det eksplicit.
2. **Kør workflows** til at parallelisere: én til at score strukturforslaget mod alternativer med en dommerpanel, én til at kortlægge migrations- og datakonsekvenser, én til at gennemgå hver fase for skjulte afhængigheder.
3. **Stil de 27 spørgsmål ovenfor** — ét ad gangen, med kontekst og nøgletal *inde i* selve spørgsmålet og din egen anbefaling først. Ejeren har eksplicit bedt om at få dem her frem for i forarbejds-sessionen, så de skal faktisk stilles, ikke opsummeres. Gruppe A og B skal være besvaret før spec'en skrives færdig; C og D kan afvikles undervejs. Opstår der nye spørgsmål af svarene — og det gør der — så stil dem også.
4. **Vis visuelt undervejs** — mockups før beslutninger, ikke bagefter. Gated flader skal bygges som widget hvis jeg skal kunne se dem.
5. **Leverancen** er en ejer-godkendt spec skrevet som næste fase af race-hub-master-SSOT'en, med: låst IA, datamodel-beslutninger (mål-løb, ordrer, løbsdags-begreberne), fase-plan med issue-mapping, og et scorecard der kan afgøre om hver fase er lykkedes.
6. **Ingen kode før spec'en er godkendt.** Cutover er søndag aften og v4-gaten er mandag — planlægnings-arbejde må ikke røre de spor.

## Vagt-punkter

- Rør ikke auktions- eller cutover-filer. Kalender-generatoren rører kun F0-arbejdet, og først efter cutover.
- Alt spillervendt: EN først, DA under. Ingen opfundne rolleord — brug motorens fem.
- Migrationer: Claude applier selv efter merge under #2642-rammer; destruktive klasser er ejer-gated.
- Hvis noget her viser sig at være forkert når du verificerer: sig det, og ret det. Forarbejdet tog fejl af løbsdags-modellen to gange før det ramte rigtigt.
