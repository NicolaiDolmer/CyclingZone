# FEATURE STATUS

_Udled fra kodebasen. Opdatér ved større ændringer._

---

## ✅ Implementeret & live

### Auth & Brugere
- Login / logout (Supabase Auth)
- Glemt password + reset-flow (`/reset-password`)
- Admin- og managerroller
- Login-streak tracking
- Manager XP + niveauer (level = floor(xp/100)+1, max 50)
- Manager-profil med historik
- `ProfilePage.jsx` — `/profile` route viser konto-/holdindstillinger; hold- og managernavn redigeres via `PUT /api/teams/my` (v1.74)

### Hold & Ryttere
- Holdoversigt og holdprofil-sider
- Nationalitetsflag: alle 8.699 ryttere har ISO 2-bogstavs kode fra PCM `fkIDregion` → 138 lande, vises som emoji-flag overalt (v1.81); `import_riders.py` sætter kode automatisk ved fremtidige imports
- **Potentiale** (v1.83): `potentiale DECIMAL(3,1)` på riders-tabellen, synkroniseret fra PCM `dyn_cyclist.value_f_potentiel`. Vises med guldstjerner (< 30 år) / sølvstjerner (≥ 30 år), halvstjerner understøttet. Tilgængeligt på alle rytteroversigter med filter (min/max 1–6) og sortering. 8.416/8.699 ryttere har data (283 uden — formentlig ryttere uden PCM-match).
- Rytterbibliotek med søgning + filtre (nation, UCI, U25, ledig, evne-min/max, osv.) + løn-kolonne og lønfilter (v1.47)
- Rytterværdi i marked/visninger er dynamisk: `market_value = max(5, uci_points) × 4000 + prize_earnings_bonus`, hvor bonus er gennemsnit af seneste op til 3 afsluttede sæsoners præmiepenge (v1.77)
- Rytterdetalje-side (stats, historik, watchlist-tæller, ryttertype-badge, ⚡-badge ved aktiv auktion)
- Rytter-sammenligning (side-by-side)
- Watchlist + notifikation når ønskeliste-rytter sættes til salg eller auktion (v1.35)
- Stat-grid med farvekodning (statBg.js)

### Auktioner
- Opret auktion med starttid + vindueslogik
- Bud-placering med auto-forlængelse (10 min ved bud nær slut)
- Garanteret salg (startpris = 50% af markedsværdi) — kun egne ryttere; exploit lukket (v1.46)
- Minimum startpris håndhævet (backend + frontend): startbud ≥ rytterens Værdi; garanteret salg er eneste undtagelse
- Minimum overbud håndhæves som 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$
- Auktionsbudfeltet forudfyldes med laveste gyldige bud, og UI viser konkrete backend-fejl ved for lavt bud, saldo eller reserveret squad-plads (v1.77)
- Auktionslisten viser sælger som AI eller managerhold, så ikke-ejede auktioner ikke ligner managersalg (v1.77)
- Aktive auktionsføringer reserverer både disponibel balance og squad-plads ved nye bud
- Auktionsfinalisering via cron (60s) — delt path for cron/admin/API, korrekt ejer-check og squad-limit
- Bank/AI/fri rytter-auktioner kan startes fra rytterprofilen; startprisen tæller som initiatorens første førende bud, og finalizer har fallback for aktive legacy-auktioner hvor første bud ikke blev skrevet til `current_bidder_id`
- Auktionshistorik-side
- Discord-notifikationer (auktioner, overbud, transfers, sæsonevents)

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Delt backend confirm-path (ejerskab, saldo, squad-limit + oprydning ved gennemførelse)
- Parkerede `window_pending` transfers/swaps kan ikke manager-annulleres efter begge parter har accepteret
- Bank/AI-ryttere skjules fra direkte tilbud på rytterprofilen; bankryttere blokeres også server-side fra direkte transfer/bytte
- Tilbagetræk tilbud (withdraw, inkl. modtilbud)
- Sendte og modtagne afsluttede tilbud kan arkiveres per manager-side uden at slette den anden parts historik; dashboardet viser nu konkrete tilbud der kræver handling (v1.77)
- Notifikationer til sælger ved nyt tilbud

### Lån
- Manager-oprettede lån (short/long)
- Accept / afvis lånetilbud
- Squad-limit check ved lejeforslag og låneaktivering
- Lejegebyr ved aktivering + ved dækket sæsonstart
- Låneoversigt (aktive + egne)
- Låneafdrag
- Auto-nødlån ved manglende løn

