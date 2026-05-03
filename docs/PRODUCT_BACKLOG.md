# PRODUCT BACKLOG — Cycling Zone

_Kanonisk, token-effektiv roadmap. Ingen done-historik her — kun fremadskuende slices og kandidater._
_Færdige detaljer bor i `docs/FEATURE_STATUS.md` og `docs/archive/`._

---

## Pre-launch roadmap

**S6 ✅ lukket (v1.78)** — onboarding MVP, navn-wizard, velkomstmodal.

### S7 — Launch readiness (aktiv)
**Status:** Gate 1+2+3+4+6+7 ✅ · Gate 5 🔒 7/5  
**Næste session:** Gate #5 (salary/dyn sync) → start ny sæson → open beta live.  
Se `docs/NOW.md` for detaljeret tjekliste.

---

## Post-launch queue

### Deadline Day — 4-session feature (parallel med S8+)

**Vision:** 24-timers oplevelse med 3 faser (anticipation → pressure → chaos) der aktiveres automatisk når transfervinduet nærmer sig lukketid. Live feed, holdoversigt og eksklusive mekanikker.

**S1 ✅ (2026-05-02):** Fundament live
- `DeadlineDayBanner` — fase-aware countdown i Layout (amber/rød/pulserende)
- Admin toggle: auto/tændt/slukket + `closes_at` input på transfervindue
- DB: `transfer_windows.closes_at`, `auction_timing_config.deadline_day_override`
- Backend: `GET /api/deadline-day/status`, `PUT /api/admin/deadline-day/override`, `PUT /api/admin/transfer-window/closes-at`
- **Test nu:** AdminPage → sæt "Tændt" for at se banneret

**S2 ✅ (2026-05-02):** Ticker + Panic Board live
- `GET /api/deadline-day/ticker` + `DeadlineDayTicker` — horisontal scrollende feed (10s poll, fixed bottom)
- `GET /api/deadline-day/squads` + `DeadlineDayBoard` (`/deadline-day`) — grøn/gul/rød squad-status (30s poll)

**S3 ✅ (2026-05-02):** Flash Auction + hastebudsignal live
- Flash Auktion: 30-min varighed under Deadline Day — guard i `POST /api/auctions`, `is_flash` kolonne i DB
- Hastebudsignal: 🚨-badge på modtagne og sendte tilbud når sælgerhold er ≤ divisionsminimum

**S4 ✅ (2026-05-02):** Notifikationer + Final Whistle-rapport live
- Planlagte advarsler T-24h/T-2h/T-30min via cron (5-min interval) → `notifyTeamOwner` med dedupe på (window_id, step-titel)
- Final Whistle: atomic claim på `transfer_windows.final_whistle_sent_at` → største handel + mest aktive manager + panikhandler → Discord embed til default webhook
- Pure functions i `backend/lib/deadlineDayReport.js`, orkestrering i `backend/cron.js`

---

### Dark mode — 3-fase udrulning

**Vision:** Token-baseret tema-system så lyst og mørkt UI vedligeholdes parallelt uden duplikering. Standard = "Følg system".

**S1 ✅ (2026-05-02):** Foundation + chrome + top-5 sider
- CSS-tokens via `:root` + `[data-theme="dark"]` i `frontend/src/index.css`
- Tailwind-tokens (`cz-body`, `cz-card`, `cz-1`, `cz-accent`, `cz-success`/`danger`/`warning`/`info`, `cz-sidebar-*`)
- `frontend/src/lib/theme.jsx` — ThemeProvider med `system | light | dark`, system-preference watcher, localStorage persistence
- Pre-paint script i `index.html` (undgår FOUC)
- Tema-vælger i `ProfilePage` under "Udseende"
- Sidebaren forbliver mørk i begge temaer (option A)
- Tokeniseret: `Layout`, `App` splash, `LoginPage`, `ResetPasswordPage`, `ProfilePage`, `Dashboard`, `Riders`, `Auctions`, `Team`, `Finance`

**S2 ✅ (2026-05-03):** Resterende sider — `Transfers`, `Board`, `Standings`, `Notifications`, `Watchlist`, `Hall of Fame`, `Race*`, `Admin`, `RiderStats`, `Manager*`, `Help`, `PatchNotes` m.fl. + 7 komponenter. Alle tokeniseret, build grøn (v2.06).

