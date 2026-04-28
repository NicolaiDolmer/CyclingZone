# PRODUCT BACKLOG — Cycling Zone

_Formål: Samlet backlog for bugs, features, integrationer og forbedringer._
_Regel: Kun aktive/top-prioriterede ting spejles til NOW.md. Kun statusændringer spejles til FEATURE_STATUS.md._

---

## 🧭 Execution roadmap

_Dette er den kanoniske udførelsesrækkefølge for de næste større produkt-slices. `NOW.md` skal kun pege på aktiv slice, næste slice og aktuelle blockers._

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

### Slice 8 — Bug-rydning og quick wins
- Mål: Ryd P1-bugs og hurtige wins inden en ny tung feature-slice påbegyndes.
- Afhænger af: Slice 7 afsluttet.
- Centrale leverancer (prioriteret):
  1. ~~Hemmelige achievements synlige i UI → fix~~ ✅ løst
  2. Event-sekvens dokumentation (`docs/EVENT_SEQUENCE.md`)
  3. Live beta-verifikation af season flow (start → result approval → end)
  4. ~~Landekode/flag på øvrige rytterflader~~ ✅ løst
  5. Discord/webhook-regression → reproducér og afgræns
- Holdt ude: boardEngine split, økonomi retuning, PCM mappings
- Done when: P1-bugs løst, docs færdige, season flow verificeret. (flag-visning: ✅)

### Slice 10 — Navigation-omstrukturering + bundlede UX-fixes
- Mål: Omstrukturer sidebar efter aftalte domænegrupper; bundle billige UX-fixes i samme session.
- Afhænger af: Slice 9 afsluttet.
- Centrale leverancer (prioriteret):
  1. Sidebar: Overblik (Dashboard default + klik), Bestyrelsen, Mit hold, Økonomi (Finanser undernav), Aktivitetsfeed, Notifikationer
  2. Sidebar: Marked (Min aktivitet, Ønskeliste — omdøb Talentspejder)
  3. Sidebar: Ny gruppe `Resultater` (Ranglisten, Sæsonresultater, Hall of Fame)
  4. Sidebar: Sæson Preview → under Liga; Logo-klik → Dashboard; Min Profil → fold ind i managerprofil
  5. UX-fix: Head-to-head auto-suggest eget hold
  6. UX-fix: Vis igangværende auktion på rytterliste + rytterside
  7. UX-fix: "Point" → "Værdi" omdøbning i UI
  8. UX-fix: Fjern ubrugte evne-farver i rytteroversigten
  9. UX-fix: Løn synlig i rytterlisten med filter og sortering; løn tydeligt vist på ryttersiden

### Slice 11 — Resultater-hub + Rytterrangliste ⛔ BLOKERET
- Mål: Forbedre rytterrangliste og løbsarkiv med rigtige data fra Google Sheets.
- Blokeret af: bruger skal sende Google Sheet med løbsresultater (format, kolonner) + liste over alle løb.
- Centrale leverancer:
  1. Rytterrangliste-forbedringer baseret på Google Sheets-datakontrakt
  2. Løbsarkiv-forbedringer: historik pr. løb på tværs af sæsoner, akkumuleret graf fra rigtige data

### Slice B — Beta-testværktøjer (NÆSTE — ikke blokeret)
- Mål: Giv admin mulighed for at nulstille game-state til test, så auktionsmarkedet og sæsonflowet kan genafprøves fra bunden.
- Afhænger af: Intet.
- Centrale leverancer:
  1. `POST /api/admin/beta/cancel-market` — annuller alle åbne auktioner/transfers/swaps/loan_agreements
  2. `POST /api/admin/beta/reset-rosters` — returner alle manager-ejede ryttere til `ai_team_id`; riders uden ai_team_id → `team_id = NULL`
  3. `POST /api/admin/beta/reset-balances` — sæt balance = 800.000 på alle ikke-AI manager-holds; optional flag til at rydde finance_transactions
  4. `POST /api/admin/beta/full-reset` — kæder ovenstående tre i rækkefølge; returnerer samlet kvittering
  5. AdminPage.jsx — ny sektion "Beta-testværktøjer" med ⚠-advarsel, confirm-dialogs og kvittering
- Invarianter: board_profiles røres ikke; AI-holds balance røres ikke; kun manager-holds (`is_ai=false`, `is_bank=false`, `is_frozen=false`)
- Nøglefiler: `backend/routes/api.js`, `frontend/src/pages/AdminPage.jsx`

### Slice 12 — Bugs (Discord + evne-filter)
- Mål: Luk udskudte live-bugs fra Slice 8.
- Afhænger af: Live debug-session.
- Centrale leverancer:
  1. Discord/webhook-regression: reproducér og afgræns; transferhistorik til Discord-tråd
  2. Evne-filter/slider: reproducér og afgræns