### Økonomi & Finans
- **Alle beløb skaleret ×4000 (v1.43)** — rytterværdi = uci_points × 4000 CZ$
- **Økonomi retuneret (v1.46 → v1.76)** — startkapital 800K, sponsor 240K/sæson (v1.46) → 260K (v1.76); SALARY_RATE 0.10, gældsloft D1/D2/D3 = 1200K/900K/600K
- **Economy baseline simulation (2026-04-29)** — read-only live baseline + lokale scenarier er dokumenteret i `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`, med gentagelig kommando `backend/scripts/economyBaselineSimulation.js`
- Sponsorindtægt ved sæsonstart (med board-modifier)
- Lønudbetaling ved sæsonslut
- Renteberegning på negativ saldo (10%/sæson)
- Resultatpoint (`points_earned`) og præmiepenge (`prize_money = points × 1.500 CZ$`) er adskilt ved løbsimport — `points_earned` fra `race_points[race_class]`, `prize_money` krediteres holdbalancen som type=`prize` (v1.75)
- Divisionsbonus ved sæsonslut: D1 300K/200K/100K/50K · D2 150K/100K/50K/25K · D3 75K/50K/25K, type=`bonus`, idempotent (v1.75)
- Finance-transaktionslog + Finance-side
- Balance-justering (admin)
- Finance transaction type-kontrakt er afstemt i schema/migration/test med runtime for lån, lånerenter, nødlån og admin-justeringer
- Live DB migration for finance-/notification type-kontrakt er applied 2026-04-29.
- Season-end nødlån sender nu `season_id` med til finance-loggen, så `emergency_loan` rows kan verificeres per sæson fremover.
- Service-visible season 6 repair verifier findes som `backend/scripts/verifySeasonEndRepair.js` / `npm run season:end:verify-repair -- --markdown`.
- UCI salary recalculation: GitHub Actions kører `backend/scripts/recalculateRiderSalaries.js` efter UCI scraperen, så `riders.salary` følger opdaterede `uci_points` med eksisterende `prize_earnings_bonus`

### Sæson & Løb
- Sæsonoversigt med race-kalender
- Løbsresultater-import (xlsx) og approve via delt backend result-path
- Google Sheets-resultatimport matcher løbsnavne robust på accenter, tegnsætning og kendte kalenderaliaser
- Google Sheets-resultatimport er idempotent for prize finance: gamle prize-transaktioner for samme løb reverseres før re-import
- Adminens `race_points`-editor bruger moderne herre-UCI-klasser og seedede UCI-point for klassement, klassikere, etaper, pointtrøje, bjergtrøje og førertrøje
- Pointtavle (season_standings) inkl. rank_in_division, recalkuleres fra race_results
- Opryknings/nedrykningslogik (top/bund 2 per division)
- Holdranglisten viser opryknings-/nedrykningszoner efter samme season-end-regel: Division 2-3 kan rykke op, Division 1-2 kan rykke ned
- Sæsonpreview-side + Races-side
- Løbsarkiv (`/race-archive`) og løbshistorik (`/race-archive/:raceSlug`)
- Season-end preview bruger economy engine til løn, lånerente som gæld, projected board satisfaction og næste sponsorudbetaling, så preview matcher season-end/season-start runtime
- Season-end runtime loader teams/riders/board_profiles separat og fejler hårdt på Supabase load/write errors, så finance/board side effects ikke silently skippes før season completion.

### Bestyrelse (Board)
- Tre parallelle planer (1yr/3yr/5yr) kører simultant per hold med egne mål og tilfredshed → budget_modifier
- Kumulativ mål-tracking, mid-plan review, plan snapshots, board wizard
- Delt boardEngine for proposal/sign/renew/season-end
- Gradvis, vægtet evaluering med 2-3 sæsoners hukommelse (resultater, økonomi, identitet, rangering)
- Board-outlook på dashboard og Board-siden (kategori-scores, drivere, signalnoter)
- Én board request pr. sæson (DB-enforced); approved/partial/rejected/tradeoff
- Mål skaleret efter division, standings og holdspecialisering
- Afledt holdprofil (specialisering, U25, national kerne + landenavn/flag, stjerneprofil)
- **S7-B verificeret (2026-05-02):** `budget_modifier` opdateres korrekt ved season-end i `processTeamSeasonEnd()` for både afsluttede og kørende planer. Live DB: 0 inkonsistente rækker. Alle 10 economyEngine-tests grønne.
- Nationale identitetsmål i balancerede planer; focus-switch lander som gradvis tradeoff