**S3 ✅ (v2.08 + v2.10, 2026-05-03):** Lint-guard mod nye hardkodede farver — ESLint `no-restricted-syntax` blokerer `(slate|gray)-(50…950)` (v2.08) og `(text|border|ring|divide|outline)-(white|black)/\d+` opacity-classes (v2.10). `bg-(white|black)/N` bevidst tilladt for modal-scrims; `bg-white`/`text-white` (uden opacity) bevidst tilladt fordi de bruges legitimt på `cz-accent`/`cz-sidebar`/Discord-brand-knapper. Se FEATURE_STATUS "Dark mode S3 lint-guard" for fulde detaljer.

---

### S8 — Discord DM ✅ (2026-05-03, v2.05)
**Status:** Kode + docs leveret. Manager-rename droppet fra titlen — allerede løst i v1.74 via `PUT /api/teams/my`.

**Leveret:**
- `discordNotifier.sendDM(discordId, payload)` + `notifyDiscordDM({teamId, type, ...})` (raw Discord REST, ingen ny dep)
- 4 person-rettede notifications wires automatisk til DM: `notifyOutbid`, `notifyAuctionWon`, `notifyTransferOffer`, `notifyTransferResponse`. Bredt-rettede (`notifyNewAuction`, `notifyTransferCompleted`, `notifySwapCompleted`, `notifySeasonEvent`) forbliver kanal-only.
- `users.discord_dm_enabled BOOLEAN DEFAULT true` — opt-out flag (migration `2026-05-03-discord-dm-opt-out.sql`)
- Backend routes: `GET /api/me/discord-status`, `POST /api/me/discord-dm-test`, `PATCH /api/me/discord-dm-enabled`
- ProfilePage: status-badge (forbundet/slået fra/bot ikke konfigureret/mangler ID), opt-out toggle, "Send test-DM"-knap
- DashboardPage: dismissable nudge-card til managers uden `discord_id` (localStorage `cz-dashboard-discord-nudge-dismissed`)

**Manuel sti for at aktivere live:**
1. Discord developer portal → ny application + bot, kopiér token
2. Tilføj bot til CZ-serveren (scope: `bot`, ingen privileged intents)
3. Sæt `DISCORD_BOT_TOKEN` i **Railway** env (ikke Vercel — backend kører på Railway)
4. Hver manager skal én gang dele server med botten + slå "Allow DMs from server members" til
5. Kør migration `database/2026-05-03-discord-dm-opt-out.sql` mod Supabase

---

### S8.5 — Løbsresultat-import UX (delvist leveret)
**Trigger:** Uge 1–2 efter lancering  
**Leveret (v1.98):** Præmieudbetaling adskilt fra import — admin-kontrolleret, preview før udbetaling, `races.prize_paid_at` tracker status.  
**Resterende scope:** Import-feedback UI — ingen synlig matchrapport ved filupload (hvilke ryttere matchede eksakt vs. fuzzy, hvilke løb blev skippet). Overvej preview-tilstand til `POST /api/admin/import-results-sheets` der returnerer diff uden at committe.  
**Næste skridt:** Kan starte direkte — kravene er nu klare fra session 2026-05-02.

---

### S9 — Løb & Info-sider
**Trigger:** Uge 2–3 efter lancering  
**Scope:**
- `/race-library` — alle løb i DB, søgbar/filtrerbar (navn, klasse, sæson, status)  
  Backend: udvid `GET /api/races?season=&class=&q=`
- `/seasons/:seasonId` — kalender for afsluttet sæson (ikke kun aktiv)  
  Frontend: ny `SeasonCalendarPage.jsx`
- Point-oversigt — `race_points` tabel synlig for managers; ny `GET /api/race-points` public route
- Præmie-oversigt — forklarer `points × 15.000 CZ$`-formlen med eksempler

**Kritiske filer:** `backend/routes/api.js` · `frontend/src/pages/RaceArchivePage.jsx` · `frontend/src/App.jsx`

---

