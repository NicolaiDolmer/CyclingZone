# Planning Center — SSOT

> **Læs denne FØR enhver opgave der rører holdudtagelse, sæsonplanlægning, kalender-fanen eller assistenten.** Ejer-direktiv 25/8 2026 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).

Planning Center er den flade hvor en manager beslutter **hvem der kører hvad, hvornår**. Alt andet om løbene bor i [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) og [`CALENDAR_RULES.md`](CALENDAR_RULES.md).

---

## 0. IA — fire zoom-niveauer, to skinner (ejer-låst 21/8)

| Niveau | Hvad | Status |
|---|---|---|
| **Z1 Sæson** | Rytter × løb over hele sæsonen. Bor i `/planning?tab=selection` bag `Season / Day`-toggle | v0 shippet (#4083); gitteret er P1 |
| **Z2 Løbsdag** | Det eksisterende dags-board | live |
| **Z3 Løb** | Løbets planlægningsvisning i centret — etaper, ruteprofiler, trup | ikke bygget |
| **Z4 Etape** | T1-T4-taktikkortet | bygges af motor-sporets F3 |
| Skinne | Rytter-inspektør | ikke bygget |
| Skinne | Stående ordrer | ikke bygget |

**Ét sted at gemme en udtagelse.** Klik på en løbsdag i Z1 åbner dagens board.

**Z4 bygges IKKE her.** P2 monterer motor-sporets kort og forbinder det. Ingen dobbeltbygning.

---

## 1. Skrivevejen

| Endpoint | Bruges af | Rate limit |
|---|---|---|
| `PUT /races/:raceId/selection` | dagsboardet — skriver med det samme | `marketWriteLimiter`: **30 pr. 60 sek** |
| `PUT /races/selection/bulk` | Z1-matrixen — atomart, hele diffen i ét kald | samme limiter, ét kald |
| `POST /races/:raceId/selection/auto` | auto-udfyld pr. løb | samme |
| `POST /races/distribution/regenerate` · `/clear` | sæson-brede operationer | samme |

**Bulk er atomart.** Enten går hele planen ind, eller ingen af den. Delvis succes findes ikke — spilleren må aldrig se halvdelen af sit arbejde gemt. Bulk-vejen orkestrerer kun; valideringen (binding, trupgrænse, tilgængelighed) er den samme som enkelt-endpointets.

**Grænsen er grunden.** 40 celler via enkelt-endpointet ville fejle efter de 30 første. Se `backend/lib/rateLimiters.js:64`.

---

## 2. Rolle-vokabularet

Fem værdier, og de ejes af motoren, ikke af denne flade: `captain` · `sprint_captain` · `hunter` · `helper` · `free_role`. Se [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) §1. **Opfind aldrig et sjette ord her.**

---

## 3. De to akser

Kolonnerne i Z1 kan ikke låses uden at kende kalenderens akse-tilstand. Se [`CALENDAR_RULES.md`](CALENDAR_RULES.md) §0: en løbsdag bor **inde i** én kalenderdag, og `game_day` kan aldrig udledes af `scheduled_at`.

Uanset udfald vises **begge akser**: dato-kalenderen som ramme, løbsdags-striben som sandhed. En flade der kun viser den ene lyver om den anden — det kostede en spiller-bugrapport 24/8 ([#4193](https://github.com/NicolaiDolmer/CyclingZone/issues/4193)).

---

## 4. Assistenten (LÅST regel — ejer-bekræftet, nedskrevet 28/8, #4201)

**Modellen er sen-udfyldning, ikke proaktiv udtagelse.** Fem regler:

1. **Ingen proaktiv præ-udfyldning.** Assistenten skriver aldrig udtagelser i forvejen, og genskaber aldrig noget spilleren har ryddet og gemt ([#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200)-klassen — én af de to ting der udskød S3; den proaktive assistent blev slået fra 25/8). Ingen ny proaktiv assistent-flade må opstå — heller ikke kortstakke, forslag-bannere eller auto-accept-flows.
2. **Sen redning ved afvikling, ens for alle hold** (ejer-beslutning 26/8, [#4174](https://github.com/NicolaiDolmer/CyclingZone/issues/4174)). Implementeret i `fillMissingTeamEntries` (kører ved etape 1-afvikling, [#4301](https://github.com/NicolaiDolmer/CyclingZone/pull/4301)): et hold med NUL udtagne får en fuld trup; et hold UNDER minimum-6-gulvet fyldes præcis op til 6 med hjælpere — spillerens egne picks og roller røres aldrig, og redningen sætter aldrig en anden kaptajn. Afmeldte og bevidst ryddede hold springes over, og der skrives intet hvis gulvet ikke kan nås.
3. **Spilleren ser konsekvensen FØR klik** (`partialSquadOutlook`, én regel på begge flader) — også ved 0 udtagne. Copy-kontrakten står i PR #4301.
4. **Forslag er aldrig beslutninger.** Peak-FORSLAG består (de skriver planer, ikke udtagelser), men optager aldrig en plads, tæller aldrig som peaks og forbliver afvist ([#4212](https://github.com/NicolaiDolmer/CyclingZone/issues/4212)/PR #4359).
5. **Spiller-initieret udfyld er lovligt** via de tre eksisterende indgange (dagsboardet, `PlannerAssistantCard` for peaks, `/selection/auto`). En fjerde indgang må ikke opstå.

**Tilstanden er nu valgbar runtime (#4201, 3/9).** Regel 1-5 ovenfor er `proactive`-tilstanden,
som er prod i dag. `app_config.assistant_selection_mode` kan skifte til `late_fill` (assistenten
udfylder KUN en helt tom trup, og først inden for `assistant_late_fill_hours` før start) eller
`opt_in` (holdet skal selv have slået assistenten til). Reglerne pr. tilstand, fail-safen og
gaterne bor i [`ASSISTANT_RULES.md`](ASSISTANT_RULES.md) §1b - dupliker dem ikke her. **Intet er
flippet**, og regel 1's forbud mod nye proaktive assistent-FLADER gælder uændret i alle tre
tilstande; den eneste nye flade er én til/fra-kontakt på Profil, synlig kun i `opt_in`.

**Kendt rest (kode, hører til P3):** symmetriske kontroller (man kan rydde dag OG sæson, men kun udfylde en dag), én forklarende linje på boardet, Hjælp-afsnit (en+da). AI-holds autofill er uændret (felterne afhænger af den, jf. #2622-bindingen).

---

## 5. Linser og filtre

| Linse | I v1 | Datagrundlag |
|---|---|---|
| Udtagelser | ja | gitterets eget indhold |
| Kun problemer | ja | udtagelser + klassegrænser + binding, regnes i browseren |
| Belastning | ja | `load.raceDays` = distinkte `race_stage_schedule.game_day` pr. løb (#4245) |
| Form og peak | senere | `peak_planner_enabled` er `on` i prod (koden defaulter off) |
| Rute-match | kun ved celle-åbning | `frontend/src/lib/suitability.js`, ægte 0-100 mod demand-vektoren |

Rute-match som fladedækkende linse er fravalgt: kalender-svaret bærer hverken evner eller demand-vektorer.

**Belastnings-linsen, præcist (#4245).** `load.raceDays` tæller de distinkte `race_stage_schedule.game_day` rytteren er tilmeldt, kun i den AKTIVE sæson (`race_entries` er ikke sæson-scopet i sig selv). Løb uden brugbare `game_day`-rækker falder tilbage til løbets etapetal, mindst 1, og det fallback deles af både Race Hub'en og planner-boardet, så de to chips aldrig kan divergere.

Belastning er ikke binding: bindingen er hele spændet `min(game_day)..max(game_day)` og er tilsigtet (ejer-direktiv 25/8, [#4217](https://github.com/NicolaiDolmer/CyclingZone/issues/4217), `docs/CALENDAR_RULES.md` §2b + §8). Belastningen er de løbsdage rytteren faktisk kører på. For et løb med spring i serien er de to tal forskellige, og det er meningen.

**Grand Tour-hviledage (låst 4/9 2026, ejer-beslutning 3/9, [#4209](https://github.com/NicolaiDolmer/CyclingZone/issues/4209)).** En GT-rytter står IKKE som ledig på GT'ens hviledage — hviledagen er en løbsdag GT'en optager (`docs/CALENDAR_RULES.md` §3), så bindingen dækker den, og planner-fladen viser rytteren som optaget. Fladen har intet eget tilgængeligheds-filter: `windowsOverlap` i `frontend/src/lib/raceHubLogic.js` skærer `bindingWindow.days`, som backendens `raceBindingWindow` serialiserer som HELE spændet. Belastnings-chippen (`load.raceDays`) tæller derimod stadig kun de kørte etapedage — hviledagen binder, men koster ikke belastning.

**Ordet "løbsdag" (ejer-beslutning 27/8).** En løbsdag er BINDINGS-enheden (`game_day`), som i `docs/CALENDAR_RULES.md` §0. Sponsor-økonomien lånte samme ord i `help.json` og `finance.json` for sin betalings-enhed; den hedder nu ETAPE / stage i al spiller-vendt tekst. Økonomien er uændret, kun ordene.

---

## 6. Komponenter der allerede findes

Byg aldrig disse om. Verificeret mod koden 25/8.

| Komponent | Ansvar |
|---|---|
| `racehub/SeasonView.jsx` | Datolineal, løbs-bånd, lane-packing, klik → dagsboard |
| `racehub/SeasonDayToggle.jsx` | `Season / Day` |
| `racehub/SeasonPicker.jsx` | Sæson-browsing, read-only (B7) |
| `lib/seasonTimeline.js` | 11 rene funktioner, sæson-agnostiske. `nextFocusDayIso` finder næste løbsdag uden udtagelse |
| `lib/suitability.js` | Rute-match 0-100, spejler `raceSimulator.terrainScore` |
| `racehub/FitBar.jsx` | Den delte fit-bar — kolonne, pulje og popover viser samme signal |
| `planner/MobileLanes.jsx` | Mobilt stakket lane-mønster, tap-mål ≥24px |
| `planner/PlannerAssistantCard.jsx` | "Accept all" for peak-forslag |

---

## 7. Verificeret UI-gæld (efterprøvet mod kode 25/8)

| # | Fund | Hvor |
|---|---|---|
| 1 | Strategi-kladde tabes tavst ved fane-skift | `StrategyPage.jsx:68` — kun `saved=false`, ingen unmount-guard, modsat boardets `boardDirty` |
| 2 | Kalender-fanen har nul URL-tilstand | `CalendarPage.jsx:49-62` — `tab`, `division`, `pool` er ren `useState` |
| 3 | Tilbage fra løb åbnet på boardet lander i Resultater | `RaceColumn.jsx:100` → #3954 |
| 4 | Drag er ren HTML5, 0 touch-handlers; løb→løb har intet klik-alternativ | `raceHubDnd.js` |
| 5 | **Hubben lukket 27/8 (#4165).** Alle **seks** flader skelner nu fejlet kald (ErrorState + retry) fra en legitim tom/slukket tilstand, og fejl-grenen ligger bindende FØR flag-/tom-grenen. Auth-grenen tæller med: et manglende token må ikke tegnes som "feature slukket", "kalenderen er tom" eller "ingen aktiv sæson". Tre tegnede intet (`RaceHubBoard`, `DivisionStartLists`, `StrategyPage`), tre tegnede en tom-tilstand der løj (`SeasonView`, `usePlanner`+`SeasonPlannerPage`, `CalendarPage`). Fejl-fladen skal desuden beholde sin navigation: et "Prøv igen" der gentager samme dag/pulje/scope er en blindgyde. **Uden for hubben er mønstret IKKE udtømmende talt op.** Fire er efterprøvet mod koden 27/8: `RaceSelectionPanel.jsx:126+129`, `StageRoleMatrix.jsx:87+90`, `useTraining.js:41+44` (tegner *"Daily training is currently paused"*) og `useScouting.js:77+80` (falder tilbage til "uscoutet"). Flere hooks deler den tavse **auth**-gren alene (`useAcademy`, `useFacilities`, `useScoutingCentral`, `useStaffDirectory`, `useTeamPublicProfile`, `BoardPage.jsx:2288`) har fejl-state for !res.ok, men ikke for et manglende token. En app-bred optælling er ikke lavet | `RaceHubBoard.jsx`, `StrategyPage.jsx`, `DivisionStartLists.jsx`, `SeasonView.jsx`, `usePlanner.js` + `SeasonPlannerPage.jsx`, `CalendarPage.jsx` |
| 6 | Formplanen viser form, aldrig træthed, selvom API'et sender begge | `PlannerSquad.jsx`, `MasterCanvas.jsx` |

---

## 8. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 2 | To gemme-modeller: boardet skriver straks, matrixen ved Gem — men spec'en siger "ét sted at gemme" | denne fil §1 |
| 3 | Tre indgange til auto-udfyld; #4201 kan gøre alle tre forkerte | [#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201) |
| 4 | `?view=`-parameteren slettes af `SeasonView.jsx:202` og sættes aldrig, selvom regel 6 kræver den | [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) |
| 5 | ~~Trupgrænser pr. klasse er ikke skrevet ned noget sted~~ **Lukket** 27/8: de står i [`CALENDAR_RULES.md` §8](CALENDAR_RULES.md) (tilføjet 24/8 i #4176), som nu også dokumenterer default-fallbacken `{6,8}`, at en delvis trup er lovlig at gemme, og gulvet på 6 udtagne for at stille op | [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295) |

Modsigelse 1 (`raceDays` bar etapetal) er lukket af [#4245](https://github.com/NicolaiDolmer/CyclingZone/issues/4245). Nummereringen står urørt, så henvisninger til modsigelse 2-5 andre steder stadig peger rigtigt.

---

## 9. Kildedokumenter

[`2026-08-21-planning-center-fase2-design.md`](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (IA, faseplan P0-P5, scorecard) · [`2026-08-25-planning-center-z1-saesonmatrix-design.md`](superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md) (Z1-gitteret).

Spiller-preview live: `frontend/public/race-planning-preview.html` (#4022), som en spiller byggede videre på 25/8 — se `.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md`.