### Admin
- Import af ryttere (Python-script `scripts/import_riders.py`) — se CONVENTIONS.md for navnematch-algoritme
- Import af løbsresultater (xlsx upload)
- UCI points sync (Google Sheets CSV — autoritativ kilde med 3000 ryttere)
- Override rider (team/stats)
- Sæsonopcioner (create/start/end/result import) via kanoniske admin-routes
- Genberegning af standings fra gemte race_results
- Løbsoprettelse og season-end preview endpoint
- Admin repair endpoint til season-end finance/board side effects uden at køre season status eller oprykning/nedrykning igen; deployed 2026-04-29 og kan resume missing side effects uden at duplikere eksisterende salary/snapshots.
- Beta-reset komplet suite: marked, trupper, balancer, divisioner, bestyrelse, løbskalender, sæsoner, XP/level og achievement unlocks via delt reset-service

**Rider import — kendte fejlmønstre der nu håndteres (v1.91–1.93):**
- PCM sammensatte efternavne (Cort Nielsen, Halland Johannessen, Søjberg Pedersen) → token-set match
- UCI mellemnavne (Honoré Mikkel **Frølich**, Sosa Iván **Ramiro**) → subset match
- Polske/nordiske precomposed tegn (Ł, Ø, Æ) → normalize_name erstatningsregler
- Alternativ translitteration (Tesfazion/Tesfatsion) → PCM_UCI_OVERRIDE
- Forældet top-1000 CSV → erstattet med 3000-rytterliste fra Google Sheet
- 1.138 ryttere masseopdateret til korrekte uci_points + salary (v1.93, 2026-05-02)

### UI / Misc
- Responsivt layout med navigation (Layout.jsx)
- Segment-aware sidebar active-state: `/team` matcher ikke `/teams`
- Sidebar og egen managerprofil linker til `/profile` → `ProfilePage` (indstillinger)
- Mobile beta-critical flows: rytterliste, rytterside-market actions, auktioner/bud, transfers, indbakke og admin beta quick actions er optimeret til smalle skærme uden primær horisontal scroll
- Frontend route-level code-splitting: sider lazy-loades via `React.lazy`/`Suspense`, så initial bundle er reduceret og Vite-build kører uden large chunk warning
- Rytterprofilens `Udvikling`-tab viser UCI-point og stats over tid fra `rider_uci_history`/`rider_stat_history`
- Notifikationssystem (in-app + badge, deduplicering ved cron/retries)
- Notification type-kontrakt er afstemt i schema/migration/test med runtime for transfer-interesse, watchlist og lånebeskeder
- Achievement-sync fra live historiktabeller (bid, transfer, watchlist, hold, board)
- Aktivitets-feed · Head-to-head sammenligning · Hall of Fame · Patch notes · Hjælpeside · Confetti modal

### Discord & Integrationer
- Discord webhooks: admin kan tilføje webhooks med navn, URL og type (general / transfer_history)
- Gennemførte transfers og byttehandler sendes til `transfer_history` webhook; runtime-bekræftet med rigtig transfer completion 2026-04-28
- `users.discord_id` gemmes og bruges udelukkende til DM-lookup (ingen @mention i kanal-embeds — fjernet i v2.07)
- **Discord DM (v2.05, 2026-05-03; privatliv-fix v2.07, 2026-05-03):** `discordNotifier.sendDM(discordId, payload)` + `notifyDiscordDM({teamId,...})` via raw Discord REST (`POST /users/@me/channels` → `POST /channels/:id/messages`); kræver `DISCORD_BOT_TOKEN` env (Railway). De 4 person-rettede events (outbid, auction_won, transfer_offer, transfer_accepted/rejected/counter) er **DM-only** — postes ikke i nogen kanal. Bredt-rettede (new_auction, transfer_completed, swap_completed, season_event) er kanal-only.
- **Opt-out:** `users.discord_dm_enabled BOOLEAN DEFAULT true` — slå fra via ProfilePage; person-rettet info bliver da kun vist via in-app notifikationer (ingen kanal-fallback efter v2.07)
- **ProfilePage:** Discord-status badge (forbundet/slået fra/bot ikke konfigureret/mangler ID), opt-out toggle, "Send test-DM"-knap kalder `POST /api/me/discord-dm-test`
- **DashboardPage:** dismissable nudge-card til managers uden discord_id (localStorage `cz-dashboard-discord-nudge-dismissed`)
- Backend routes: `GET /api/me/discord-status`, `POST /api/me/discord-dm-test`, `PATCH /api/me/discord-dm-enabled`
- dyn_cyclist sync: PCM-stats (14 stat-felter + højde, vægt, popularitet + `potentiale`) fra Google Sheets (match på pcm_id) — logger stats-historik i `rider_stat_history` ved hver sync; v1.83 tilføjede `value_f_potentiel → potentiale` (bevaret som 0,5-trin float)
- UCI-points sync fra Google Sheets — logger nu historik i `rider_uci_history` ved hver sync
- UCI scraper: GitHub Actions cron henter top 3000 fra ProCyclingStats, skriver Google Sheets, synkroniserer Supabase, genberegner rytterlønninger og har safety-gates for coverage og mass minimum downgrade; live data-repair godkendt 2026-04-28

