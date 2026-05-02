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
- `users.discord_id` gemmes og bruges til @mention i kanal-embeds — **ikke DM** (webhooks kan ikke sende DMs)
- **Planlagt S8:** Discord Bot (bot-token) til DMs; `discordNotifier.js` udvides med `sendDM()`; dashboard-nudge til managers uden discord_id; Discord-status badge på `ProfilePage`
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
- `DeadlineDayBoard` (`/deadline-day`) — Panic Board: alle holds truppestørrelse vs. divisions-minimum, grøn/gul/rød, 30s poll; vises kun under Deadline Day
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