### S10 — Admin økonomi-panel
**Trigger:** Uge 3–4 efter lancering  
**Scope:**
- `GET /api/admin/teams-economy-summary` — per-hold: balance, sponsor-base, budget_modifier, gæld
- `GET /api/admin/prize-summary?seasonId=` — præmiepenge per hold per sæson
- Ny "Økonomi"-tab i `AdminPage.jsx`

**Kritiske filer:** `backend/routes/api.js` · `frontend/src/pages/AdminPage.jsx`

---

- **Economy tuning iteration** — baseret på live data fra første beta-sæson; salary rate, sponsor, debt ceilings
- **Season countdown + dashboard UX** — ✅ leveret v1.88
- **Manager cross-season statistik** — fuld historik og vækst over sæsoner fra `board_plan_snapshots` og `season_standings`
- **XLSX security advisory** — evaluer og patch eller erstat `xlsx`-pakken (high-severity advisory)
- **Inbox/activity consolidation v2** — trigger: launch-critical flows er stabile; ingen chat mellem managers

---

### Onboarding v2 — multi-slice retention-feature (aktiv)

**Vision:** Dashboard-kort med fremskridt-tracking + opt-in tour pr. side. Alle managers (også eksisterende 17) ser kun trin der ikke allerede er gennemført — eksisterende med fuld profil ser intet. Progressiv disclosure af bestyrelses- og økonomi-kompleksitet; guided squad-builder.

**Slice 1a ✅ (v2.12, 2026-05-03):** Dashboard kom-i-gang-kort
- Backend: `GET /api/me/onboarding-progress` returnerer 4 step-counts (`team_named`, `first_rider_owned`, `first_bid_placed`, `board_plan_set`) som parallelle queries mod `teams`/`riders`/`auction_bids`/`board_profiles`
- Frontend: `OnboardingProgressCard.jsx` på `DashboardPage` med progress-bar, step-liste, CTA-link på næste trin, dismiss via `cz-dashboard-onboarding-dismissed`. Auto-skjul ved `completed_count === total_count`.

**Slice 1b ✅ (v2.13, 2026-05-03):** Guided squad-builder UX
- `RidersEmptyState` på `/riders` for managers uden ryttere (`first_rider_owned === false`) — forklarer filtre, viser balance vs. division-minimum, CTA filtrerer på pris ≤ balance
- `AuctionsFirstBidHint` på `/auctions` for managers uden bud (`first_bid_placed === false` + localStorage `cz-first-bid-shown !== "1"`) — forklarer +10%-overbud + 10-min auto-forlængelse
- `OnboardingTour` (generisk peg-pil-overlay) + `lib/onboardingTour.js` (state-helpers) startet fra "Vis mig hvordan"-knap på `OnboardingProgressCard`. Tour-trin på `/riders` (3 steps: filtre → liste → ønskeliste) og `/auctions` (2 steps: bud-input → countdown). State i localStorage `cz-onboarding-tour-step`.

**Slice 2 ✅ (v2.15, 2026-05-03):** Bestyrelse-explainer
- `BoardEmptyState` på `/board` for managers uden plan (`hasAnyPlan === false`) — forklarer bestyrelsens rolle (mål → vurdering → sponsor-modifier), 1yr/3yr/5yr-strukturen som tre parallelle planer med egne mål og tidshorisont, tilfredsheds-tærskler (70%+/40-69%/<40% → modifier), KPI-kategorier (resultater, økonomi, identitet, rangering). CTA åbner wizardens `setup_next_plan_type`.
- Auto-wizard-skip ved første gangs setup: `BoardPage.loadAll` åbner kun wizard automatisk ved sekventiel fortsættelse (`hasAnyPlan === true`). Første gangs managers ser empty-state først → starter wizard via CTA.
- Tour-trin på `/board` (3 steps: 1yr/3yr/5yr-grid → sponsor-modifier-tabel → KPI-liste). `TOUR_PAGE_BY_STEP` udvidet med `board_plan_set: "board"` så "Vis mig hvordan"-knappen virker for fjerde trin.