### Deadline Day (S1+S2, 2026-05-02)
- `DeadlineDayBanner` — vises øverst i indholdsområdet på alle sider; 3 faser: anticipation (amber), pressure (rød), chaos (pulserende rød)
- Fase beregnes fra `transfer_windows.closes_at`: chaos ≤30min, pressure ≤2t, anticipation ≤24t
- Admin override på `auction_timing_config.deadline_day_override`: `auto` / `on` (test) / `off`
- `GET /api/deadline-day/status` — returnerer `{ active, phase, closes_at, seconds_remaining, override }`
- `PUT /api/admin/deadline-day/override` — skifter override-tilstand
- `PUT /api/admin/transfer-window/closes-at` — opdaterer lukketidspunkt på seneste vindue
- AdminPage: lukketid datetime-input + override-toggle integreret i Transfervindue-sektionen
- `DeadlineDayTicker` — horisontal scrollende live feed (fixed bottom) med seneste bud/salg/transfers; poller 10s, vises kun når active=true
- `GET /api/deadline-day/ticker` — merger bids + completed auctions + accepted transfers, seneste 20 events inden for 24t
- `DeadlineDayBoard` (`/deadline-day`) — Panic Board: alle holds truppestørrelse vs. divisions-minimum, grøn/gul/rød, 30s poll; vises kun under Deadline Day; nav-link permanent under Marked (v2.09)
- `GET /api/deadline-day/squads` — returnerer alle ikke-bank holds squad-count vs. MARKET_SQUAD_LIMITS, med status ok/warning/critical

### Deadline Day S3 (2026-05-02)
- Flash Auktion: `is_flash boolean` i `auctions`-tabel, guard i `POST /api/auctions` (tjekker DD aktiv via override + closes_at), `calculated_end = now+30min`
- Flash UI: checkbox i `AuctionButton` (RiderStatsPage) — vises kun når `ddActive=true`; rød knap + `⚡ Flash`-badge i AuctionsPage
- Hastebudsignal: `GET /api/transfers/my-offers` beregner `seller_squad_critical` (sælger ≤ divisionsminimum) via rider-count + division-opslag
- 🚨-badge: ReceivedOfferCard ("Under minimum"), SentOfferCard ("Sælger under min.") i TransfersPage

### Dark mode S1 (v2.04, 2026-05-02)
- Foundation: `:root` (lyst) + `[data-theme="dark"]` i `frontend/src/index.css` med samme CSS-variabel-navne; Tailwind eksponerer dem som `cz-body`, `cz-card`, `cz-1/2/3`, `cz-accent`, `cz-success/danger/warning/info`, `cz-sidebar-*` m.fl.
- `frontend/src/lib/theme.jsx` — `ThemeProvider` + `useTheme` hook med `system | light | dark`, localStorage (`cz-theme`), system-preference watcher, `data-theme` på `<html>`
- Pre-paint script i `index.html` (læser localStorage før hydration → undgår FOUC)
- Tema-vælger i `ProfilePage` under "Udseende" (3 valg: Følg system / Lyst / Mørkt)
- Sidebaren forbliver mørk (`#1a1f38`) i begge temaer (option A — Vercel/Linear-stil)
- Tokeniseret: `Layout`, `App` splash, `LoginPage`, `ResetPasswordPage`, `ProfilePage`, `Dashboard`, `Riders`, `Auctions`, `Team`, `Finance` — øvrige sider ligner status quo (lyst tema-look) i begge modes indtil S2

