# UI/UX-audit — hele siden (2026-07-15)

> **Metode:** evidens-vægtet. 8 flade-klynger auditeret af parallelle agenter mod en fast 6-akset rubrik, hvert P0/P1-finding adversarisk verificeret af en uafhængig skeptiker (63 findings → 50 overlevede), plus 2 tværgående lenses (mobil, feedback), benchmark mod PCM/FM/Hattrick, og live-screenshots på mobil+desktop. Alle domme er vægtet mod **ægte prod-brug** (`player_events`, `traffic_events`, 15/7), ikke mavefornemmelse.
>
> **Status:** research. Ingen kode ændret. Ejeren valgte: mobil-først på public+kerne-loop, stop før kode, vægt aktivering > dybde.

## Kort version

Design-systemet er **ikke** problemet. Egenart scorer 4/5 på alle 8 flader — [20/6-auditten](2026-06-20-design-quality-audit.md) holder stadig, og token-drift er stort set lukket.

Problemet er tre kontrakter som kodebasen **selv definerer korrekt**, men som UI-laget springer over på enkelte flader:

| Kontrakt | Defineret i | Brudt |
|---|---|---|
| Tabeller scroller | `ui/Table.jsx:4-12` (wrapper altid i `overflow-x-auto`) | 27 player-facing filer bruger rå `<table>` |
| Handlinger rapporterer fejl | 6 hooks returnerer `{ok, error}` | Flere kaldesteder ignorerer returværdien |
| Design-tokens | `cz-*` + CI-gate `lint-ui-slop.mjs` | Stort set holdt (20/6-arbejdet virkede) |

Det er samme diagnose som 20/6 stillede om design-tokens — **afvigelser fra et godt system, ikke fravær af et** — nu på mobil og fejlhåndtering. Kuren er den samme: håndhæv kontrakten i CI.

## Evidensgrundlag (verificeret 15/7)

- **Aktive:** DAU 34 / WAU 43 / MAU 82 (88 all-time). DAU/MAU = 41% — stærk stickiness. **Det virker. Pas på det.**
- **Mobil er flertallet, også inde i appen:** 54,9% af app-besøg (693 mod 570). Ikke kun landing. En desktop-først-prioritering ville have optimeret for mindretallet.
- **Tragt:** 78 af 88 draftede hold (89%) → 56 satte træning (64%) → 42 bød (48%) → **22 så et løbsresultat (25%)**.
- **Brug/7 dage:** race 2.432/38 · træning 2.292/34 · auktion 803/28 · rytter-faner 431-758/20-25 · bud **16/10**.

### Lave tal med forklaring (ikke svage flader)

Hvert lavt tal blev efterprøvet, før det blev til en dom. Fire viste sig at være noget andet:

