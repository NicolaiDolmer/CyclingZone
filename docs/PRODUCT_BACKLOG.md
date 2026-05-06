# PRODUCT BACKLOG — Cycling Zone

_Kanonisk, token-effektiv roadmap. Ingen done-historik her — kun fremadskuende slices og kandidater._
_Færdige detaljer bor i `docs/FEATURE_STATUS.md` og `docs/archive/`._

---

## Launch-blocker status

**P0 launch-blockers ✅ lukket (6/6, runtime-verificeret 2026-05-05).** Open beta er live; færdig status bor i `docs/FEATURE_STATUS.md` og `docs/LAUNCH_ROADMAP.md`. Backloggen her er fremadskuende: vælg næste post-launch eller North Star slice.

---

## Post-launch queue

### Slice DX continuation — Lag 4-7 + 8 (ad-hoc når smerte opstår)

**Lag 0+1+2+3 LIVE** siden 2026-05-06 (`c1a8970`) — agent-loop bevist. Detaljer i `docs/FEATURE_STATUS.md` + `docs/GITHUB_WORKFLOW.md`. Resterende lag tages når deres specifikke smerte opstår:

| Lag | Titel | Trigger | Estimat |
|---|---|---|---|
| 4 | GitHub Projects v2 board | Issue-listen bliver uoverskuelig | ~10 min (Nicolai UI) |
| 5 | Branch protection + auto-merge | Broken main bliver et problem | ~5 min |
| 6 | Pre-commit hooks (husky + lint-staged) | CI fejler tit på trivielt | ~15 min |
| 7 | Dependabot + CodeQL | Før eksterne brugere ud over open beta | ~5 min |
| 8 | MCP write-fix (claude.ai-connector reconnect) | Cosmetic — kun terminal-MCP | ~30 sek (Nicolai) |

---

### Slice 07 — Economy Overhaul (8 sub-slices, drevet af 2026-05-07-audit)

**Vision:** Lukke det bug-mønster der gav 3 økonomi-bugs på samme dag (v2.46/v2.48/v2.49 = TOCTOU + stale fallback + off-by-fee), bygge "perfekt admin historik" (komplet finance audit-log + admin_log + super-dashboard) og levere 4 moderne manager-features (sponsor-variabel, finance-forecast, risk-tier, season financial close-out report).

**Audit-rapport:** [docs/archive/ECONOMY_AUDIT_2026-05-07.md](docs/archive/ECONOMY_AUDIT_2026-05-07.md) — 9 fund (4 P0/3 P1/2 P2) verificeret manuelt mod runtime.

**Slice-master:** [docs/slices/07-economy-overhaul-MASTER.md](docs/slices/07-economy-overhaul-MASTER.md) — 5-linje GUARDRAILS-format pr. sub-slice.

| Sub | Titel | Sev/værdi | Estimat | Blokerer |
|---|---|---|---|---|
| 07a | ✅ Stale fallbacks + 240K/260K-drift (v2.50, 2026-05-07) | P0 bug | S | — |
| 07b | TOCTOU-fixes + idempotency-keys | P0 bug | M (~2 sessioner) | — |
| 07c | Atomic balance updates (Postgres-RPC) | P1 safety | M (~1-2 sessioner) | — |
| 07d | Komplet finance audit-log + admin_log | P1 audit | M (~2 sessioner) | — |
| 07e | Admin økonomi super-dashboard | Feature | M (~2 sessioner) | 07d |
| 07f | Sponsor variabel ift. resultater | Feature | M (~1-2 sessioner) | — |
| 07g | Manager finance-forecast + risk-tier | Feature | M (~2 sessioner) | 07d (delvist) |
| 07h | Season financial close-out report | Feature | S-M (~1 session) | 07d (delvist) |

**Anbefalet rækkefølge:** 07a → 07b → 07d → 07c → 07e → 07f → 07g → 07h. Bug-fixes først, foundation før features. 07f kan parallelliseres da uafhængig.