### Dark mode S2 (v2.06, 2026-05-03)
- Alle resterende sider tokeniseret (27 pages): TransfersPage, BoardPage, StandingsPage, NotificationsPage, WatchlistPage, HallOfFamePage, RacesPage, RaceArchivePage, RaceHistoryPage, RacePointsPage, AdminPage, RiderStatsPage, ManagerProfilePage, RiderComparePage, ActivityPage, ActivityFeedPage, SeasonEndPage, SeasonPreviewPage, HelpPage, PatchNotesPage, HeadToHeadPage, ResultaterPage, RiderRankingsPage, DeadlineDayBoard, TeamProfilePage, TeamsPage, AuctionHistoryPage
- Alle komponenter tokeniseret (7): ConfettiModal, DeadlineDayBanner, DeadlineDayTicker, OnboardingModal, RiderDevelopmentTab (inkl. Recharts stroke/fill props), RiderFilters, SetupWizardModal
- Kendte intentionelle farver bevaret: PotentialeStars (guld/sølv stjerner), statBg.js (statistik-grading), ConfettiModal farvearray, chart-inline colors (#e8c547/#60a5fa/#a78bfa i Recharts), Discord brand (#5865F2)
- Build: `✓ vite built in 9.30s` — ingen fejl

### Dark mode S3 lint-guard (v2.08 → udvidet i v2.10, 2026-05-03)
- ESLint `no-restricted-syntax`-regel i `frontend/eslint.config.js` fejler på `(slate|gray)-(50|100|...|950)` i string-literals OG template-elementer (catches både `className="text-slate-400"` og `` `${x ? 'bg-gray-100' : 'bg-cz-card'}` `` patterns)
- **v2.10:** udvidet med `(text|border|ring|divide|outline)-(white|black)/\d+` — fanger Panic Board-hullet (text-white/N + border-white/N) der bypassede v2.08-guarden. `bg-(white|black)/N` bevidst tilladt fordi modal-scrims (ConfettiModal, OnboardingModal, SetupWizardModal, Layout, TeamPage) idiomatisk bruger `bg-black/60-70`
- Scope: `**/*.{js,jsx}` med dedikeret config-block. **v2.11:** alle øvrige react-rules løftet fra `.js`-only til `.{js,jsx}` efter sanitering af 71 pre-eks. fejl
- Migration-misser fra S2 ryddet: `text-slate-300/400` i `frontend/src/components/PotentialeStars.jsx:15+35`, `text-slate-400` i `frontend/src/lib/statBg.js:4` → alle `text-cz-3`. v2.10: `text-white/20` i `DeadlineDayBanner.jsx:92` (TEST-label) → `text-cz-3`
- `bg-white`/`text-white` (uden opacity) IKKE blokeret — bruges legitimt på `cz-accent`/`cz-sidebar`/Discord-brand-knapper
- Verificeret v2.10: sanity-test med `text-white/40` literal + ` `text-white/30 mt-2` ` template literal fejler begge med besked om cz-tokens; `bg-black/60` passerer; `npm run lint` grøn på baseline (0 errors)

### JSX react-rules sanitering (v2.11, 2026-05-03)
- React-regelsæt løftet fra `.js`-only til `.{js,jsx}` i `frontend/eslint.config.js`. Sanering af 71 pre-eks. fejl fordelt på 7 regler:
  - **28 react-hooks/immutability** — `useEffect(() => loadX())` blev kaldt før `async function loadX()` deklareret. Fix: useEffect-blokke flyttet ned under fn-deklarationer på 22 sider (ActivityFeedPage, ActivityPage, AuctionHistoryPage, AuctionsPage, DashboardPage, HallOfFamePage, HeadToHeadPage, Layout, ManagerProfilePage, RaceArchivePage, RaceHistoryPage, RacePointsPage, ResultaterPage, RiderRankingsPage, RiderStatsPage, RidersPage, SeasonPreviewPage, StandingsPage, TeamProfilePage, TeamsPage, WatchlistPage). Layouts `fetchOnlineCount` flyttet op før useEffects der bruger den
  - **15 react/no-unescaped-entities** — `"text"` og `app'en` JSX-tekst escapet til `&quot;`/`&apos;` i AdminPage, DashboardPage, ProfilePage, RaceHistoryPage, TransfersPage
  - **8 no-empty** — `catch {}`-blokke i DeadlineDayBanner, DeadlineDayTicker, theme.jsx, AuctionsPage, RiderStatsPage fået kort begrundelse-kommentar
  - **6 react-hooks/static-components** — `NavItem` + `SidebarContent` flyttet ud af `Layout` (med props-passing); `StatCompare` flyttet ud af `HeadToHeadPage`
  - **2 react-hooks/purity** — `Math.random()` for ConfettiModal-partikel-radius låst ved mount-time (state-felt `radius`); RiderStats `Date.now()` til age-beregning beholdt med targeted `eslint-disable-next-line` + begrundelse (acceptabel for stabil rytter-alder-visning)
  - **1 no-useless-assignment** — ubrugt initial-value til `nextNegotiationOptions` i BoardPage fjernet
- **react-hooks/set-state-in-effect** disabled globalt med begrundelse i config: regelen er en React-Compiler-rule i react-hooks v7 der antager React 19-mønstre. Vi kører React 18.3.1 hvor data-load ved mount + setState i async fn fra useEffect er det idiomatiske pattern (data-fetching, polling, countdown-timers, derived state). Genoverveje hvis vi opgraderer til React 19 + compiler
- Verificeret: `npm run lint` returnerer 0 errors (42 acceptable warnings: exhaustive-deps + no-unused-vars). Build grøn (`vite built in 4.92s`)

### Onboarding v2 — Slice 1a Dashboard progress-card (v2.12, 2026-05-03)
- **Backend:** `GET /api/me/onboarding-progress` (`backend/routes/api.js` lige efter `/me/discord-dm-enabled`) returnerer 4 step-status fra parallelle DB-counts:
  - `team_named` ← `teams.manager_name IS NOT NULL`
  - `first_rider_owned` ← count(`riders.team_id = mit`) > 0
  - `first_bid_placed` ← count(`auction_bids.team_id = mit`) > 0
  - `board_plan_set` ← count(`board_profiles.team_id = mit`) > 0
- **Frontend:** `frontend/src/components/OnboardingProgressCard.jsx` rendres på `DashboardPage` mellem Squad warning og Discord nudge. Progress-bar + step-liste med ✓/▸/○-ikoner, line-through på færdige trin, CTA-link på næste trin (Profil/Marked/Auktioner/Bestyrelse)
- **Dismiss:** localStorage `cz-dashboard-onboarding-dismissed` (matcher Discord-nudge-pattern). Auto-skjul ved `completed_count === total_count` (uafhængigt af dismiss)
- **Eksisterende managers:** Card vises retroaktivt for de 17 — men auto-skjules hvis alle 4 trin allerede er gennemført. Ingen blokerende wizard.
- Verificeret: lint 0 errors, build grøn (`vite built in 5.53s`). UI-smoke pending.

### Onboarding v2 — Slice 3 Økonomi-explainer (v2.16+v2.17 fix, 2026-05-03)
- **v2.17 timing-fix:** Hint og tour sagde fejlagtigt at sponsor "udbetales månedligt" og løn "trækkes løbende". Runtime udbetaler sponsor som ENGANGS-payout ved sæsonstart (`backend/lib/economyEngine.js:162-172`, type=`"sponsor"`, beskrivelse "Sponsorindtægt — Sæson start") og trækker løn som ENGANGS-debit ved sæsonafslutning (`backend/lib/economyEngine.js:499-506`, type=`"salary"`, beskrivelse "Sæsonlønninger — N ryttere"). Tekster opdateret i `FinanceFirstVisitHint.jsx` og `FINANCE_TOUR_STEPS` i `FinancePage.jsx`. Drift fanget via doc-drift sweep mod HelpPage `q: "Hvornår udbetales sponsorpenge?"` (linje 528-529).
- **Ingen backend-ændring:** Finance er en explainer (passive læring), ikke en aktiv milestone som "afgiv første bud" — derfor ingen ny step i `GET /api/me/onboarding-progress`. Trigger via localStorage `cz-finance-hint-shown` matcher Slice 1b's `cz-first-bid-shown`-mønster.
- **FinancePage hint:** `frontend/src/components/FinanceFirstVisitHint.jsx` rendres øverst på `/finance` ved første besøg (`localStorage.cz-finance-hint-shown !== "1"`). Forklarer fire pengestrømme i 2x2-grid: (1) Sponsor 260K base × bestyrelses-modifier (link til `/board`), (2) Salary 10% af rytterværdien (uci_points × 4000), (3) Gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), (4) Lån kort vs. langt. CTA "💡 Vis mig rundt" starter tour og dismisser hint i samme handling. Dismiss × eller "Spring over" → permanent skjult.
- **Tour på /finance:** `OnboardingTour pageKey="finance"` mountet på FinancePage med 3 trin der peger på hovedsektionerne (`[data-tour='finance-balance']` → balance/gæld/præmie-grid, `finance-debt-ceiling` → Total gæld-kortet med loft-indikator, `finance-tx-history` → transaktionshistorikken). Ingen step→tour mapping i `TOUR_PAGE_BY_STEP` (touren startes kun fra hint-kortet, ikke fra `OnboardingProgressCard`, da der ikke er en finance-step).
- **Verificeret tal mod runtime:** `backend/lib/teamProfileEngine.js:6` (sponsor_income: 260000), `backend/lib/economyEngine.js:44` (SALARY_RATE = 0.10), `database/2026-04-30-economy-light-tune-v176.sql:5-7` (debt_ceiling 1.2M/900K/600K). Match med memory `feedback_economy_scaling` og NOW.md kritiske invarianter.
- Verificeret: lint 0 errors, build grøn. UI-smoke pending.

