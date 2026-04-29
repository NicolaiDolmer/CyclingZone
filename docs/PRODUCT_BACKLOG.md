# PRODUCT BACKLOG — Cycling Zone

_Formål: Samlet backlog for bugs, features, integrationer og forbedringer._
_Regel: Kun aktive/top-prioriterede ting spejles til NOW.md. Kun statusændringer spejles til FEATURE_STATUS.md._

---

## 🧭 Execution roadmap

_Dette er den kanoniske udførelsesrækkefølge for de næste større produkt-slices. `NOW.md` skal kun pege på aktiv slice, næste slice og aktuelle blockers._

### Aktuel rækkefølge
1. Live season flow verification med admin xlsx som primær resultater-kilde.
2. Øvrig beta-readiness og post-beta feature candidates.

### Slice UCI-R2 — Løn følger værdi efter UCI-sync ✅ FÆRDIG (2026-04-28)
- Mål: Når UCI-værdier opdateres, skal rytterlønninger genberegnes i samme kontrollerede flow, så værdi og løn ikke driver fra hinanden.
- Manager-værdi: Managerne ser og betaler lønninger, der matcher de nyeste rider values, og økonomi/budget bliver ikke baseret på stale løndata.
- Berørt runtime-path: `.github/workflows/uci_sync.yml` → `scripts/uci_scraper.py` → `backend/scripts/recalculateRiderSalaries.js` → `backend/lib/economyEngine.js`.
- Done proof: GitHub Actions workflowet kører salary recalculation efter UCI scraperen. `recalculateRiderSalaries.js` bruger den eksisterende `updateRiderValues`-regel: `salary = max(1, round((uci_points * 4000 + prize_earnings_bonus) * 0.15))`.
- Regression: `backend/lib/economyEngine.test.js` har `updateRiderValues recalculates salaries after UCI values change`, inkl. bevaret/indregnet `prize_earnings_bonus` og minimum UCI-værdi.
- Lukkede invarianter:
  1. UCI dry-run må ikke skrive lønninger.
  2. Salary update kører efter godkendt UCI-sync i workflowet.
  3. Eksisterende `prize_earnings_bonus` indgår via `updateRiderValues`; UCI scraperen nulstiller ikke bonusfeltet.