- **Hall of Fame** (0 brugere): fladen er *fjernet*, `/hall-of-fame` redirecter til `/standings`. Side-koden er **bevidst bevaret** ([#2359](https://github.com/NicolaiDolmer/CyclingZone/issues/2359), dokumenteret i `App.jsx:249-250`). **Skal ikke slettes.**
- **Uge-planlægger** (2 brugere): `peak_planner_enabled='beta'`. Merged, men beta-gated.
- **Survey-banner** (5.389 visninger / 2 brugere): `SurveyBanner.jsx:75` returnerer for ikke-admins. Admin-preview der fyrer ved hver mount, på en feature hvis egen kode siger *"Ingen rigtig Tally-URL endnu"*. 8% af `player_events` er støj herfra.
- **Facilities/staff** (20-21 brugere): først instrumenteret 10/7 — 5 dages data, faktisk god adoption.

## Rangering — svageste flader vægtet efter brug

Score = kvalitetsgap × brugsvolumen × strategisk vigtighed. Snit er gennemsnit af 6 akser (0-5).

| # | Flade | Snit | Mobil | Feedback | Brug/uge | Hvorfor her |
|---|---|---|---|---|---|---|
| **1** | **Race** | **2,8** | **1** | 3 | 38 brugere | Lavest score **og** højest brug. Ejerens vigtigste søjle. |
| **2** | **Dashboard** | 3,0 | 2 | 3 | Hver session | Første skærm hver gang. 5.915px på mobil, 4 af 8 kort tomme for nye. |
| **3** | **Bestyrelse** | 3,0 | 3 | 2 | 1 nu → **43 om ~11 løbsdage** | Tidsindstillet. Se nedenfor. |
| **4** | **Auktion/marked** | 3,3 | 3 | 3 | 28 (kun 10 bød) | Konverteringen lækker målbart. |
| **5** | **Træning** | 3,3 | 2 | 3 | 34 brugere | Næst-mest brugte handling; fejler tavst. |
| **6** | **Rytterprofil** | 3,0 | 2 | **2** | 25 brugere | Håndværket er solidt, men handlinger fejler tavst. |
| **7** | **Finans/info** | 3,0 | 2 | 4 | 32 brugere | Døde deep-links; Help/Rules klemt til 167px på mobil. |
| **8** | **Public entry** | 3,3 | 3 | 2 | 565 mobilbesøg | Stærkest af de svage. Landing-CTA er rettet siden 20/6. |

**Egenart = 4/5 på alle otte.** Det er ikke en høflighed; det er auditens mest konsistente tal.

## De to P0'er

**1. StageStripe klipper Grand Tours på mobil.** `components/race/StageStripe.jsx:20` — `<div className="flex gap-1.5">` uden `overflow-x-auto`, hver knap `flex-1 min-w-0`. Med 21 etaper + overall på 375px får hver knap ~15px, hvoraf 12px er padding. Verificeret i prod: **3 løb har 21 etaper — Tour, Giro, Vuelta.** Spillets mest prestigefyldte løb har en ubrugelig etapevælger på den skærm 55% af spillerne bruger.

**2. Race Hub-brættets tap-mål.** `components/racehub/RaceColumn.jsx:143-145` — fjern-rytter-knappen er ~16-20×24px (`px-1`, tekst-baseret). Rolle-toggle arver kun `py-1.5`. Hver holdudtagelse på den mest brugte flade i spillet kræver at ramme et mål under det halve af 44px-minimum.

*(Founder-waitlistens CTA linker til `/pro` bag `ProtectedRoute` mens `#waitlist`-ankeret sidder på samme side — `FounderSupporterPage.jsx:255` vs `:376`. Agenten kaldte den P0; **trafikken siger P2**: `/founder-supporter` har haft 1 besøg på 30 dage. Ægte fejl, 1-linjes fix, men den haster ikke.)*

## Fem store forbedringer

### 1. "Sådan gik det for dit hold" — luk 22-af-88-hullet
**Problem:** Der findes ingen garanteret vej fra "jeg har et hold" til "sådan gik det".
- `DashboardPage.jsx:980-987` viser **løbets vinder** — en global ticker, ikke dit hold.
- `TeamResultsTab.jsx:60` filtrerer `.gt("points_earned", 0)`. Prod: **kun 7,6% af alle resultater er synlige** (5.919 af 78.213). Din rytter blev nr. 47 i Touren? Usynlig.
- `buildRaceRecap()` **findes allerede** (`lib/raceRecap.js:97`) men kaldes kun fra `RaceDetailPage.jsx:554` — først når spilleren selv har fundet løbet.

**Greb:** Push resultatet i stedet for at vente på at det bliver fundet. Dashboard-kort med dit holds seneste løb + recap-moment, vist til det er set. Fjern points-filteret.
**Effekt:** rammer alle 88. Største enkelthul i tragten. **Omfang: M. Risiko: lav** (recap-logikken findes).

### 2. Mobil-kontrakten — gør 55%-fladen førsteklasses
**Problem:** mobil scorer 1-3 på alle flader, men er flertallet af sessionerne.
- `Layout.jsx:511` — hamburger 24×24px. **Hver side, hver mobilsession.** Bell 20×20px.
- `useDashboardLayout.js:8-16` — alle 9 moduler `defaultVisible: true`; `DashboardPage.jsx:704` bruger `lg:grid-cols-2`, så selv tablets får én lang stak.
- `RaceDetailPage.jsx:811` + `AuctionHistoryPage.jsx:269` — rå `<table>` i `overflow-hidden` **uden** scroll-div: data klippes usynligt.
- `tabsStyles.js:11` har faktisk `overflow-x-auto` — fanerne *er* scrollbare, de mangler bare et visuelt hint.

**Greb:** 44px tap-mål i Layout + RaceColumn · mobil-defaults på dashboard-moduler · migrér de rå tabeller til `<Table>` · scroll-fade på faner · StageStripe-scroll (P0).
**Mønsteret findes allerede internt:** `AuctionsPage.jsx:1499` har en `md:hidden` kortvisning. Kopiér den.
**Effekt:** flertallet af alle sessioner. **Omfang: L (skæres i slices). Risiko: lav-mellem.**

### 3. Feedback-kontrakten — beslutninger med synlig konsekvens
**Problem:** kerne-loopets handlinger er blinde eller tavse.
- **Taktik er live med kalibrerede konsekvenser, men uforklaret:** `backend/lib/raceRoles.js:41` (`WORK_COST_HELPER_GC: -0.03`, kommentaren siger selv *"flytter en top-hjælper 3-13 pladser"*). `StageRoleMatrix.jsx:234-256` viser to bare dropdowns. Ingen tooltip, ingen retning.
- **Tavse fejl:** `useTraining.js:66-86` returnerer eksplicit `{ok:false, error}`; `RiderTrainingTab.jsx:86-91` kalder den uden `await` og læser aldrig svaret. Samme i `RiderScoutingTab.jsx:116-123` (en handling der koster CZ$) og `StrategyPage.jsx:62-83` (`catch { /* ignore */ }`).
- Toast-mønsteret findes allerede i samme filer (`DirectOfferButton`, `TransferListButton`).

**Greb:** honorér `{ok, error}` alle 6 hooks igennem · rolle-forklaring i matrixen · "Gemt"-kvittering pr. række.
**Effekt:** fjerner blindhed i kerne-loopet. **Omfang: M. Risiko: lav.**

### 4. Auktion — gør købet vurderbart
**Problem:** 803 visninger → 16 bud.
- `useStatsToggle.js:3-6` — auktionssiden har `defaultVisible = []`. Kommentaren siger selv at **RidersPage bruger inverteret default**. To flader, samme data, modsatte defaults — og den der koster penge er den der skjuler.
- `market_value` **hentes** på `AuctionsPage.jsx:783` og **vises aldrig** (kun brugt indirekte til løn).
- Potentiale er skjult bag scouting der modner over dage (`useScouting.js:8-11`).

**Greb:** vis `market_value`-delta ved prisen ("12% under vurdering") · slå nøgle-stats til som default · kollaps filterpanelet på mobil (`RiderFilters.jsx:248`).
**Effekt:** direkte på konverteringen. Billigst af de fem. **Omfang: S-M. Risiko: lav** (formulér som estimat, ikke løfte).

### 5. Board-generalprøven — den tidsindstillede
**Problem:** `BoardPage.jsx` er **3.061 linjer, appens største fil**. I baseline-sæsonen viser den to statiske infobokse og 60% tom skærm *(verificeret på screenshot)*. Prod: **`board_plan_snapshots = 0`** — ingen har nogensinde lavet en plan. **Sæson 1 er på løbsdag 16 af 27.** Ved sæsonskifte rammer 43 spillere kæden samtidigt.
- Ingen Playwright-spec kalder `POST /api/board/sign` — kæden er aldrig gennemklikket af nogen.
- `BoardPage.jsx:2643` — 3yr/1yr-wizards er `wizardClosable=false`. Ingen udgang.
- `backend/lib/boardAutoAccept.js:37-44` dokumenterer at en lignende first-contact-fejl **allerede har ramt et rigtigt hold** (Team CSC, auto-valgt 29 min efter signup).

**Greb:** klik selv hele 5yr→3yr→1yr-kæden igennem som nyt hold **før sæsonskiftet** + én Playwright-test der faktisk signerer + exit-mulighed i wizarden.
**Effekt:** forhindrer at sæsonskiftet bliver appens dårligste dag. **Omfang: S. Risiko: høj hvis den springes over.**

> **Bemærk:** BoardPage er ikke død kode. Den er *ufødt*. Havde vi dømt på event-tal alene (7 brugere / 3.061 LOC), var konklusionen blevet "slet den" — hvilket ville have været forkert.

## Benchmark — de reelle gab mod klassens bedste

1. **Resultatet skubbes til spilleren** (FM/PCM: inbox/continue-flow). Vi venter på at det findes. → forbedring 1.
2. **Etapeprofilen er et landskab med historie** (PCM: gradient, kategoriserede stigninger). Vi har `StageProfileSilhouette` — kunne udvides med 1-3 nøglepunkter. *Ærligt: ægte GPS-profiler er urealistisk; vi har kun kategorier.*
3. **Træning er "sæt og glem"** (FM/Hattrick: rør den kun når coach flagger noget). Vi viser en flad tabel der signalerer "rør alle rækker hver dag". `smartDefaultFocus` + `weekPlan` findes — det er et præsentationsvalg, ikke ny mekanik.
4. **Referenceværdi ved prisen** (fantasy-auktioner). → forbedring 4.
5. **"Ryttere der matcher din mangel"** i stedet for et regneark. `groupRidersByType` findes i `lib/trainingRoster.js`.

**Ikke realistisk for os:** 3D-motor, ægte rutekort, synkron nominations-auktion, AI-pressemøder. Tekst+SVG-linjen er den rigtige.

## Hvad auditten ikke kunne afgøre

- **Er træning elsket eller friktion?** `training_focus_set` fyrer **kun ved success** (`useTraining.js:79`), og hvert intensitetsklik tæller. De 67/bruger/uge måler **klik, ikke beslutninger** — og tavse fejl er per definition usynlige i data. Hypotesen "friktion" er **ikke bevist**. Split eventet (ny plan vs. ændring) før vi konkluderer.
- **Bouncer mobil pga. UX eller lavere intent?** Vi ser frafaldet, ikke årsagen.
- **Prod-tilstand vs. mock:** screenshots er taget mod `VITE_PREVIEW_MOCK`, som viser gated tilstande der ikke matcher prod (fx træningens "relanch"-note vises ikke live — `daily_training_enabled='on'`). Layout-fund holder; data-fund er verificeret separat mod prod.
- **`seasons.race_days_total`=60 vs. faktisk 28 game-days (0-27), `race_days_completed`=456.** Ser stale ud. Ikke UI/UX — men værd at kigge på.

## Småfund (lav effort, ikke prioriteret)

- `da/training.json:10` staver **"relanch"** (EN siger korrekt "relaunch"). Vises kun når træning er gated — latent, ikke live.
- `FounderSupporterPage.jsx:255` → `/pro` bør være `#waitlist`. 1-linjes fix.
- Prognosekortets "Hvordan beregnes prognosen?" er et dødt deep-link; RulesPage's 5 "Related Help"-links lander samme sted.
- `WatchlistPage.jsx:124` bruger native `alert()`.
- Survey-banneret bør slås fra eller færdiggøres — det forurener `player_events` med 8% støj.

## Anbefalet rækkefølge

1. **Board-generalprøven** (5) — deadline er ~11 løbsdage væk og kan ikke flyttes.
2. **Resultat-push** (1) — største hul i tragten, logikken findes.
3. **Auktions-vurderbarhed** (4) — billigst, målbar effekt.
4. **Feedback-kontrakten** (3) — fjerner blindhed.
5. **Mobil-kontrakten** (2) — størst, skæres i slices; tag P0'erne (StageStripe, tap-mål) først.