### Slice 12b — Online status + Notifikations-badge
- Mål: Gør manager-tilstedeværelse synlig; vis ulæste notifikationer i topbar.
- Afhænger af: Slice B afsluttet.
- Centrale leverancer:
  1. Online status + sidst-set på ManagerProfilePage og managerlister
  2. Ulæste-tæller badge i topbar (øverste højre hjørne)

### Slice 14 — UCI-punkt + stats-udvikling over tid
- Mål: Historisk tracking og visualisering af UCI-points og rytterstats pr. rytter.
- Afhænger af: Del B ✅ færdig.
- Centrale leverancer:
  - Del A ✅ UCI scraper (scripts/uci_scraper.py + GitHub Actions cron, ugentlig) — afventer bekræftet testkørsel
  - Del B ✅ DB-tabeller rider_uci_history + rider_stat_history; sheetsSync + dynCyclistSync logger historik
  - Del C — Frontend: ny tab "Udvikling" på rytterprofil — tabel + linjegraf over UCI-points og stats over tid (spec nedenfor)
- Arkitektur: procyclingstats → Google Sheets (ID: 1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic) → Supabase direkte via REST
- Kører: hver mandag 06:00 UTC, manuelt via GitHub Actions → "Run workflow"
- GitHub Actions secrets: UCI_GOOGLE_SERVICE_ACCOUNT_JSON, UCI_GOOGLE_SHEET_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY

### Slice R1 — Review hardening efter Claude-session (AKUT)
- Mål: Luk review-fund og markedsregressioner før næste større feature-slice, så runtime-kontrakterne ikke driver.
- Klassifikation: `direkte implementerbar` for P1/P2-fund; enkelte markedsregler kræver testreproduktion, men ikke produktvalg.
- Manager-værdi: færre strandede handler, korrekt økonomi efter resultater, og navigation/profil der ikke sender manageren forkert.
- Berørte runtime-paths: `raceResultsSheetSync`/`raceResultsEngine`, `/profile` redirect, `transferExecution`, auktionsoprettelse/bud/finalisering, Layout route matching.
- Centrale leverancer (prioriteret):
  1. P1: Google Sheets-resultatimport skal bruge den kanoniske race-result path (`applyRaceResults`) eller en delt helper, så `race_results`, standings, finance transactions og balances opdateres ens på tværs af importflows.
  2. P2: `/profile` redirect skal filtrere på aktuel bruger/team og ikke vælge første synlige team-række.
  3. P2: `window_pending` handler må ikke kunne efterlade listings som `sold`, hvis flush senere fejler; indgåede handler må heller ikke kunne annulleres af manager efter begge parter har accepteret.
  4. P3: Sidebar active-state skal være segment-aware, så `/team` ikke matcher `/teams`.
  5. Bank-holdet skal ikke modtage direkte tilbud; bankryttere skal i stedet kunne auktioneres automatisk/efter samme model som ryttere uden noteret hold.
  6. Auktioner skal reservere/validere truppens ledige pladser, så en manager ikke kan føre flere auktioner end der er plads til på holdet.
  7. En auktion uden modbud skal stadig kunne gennemføres korrekt for initiator/køber; spillet må ikke behandle initiator som sælger af en bank/AI/fri rytter.
  8. Bud må ikke kunne placeres, hvis maksimal betalingsforpligtelse overstiger holdets aktuelle disponible balance.
  9. Auktionsbud skal minimum være 10% over nuværende bud/startpris, afrundet til nærmeste 1.000 CZ$; højere frie bud er stadig tilladt.
- Regression tests:
  - Sheets-import smoke: finance rows + standings + race status efter import.
  - Transfer parking: success, failed flush og manager-withdraw efter accepteret handel.
  - Auction capacity: aktive føringer/pending wins tæller mod squad max.
  - Auction initiator-as-winner: bank/AI/fri rytter skifter korrekt uden falsk seller-flow.
- Done when: backend tests + frontend build passerer, og mindst én regressionstest dækker hver kritisk runtime-invariant.

#### Slice 14 Del C — Præcis implementeringsspec

**Fil der ændres:** `frontend/src/pages/RiderStatsPage.jsx`

**Nyt npm-pakke der skal installeres:** `recharts` (ingen chart-bibliotek i projektet endnu)
```
cd frontend && npm install recharts
```

**Ny tab tilføjes til tab-rækken:**
```jsx
{ key: "udvikling", label: "Udvikling" }
```
Placeres efter `{ key: "history", label: "Historik" }`.

**Data der hentes (tilføj til loadRider eller separat useEffect):**
```js
// UCI-point historik
supabase.from("rider_uci_history")
  .select("uci_points, synced_at")
  .eq("rider_id", id)
  .order("synced_at", { ascending: true })
  .limit(104)  // maks 2 år

// Stats-historik
supabase.from("rider_stat_history")
  .select("synced_at, stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl, stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr")
  .eq("rider_id", id)
  .order("synced_at", { ascending: true })
  .limit(52)
```