### Onboarding v2 — Slice 2 Bestyrelse-explainer (v2.15, 2026-05-03)
- **Genbruger eksisterende endpoint:** `GET /api/me/onboarding-progress` returnerer allerede `board_plan_set` (count på `board_profiles.team_id = mit`) — ingen ny route.
- **BoardPage empty-state:** `frontend/src/components/BoardEmptyState.jsx` rendres øverst på `/board` når der ikke findes nogen plan endnu (`hasAnyPlan === false` + `setupNextPlanType` sat). Forklarer kort bestyrelsens rolle (mål → vurdering → sponsor-modifier), 1yr/3yr/5yr-strukturen (tre parallelle planer med egne mål og tidshorisont), tilfredsheds-tærskler (70%+ → ×>1.0, 40-69% → ×1.0, <40% → ×<1.0) og KPI-kategorier (resultater, økonomi, identitet, rangering). CTA "Forhandl din første plan" åbner wizardens `setup_next_plan_type` (typisk 5yr).
- **Auto-wizard-skip ved første gangs setup:** `loadAll` i `BoardPage.jsx` åbner kun wizardens setup-flow automatisk når mindst én plan allerede findes (sekventiel fortsættelse). For brand-new managers (ingen planer) vises empty-state først, så de får kontekst inden forhandlingen — og kan starte wizard via CTA.
- **Tour på /board:** `OnboardingTour pageKey="board"` mountet på BoardPage med 3 trin der peger på empty-state-sektionerne (`[data-tour='board-plans']` → 1yr/3yr/5yr-grid, `board-satisfaction` → modifier-tabellen, `board-kpis` → KPI-listen). Tour fyrer kun når `board_plan_set === false`, så empty-state altid er rendret når targets søges.
- **Step→tour mapping udvidet:** `TOUR_PAGE_BY_STEP` i `frontend/src/lib/onboardingTour.js` har nu `board_plan_set: "board"` ved siden af de eksisterende `first_rider_owned`/`first_bid_placed`. "💡 Vis mig hvordan"-knappen på `OnboardingProgressCard` virker nu også på fjerde trin og ruter til `/board` med tour startet.
- Verificeret: lint 0 errors (41 pre-eks. warnings), build grøn (`vite built in 8.05s`). UI-smoke pending.