**Pre-kode-beslutninger låst 2026-05-07:**
1. Sponsor-default = **240K** (DB-default kanonisk; 260K-referencen i pre-v1.76-feature-status er doc-drift).
2. Konkurs-mekanik = **light** — lag 1 forvarsel ved 70% af loft, lag 2 hard-warning ved 90%. Ingen auto-tvangs-salg eller account-freeze i denne iteration. Ved actual breach: status quo (emergency-lån oprettes med soft-log + notif). Hard-enforcement potentielt en fremtidig 07i-slice baseret på live-data.
3. 07f-aktivering = **automatisk fra sæson 2** (sæson 1 i open beta = introsæson, flat 240K + board-modifier 1.0×). Ingen retroaktiv migration.

**Sæson-state-baseline (2026-05-07):** open beta åbnet 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet. Pre-launch dev-docs (`archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md` o.l.) refererer til "sæson 6/7" — det er test-DB-state fra FØR beta-reset; ignorér numrene når du genbruger de docs.

**Erstatter eksisterende backlog-poster:** "S10 — Admin økonomi-panel" (subset af 07e), "Sponsor-tied-to-results" North Star (= 07f), "Economy tuning iteration" (afhængig af 07a-c-data).

---

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

### S8.5 — Løbsresultat-import UX ✅ (leveret 2026-05-04)
**Trigger:** Uge 1–2 efter lancering  
**Leveret (v1.98):** Præmieudbetaling adskilt fra import — admin-kontrolleret, preview før udbetaling, `races.prize_paid_at` tracker status.  
**Leveret (v2.24):** Import-feedback UI — `Forhåndsvis`-knap kalder `POST /api/admin/import-results-sheets` med `dry_run: true` (0 DB writes), viser per-løb tabel: sæson, sheet-navn vs. DB-navn, antal rækker, matched/unmatched ryttere (✓/⚠ med hover-tooltip), matched/unmatched hold, total points. `Bekræft import` (grøn) committer; `Annullér` rydder. Skipped løb vises som separat advarsel. Singular execution path bevaret (samme endpoint, ny `dryRun` param).  
**Status:** Lukket; videre polish kræver ny konkret admin-feedback.

---

### S9 — Løb & Info-sider

**S9a ✅ (v2.22, 2026-05-04):** Løb-hub konsolideret
- `/races` udvidet med tabs: Kalender · Bibliotek · Point & præmier (+ existing Indberét/Godkend)
- Bibliotek = søgbar/filtrerbar liste (sæson/klasse/status/q), client-side filtering, lazy-loaded, klik → `/race-archive/:raceSlug`
- Point & præmier embedder `RacePointsPage` (præmieformlen `points × 1.500 CZ$` + tabeller for 9 klasser var allerede leveret)
- `/race-archive` redirecter til `/races?tab=library`; `RaceArchivePage.jsx` slettet (gamle by-name-grupperinger erstattet af søgbar flad liste)
- Sidebar: kun ét race-link (`Liga → Løb`). `Resultater → Løbsarkiv` fjernet
- Backend: `GET /api/races?season=&class=&q=&status=` (auth)

**S9b ✅ (v2.23, 2026-05-04):** Sæson-snapshot
- `/seasons/:seasonId` deelbar URL — refaktor af `SeasonEndPage` (genbrug, ikke ny side). Kalender + slutstilling pr. division + 4 vinder-kort
- Vindere: 💰 præmie-leader (sum prize_money), 💸 største enkelt-transfer (max ABS finance_transactions), 🔄 mest aktive transfer-marked-hold (count tx), 🚴 stage-king (count rank=1 stage)
- Routing: `/seasons` (auto-vælger aktiv/seneste), `/seasons/:seasonId`, `/season-end` redirecter
- IA: sidebar `Sæson-snapshot`, ResultaterPage hub-card opdateret, Bibliotek-tab Sæson-celle klikbar
- Ingen ny backend — alt via supabase-client

---

### S10 — Admin økonomi-panel ⮕ erstattet af 07e
**Status:** Subsumed af [Slice 07e](docs/slices/07-economy-overhaul-MASTER.md). 07e udvider scope til komplet super-dashboard (transaktion-filtre, drill-down, admin_log-feed, korrelering, bulk-export) ovenpå 07d's audit-data.

---

- **Economy tuning iteration** ⮕ skal vente til 07a-c er deployet (live-data uden de 4 P0-bugs giver bedre tuning-baseline)
- **Season countdown + dashboard UX** — ✅ leveret v1.88
- **Manager cross-season statistik** — fuld historik og vækst over sæsoner fra `board_plan_snapshots` og `season_standings`
- **XLSX security advisory** — evaluer og patch eller erstat `xlsx`-pakken (high-severity advisory)
- **Inbox/activity consolidation v2** — trigger: launch-critical flows er stabile; ingen chat mellem managers