**Slice 3 ✅ (v2.16, 2026-05-03):** Økonomi-explainer
- `FinanceFirstVisitHint` på `/finance` ved første besøg — 2x2-grid forklarer sponsor (260K base × bestyrelses-modifier, link til `/board`), salary (10% af uci_points × 4000), gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), og kort vs. langt lån. CTA "Vis mig rundt" starter tour og dismisser hint.
- Tour-trin på `/finance` (3 steps: balance-grid → gældsloft-indikator → transaktionshistorik). Mountet via `OnboardingTour pageKey="finance"`. Trigger via localStorage `cz-finance-hint-shown` — ingen backend-step (finance er passiv explainer, ikke aktiv milestone som "afgiv første bud").

**Status:** Onboarding v2 multi-slice komplet — alle fire sub-slices (1a + 1b + 2 + 3) leveret 2026-05-03.

---

## Cykling-fokuserede North Star kandidater (post-launch)

### Race Day Live-ticker
**Vision:** Når `races.status = active`, vis fixed-bottom ticker (samme pattern som `DeadlineDayTicker`) der streamer race-results-events ind løbende. "🏁 Stage 7: Pogačar vinder", "💰 Movistar tjener 45.000 CZ$ i præmier", "🟢 GC-skifte: Vingegaard rykker til 1.".  
**Datakilde:** Eksisterende `race_results` + `finance_transactions` (type=prize). Ingen ny data nødvendig.  
**Manager-værdi:** Race-dage bliver events. Samme texture som Deadline Day, men anvendt på den oprindelige cykling-spændings-akse.  
**Estimeret slog:** 2 sessioner.

### Rytter-arketype som first-class citizen
**Vision:** Hver rytter får én af 7 arketyper (Sprinter, GC, Klatrer, Klassiker, Tidskører, Allrounder, Domestique) computed fra stats. Vises som badge på rytterkort, filterbar på `RidersPage`.  
**Datakilde:** Eksisterende `stat_*`-felter. Pure function, ingen ny DB.  
**Manager-værdi:** Cykling-fans elsker arketype-debat. Nye managers får entry-point til stat-systemet uden at skulle læse 14 stat-felter. Filtre på arketype = lettere truppestrategi.  
**Estimeret slog:** 1 session.

### Sponsor-tied-to-results
**Vision:** Sponsor er i dag flat 260K + board-modifier. Iteration: base 200K + variabel 0–150K baseret på sidste sæsons points/division-rank, så cykling-virkeligheden ("synlighed = penge") afspejles.  
**Datakilde:** `season_standings.total_points` + `division`. Ingen ny data.  
**Manager-værdi:** Comeback-mekanik (lille hold der overpresterer får boost), belønner sportsligt fokus, skaber økonomisk drama omkring sæsonslut.  
**Trigger:** Skal vente til 1–2 sæsoners live beta-data — del af "Economy tuning iteration".

---

## Data Depth Candidates

- **Teams PCM mapping** — trigger: økonomi og season-flow er stabile
- **Cyclists PCM mapping** — trigger: sammen med eller efter team mapping
- **3-sæsoners glidende rangliste** — trigger: kræver mindst 3 sammenlignelige sæsoner med data

---

## Engagement + Polish Candidates

- **Discord-name matching** — trigger: managerprofil/presence poleres
- **Richer notification filters** — trigger: efter inbox IA er låst
- **Secret achievement presentation audit** — trigger: hvis runtime viser achievements før unlock

---

## Locked Product Defaults

- `Liga` beholdes som navn indtil videre
- Managers kan ikke sende beskeder til hinanden
- `Min aktivitet` forbliver separat side under `Marked`
- `Indbakke` er kun til systemhændelser og notifikationer
- Garanteret salg: eneste undtagelse til minimum-startpris-reglen (50% af Værdi)
- Første bud på AI-/bank-/fri rytter-auktion = initiatorens implicitte vinderposition; gælder også legacy-auktioner
- Økonomi: **stram men fair** — ikke let beta-start, ikke hardcore sim
- Konkrete økonomi-tal vælges baseret på live data + simulation

---

## Archived Done Proof

- `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`
- `docs/archive/RECENT_DONE_PROOF_2026-04-29.md`
- `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`
- `docs/archive/SEASON_6_REPAIR_VERIFICATION_2026-04-29.md`
- Runtime feature truth: `docs/FEATURE_STATUS.md`