### Onboarding v2 — Slice 1b Guided squad-builder (v2.13, 2026-05-03)
- **Genbruger eksisterende endpoint:** Begge sider læser `GET /api/me/onboarding-progress` for `first_rider_owned`/`first_bid_placed`-flags — ingen nye routes.
- **RidersPage empty-state:** `frontend/src/components/RidersEmptyState.jsx` rendres øverst på `/riders` når `first_rider_owned === false`. Viser balance vs. division-minimum (D1=20, D2=14, D3=8) + 3 filter-tips (Værdi/Stat/U25-Fri agent). CTA "Find din første rytter" sætter `max_uci`-filter til managerens balance og indsnævrer listen automatisk.
- **AuctionsPage first-bid hint:** `frontend/src/components/AuctionsFirstBidHint.jsx` rendres på `/auctions` når `first_bid_placed === false` og localStorage `cz-first-bid-shown !== "1"`. Forklarer +10%-overbud + 10-min auto-forlængelse. Dismiss × → permanent skjult.
- **Opt-in tour:** `frontend/src/components/OnboardingTour.jsx` (generisk peg-pil-overlay) + `frontend/src/lib/onboardingTour.js` (state-helpers). Knappen "💡 Vis mig hvordan" på `OnboardingProgressCard` sætter localStorage `cz-onboarding-tour-step` (JSON `{page, step}`) og navigerer til næste-trin-siden. Mounten på `RidersPage` (3 steps: filtre → liste → ønskeliste) og `AuctionsPage` (2 steps: bud-input → countdown). Tooltip har "Næste"/"Spring over"-kontrol, scroll-til-element ved trin-skift, smart placement (under/over target), highlight-ring + CSS-trekant-pil. Fallback: hvis target ikke findes (fx 0 aktive auktioner), vises kun "Afslut tour"-knap nederst-højre.
- **Step→tour mapping:** `TOUR_PAGE_BY_STEP = { first_rider_owned: "riders", first_bid_placed: "auctions" }`. "Vis mig hvordan"-knappen er kun synlig på kortet hvis næste trin har en tour (Slice 2 vil tilføje `board_plan_set: "board"`).
- **Data-tour hooks:** `[data-tour="riders-filters"]`, `riders-list`, `riders-watchlist`, `auctions-bid-input`, `auctions-countdown`. På AuctionsPage tilføjes attributterne kun til første rendrede række/kort (via `isFirst`-prop) for at holde DOM ren.
- Verificeret: lint 0 errors (42 pre-eks. warnings), build grøn (`vite built in 7.14s`). UI-smoke pending.