### ✅ Afsluttede slices
- Slice 0 — Baseline & blockers ✅
- Slice 1 — Navigation & app-shell ✅
- Slice 2 — Indbakke, notifikationer og topbar ✅
- Slice 3 — Min aktivitet ✅
- Slice 4 — Markedsregler og rytterflader ✅
- Slice 5 — Resultater og rytterrangliste ✅
- Slice 6 — Løbshistorik og løbsarkiv ✅
- Slice 7 — Integrationer og Discord ✅
- Slice 8 — window_pending parking (direkte transfers og swaps) ✅
- Slice 10 — Navigation-omstrukturering + UX-fixes ✅
- Slice 11 — Google Sheets-import af løbsresultater ✅
- Slice 11b — Quick wins (docs-audit, patch notes, HelpPage) ✅
- Slice 12 — Discord + evne-filter bugs ✅
- Slice 12b — Online status + Notifikations-badge ✅
- Slice 13 — FM-style indbakke ✅
- Slice B — Beta-testværktøjer ✅
- Slice 14 Del B — Historisk tracking (rider_uci_history + rider_stat_history) ✅ (2026-04-26)
- Slice R2 — Beta-reset komplet reset-suite ✅ (2026-04-28)
- Slice UCI-R1 — Scraper top 3000 hardening ✅ (2026-04-28). Done proof: `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`
- Slice UCI-R2 — Løn følger værdi efter UCI-sync ✅ (2026-04-28). Done proof: `.github/workflows/uci_sync.yml` + `backend/scripts/recalculateRiderSalaries.js` + `backend/lib/economyEngine.test.js`
- Live season-flow quick fix — season-end preview board/sponsor drift ✅ (2026-04-28). Done proof: `backend/lib/economyEngine.js::buildSeasonEndPreviewRows`, `/api/admin/season-end-preview/:seasonId` bruger helperen, og `backend/lib/economyEngine.test.js` dækker projected satisfaction/modifier/sponsor samt løn/renter.
- Live season-flow quick fix — preview lånerente vs kontantbalance ✅ (2026-04-28). Done proof: `buildSeasonEndPreviewRows` viser lånerente separat, men `balance_after`/nødlånsbehov følger runtime hvor aktive lånerenter lægges på gæld via `processLoanInterest`.
- Rangliste quick fix — opryknings-/nedrykningsindikator følger season-end runtime ✅ (2026-04-29). Done proof: `frontend/src/pages/StandingsPage.jsx` markerer nu oprykning for Division 2-3 og nedrykning for Division 1-2, i samme retning som `backend/lib/economyEngine.js::processDivisionEnd`.
- Slice UI-M1 — Mobile beta-critical flows ✅ (2026-04-28). Done proof: `frontend/src/pages/AuctionsPage.jsx` har mobilkort for auktioner; `RiderStatsPage.jsx`, `RidersPage.jsx`, `TransfersPage.jsx`, `NotificationsPage.jsx`, `AdminPage.jsx` og `RiderFilters.jsx` har responsive action-/filterlayouts; `npm run build` i frontend passerer.
- UI quick fix — Min Profil tilbage i UI ✅ (2026-04-28). Done proof: `/profile` viser igen `ProfilePage`, sidebar linker til Profil & Indstillinger, og egen managerprofil linker til redigering af manager- og holdnavn via `PUT /api/teams/my`.
- Evne-filter/slider investigation status cleanup ✅ (2026-04-28). Done proof: Patch Notes v1.51 dokumenterer rettelsen; `RiderFilters.jsx` viser separate min/max-slidere pr. evne, og `useRiderFilters.js` anvender evne-min/max i Supabase-query og client-filter. Punktet var en forældet backlogrest.
- Slice R1 — Review hardening efter Claude-session ✅ (2026-04-28). Done proof: `raceResultsSheetSync` delegerer til `applyRaceResults`; profilrouting blev auditeret mod `teams.user_id`; `transferExecution` låser accepterede/window_pending handler og undgår tidlig `sold`; `auctionRules` dækker minimumsbud, balance og squad-reservation; `auctionFinalization` håndterer bank/AI/fri auktioner; `RiderStatsPage` eksponerer bank/AI-auktioner i UI; `Layout.pathMatchesNavItem` er segment-aware; relevante backend-tests passerer.
- Discord/webhook transferhistorik ✅ (2026-04-28). Done proof: live DB har `general` og `transfer_history` webhooks; Admin-testknapper virker på begge; bruger har runtime-bekræftet at en rigtig transfer completion lander i Transferhistorik.

### Slice 14 — UCI-punkt + stats-udvikling over tid ✅ FÆRDIG
- Mål: Historisk tracking og visualisering af UCI-points og rytterstats pr. rytter.
- Afhænger af: Del B ✅ færdig.
- Centrale leverancer:
  - Del A ✅ UCI scraper (scripts/uci_scraper.py + GitHub Actions cron, ugentlig) — top-3000 hardening merged, live write/data-repair godkendt 2026-04-28
  - Del B ✅ DB-tabeller rider_uci_history + rider_stat_history; sheetsSync + dynCyclistSync logger historik
  - Del C ✅ Frontend: ny tab "Udvikling" på rytterprofil — tabel + linjegraf over UCI-points og stats over tid
- Done proof Del C: `frontend/src/pages/RiderStatsPage.jsx` henter `rider_uci_history` og `rider_stat_history`, lazy-loader `frontend/src/components/RiderDevelopmentTab.jsx`, og `frontend/package.json` har `recharts`.
- Arkitektur: procyclingstats → Google Sheets (ID: 1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic) → Supabase direkte via REST
- Kører: hver mandag 06:00 UTC, manuelt via GitHub Actions → "Run workflow"
- GitHub Actions secrets: UCI_GOOGLE_SERVICE_ACCOUNT_JSON, UCI_GOOGLE_SHEET_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY

### Slice R1 — Review hardening efter Claude-session ✅ FÆRDIG (2026-04-28)
- Mål: Luk review-fund og markedsregressioner før næste større feature-slice, så runtime-kontrakterne ikke driver.
- Klassifikation: `direkte implementerbar` for P1/P2-fund; enkelte markedsregler kræver testreproduktion, men ikke produktvalg.
- Manager-værdi: færre strandede handler, korrekt økonomi efter resultater, og navigation/profil der ikke sender manageren forkert.
- Berørte runtime-paths: `raceResultsSheetSync`/`raceResultsEngine`, profilrouting, `transferExecution`, auktionsoprettelse/bud/finalisering, Layout route matching.
- Lukkede leverancer:
  1. P1 Google Sheets-resultatimport bruger kanonisk `applyRaceResults` path.
  2. P2 profilrouting blev auditeret mod aktuel bruger/team.
  3. P2 `window_pending` handler låses mod manager-cancel efter begge parter har accepteret og listings markeres ikke som `sold` før faktisk execution.
  4. P3 Sidebar active-state er segment-aware.
  5. Bank/AI/fri ryttere kan auktioneres; bank/AI skjules fra direkte tilbud på rytterprofilen.
  6. Auktioner reserverer/validerer squad capacity via aktive føringer.
  7. Initiator-as-winner på bank/AI/fri rytter gennemføres uden falsk seller-flow.
  8. Bud blokeres hvis maksimal betalingsforpligtelse overstiger disponibel balance.
  9. Auktionsbud kræver 10% over nuværende pris/startpris, rundet op til nærmeste 1.000 CZ$.
- Regression: `node --test backend/lib/auctionRules.test.js backend/lib/auctionFinalization.test.js backend/lib/transferExecution.test.js` passerer 24/24.
- Frontend verification: `npm run build` i `frontend` passerer; `RiderStatsPage` runtime-audit bekræfter bank/AI-auktions-UI.

#### Slice 14 Del C — Done proof

- `frontend/src/pages/RiderStatsPage.jsx` har tabben `{ key: "development", label: "Udvikling" }` efter Historik.
- `loadDevelopmentHistory()` henter `rider_uci_history` med `uci_points, synced_at` og `rider_stat_history` med de 14 stat-felter.
- `frontend/src/components/RiderDevelopmentTab.jsx` viser Recharts-linjegrafer for UCI-point og valgt stat samt en tabel med seneste datapunkter.
- `frontend/package.json` har `recharts` som dependency.

### Senere produktspor
- Slice U1 — UI/mobil/dark-mode forbedringsspor
- Slice 15 — Løbsoprettelse i admin + resultater-import via Google Sheets
- Slice 16 — Discord/webhook P1-bug + transferhistorik til Discord-tråd ✅ lukket 2026-04-28

### Låste defaults for roadmapen
- `Liga` beholdes som navn indtil videre.
- Managers kan ikke sende beskeder til hinanden.
- `Min aktivitet` forbliver en separat side under `Marked`.
- `Indbakke` er kun til systemhændelser, ikke chat.
- Almindelige auktioner kræver minimum `Værdi`.
- `Garanteret salg` er eneste undtagelse og må fortsat bruge 50%.
- `NOW.md` skal holdes kort og ikke kopiere roadmapen.

## 🤝 Samarbejdsmodel

- `docs/PRODUCT_BACKLOG.md` forbliver kanonisk roadmap; `docs/NOW.md` holder kun aktiv slice, næste slice og blockers
- Nye sessions bør bruge `docs/PROMPT_LIBRARY.md#effektiv-session` for at holde scope, kontekst og tokenforbrug nede
- Hver ny opgave starter med en kort feature-brief i chatten: mål, manager-værdi, berørt runtime-path, åbne beslutninger, anbefaling og evt. inputbehov
- Hver opgave klassificeres før execution som `direkte implementerbar`, `investigation` eller `kræver askuserquestion`
- `askuserquestion` bruges især ved IA/naming, flere plausible produktmodeller, nye datakontrakter/integrationer/offentlige visninger og balancing-spor
- Afgrænsede bugfixes og tydelige runtime-reproduktioner håndteres normalt uden afklaringssession, medmindre der opdages drift mellem frontend, API, engine/service og DB
- Ved slutningen af hver slice laves en kort review i chatten: hvad lukkede vi, hvad blokerer stadig, hvilke nærliggende quick wins dukkede op, og hvilken næste session skal låses
- Nye featureforslag må gerne komme løbende, men skal være tydeligt forankret i aktiv slice, runtimeen eller et konkret produktgap