---

### Onboarding v2 — multi-slice retention-feature ✅

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
- `FinanceFirstVisitHint` på `/finance` ved første besøg — 2x2-grid forklarer sponsor (240K base × bestyrelses-modifier, link til `/board`; 260K-værdien i original v2.16-shipping var doc-drift, korrigeret v2.50), salary (10% af uci_points × 4000), gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), og kort vs. langt lån. CTA "Vis mig rundt" starter tour og dismisser hint.
- Tour-trin på `/finance` (3 steps: balance-grid → gældsloft-indikator → transaktionshistorik). Mountet via `OnboardingTour pageKey="finance"`. Trigger via localStorage `cz-finance-hint-shown` — ingen backend-step (finance er passiv explainer, ikke aktiv milestone som "afgiv første bud").

**Slice 4 ✅ (v2.19, 2026-05-04):** Empty-state-tour + completion-celebration (closure-slice)
- `RidersEmptyState`/`AuctionsFirstBidHint`/`BoardEmptyState` får sekundær "💡 Vis mig rundt"-knap (matcher `FinanceFirstVisitHint`'s pattern) — manager der lander direkte på siden via menuen får tour-tilbud uanset om de gik via Dashboard "Vis mig hvordan".
- Ny `OnboardingCompletionCard.jsx` på Dashboard vises engang når `completed_count === total_count` — 🎉 "Du er klar" + 3 quick-links (Deadline Day, Bestyrelse, Hjælp & regler). Dismiss persisteres i localStorage `cz-dashboard-onboarding-completion-dismissed`.
- `DashboardPage.loadAll` fetch-condition justeret: progress hentes hvis hvilken som helst af progress/completion-kort kan vises — så eksisterende managers der allerede har dismisset progress-kortet stadig ser completion-kortet første gang efter v2.19-deploy.

**Status:** Onboarding v2 multi-slice komplet — alle fem sub-slices (1a + 1b + 2 + 3 + 4) leveret. Closure-slice lukker post-onboarding-cliff'et.

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

### Sponsor-tied-to-results ⮕ erstattet af 07f
**Status:** Subsumed af [Slice 07f](docs/slices/07-economy-overhaul-MASTER.md). Vision uændret (base 200K + variabel 0–150K), men nu med eksplicit sub-slice-brief i master-roadmap.

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

## Developer tooling / harness

### Claude harness safety — multi-PC install
**Trigger:** Næste gang en ny PC eller fresh Claude install skal have beskyttelsen mod proces-kill (lært 2026-05-04: en session dræbte sit eget process-træ via `Stop-Process` på claude.exe-children).
**Status:** Live på primær PC — `~/.claude/scripts/protect-claude-process.sh` + `~/.claude/settings.json` med `permissions.deny` (5 rules) + `PreToolUse` hook på `Bash|PowerShell`. `~/.claude/` er IKKE OneDrive-synced → reglen er per-PC, kræver gentaget install pr. maskine.
**Scope:**
- `scripts/install-claude-hooks.ps1` i cycling-manager repoet — idempotent (safe at køre flere gange)
- Kopierer `protect-claude-process.sh` til `~/.claude/scripts/` (chmod +x)
- Merger `permissions.deny` + `PreToolUse` hook ind i eksisterende `~/.claude/settings.json` UDEN at overskrive andre keys (kritisk: bevar SessionStart `cycling-manager-cleanup.sh`, plugins, theme, autoUpdatesChannel)
- Pipe-tester scriptet (forventet: 9/9 positive blokeret, 10/10 negative passer)
- Kort sektion i `docs/CONVENTIONS.md` om kør-procedure: `pwsh -File scripts/install-claude-hooks.ps1`
**Estimat:** S (~30 min)
**Why:** I dag kræver ny PC manuel prompt-paste. Install-script reducerer risiko for at glemme beskyttelsen på 3./4. PC.
**Risiko:** Lav — ingen runtime-impact på spillet, ingen DB, ingen brugerrettet ændring (patch-notes-reglen gælder ikke).

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