### Deadline Day S4 (2026-05-02)
- Planlagte advarsler (T-24h / T-2h / T-30min): cron kører hver 5. minut, sender `deadline_day_warning`-notifikationer til alle aktive managers via `notifyTeamOwner`; dedupe via `related_id = window_id` + step-titel (24t-vindue i `notificationService`)
- Final Whistle-rapport: `transfer_windows.final_whistle_sent_at` atomic claim (UPDATE WHERE IS NULL → SELECT) → `computeFinalWhistleReport` (største handel, mest aktive manager, panikhandler) → Discord embed til default webhook
- Pure functions: `getDueWarningSteps`, `buildWarningPayload`, `computeFinalWhistleReport`, `formatFinalWhistleEmbed` i `backend/lib/deadlineDayReport.js`
- Cron-orkestrering: `processDeadlineDayCron` i `backend/cron.js` (5-min interval ved siden af 60s auctions + 6h debt)
- DB: `2026-05-02-deadline-day-final-whistle.sql` udvider `notifications_type_check` + tilføjer `final_whistle_sent_at`-kolonne

### Developer Tooling (v1.99, 2026-05-02)
- **ESLint** (backend + frontend) — flat config, `@eslint/js` recommended; kører i CI efter tests; 0 errors
- **Prettier** — 2 spaces, double quotes, semikolon, `trailingComma: es5`; `npm run format` i begge
- **Supabase TypeScript types** — 63KB genereret fra live DB-schema til `frontend/src/types/database.types.ts`; koblet til `createClient<Database>` i `frontend/src/lib/supabase.ts` (v2.00)
- **verify-invariants** — `pwsh -File scripts/verify-invariants.ps1` kører 6 domæne-tjek mod live Supabase (zero npm-deps); exit code 1 ved brud
- **backend/node_modules** — nu installeret; `npm run test`, `lint`, `format` virker lokalt

---

## 🔴 Broken / Kendte bugs


---

## 📋 Planlagt (backlog)

- Aktiv feature- og forbedringsbacklog vedligeholdes i `docs/PRODUCT_BACKLOG.md`
- Economy baseline & simulation gennemført (v1.76 tune applied); næste spor er iteration baseret på live beta-data.
- Team ID-mapping fra PCM
- Cyclist ID-mapping fra PCM
- 3-sæsoners glidende gennemsnit for rangliste