**Tab-indhold "Udvikling":**
1. Sektion "UCI-point over tid": Recharts `LineChart` med `synced_at` på X-aksen (formateret som dato), `uci_points` på Y. Farve: amber (#e8c547). Tooltip viser præcis dato + points.
2. Sektion "Stats-udvikling": Dropdown/select til at vælge stat (de 14 fra STATS-arrayet øverst i filen). LineChart viser valgt stat over tid. Farve: blue-400.
3. Hvis ingen data: vis "Ingen historik endnu — data akkumuleres fra næste ugentlige sync".

**Styling:** Matcher eksisterende `bg-white border border-slate-200 rounded-xl p-5`-pattern fra de andre tabs.

### Næste planlagte slices
- Slice R2 — Beta-reset komplet reset-suite
- Slice U1 — UI/mobil/dark-mode forbedringsspor
- Slice 15 — Løbsoprettelse i admin + resultater-import via Google Sheets (udskudt til 2026-04-28)
- Slice 16 — Discord/webhook P1-bug + transferhistorik til Discord-tråd (udskudt til 2026-04-28)

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
- P1: Google Sheets-resultatimport bypasser den kanoniske `applyRaceResults` path og kan skabe drift mellem `race_results`, standings, finance transactions og balances
- P1: Discord/webhook-regression skal reproduceres og spores gennem nuværende notifier-paths og live webhook-konfiguration; samme spor bør også afklare hvordan transferhistorik kan spejles til en dedikeret Discord-tråd via webhook
- P2: `/profile` redirect kan vælge forkert team, fordi query ikke filtrerer på aktuel bruger
- P2: `window_pending` handler kan efterlade transfer listings som `sold`, hvis flush fejler senere
- P2: Indgåede handler må ikke kunne annulleres efter begge parter har accepteret, heller ikke hvis transfervinduet er lukket
- P2: Evne-filter/slider kræver frisk reproduktion på rigtige data; nuværende kodegennemgang fandt ingen entydig root cause
- P3: Sidebar active-state matcher `/team` på `/teams`

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
- Bank-holdet skal ikke modtage direkte transfer-tilbud; bankryttere skal i stedet kunne sendes på auktion som bank/AI/fri ryttere
- Auktioner skal tælle aktive føringer/potentielle wins mod squad max, så man ikke kan føre flere auktioner end der er plads til
- Auktioner uden modbud skal gennemføres korrekt for initiator, også når rytteren kommer fra bank/AI/fri pulje
- Bud skal blokeres, hvis holdet ikke har råd til buddet
- Minimum overbud i auktioner skal være 10% over nuværende pris/startpris, afrundet til nærmeste 1.000 CZ$
- Indgåede direkte transfers og swaps skal låses mod manager-annullering efter gensidig accept, inkl. mens de er parkeret til næste transfervindue
- Ryttersiden må ikke kræve horisontal scroll for at kunne byde/købe; primære markedsactions skal være tilgængelige på mobil og smalle skærme

---

## 🔵 Resultater, historik & ranglister

- ~~Opret en egentlig `Resultater`-hub i produktet~~ ✅ (v1.36)
- ~~Individuel rytterrangliste (etapesejre, GC, point, bjerg, ungdom, inkl. AI-ryttere)~~ ✅ (v1.36) — _Slice 11 forbedrer med Google Sheets-data_
- ~~Gør alle løb browsebare med historik pr. løb~~ ✅ (v1.37)
- ~~Akkumuleret historikvisning/graf pr. løb~~ ✅ (v1.37) — _Slice 11 forbedrer med Google Sheets-data_
- UCI-point udvikling over tid
- Stats-udvikling over tid
- Oprykningsindikator under ranglisten
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

- Udvid beta-reset, så alle managerhold kan sættes tilbage til 3. division
- Board-profiler/bestyrelser skal kunne resettes til baseline
- Løbskalenderen skal kunne nulstilles
- Sæsoner skal kunne nulstilles
- Modtagne tilbud, transfer offers, swap offers og lånetilbud skal resettes konsekvent
- Manager XP og level skal resettes
- Achievements og achievement unlocks skal resettes
- Reset-flowet skal give tydelig admin-kvittering og skelne mellem test-reset og destruktiv live-reset

## 🎨 UI, mobil & tilgængelighed

- Beslut om dark mode skal være permanent ny standard eller bruger-toggle; kræver lille IA/design-afklaring før implementering
- Mobiloptimering af centrale flows: rytterliste, rytterside, bud/auktion, indbakke, admin quick actions
- Siden til ændring af managernavn og holdnavn skal findes og bringes tilbage i UI, sandsynligvis som link fra managerprofil eller Overblik
- Rytteroversigt: ret UI-fejl med streger mellem evnerne
- Rytterside: fjern behov for horisontal scroll og gør bud/markedshandlinger sticky eller tydeligt placeret på mobil
- Frontend-build advarer om stor Vite chunk; planlæg code-splitting med `React.lazy`/route-level dynamic imports før appen vokser yderligere

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