### Planlagte sparringssessioner
- Session 6: økonomiretuning hvis den løftes i prioritet

---

## 🔴 Kritiske bugs / investigations

- ~~P0: Garanteret salg kunne misbruges til at købe AI-ejede ryttere til 50% af værdien~~ ✅ løst
- ~~P1: Bestyrelse vises ikke korrekt på dashboard efter boardEngine-refactor — regression~~ ✅ løst (v1.46)
- ~~P0: UCI scraper workflow kunne køre grønt uden korrekt top 101-3000 coverage og kunne masse-nedskrive ikke-matchede ryttere til 5 UCI-point~~ ✅ løst via Slice UCI-R1
- ~~P1: Lønninger genberegnes ikke automatisk efter UCI value-sync~~ ✅ løst via Slice UCI-R2
- ~~P2: Season-end preview kunne vise sponsor/board-tal fra en lokal forenklet regel i stedet for den delte board/economy-runtime~~ ✅ løst 2026-04-28
- ~~P2: Season-end preview kunne trække aktive lånerenter fra kontantbalance, selvom runtime lægger lånerenten på lånets restgæld~~ ✅ løst 2026-04-28
- ~~P1: Google Sheets-resultatimport bypasser den kanoniske `applyRaceResults` path og kan skabe drift mellem `race_results`, standings, finance transactions og balances~~ ✅ løst; `raceResultsSheetSync` delegerer til `applyRaceResults` og backend-test dækker flowet
- P1: Live result-import kan ikke verificeres end-to-end før `races` er fyldt i live DB; read-only verifikation 2026-04-28 viste 0 races/resultater/standings og `import_log` med 709 rows processed men 0 inserted/updated på grund af unmatched løb.
- ~~P1: Discord/webhook-regression skulle reproduceres via en ægte gennemført transfer/byttehandel og spores gennem completion-pathen til Discord~~ ✅ lukket; Admin-testknapper virker på begge webhooks, og bruger har runtime-bekræftet at en rigtig transfer completion sendes til Transferhistorik
- ~~P2: `/profile` redirect kan vælge forkert team, fordi query ikke filtrerer på aktuel bruger~~ ✅ løst; `/profile` er igen Min Profil, og offentlig managerprofil tilgås via `/managers/:teamId`
- ~~P2: `window_pending` handler kan efterlade transfer listings som `sold`, hvis flush fejler senere~~ ✅ løst; parkerede handler holder listing i `negotiating`, og `sold` sættes først i execution
- ~~P2: Indgåede handler må ikke kunne annulleres efter begge parter har accepteret, heller ikke hvis transfervinduet er lukket~~ ✅ løst; transfer/swap cancel-guards dækket af test
- ~~P2: Evne-filter/slider krævede frisk reproduktion på rigtige data~~ ✅ lukket som forældet statusrest; runtime-koden har separate min/max-slidere og anvender stat-min/max på rigtige query-felter
- ~~P3: Sidebar active-state matcher `/team` på `/teams`~~ ✅ løst; `pathMatchesNavItem` kræver eksakt match eller slash-segment

---

## 🟠 Navigation & informationsarkitektur ✅ FÆRDIG (Slice 10)

_Alle punkter implementeret. Se commit-historik for detaljer._

---

## 🟡 Inbox, notifikationer & presence

- Byg en Football Manager-inspireret indbakke hvor aktiviteter, notifikationer og systemhændelser samles ét sted
- Indbakken skal have stærke filtre så man hurtigt kan finde handler, resultater, board-events, økonomi og øvrige hændelser
- Der skal vises tællere for ulæste indbakke-/notifikationselementer i top-højre
- Notifikationer skal stadig kunne eksistere som en særskilt overbliksflade, men informationsarkitekturen mellem indbakke, notifikationer og aktivitetsfeed skal gøres kanonisk før UI-refactor
- Managers skal ikke kunne sende direkte beskeder til hinanden; indbakken er kun til systemhændelser, notifikationer og aktivitetsopsamling
- Online status skal være tydelig på managerprofilen
- Online status og sidst-set skal være tydelig i lister over managers
- Managernavn bør helst kunne matches med Discord-navn
- ~~Head-to-head skal som default forudvælge brugerens eget hold som det ene hold, men stadig kunne ændres~~ ✅ (v1.47)
- ~~Klik på notifikation bør deep-linke til relevant side~~ ✅ (v1.32)
- Direkte Discord-besked til manager ved events undersøges som særskilt forbedringsspor

---

## 🟢 Marked, ryttere & handler

- ~~`Min aktivitet` ombygget med 6 faner: Kræver handling, Auktioner, Transfers, Lån, Ønskeliste, Historik~~ ✅ (v1.34)
- ~~Rytterfeltet `Point` omdøbt til `Værdi` i UI~~ ✅ (v1.35)
- ~~Ved oprettelse af auktion må startbud ikke være lavere end rytterens Værdi~~ ✅ (v1.35, backend+frontend)
- Ved manager-til-manager-køb skal tilbud stadig kunne være præcis det beløb man ønsker, også under rytterens Værdi _(allerede muligt)_
- ~~Rytterlisten viser ⚡-badge ved aktiv auktion~~ ✅ (v1.35)
- ~~Ryttersiden viser ⚡-badge ved aktiv auktion~~ ✅ (v1.35)
- ~~Notifikation når en ønskeliste-rytter sættes til salg eller auktion~~ ✅ (v1.35)
- ~~Vis tidspunkt for hvornår en rytter blev sat til transfer~~ ✅ (v1.35)
- ~~Vis ryttertype på ryttersiden~~ ✅ (v1.35)
- ~~Vis landenavn/flag i stedet for rå landekoder på øvrige rytterflader~~ ✅ (v1.39)
- ~~Bank-holdet skal ikke modtage direkte transfer-tilbud; bankryttere skal i stedet kunne sendes på auktion som bank/AI/fri ryttere~~ ✅ (2026-04-28)
- ~~Auktioner skal tælle aktive føringer/potentielle wins mod squad max, så man ikke kan føre flere auktioner end der er plads til~~ ✅ (2026-04-28)
- ~~Auktioner uden modbud skal gennemføres korrekt for initiator, også når rytteren kommer fra bank/AI/fri pulje~~ ✅ (2026-04-28)
- ~~Bud skal blokeres, hvis holdet ikke har råd til buddet~~ ✅ (2026-04-28)
- ~~Minimum overbud i auktioner skal være 10% over nuværende pris/startpris, afrundet til nærmeste 1.000 CZ$~~ ✅ (2026-04-28)
- ~~Indgåede direkte transfers og swaps skal låses mod manager-annullering efter gensidig accept, inkl. mens de er parkeret til næste transfervindue~~ ✅ (2026-04-28)
- ~~Ryttersiden må ikke kræve horisontal scroll for at kunne byde/købe; primære markedsactions skal være tilgængelige på mobil og smalle skærme~~ ✅ (2026-04-28)

---

## 🔵 Resultater, historik & ranglister

- ~~Opret en egentlig `Resultater`-hub i produktet~~ ✅ (v1.36)
- ~~Individuel rytterrangliste (etapesejre, GC, point, bjerg, ungdom, inkl. AI-ryttere)~~ ✅ (v1.36) — _Slice 11 forbedrer med Google Sheets-data_
- ~~Gør alle løb browsebare med historik pr. løb~~ ✅ (v1.37)
- ~~Akkumuleret historikvisning/graf pr. løb~~ ✅ (v1.37) — _Slice 11 forbedrer med Google Sheets-data_
- ~~UCI-point udvikling over tid~~ ✅ (v1.61)
- ~~Stats-udvikling over tid~~ ✅ (v1.61)
- ~~Oprykningsindikator under ranglisten~~ ✅ (2026-04-29)
- ~~Rytterhistorik skal vise AI-salg med pris~~ ✅ (v1.54)
- ~~Rytterhistorik skal vise alle transfers~~ ✅ (v1.54)
- ~~Rytterhistorik skal vise manager-handler uden pris~~ ✅ (v1.54, bytter og lån)

---

## 🟣 Data & integrationer

- Google Sheets integration til `dyn_cyclist`-arket
- Afventer eksempel-Google Sheet fra bruger til resultatformat og datakontrakt
- Scraper til UCI-ranglisten
- UCI rangliste sync
- Løbsresultater sync
- Teams PCM mapping
- Cyclists PCM mapping

---

## 🟤 Økonomi & tuning

- ~~Startkapital og sponsorindtægt retunede~~ ✅ — startkapital 800K, sponsor 240K/sæson (v1.44)
- Præmiepenge skal kalibreres — afventer Google Sheets-integration til løbsresultater (Session 6b); præmier og Google Sheets skal designes samlet så de hænger sammen med ranglisten
- Overvej prisfaktor x4000 som særskilt tuning-spor (ikke prioriteret)
- Finans-overblikket skal ses i sammenhæng med navigationsoverblikket (`Økonomi` → `Finanser`)
- Gældsloft skal sættes ned og justeres efter ny økonomisk balance; kræver tuning-session med konkrete divisionstal

## 🧪 Beta reset & admin tooling

- ~~Udvid beta-reset, så alle managerhold kan sættes tilbage til 3. division~~ ✅
- ~~Board-profiler/bestyrelser skal kunne resettes til baseline~~ ✅
- ~~Løbskalenderen skal kunne nulstilles~~ ✅
- ~~Sæsoner skal kunne nulstilles~~ ✅
- ~~Modtagne tilbud, transfer offers, swap offers og lånetilbud skal resettes konsekvent~~ ✅
- ~~Manager XP og level skal resettes~~ ✅
- ~~Achievements og achievement unlocks skal resettes~~ ✅
- ~~Reset-flowet skal give tydelig admin-kvittering og skelne mellem test-reset og destruktiv live-reset~~ ✅

## 🎨 UI, mobil & tilgængelighed

- Beslut om dark mode skal være permanent ny standard eller bruger-toggle; kræver lille IA/design-afklaring før implementering
- ~~Mobiloptimering af centrale flows: rytterliste, rytterside, bud/auktion, indbakke, admin quick actions~~ ✅ (2026-04-28)
- ~~Siden til ændring af managernavn og holdnavn skal findes og bringes tilbage i UI, sandsynligvis som link fra managerprofil eller Overblik~~ ✅ (2026-04-28)
- Rytteroversigt: ret UI-fejl med streger mellem evnerne
- ~~Rytterside: fjern behov for horisontal scroll og gør bud/markedshandlinger tydeligt placeret på mobil~~ ✅ (2026-04-28)
- ~~Frontend-build advarer om stor Vite chunk; planlæg code-splitting med `React.lazy`/route-level dynamic imports før appen vokser yderligere~~ ✅ (2026-04-28)

---

## ⚙️ System, docs & admin

- ~~Gennemgå runtime mod `PatchNotesPage.jsx` og `HelpPage.jsx`/FAQ for manglende dokumentation~~ ✅ (2026-04-26)
- FAQ auto-opdatering
- Patch notes auto-opdatering
- ~~Admin skal kunne slette en bruger~~ ✅ (v1.42)
- ~~Split `backend/lib/boardEngine.js` i mindre moduler~~ ✅ (refactor, 2026-04-25)
- `.claude/settings.local.json` bør ignoreres i `.gitignore`, hvis den kun er lokal Claude-konfiguration
- `docs/Noter til spiller. Features og bugs.txt` bør enten flyttes ind i denne backlog eller committes bevidst som rå produktnote
- `xlsx` dependency har kendte high-severity advisories i npm audit; planlæg isolering/erstatning eller strammere upload-validering

---

## ❓ Åbne produktafklaringer

- Ingen åbne produktafklaringer registreret lige nu fra denne noteopsamling
