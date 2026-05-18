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
- Nationalitetsflag: alle 8.699 ryttere har ISO 2-bogstavs kode fra PCM `fkIDregion` → 138 lande, vises som SVG-flag via `<Flag>`-komponenten (flag-icons sprite, v2.18 — cross-browser inkl. Chrome på Windows); `import_riders.py` sætter kode automatisk ved fremtidige imports
- **Potentiale** (v1.83): `potentiale DECIMAL(3,1)` på riders-tabellen, synkroniseret fra PCM `dyn_cyclist.value_f_potentiel`. Vises med guldstjerner (< 30 år) / sølvstjerner (≥ 30 år), halvstjerner understøttet. Tilgængeligt på alle rytteroversigter med filter (min/max 1–6) og sortering. 8.416/8.699 ryttere har data (283 uden — formentlig ryttere uden PCM-match).
- **Pensionerede ryttere** (v3.16): `riders.is_retired` markerer ryttere der skal bevares til historik, men skjules fra almindelige rytter-/handelssøgninger. Admin kan toggle status under `/admin` → Manuel override. Backend blokerer nye auktioner, transferlistinger, direkte tilbud, byttehandler og lejeaftaler hvis en involveret rytter er pensioneret.
- Rytterbibliotek med søgning + filtre (nation, UCI, U25, ledig, evne-min/max, osv.) + løn-kolonne og lønfilter (v1.47)
- Rytterværdi i marked/visninger er dynamisk: `market_value = max(5, uci_points) × 4000 + prize_earnings_bonus`, hvor bonus er gennemsnit af seneste op til 3 afsluttede sæsoners præmiepenge (v1.77)
- Rytterdetalje-side (stats, historik, watchlist-tæller, ryttertype-badge, ⚡-badge ved aktiv auktion)
- Rytter-sammenligning (side-by-side)
- Watchlist + notifikation når ønskeliste-rytter sættes til salg eller auktion (v1.35). Indbakke-routing adskiller nu auktion (`watchlist_rider_auction` → `/auctions`) fra salg (`watchlist_rider_listed` → `/transfers`) med legacy-fallback for gamle auktion-notifikationer (v2.45)
- Stat-grid med farvekodning (statBg.js)

### Auktioner
- Opret auktion med starttid + vindueslogik
- Bud-placering med auto-forlængelse (10 min ved bud nær slut). Forlængelsen må overskride dagens vindueslukning med op til 1 time (grace), og ved overflow ruller den resterende tid videre til næste vindues åbning (v2.87)
- Garanteret salg (startpris = 50% af markedsværdi) — kun egne ryttere; exploit lukket (v1.46)
- Minimum startpris håndhævet (backend + frontend): startbud ≥ rytterens Værdi; garanteret salg er eneste undtagelse
- Minimum overbud håndhæves som +1 CZ$ over nuværende pris; hvis ingen har budt endnu, må asking-prisen matches.
- Auktionsbudfeltet forudfyldes med laveste gyldige bud, og UI viser konkrete backend-fejl ved for lavt bud, saldo eller reserveret squad-plads (v1.77)
- Auktionslisten viser sælger som AI eller managerhold, så ikke-ejede auktioner ikke ligner managersalg (v1.77)
- Aktive auktionsføringer reserverer både disponibel balance og squad-plads ved nye bud
- Auktionsfinalisering via cron (60s) — delt path for cron/admin/API, korrekt ejer-check og squad-limit
- Bank/AI/fri rytter-auktioner kan startes fra rytterprofilen; startprisen tæller som initiatorens første førende bud, og finalizer har fallback for aktive legacy-auktioner hvor første bud ikke blev skrevet til `current_bidder_id`
- **Admin annullér auktion (v2.26):** `Aktive auktioner`-sektion i AdminPage lister aktive+forlængede auktioner og lader admin annullere med ét klik. Atomar status-transition i `auctionCancellation.js` (race-safe mod parallel cron). Bud frigives automatisk fordi reservation kun beregnes ved query-time. `auction_cancelled` notification-type sendes til alle unikke budgivere + sælger. Admin-handling logges i `admin_log`. `auctions.cancelled_at` + `cancelled_by_user_id` audit-spor.
- Auktionshistorik-side
- Discord-notifikationer (auktioner, overbud, transfers, sæsonevents)
- **Proxy-bidding / autobud med max-loft (v2.79, #10):** Manager sætter et privat max-loft; hvis manageren ikke allerede fører, placerer PATCH `/api/auctions/:id/proxy` samtidig minimumsbuddet som `auction_bids.is_proxy=true`, så autobud fungerer som et reelt første bud. Derefter counter-byder resolveren automatisk i +1 CZ$-trin op til loftet. `auction_proxy_bids (auction_id, team_id, max_amount)` UNIQUE per (auction, team). `auction_proxy_outbid` notif ved loft-udtømning eller balance-stop. Routes: GET/PATCH/DELETE `/api/auctions/:id/proxy`; proxy kan også sendes som `proxy_max` felt ved POST bid. UI: badge + Ændr + Fjern i AuctionRow/AuctionCard.

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Delt backend confirm-path (ejerskab, saldo, squad-limit + oprydning ved gennemførelse)
- Parkerede `window_pending` transfers/swaps kan ikke manager-annulleres efter begge parter har accepteret
- AI-ryttere skjules fra direkte tilbud på rytterprofilen og blokeres server-side fra direkte transfer/bytte
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
- **Økonomi retuneret (v1.46 → v1.76)** — startkapital 800K, sponsor 240K/sæson (v1.46, fortsat kanonisk; v1.76 "ramp til 260K" var en in-code drift uden DB-migration, normaliseret tilbage til 240K i v2.50/slice 07a); SALARY_RATE 0.10, gældsloft D1/D2/D3 = 1200K/900K/600K
- **Signup-økonomi hardening (v3.15, 2026-05-11)** — live auth/signup placeholder-path kunne oprette et manager-team med testøkonomi (`balance=500`, `sponsor_income=100/500`) før backend-setup. `teamProfileEngine` reparerer nu kun de kendte placeholder-værdier til 800K/240K på `PUT /api/teams/my`, DB-defaults/signup-trigger låses i migration `2026-05-11-fix-signup-economy-defaults.sql`, og eksisterende placeholder-teams uden finance-transaktioner normaliseres.
- **Variabel sponsor fra sæson 2 (v3.12, slice 07f, 2026-05-11):** Sæson 1 er intro med fast 240K. Fra sæson 2 beregnes sponsorbase via delt `sponsorEngine`: 200K fast base + 0-150K variabel del ud fra forrige sæsons `season_standings.total_points` og `rank_in_division` relativt til divisionen. Board budget_modifier og sponsor-pullout multipliceres ovenpå samme base. `processSeasonStart`, `buildTransitionPlan` og `/api/me/finance-forecast` bruger samme pure-function-kontrakt.
- **Rytter-løn er en GENERATED column (v2.25, 2026-05-04)** — `riders.salary = max(1, round((max(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10))` beregnes automatisk af Postgres. Ingen application-path kan skrive direkte til `riders.salary` — DB genberegner ved opdatering af `uci_points` eller `prize_earnings_bonus`. Eliminerer permanent dual-formula konflikten mellem 10% (cron) og 15% (auktioner/transfers/lån) der drev løn-drift mellem mandag og onsdag
- **Economy baseline simulation (2026-04-29)** — read-only live baseline + lokale scenarier er dokumenteret i `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`, med gentagelig kommando `backend/scripts/economyBaselineSimulation.js`
- Sponsorindtægt ved sæsonstart (med board-modifier)
- Lønudbetaling ved sæsonslut
- Renteberegning på negativ saldo (10%/sæson)
- Resultatpoint (`points_earned`) og præmiepenge (`prize_money = points × 1.500 CZ$`) er adskilt ved løbsimport — `points_earned` fra `race_points[race_class]`, `prize_money` krediteres holdbalancen som type=`prize` (v1.75)
- Divisionsbonus ved sæsonslut: D1 300K/200K/100K/50K · D2 150K/100K/50K/25K · D3 75K/50K/25K, type=`bonus`, idempotent (v1.75)
- **DB-håndhævet idempotency for cron-payouts (v2.51, slice 07b, 2026-05-07):** 4 partial UNIQUE indices på `finance_transactions` — `uniq_sponsor_per_team_season`, `uniq_salary_per_team_season`, `uniq_bonus_per_team_season` (alle på `(team_id, season_id)`) + `uniq_loan_interest_per_loan_season` på `(related_loan_id, season_id)`. Ny `finance_transactions.related_loan_id` UUID-kolonne (FK til `loans.id`) sporer renter per individuelt lån. Backend-engines fanger `unique_violation` (PG 23505) og skipper stille — cron-retry er nu sikkert.
- **Atomisk createLoan via `create_loan_atomic` Postgres-RPC (v2.51, slice 07b):** Concurrent createLoan-calls for samme team serialiseres via `pg_advisory_xact_lock(team_id_hash)`, så debt-ceiling-tjek + INSERT kører i samme transaktion. Lukker TOCTOU der tidligere kunne lade 2 parallelle requests bestå ceiling-check og samlet overskride loftet. App-niveau fallback bevares til legacy/test-mocks uden RPC.
- **Light konkurs-mekanik lag 1 (v2.51, slice 07b):** `createEmergencyLoan` udfører SOFT debt_ceiling-tjek. Ved breach oprettes lånet alligevel (status quo), men manageren får `emergency_loan_breach`-notifikation der opfordrer til at sælge ryttere/reducere udgifter. Ingen automatiseret konsekvens — hard-enforcement venter på live-data fra ~18 managers. Live-observationer trackes i [#97](https://github.com/NicolaiDolmer/CyclingZone/issues/97) (slice-07i decision).
- Finance-transaktionslog + Finance-side
- Balance-justering (admin)
- Finance transaction type-kontrakt er afstemt i schema/migration/test med runtime for lån, lånerenter, nødlån og admin-justeringer
- Live DB migration for finance-/notification type-kontrakt er applied 2026-04-29.
- Season-end nødlån sender nu `season_id` med til finance-loggen, så `emergency_loan` rows kan verificeres per sæson fremover.
- Service-visible season 6 repair verifier findes som `backend/scripts/verifySeasonEndRepair.js` / `npm run season:end:verify-repair -- --markdown`.
- UCI salary recalculation: GitHub Actions kører `backend/scripts/recalculateRiderSalaries.js` efter UCI scraperen. Scriptet kører `updateRiderValues` som nu kun opdaterer `prize_earnings_bonus` (3-sæson-gennemsnit) — DB genberegner `salary` automatisk via GENERATED-formel når `uci_points` eller `prize_earnings_bonus` ændres (v2.25)
- **Auto-migrate workflow (v2.25, 2026-05-04):** `.github/workflows/auto-migrate.yml` kører nye `database/2026-*.sql` filer mod live Supabase ved push til main. Tracker applied filenames i `schema_migrations` tabel (PK = filename) for idempotency. Sleeps 180s for Vercel + backend deploy at færdiggøre, så `psql -f` med `ON_ERROR_STOP=1`. Setup-doc: `docs/AUTO_MIGRATION_SETUP.md` (kræver `SUPABASE_DB_URL` GitHub secret). Eliminerer manuel "kopier SQL ind i dashboard"-proces
- **Slice DX agent-loop (2026-05-06, `c1a8970`):** 3 GitHub Actions workflows live på `.github/workflows/`. (1) `claude.yml` — `@claude`-mention i issue/PR-comment trigger en cloud Claude-session via `anthropics/claude-code-action@v1` med Pro-subscription auth (`CLAUDE_CODE_OAUTH_TOKEN` repo-secret). (2) `claude-review.yml` — auto PR-review på `pull_request: opened/synchronize` med opus-4-7, prompt tunet til CLAUDE.md+CONVENTIONS.md+sikkerhed+doc-drift. (3) `claude-triage.yml` — auto issue-triage på `issues: opened` med sonnet-4-6, sætter priority/type-labels + første-pass investigation på bugs. Foundation (issue templates, 12 labels, PR template) live siden `f26f2e5`. Setup-doc: `docs/GITHUB_WORKFLOW.md`

### Sæson & Løb
- Sæsonoversigt med race-kalender
- Løbsresultater-import (xlsx) og approve via delt backend result-path
- Google Sheets-resultatimport matcher løbsnavne robust på accenter, tegnsætning og kendte kalenderaliaser
- Google Sheets-resultatimport er idempotent for prize finance: gamle prize-transaktioner for samme løb reverseres før re-import
- Adminens `race_points`-editor bruger moderne herre-UCI-klasser og seedede UCI-point for klassement, klassikere, etaper, pointtrøje, bjergtrøje og førertrøje
- Pointtavle (season_standings) inkl. rank_in_division, recalkuleres fra race_results
- Opryknings/nedrykningslogik (top/bund 2 per division)
- Holdranglisten viser opryknings-/nedrykningszoner efter samme season-end-regel: Division 2-3 kan rykke op, Division 1-2 kan rykke ned
- Sæsonpreview-side
- **Løb-hub (v2.22, 2026-05-04):** `/races` konsolideret med tabs Kalender · Bibliotek · Point & præmier · Indberét resultater (· Godkend for admin). Bibliotek = søgbar/filtrerbar liste over alle løb på tværs af sæsoner (sæson/klasse/status/q-filtre, lazy-loadet). Point & præmier embedder `RacePointsPage`. Tab-state synkroniseres til URL (`?tab=library`). Den gamle `/race-archive` redirecter til `/races?tab=library`; `/race-archive/:raceSlug` (RaceHistoryPage) bevaret som detail-side
- Løbshistorik pr. løbsnavn (`/race-archive/:raceSlug` → RaceHistoryPage) — tidligere udgaver, vinder pr. sæson, akkumuleret rytter-rangliste
- Season-end preview bruger economy engine til løn, lånerente som gæld, projected board satisfaction og næste sponsorudbetaling, så preview matcher season-end/season-start runtime
- Season-end runtime loader teams/riders/board_profiles separat og fejler hårdt på Supabase load/write errors, så finance/board side effects ikke silently skippes før season completion.

### Bestyrelse (Board)
- **S-02i Bug-fix-pass + regression-tests leveret (2026-05-05, v2.41):** 293/293 backend-tests grønne. Bugfix: multi-plan-fornyelse (renewalQueue) starter nu altid med den længste udløbne plan uanset klikpunkt — Q19 "5yr eller 3yr forhandles først". processReplacementTrigger og evaluateAndApplyConsequences gjort deps-injectable i processTeamSeasonEnd (følger etableret mønster for processLoanInterest). 7 nye regression-tests for processSeasonEnd dækker replacement-trigger ved plan-completion, skip ved mid-cycle, replacement-notif, triggerDoublePlanLapse (consecutiveLowExpirations=2 vs 0), fejl-isolation, u25_stat_sum + u25_count i snapshot.
- **S-02h Wizard-redesign Hybrid B+A leveret (2026-05-05, v2.40):** BoardPage redesignet til 3-kolonne dashboard (5yr/3yr/1yr side om side; mobile: vertikal stack). Compact panel per plan: tilfredshed-%, sponsor×-modifier, mål-progress-bar, top-3 mål med status-ikoner (✓/!/~/○ fra GOAL_STATUS_META) per Q17. GoalMiniDialog: klik på mål → modal med fulde detaljer + kumulativt progress-bar + dominerende board-member-portræt + reaktions-citat (Q17). Wizard redesignet fra full-page takeover til modal overlay; dashboard forbliver synligt i baggrunden. Multi-plan-fornyelse (Q19): renewalQueue[] sorted by PLAN_SEQUENCE (5yr→3yr→1yr), modal-header "Planfornyelse 1/2", Tilbage-knap fra trin 2+. DashboardPlanPanel: ny kompakt komponent med expand-toggle → fulde GoalCards, PlanTimelineBar, SeasonSnapshotGrid, outlook/feedback, BoardRequestPanel under fold. 286/286 tests grønne.
- **S-02g Manager-konkurrence + mid-season + drej-låsninger leveret (2026-05-05, v2.39):** 6 mini-features over én session. F1: `relative_rank`-mål går live på BoardPage med rich detail "Du staar #X af Y managers — slaar Z (maal: N ✓)" beregnet fra `season_standings.rank_in_division` + antal humane managers i divisionen. evaluateGoalProgress udvidet til at returnere `rank_in_division` + `division_manager_count` for relative_rank-typen. F2: Mid-season auto-banner (`backend/lib/boardMidSeason.js`): når race_days_completed >= floor(race_days_total/2) tjekker en ny cron (30-min interval i `cron.js`) hver human team — hvis satisfaction <50 ELLER ≥50% målbare goals 'behind'-status → fyrer `board_critical`-notif "Mid-season check (sæson N)" til Indbakke 'Skal handles'-tier. Idempotent via eksplicit notif-tabel-tjek. Banner-action er per Q-batch 1B Q15 ren acknowledgement (manager handler via eksisterende request/loan-flows). F3: Tradeoff-låsninger — `applyTradeoffTighteningToGoals` implementerer 2 hardkodede payloads: `lower_results_pressure` → `tighten_identity_riders` (+1 target på min_u25_riders/min_national_riders i næste plan-renewal) og `ease_identity_requirements` → `raise_sponsor_growth_target` (+5pp). Mål markeres `tradeoff_tightened: true`. buildBoardProposal accepterer `tradeoffPayload`-param og applyer som sidste step (efter DNA-vægtning, så subtil). /api/board/proposal læser eksisterende board's tradeoff_payload og preview tightenede goals; /api/board/sign clearer tradeoff_payload + tradeoff_active_until_season_id ved upsert. F4: MAJOR pivot cool-down — `isMajorPivotRequest` returnerer true kun for more_youth_focus FRA star_signing ELLER more_results_focus FRA youth_development (krydsninger mellem extremer; pivots til/fra balanced er ikke MAJOR). resolveBoardRequest sætter `major_pivot_used_at = now()` ved approval; getBoardRequestAvailability blokerer videre MAJOR pivots med "Bestyrelsen har allerede accepteret en MAJOR drejning". Reset til null ved plan-renewal (frisk plan = frisk cool-down). F5: Window-blokering — alle requests disabled når `context.raceDaysLeft <= 5` (konstant `REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT`). F6: Mid-cycle-låsning — for plan_type='5yr' eller '3yr' blokeres requests hvis seasonsCompleted/planDuration < 50% OG abs(satisfaction-50) ≤ 30% (konstanter `MID_CYCLE_PROGRESS_THRESHOLD_PCT=50`, `MID_CYCLE_SATISFACTION_DELTA_PCT=30`). 1yr-planer ingen mid-cycle-lås. Migration: `database/2026-05-05-board-tradeoff-pivot.sql` (board_profiles.tradeoff_active_until_season_id + tradeoff_payload + major_pivot_used_at + index). BoardPage: '🔒 Strammet'-badge på GoalCard + relative_rank rich detail. Beta-reset wiper alle 3 nye felter via DELETE board_profiles. HelpPage: 6 nye FAQ-items. 286/286 backend-tests grønne (36 nye).
- **S-02f Klub-DNA leveret (2026-05-05, v2.38):** 5 håndlavede klub-DNA-arketyper (`backend/lib/boardClubDna.js`): 🌲 Skandinavisk udviklingshold, 🪨 Italiensk klassiker-traditionalist, ⚡ Sprint-fokuseret kommerciel, ⛰️ Fransk klatrer-arv, 🎯 Britisk all-rounder. Hver DNA har 8 policy-akser, member_alignment_bonus til 1-4 board-arketyper og en signature klub-tradition-mål. Tildelings-flow: ved sæson-2-onboarding (efter `season_1_identity_basis` er observeret) computer `computeDnaSuggestions(identityBasis)` 3 forslag — national_match (mod national_core.code), specialization_match (mod primary_specialization), wildcard. Manageren vælger frit fra de tre via `POST /api/board/dna-choose`. DNA påvirker tre engine-paths: (1) `selectBoardMembers` får `dnaKey`-bias så italiensk_klassiker tipper +4 til klassiker_purist, -2 til gc_elsker (slår ind ved chairman-replacement); (2) `buildBoardProposal` injicerer DNA-tradition-mål som ekstra (bonus) mål i 5yr-forslag (med dedup mod base-pakken så britisk_allrounder's relative_rank ikke duplikeres på 'balanced'-focus); (3) `applyDnaWeightingToGoals` multiplicerer satisfaction_bonus + _penalty på matchende mål-typer (italiensk_klassiker × 1.6 på monument_podium). Migration: `database/2026-05-05-board-club-dna.sql` (team_dna-reference-tabel seedet med 5 rows + teams.team_dna_key + teams.team_dna_chosen_at). 2 nye routes: `GET /api/board/dna-suggestions` + `POST /api/board/dna-choose`. AI/bank/frozen får aldrig DNA — manager-only. BoardPage: `ClubDnaSelectionCard` (3-forslags-grid med Vælg-knap) før plan-cards når dnaSuggestions findes; `ClubDnaBadge` (kompakt valgt-display) når team_dna er sat. Beta-reset nulstiller team_dna_key + team_dna_chosen_at. DNA er final indtil drift-mekanik (gradvis udvikling over 5 sæsoner) leveres i opfølgnings-slice S-02f.1. 250/250 backend-tests grønne (18 nye).
- **S-02e Konsekvens-tier (6 lag) leveret (2026-05-05, v2.37):** 6-lags gradueret konsekvens-system når tilfredshed dykker (eller stiger højt). Lag 1 (passive sponsor-modifier ±20%, eksisterende). Lag 2: lønloft <40% (frosser holdets totale løn ved trigger-tidspunktet, sælg en rytter for at handle vækst). Lag 3: signing-restriktion <30% (køb >300K CZ$ blokeres). Lag 4: tvunget salg <15% (auto-list rytter med laveste market_value, beskytter pop≥70 OR uci≥100). Lag 5: sponsor-pull-out <10% ELLER 2× plan-udløb under 30% (-10% sponsor i ÉN sæson, multiplicerer ind i budget_modifier-stack ved næste sæson-start, auto-expirer derefter). Lag 6 (positiv): bonus-tilbud sat>75% + ≥75% mål nået → +200K mod ekstra-mål (signature_rider for star_signing-fokus, ellers monument_podium). Hard-blocks live på POST /api/auctions/:id/bid + POST /api/transfers/offer + accept_counter via `assertSigningAllowed`. Migration: `database/2026-05-05-board-consequences.sql` (board_consequences-tabel m. unique-active-index på (team_id, layer)). Status-flow: active → accepted/declined (lag 6) ELLER active → expired (lag 5 ved sæson-start) ELLER active → fulfilled (lag 4 når listing sælges). Notif-routing låst i Q-batch 1C Q21: lag 4-6 → `type='board_critical'`, lag 2-3 silent (kun BoardPage warning-panel). 2 nye routes `/api/board/bonus-offer/{accept,decline}`. BoardPage: `BoardConsequencesPanel` (gul lag 2-3, rød lag 4-5) + `BonusOfferCard` (grøn m. Acceptér/Afvis). Beta-reset clearer board_consequences. 232/232 backend-tests grønne (41 nye). Aldrig fyring (Q-batch 1A #4).
- **S-02c Navngivne board-medlemmer leveret (2026-05-05, v2.35):** 9 håndlavede arketyper (Sponsoraten 💰, Traditionalisten 🎩, Talentspejderen 🔭, Resultatjægeren 🏆, Pragmatikeren ⚖️, Ungdoms-idealisten 🌱, Nationalist-purist 🏳️, Klassiker-purist 🪨, GC-elsker ⛰️) med personality-akser + 8 policy-akser + 30 reactions/arketype = 270 templates total. Hvert team får 5 medlemmer ved sæson-1-slut: 3 identity-matched (top-3 alignment_score) + 2 wildcards der ikke modsiger på friction-akser (debt_aversion, youth_focus, results_pressure). Højeste alignment = formand (taler ved tvivl, udskiftes ved replacement-trigger). `boardEvaluation.buildBoardOutlook` udvidet med `dominant_member`-citat på feedback (kategori-routet) + `member_reaction` pr. goal-evaluation. BoardPage: avatar-grid mellem identity-card og plan-cards, GoalCard 'X reagerer'-expand-knap, PlanCard outlook-feedback med formand/dominerende medlem-citat. Replacement-trigger: 2× plan-udløb i træk under 30% sat → udskift formand fra de 4 ikke-tildelte arketyper (per-team counter på `teams.consecutive_low_satisfaction_expirations`); notif: "Bestyrelsen har valgt en ny formand: {label}". Migration: `database/2026-05-05-board-members.sql` (`team_board_members`-tabel + counter-kolonne). Beta-reset clearer members + nulstiller counter + identity_basis. 164/164 backend-tests grønne (16 nye).
- **S-02b 1yr-auto-gen + identity-feeding + auto-accept leveret (2026-05-05, v2.34):** Bestyrelsen tager et frosset identity-snapshot ved sæson-1-slut (`teams.season_1_identity_basis JSONB`) der bruges som goal-weighting input til 5yr-forslag, identity-feeding-badge og auto-accept default-focus. 5yr-mål annoteres med `identity_basis_rationale` ("Bygger paa din FR-kerne (5/8 ryttere)") som klikbar inline-badge med expand-forklaring. `boardAutoAccept.processBoardAutoAcceptCron` (cron.js, hver 30 min) sender T-3 reminder ved race_days_completed=2 → `notifications.type='board_update'`, T-1 ved =4 → `type='board_critical'`, og auto-signer plan ved ≥5 med default-focus afledt fra identity_basis (youth_high → youth_development, elite_star → star_signing, gc/sprint/classics → star_signing, ellers balanced). Notif-dedup (24h) gør cron idempotent. Migration: `database/2026-05-05-board-1yr-autogen.sql`. BoardPage: countdown-banner + Bestyrelse-feed-sektion. 146/146 backend-tests grønne (15 nye).
- **S-02a Foundation leveret (2026-05-05, v2.33):** Sæson 1 = baseline observation (ingen mål, modifier 1.0, ingen evaluering). `processSeasonEnd` skipper baseline-rows og kalder `startSequentialNegotiation` inline ved sæson 1-slut → window-state sættes til `pending_5yr` + baseline-rows slettes. Migration: `database/2026-05-05-board-foundation.sql` (board_profiles.is_baseline + plan_type='baseline' + transfer_windows.board_negotiation_state). Beta-reset opretter nu 1 baseline-row pr. team (ikke 3 plan-rows). Per-team-fremdrift udledes stadig af row-eksistens (api.js:3093) — window-state er global fase-lås.

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
- **Milestone-gated tabeller (verificeret 2026-05-10, [#284](https://github.com/NicolaiDolmer/CyclingZone/issues/284)):** `team_board_members`, `board_consequences` og `board_request_log` har 0 rows i prod by design indtil sæson 1 afslutter første gang. Skrive-paths fyrer korrekt — de er bare gated på milestones der ikke er nået endnu: (a) `team_board_members` populates af `assignBoardMembersForTeam` kaldt fra `startSequentialNegotiation` ved sæson-1-end, (b) `board_consequences` populates af `evaluateAndApplyConsequences` ved enhver sæson-end, (c) `board_request_log` populates når en manager submitter via `POST /api/board/.../request` — gated på `board.negotiation_status='completed'` AND non-baseline. Sæson 1 forventet ~2026-05-15 (Slice 09). Når feature-liveness-audit ([#287](https://github.com/NicolaiDolmer/CyclingZone/issues/287)) bygges, skal disse 3 tabeller whitelistes som "milestone-gated, trigger=after_season_1_end".

### Admin
- Import af ryttere (Python-script `scripts/import_riders.py`) — se CONVENTIONS.md for navnematch-algoritme
- Import af løbsresultater (`.xlsx`/`.xls` upload) via `POST /api/admin/import-results`; upload-parseren er `multer@2.1.1` med memoryStorage, 10 MB loft og regressionstest for multipart `file` + `race_id` + `stage_number` (v3.13, #295)
- UCI points sync (Google Sheets CSV — autoritativ kilde med 3000 ryttere)
- Override rider (team/stats)
- Sæsonopcioner (create/start/end/result import) via kanoniske admin-routes
- Genberegning af standings fra gemte race_results
- Løbsoprettelse og season-end preview endpoint
- Admin repair endpoint til season-end finance/board side effects uden at køre season status eller oprykning/nedrykning igen; deployed 2026-04-29 og kan resume missing side effects uden at duplikere eksisterende salary/snapshots.
- Beta-reset komplet suite: marked, trupper, balancer, divisioner, bestyrelse, løbskalender, sæsoner, XP/level og achievement unlocks via delt reset-service
- **Økonomi-dashboard (07e Fase A, v2.93, 2026-05-09):** Ny Økonomi-sektion i AdminPage med tre sub-views — Sundhed (NULL actor_type-counter + balance-drift watchdog), Overblik (per-hold balance/sponsor/gæld/loft/sustainability) og Transaktioner (paginated finance_transactions m. filter på actor_type/reason_code/source_path/team/season/dato/beløb + drill-down-modal m. before/after-balance-invariant-check). Tre nye GET-endpoints (`/admin/economy-overview`, `/finance-transactions`, `/economy-health`) bag requireAdmin med limit-clamping (max 200). Fase B (admin_log-feed + cron-run-korrelering + CSV-export) parkeret til næste session.

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
- Notification type-kontrakt er afstemt i schema/migration/test med runtime for transfer-interesse, watchlist-salg, watchlist-auktion og lånebeskeder
- Achievement-sync fra live historiktabeller (bid, transfer, watchlist, hold, board)
- Aktivitets-feed · Head-to-head sammenligning · Hall of Fame · Patch notes · Hjælpeside · Confetti modal

### Discord & Integrationer
- Discord webhooks: admin kan tilføje webhooks med navn, URL og type (general / transfer_history); pr. webhook-row vises Test-knap der returnerer struktureret status (✅ leveret + tidsstempel, eller ❌ med 404/401/403/429-diagnose) inline pr. webhook (v2.28, S-06 P0 lukket)
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
- `DeadlineDayBoard` (`/deadline-day`) — Deadline Day-overblik: alle holds truppestørrelse vs. divisions-minimum, grøn/gul/rød, 30s poll; vises kun under Deadline Day; nav-link permanent under Marked (menu-label `Deadline Day` fra v2.44)
- `GET /api/deadline-day/squads` — returnerer alle ikke-bank holds squad-count vs. MARKET_SQUAD_LIMITS, med status ok/warning/critical

### Trupstørrelse-håndhævelse (S-03 v2.29, 2026-05-04)
- `backend/lib/squadEnforcement.js` — `enforceTeamSquadCompliance` + `processSquadEnforcementCron`. Cron fyrer hver 5. min via `cron.js`, men kun aktiv på lukkede vinduer der ikke er enforced endnu (atomic claim på `transfer_windows.squad_enforcement_completed_at`)
- Per-team logik: under min → auto-køb cheapeste fri-/AI-rytter til 150% × market_value (nødlån via `createEmergencyLoan` hvis utilstrækkelig balance); over max → auto-sælg senest-erhvervede til ai_team_id (eller NULL) for fuld market_value som kredit
- Bøde: `squad_violation_fine` finance_transaction (-100K pr. afvigende rytter); fradrag: `season_standings.penalty_points += 200 × afvigende`
- `season_standings.penalty_points` preserves på tværs af `updateStandings`-recompute fordi den ikke er i upsert-rows; `updateStandings` ranking bruger `effective = total_points - penalty_points` for `rank_in_division`
- `riders.acquired_at` tracker hvornår rytter erhvervedes; live-opdateret i alle 6 write-paths: auctionFinalization (vinder + bank-køb), transferExecution (transfer + 2x swap-mutationer + revert), api.js loan-buyout, admin-override, window-open flush
- StandingsPage: rangliste viser `total (−penalty)`-notation når `penalty_points > 0` med tooltip der forklarer optjent vs. fradragne points; sortering bruger effective points
- Notifikation: `squad_enforced` notification-type til ramt manager med oversigt over auto-køb/-salg + bøde + fradrag
- Migration: `database/2026-05-04-squad-enforcement.sql` (acquired_at, squad_enforcement_completed_at, penalty_points, finance/notif type-constraints)

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
- **v2.10:** udvidet med `(text|border|ring|divide|outline)-(white|black)/\d+` — fanger Deadline Day-boardets tidligere token-hul (text-white/N + border-white/N) der bypassede v2.08-guarden. `bg-(white|black)/N` bevidst tilladt fordi modal-scrims (ConfettiModal, OnboardingModal, SetupWizardModal, Layout, TeamPage) idiomatisk bruger `bg-black/60-70`
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

### DD banner pressure-dot + cz-bg0 aliases (v2.20, 2026-05-04)
- **Bug:** DeadlineDayBanner pressure-fase dot var transparent fordi `cz-danger-bg0` brugt 20+ steder (banner + Notifications + Board + Admin + Dashboard m.fl.) ikke var defineret i tailwind config — silently dropped af Tailwind. Fundet under DD UI-smoke audit.
- **Fix:** Tilføjet 4 aliases (`cz-{success,danger,warning,info}-bg0`) der peger på respektive base-farve `var()`. Plain-form klasser virker; opacity-varianter (fx `/8`) virker stadig ikke pga. bredere pre-eks. bug — løst i v2.21 nedenfor.
- **Verificeret runtime via Claude Preview:** `bg-cz-danger-bg0` = `rgb(185, 28, 28)` ✅. Final Whistle Discord-embed format auto-testet mod Discord limits.

### Sæson-snapshot (v2.23, 2026-05-04 — S9b)
- **Mål:** Manager skal kunne svare "Hvad skete der i sæson N?" på ét skærmbillede via deelbar URL `/seasons/:seasonId` — kalender + slutstilling + sæsonens vindere væves sammen
- **Strategi:** Genbrug af eksisterende `SeasonEndPage.jsx` (315 linjer → ~470 linjer) — refaktoreret til at læse `:seasonId` fra URL via `useParams`, fallback til aktiv eller seneste sæson. Slutstilling pr. division med op/ned-rykning, mini-charts og pointudviklings-charts bevaret uændret
- **Routing:**
  - `App.jsx`: nye routes `seasons` (no-param, picker active/latest) og `seasons/:seasonId`. Gammel `season-end`-route konverteret til `<Navigate to="/seasons" replace />` for backwards-compat
  - `Layout.jsx`: sidebar `Resultater → Sæsonresultater (/season-end)` → `Sæson-snapshot (/seasons)`
  - `ResultaterPage.jsx`: hub-card "Sæsonresultater (/season-end)" → "Sæson-snapshot (/seasons)" med ny desc
  - `RacesPage.jsx` Bibliotek-tab: Sæson-cellen er nu klikbar `<button>` til `/seasons/{id}` (med `e.stopPropagation()` så row-click til race-archive bevares)
- **Vinder-aggregering (4 kort, alle klikbare):**
  - 💰 **Præmie-leader**: sum(`race_results.prize_money`) per `rider.team_id`, filtreret til human teams. Klik → hold-profil
  - 💸 **Største enkelt-transfer**: max(ABS(`finance_transactions.amount`)) WHERE `season_id={id}` AND `type='transfer_in'` (sælger-perspektiv undgår double-count). Vises beløb + description (rytter-navn) + hold. Klik → hold-profil
  - 🔄 **Mest aktive transfer-marked-hold**: count(`finance_transactions`) per `team_id` WHERE `type IN ('transfer_in','transfer_out')`. Klik → hold-profil
  - 🚴 **Stage-king**: count(`race_results` WHERE `result_type='stage' AND rank=1`) per rider_id. Vises navn + antal etapesejre. Klik → rytter-profil
- **Kalender-sektion:** alle løb i sæsonen sorteret kronologisk (`races.start_date ASC`). Viser dato (DD MMM), navn, type (etapeløb/enkeltdag), præmiepulje og status-badge (afsluttet/igang/kommende). Header viser totals (`X afsluttet · Y kommende`). Klik på række → `/race-archive/:raceSlug`
- **Backend:** Ingen nye endpoints — alt læses via supabase-client (`season_standings`, `races`, `race_results`, `finance_transactions`). Reuse-pattern matcher resten af `SeasonEndPage`
- **URL-flow:** Dropdown-skift kalder `changeSeason(s)` → `navigate('/seasons/{id}')`. `useEffect([urlSeasonId, seasons])` reagerer på URL og kalder `loadSeason(target)`. Re-renders triggered af split useEffect-pattern (init + load) for at undgå `react-hooks/exhaustive-deps` parser-error når function-decl forward-refereres
- **Empty-states:** Vinder-kort viser "—" + "Ingen X endnu" hvis ingen data. Kalender-sektion vises kun hvis `races.length > 0`
- **Bevidst ikke i denne slice:** ingen ny dedikeret `SeasonCalendarPage.jsx` (genbrug var bedre — undgår kode-død), ingen StandingsPage-link til snapshot (kan tilføjes senere hvis manager-feedback efterlyser det)
- Verificeret: `npm run lint` 0 errors (41 pre-eks. warnings — uændret), `npm run build` grøn (10.74s), `npm test` 104/104. UI-smoke pending — manager validerer kalender-orden, vinder-aggregering på live data og dropdown ↔ URL-sync efter deploy

### Løb-hub konsolidering (v2.22, 2026-05-04 — S9a)
- **Mål:** Konsolidér 3 overlappende race-sider til ét hub-anker så managere har én indgang i stedet for 3 sidebar-entries i 2 forskellige sektioner
- **Frontend:** `RacesPage.jsx` udvidet med 2 nye tabs ud over eksisterende `calendar`/`submit`/`approve`:
  - **`library`** (📚 Bibliotek) — flad liste over alle løb på tværs af alle sæsoner. Filtre: sæson (drop-down), klasse (9 race-klasser fra `RACE_CLASS_OPTIONS`), status (`completed`/`active`/`scheduled`), fritekst-søgning på navn. Filtrering sker client-side via `useMemo` for instant UX (DB har <200 races). Lazy-loaded ved første tab-åbning (`useEffect` watcher på `tab === "library" && !libLoaded && !libLoading`). Klik på række → `/race-archive/:raceSlug`
  - **`points`** (💰 Point & præmier) — embedder `RacePointsPage`-komponenten direkte som tab-indhold. Begge URLs (`/races?tab=points` og `/race-points`) virker
- **Tab-state ↔ URL:** `useSearchParams` læser initial tab fra `?tab=`; `changeTab(next)` opdaterer URL (med `replace: true`, ingen historik-bloat). Whitelisted tabs i `VALID_TABS` så ugyldige query-værdier falder tilbage til `calendar`
- **IA-rensning:**
  - Sidebar `Layout.jsx`: `Resultater → Løbsarkiv` fjernet; `Liga → Løbskalender` → `Liga → Løb`
  - `ResultaterPage.jsx` hub-grid: `Løbsarkiv → /race-archive` erstattet med `Løbsbibliotek → /races?tab=library`; `Pointtabel → /race-points` erstattet med `Point & præmier → /races?tab=points` (begge URLs er stadig valide aliases)
  - `RaceHistoryPage.jsx` back-link: `← Løbsarkiv` → `← Løbsbibliotek` (begge instanser linje 97 + 110)
  - `App.jsx`: `/race-archive` route bytter `<RaceArchivePage />` ud med `<Navigate to="/races?tab=library" replace />`. `RaceArchivePage.jsx` slettet (var eneste forbruger). `/race-archive/:raceSlug` urørt
  - `HelpPage.jsx`: 3 tekst-strenge opdateret (`Løbskalender → Indberét` → `Løb → Indberét`; `Resultater → Pointtabel` → `Løb → Point & præmier`; `Løbsarkiv` sektion omdøbt til `Løbsbibliotek` med ny tekst om søg/filtrer)
- **Backend:** Ny `GET /api/races?season=&class=&q=&status=` (`requireAuth`) ved siden af `/api/race-points`. Accepter både season UUID og season number. Returnerer race-rows med `season:season_id(id, number, status)` join. Frontend bruger fortsat supabase RPC i bibliotek-tab (matcher eksisterende race-pages-mønster — endpoint er for programmatisk/ekstern adgang)
- **RacesPage h1 dynamisk:** "Løb" + sub-tekst der ændrer sig pr. tab (`X løb på tværs af alle sæsoner` / `UCI-pointtabeller og præmieformel` / `Sæson N — N løb`)
- **Bevidst ikke i denne slice:** `/seasons/:seasonId` snapshot (S9b), public-gøre `/api/race-points`, paginering på `/api/races`, point × 15.000 typo i backloggen rettet til 1.500 (var aldrig live)
- Verificeret: `npm run lint` 0 errors (41 pre-eks. warnings — uændret), `npm run build` grøn (8.55s), `npm test` 104/104. UI-smoke pending

### Color-system /N opacity fix (v2.21, 2026-05-04)
- **Pre-eks. bug:** `cz-{success,danger,warning,info,accent,accent-t}` og deres `-bg0` aliases var defineret som plain `var(--xxx)` strings i `frontend/tailwind.config.js`. Tailwind 3's `/N` opacity-syntax kræver enten standard color-format ELLER `<alpha-value>` placeholder — plain `var()` ignoreres silently. Effekt: 50+ callsites med fx `bg-cz-info-bg0/20`, `text-cz-danger/70`, `border-cz-success/30` rendrede transparent. Sandsynligvis siden Dark mode S1 (v2.04).
- **Yderligere fund:** opacity-trin `3`, `8`, `12` (brugt 30+ steder, fx `bg-cz-success-bg0/8`) er ikke i Tailwinds default opacity-skala (5/10/20/25/30/40/50/60/70/75/80/90/95/100) — produceredes aldrig som CSS uanset color-token-fix.
- **Fix:**
  - `frontend/src/index.css` — base CSS-vars konverteret til channel-format (fx `--danger: 185 28 28` i lys, `248 113 113` i mørk; samme for `--success`, `--warning`, `--info`, `--accent`, `--accent-t`)
  - `frontend/tailwind.config.js` — alle 8 status-color tokens (4 base + 4 `-bg0`) + `cz-accent`/`cz-accent-t` brug `rgb(var(--xxx) / <alpha-value>)` syntax. `theme.extend.opacity` udvidet med `3: 0.03`, `8: 0.08`, `12: 0.12`
  - **Bevidst urørt:** `cz-*-bg` (uden -0) — dark mode bruger med vilje `rgba(... 0.12)` for soft tint på alert-baggrunde. Channel-konvertering ville bryde `bg-cz-success-bg`-callsites uden opacity-modifier i dark mode (TransfersPage, NotificationsPage). `--on-accent` urørt (kun brugt på solid sidebar/accent uden opacity).
  - Direct `var(--accent)` / `var(--accent-t)` callsites i 5 filer (`index.css` spinner, `DashboardPage.jsx` MiniBar, `OnboardingTour.jsx` arrow, `LoginPage.jsx` + `ResetPasswordPage.jsx` grid pattern) wrappet i `rgb(...)` så channel-format renderer korrekt.
- **Verificeret runtime via Claude Preview:** 35 opacity-klasser tester nu korrekt (alle returnerer rgba med korrekt alpha). `cz-*-bg` (uden -0) bevarer dark mode rgba 12% tint som før. Build grøn (`vite built in 6.91s`), lint 0 errors (41 pre-eks. warnings).

### Onboarding v2 — Slice 4 Empty-state-tour + completion-celebration (v2.19, 2026-05-04)
- **Empty-state tour-trigger:** `RidersEmptyState`, `AuctionsFirstBidHint` og `BoardEmptyState` får ny `onStartTour`-prop med sekundær "💡 Vis mig rundt"-knap. Manager der lander direkte på siden via menuen får nu tour-tilbud uanset om de gik via Dashboard "Vis mig hvordan". Pattern matcher `FinanceFirstVisitHint`'s allerede-eksisterende `onStartTour`. På `AuctionsFirstBidHint` dismisser tour-knappen samtidig hintet (`handleStartFirstBidTour` i `AuctionsPage`); på Riders/Board dismisses ikke (de er data-driven, ikke localStorage).
- **DashboardPage completion-celebration:** Ny komponent `frontend/src/components/OnboardingCompletionCard.jsx` vises engang når `completed_count === total_count`. Indeholder 🎉 "Du er klar"-overskrift, kort sub-tekst om næste fase (multi-sæson hold-bygning, Deadline Day, oprykning) og 3 quick-link-cards: Deadline Day, Bestyrelse, Hjælp & regler. Dismiss persisteres i localStorage `cz-dashboard-onboarding-completion-dismissed` (separat fra `cz-dashboard-onboarding-dismissed` så de er uafhængige).
- **Fetch-condition justeret:** `DashboardPage.loadAll` henter nu progress hvis `!onboardingDismissed || !completionDismissed` (før kun `!onboardingDismissed`). Sikrer at eksisterende managers der har dismisset progress-kortet stadig ser completion-kortet første gang efter v2.19-deploy.
- **Lukker post-onboarding-cliff:** Før slice 4 forsvandt `OnboardingProgressCard` bare ved completion uden eksplicit "du er klar"-marker. Nu får manager celebration + pegning på næste fase, så de ikke lander på "ingenting" efter at have brugt energi på 4-trins-flowet.
- Verificeret: lint 0 errors (41 pre-eks. warnings, ingen nye), build grøn.

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
- **FinancePage hint:** `frontend/src/components/FinanceFirstVisitHint.jsx` rendres øverst på `/finance` ved første besøg (`localStorage.cz-finance-hint-shown !== "1"`). Forklarer fire pengestrømme i 2x2-grid: (1) Sponsor 240K base × bestyrelses-modifier (link til `/board`), (2) Salary 10% af rytterværdien (uci_points × 4000), (3) Gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), (4) Lån kort vs. langt. CTA "💡 Vis mig rundt" starter tour og dismisser hint i samme handling. Dismiss × eller "Spring over" → permanent skjult.
- **Tour på /finance:** `OnboardingTour pageKey="finance"` mountet på FinancePage med 3 trin der peger på hovedsektionerne (`[data-tour='finance-balance']` → balance/gæld/præmie-grid, `finance-debt-ceiling` → Total gæld-kortet med loft-indikator, `finance-tx-history` → transaktionshistorikken). Ingen step→tour mapping i `TOUR_PAGE_BY_STEP` (touren startes kun fra hint-kortet, ikke fra `OnboardingProgressCard`, da der ikke er en finance-step).
- **Verificeret tal mod runtime (post-07a 2026-05-07):** `backend/lib/economyConstants.js` (SPONSOR_INCOME_BASE = 240000, INITIAL_BALANCE = 800000, MARKET_VALUE_MULTIPLIER = 4000, PRIZE_PER_POINT = 1500, DEBT_CEILING_BY_DIVISION = 1.2M/900K/600K), `database/2026-05-04-salary-generated-column.sql` (SALARY_RATE = 0.10 GENERATED), `database/2026-04-30-economy-light-tune-v176.sql` (debt_ceiling). Match med DB-defaults i schema.sql.
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
- **Playwright smoke + light visual regression (v3.27, #329)** — `frontend/tests/e2e/` kører login + 8 manager-kerneflader (`/dashboard`, `/riders`, `/auctions`, `/team`, `/finance`, `/board`, `/seasons`, `/notifications`) i desktop og mobile Chromium. Supabase/backend er mocket i browser-testen, så PR-checken ikke kræver live secrets og ikke skriver til prod. Screenshots er committede baselines under `core-smoke.spec.js-snapshots/`; opdateres bevidst med `npm run test:e2e:update`.
- **Zero-known-error hardening (v3.31, 2026-05-13):** Drift Monitor workflow bruger nu npm/package-lock i stedet for pnpm, Discord-notification skipper sikkert hvis webhook-secret mangler, audit-scripts klassificerer `auth-failure` vs `rpc-missing`, `agent-doctor.ps1 -Json` er maskinlæsbar Quality Cockpit, Quality Inbox workflow opdaterer ét tracking-issue, lint warning-budget gate blokerer nye warnings over baseline, og Sentry er wired til backend/frontend runtime errors med source-map upload når Sentry build-secrets er sat.
- **backend/node_modules** — nu installeret; `npm run test`, `lint`, `format` virker lokalt

### Sprint-validation foundation — Founder Supporter waitlist (v3.43–v3.45, 2026-05-15/16, #359/#361/#362/#363)
- **`founder_supporter_waitlist` tabel + RLS** (#359, backend-only): 9-felts intent-schema (interest_level + preferred_tier + valued_benefits + fairness_red_line + follow_up_consent), GDPR `consent_given_at NOT NULL`, generated `intent_score` (1-5 efter Manus-formel), genbrugelig `is_admin()`-helper. RLS: anon/authenticated INSERT med consent-check, admin-only SELECT, service_role for mutation. Verificeret via `BEGIN/ROLLBACK`-tests + post-apply prod-state-tjek.
- **Waitlist-form** (#362, v3.44): Public route `/founder-supporter` med embedded form — email/Discord (mindst én), interesseniveau, tier-radio, valgfri benefits + fritekst, country (EU-prefill). GDPR-consent IKKE pre-tjekket. UTM-capture via `useSearchParams` (`utm_source`/`utm_campaign`/`utm_medium` + ny `country` ISO-2). Submit bruger `Prefer: return=minimal` UDEN `.select()` (anon har ingen SELECT-policy så RETURNING fejler RLS-violation); duplicate-detektion via `error.code === '23505'`. Honeypot mod bots. Pure helpers i `frontend/src/lib/waitlistForm.js` (35 unit-tests).
- **Admin dashboard** (#363, v3.43): `/admin/waitlist` (admin-gated, RLS-bagside) med sortérbar tabel, 5 filtre, 5 KPI-kort (total, high-intent ≥4, % vil betale, % Pro Analyst, top 3 kilder) og CSV-eksport af filtreret data (16 kolonner inkl. PII).
- **Landing page** (#361, v3.45): `/founder-supporter` upgraded fra form-side til fuld marketing-side — hero med non-pay-to-win-løfte, fair-premium-løftet, 4-tier pris-sammenligning (Free/Supporter/Pro Analyst/Patron), "må sælges vs IKKE sælges"-tabel direkte fra BUSINESS_STRATEGY §3, Founder benefits, 6-spørgsmåls FAQ, embedded form, FAQ-accordion. **DA/EN sprog-toggle** synkroniseret med `?lang=en` — hele siden + formen (radio-options, country, fejlbeskeder, success-state) oversættes. `?variant=A|B|C` + `utm_campaign=launch_29dkk|49dkk|69dkk` ændrer Supporter-pris i pris-sammenligningen (annual = monthly × 10 dynamisk). OpenGraph + Twitter Card-metadata + 1200×630 SVG OG-image (`og-cycling-zone.svg`). `validateForm`/`mapInsertError` lang-aware med default `"da"` for backwards-compat.

### i18n Fase 3d — Help EN/DA (v3.57, 2026-05-18, #412 / PR #482)
- **HelpPage** (921 linjer) — alle hardcoded DK-strings via `useTranslation("help")`: sidetitel + subtitle, søgeboks, sidebar med 14 sektioner (Kom i gang / Bestyrelse / Auktioner / Transfers / Manager & Profil / Discord DMs / Achievements / Talentspejder / Min Aktivitet / Sæson / Præmier / Divisioner / Ryttere / Aktivitetsfeed) + FAQ-link, ~80 indholds-blokke (titel + text/steps/rows) og 53 FAQ Q/A-par. Searchfunktion filtrerer på tværs af labels/titler/tekst/Q/A på det aktive sprog.
- **`help.json` bundlet inline** i `i18n/index.js` (samme pattern som `dashboard`/`auctions`/`transfers`/`banners`) → FOUC-fri first paint.
- **SECTIONS-array refaktoreret** fra hardcoded data-struktur til `SECTION_DEFS` (key/icon/blocks) + `buildSections(t)`-helper. **FAQ-array** → `FAQ_KEYS`-liste + `buildFaq(t)`-helper. Stabile semantic keys: `sections.<area>.<block>.title|text|steps|rows`, `faq.<id>.q|a`.
- **Em-dash systematisk renset** i begge sprog jf. `docs/TONE_OF_VOICE.md` (2026-05-18 tone-guide). Erstattet med komma, kolon, parentes eller punktum efter kontekst. Tabel-celler kan beholde `—` som "tom celle"-indikator.
- **Scope-korrektion:** AdminPage forbliver **dansk-only by design** — alle 23 sektioner er internal admin-tools (race-katalog, økonomi, sæsoner, manuel override, discord webhooks, beta-reset, præmieudbetaling, brugere osv.) bag admin-role gating. Ingen publik-facing flader = ingen ROI. Triage-kommentaren om "~71 t()-kald" var fejlbehæftet (faktisk 0). `admin.json` forbliver tom placeholder.
- **`help` namespace keys:** ~520 per sprog (page, sections × 14, faq × 53).

### i18n Fase 3c — Transfers EN/DA (v3.53, 2026-05-17, #412)
- **TransfersPage** (1461 linjer) + **TeamTransferHistoryTab** (194 linjer) — alle hardcoded DK-strings via `useTranslation("transfers")`: sidetitel, balance-card, transfervindue-banner, 6 tabs (Modtagne/Sendte/Historik/Byttehandler/Lejeaftaler/Marked), status-badges på 4 kort-typer (ReceivedOfferCard, SentOfferCard, SwapCard, LoanCard), 2 forms (NewSwapForm, NewLoanForm), TransferCard market-listing.
- **`transfers.json` bundlet inline** i `i18n/index.js` (samme pattern som `common`/`auth`/`errors`/`auctions`) → FOUC-fri first paint + ingen HttpBackend race-condition på tunge nested status-keys.
- **Toast-flow oversat:** ~25 toast-strenge for tilbud/swaps/loans + 3 celebration-titler (transferDone/swapDone/buyoutDone). Action-handlers bygger nu `msgs`-mapping via `t()`-kald inde i komponenten (i stedet for modul-konstanter) så de re-renders ved sprogskift.
- **Intl-modernisering:** ~30 hardcoded `toLocaleString("da-DK")` → `formatNumber(...)`. `new Date(...).toLocaleDateString("da-DK", ...)` → `formatDate(date, null, {day,month})` på TransferCard.listedSince + `formatDate(date, "short")` på history. `timeAgo` konverteret til `useTimeAgo()`-hook (returnerer "Lige nu / Just now", "15m siden / 15m ago" osv.).
- **STATUS_CONFIG og LOAN_STATUS_CONFIG** modul-konstanter refaktoreret til pure-style maps + `statusCfg(t, status)` / `loanCfg(t, status)`-helpers så labels følger sproget mens farver/border-classes forbliver konstante.
- **`transfers` namespace keys:** ~150 per sprog (page, window, tabs, status, loanStatus, type, direction, relativeTime, offerCard, swapCard, loanCard, transferCard, newSwap, newLoan, history, sections, empty, toast, celebration).
- **BidConfirmModal** brugte allerede `mode="transfer"` fra Fase 3b — ingen ændring nødvendig.
- **Out-of-scope** (følger senere): HelpPage (Fase 3d), AdminPage publik-facing dele (3d).

### i18n Fase 3b — Auctions EN/DA (v3.52, 2026-05-17, #412 / PR #466)
- **AuctionsPage** (1376 linjer) + 4 components (`BidConfirmModal`, `AuctionsFirstBidHint`, `AuctionsSidebarFeed`, `OverbidToast`) — alle hardcoded DK-strings via `useTranslation(["auctions", "common"])`: sidetitel, 3 filter-tabs (Min situation/Alle/Andre managers med ICU plurals), Ønskeliste-toggle, Aktive/Historik-nav, 4 stat-cards (Balance/Reserveret/Ryttere/Projektion), tabel + mobil-kort (8 kolonne-headers, 5 badges, countdown-timer h:m:s), bid-flow + autobud-loft, live-ticker, sidebar-feed, overbid-toasts, first-bid-hint, empty-states, My situation-sektioner.
- **`auctions.json` bundlet inline** i `i18n/index.js` (samme pattern som `common`/`auth`/`errors`) → FOUC-fri first paint + ingen HttpBackend race-condition. Postmortem: `.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md` (5-runde CI-fix-loop fordi auctions.json oprindeligt lazy-loadede → t() returnerede rå key i headings).
- **`common.json`** udvidet med `actions`-block (cancel/save/close/hide/loading/loadingShort/success/error) — delt på tværs af fremtidige i18n-faser.
- **Intl-modernisering:** ~16 hardcoded `toLocaleString("da-DK")` → `formatNumber(...)` i AuctionsPage + 3 components. Countdown-`endLabel` bruger nu `i18n.language` i stedet for "da-DK".
- **`AUCTIONS_TOUR_STEPS`** modul-konstant → `getAuctionsTourSteps(t)`-funktion, kaldes via `useMemo` så onboarding-tour rendres med korrekt sprog.
- **Forward-guards landet i samme session:** `core-smoke.spec.js` heading-regex + per-spec snapshot-threshold (inbox 0.12) + `scripts/hooks/check-ci-before-push.sh` PreToolUse-hook + CLAUDE.md pre-flight checklist.
- **Auctions namespace keys:** ~110 per sprog (page, tour, hint, ticker, stats, filter, nav, table, card, timer, badge, bid, proxy, section, empty, feed, toast, modal, fallback, celebration, error).
- **Verificeret live:** `https://cycling-zone.vercel.app/locales/en/auctions.json` returnerer page.title="Auctions", bid.buttonPlace="Bid"; DA returnerer "Auktioner"/"Byd"/"byde".
- **Out-of-scope** (følger senere): TransfersPage (#412 Fase 3c), HelpPage (3c/3d), AdminPage (3d).

### i18n Fase 3a — Dashboard EN/DA (v3.51, 2026-05-17, #412 / PR #461)
- **DashboardPage** — alle hardcoded DK-strenge via `useTranslation(["dashboard","common"])`: header (Division + rytter-count med ICU plurals + ind/ud/leje-deltas), squad-warning, Discord-DM-nudge, Deadline Day-banner, Sæson-banner (status-pills, dage tilbage, løbsdage, transfervindue-state), 4 stat-cards og 5 indholds-kort (Aktive Auktioner / Transfers & Tilbud / Kommende Løb / Division-Stilling / Bestyrelsens Status).
- **`FinanceForecastCard` + `FinanceForecastBadge`** — tier-meta (Grøn/Gul/Rød ↔ Green/Yellow/Red), prognose-block (forventet net + spænd + tagline), cashflow-tabel, sponsor-detail (variable/intro/fallback) og footnote-link oversat. `formatSigned` bruger `formatNumber()` (locale-aware) i stedet for hardcoded `"da-DK"`.
- **`OnboardingProgressCard` + `OnboardingCompletionCard`** — step-labels, CTA-knapper og tour-trigger henter alt fra `dashboard.json`.
- **`dashboardSquadStats.warning`** refaktoreret til pure data (`{type, count, limit, division, color}`) — UI bygger besked via ICU plurals så "Sælg 1 rytter" / "Sell 2 riders" er korrekte (tests opdateret 11/11).
- **`lib/intl.formatDate(date, null, options)`** understøtter fine-grained Intl-options ved at droppe `dateStyle` når style er `null`. Bruges fx på løbsdatoer ("3. jul" / "Jul 3").
- **`dashboard.json`** — 112 keys per sprog (fyldt fra Fase 1 tom-placeholder).
- **Out-of-scope** (følger senere): `boardOutlook.feedback.*` på Dashboard kommer fra `/api/board/status` → backend-i18n separat slice; BoardPage bruger stadig `FOCUS_LABELS` (Board ikke på #412-scope); Auctions/Transfers/Help/Admin = Fase 3b–3d.

### i18n Fase 2 — Auth + Onboarding critical path (v3.47, 2026-05-16, #411)
- **LoginPage refactor** — alle 30+ strings via `useTranslation(["auth", "errors"])`. `<LanguageSwitcher />` øverst-til-højre pre-login så bruger kan vælge sprog FØR signup. Signup sender `options.data.language=currentLng` så `handle_new_user`-trigger gemmer korrekt sprog på DB-rækken.
- **ResetPasswordPage** — fuld refactor med samme switcher i top-right.
- **SetupWizardModal + OnboardingModal + OnboardingTour** — alle strings flyttet til `auth.json`.
- **Layout (NavBar)** — Liga-gruppe (Hold/Head-to-Head/Sæson Preview), admin-gruppe (Admin/Waitlist), sidebar Balance/Division/online-count oversat. Sidebar-balance bruger locale-aware `formatNumber()` (1.234 DA / 1,234 EN).
- **`lib/authErrors.js`** — `mapSupabaseAuthError(error, t)` mapper Supabase auth-fejl (invalid credentials, email not confirmed, user already registered, rate limit m.fl.) til `errors.json`-keys. Bruges af LoginPage forgot/signup + ResetPasswordPage updateUser.
- **`auth.json` (75+ keys) + `errors.json` (13 keys)** bundlet inline i `i18n/index.js` (samme mønster som `common.json`) → FOUC-fri first paint på Login. Postmortem: `2026-05-16-i18n-lazy-ns-rerender-fouc.md` (HTTP-backend lazy-load triggrer ikke pålideligt re-render med `useSuspense: false`). +~6 KB initial JS.
- **Verificeret på prod (DA+EN):** Login fejl-mapping, signup-existing-email, reset-password uden session, setup-wizard NULL manager_name, sidebar nav. Brugerverifikations-kommentar: https://github.com/NicolaiDolmer/CyclingZone/pull/444#issuecomment-4467644990
- **Out-of-scope follow-ups:** [#446](https://github.com/NicolaiDolmer/CyclingZone/issues/446) signup bootstrap silent fail (preexisting), [#447](https://github.com/NicolaiDolmer/CyclingZone/issues/447) Privatlivspolitik footer untranslated, [#448](https://github.com/NicolaiDolmer/CyclingZone/issues/448) Vercel Preview env. Dashboard-cards oversættelse er separat fremtidig slice.

### i18n foundation — EN/DA sprog-switcher (v3.46, 2026-05-16, #410)
- **`public.users.language`** (NOT NULL DEFAULT 'en', CHECK en/da) + `sync_user_language_to_auth_meta`-trigger (SECURITY DEFINER) der propagerer skift til `auth.users.raw_user_meta_data.language` for Edge Functions + email-templates. 23 backfilled brugere → 'da'.
- **`handle_new_user`-trigger** opdateret: læser `raw_user_meta_data->>'language'` ved signup (default 'en'). Frontend skal sende `language` i `supabase.auth.signUp({ options: { data: { language } } })` — wireup gøres i Fase 2 (#411).
- **react-i18next + i18next-icu + intl-messageformat + HTTP-backend** — ICU plurals fra dag 1, lazy-loaded namespaces fra `/locales/{lng}/{ns}.json`, `common.json` bundlet inline → FOUC-fri first paint på NavBar.
- **LanguageProvider + useLanguage hook** (`frontend/src/lib/language.jsx`) — DB → localStorage → browser → 'en'. `setLanguage(lng)` skriver DB + localStorage + skifter live.
- **Intl-wrappers** (`frontend/src/lib/intl.js`) — `formatCurrency('da', 1500, 'DKK')` → `"1.500,00 kr."`; `('en')` → `"DKK 1,500.00"`. Også `formatDate/DateTime/Number/RelativeTime`.
- **LanguageSwitcher** — 🇩🇰/🇬🇧 dropdown i sidebar-footer (desktop) + mobile topbar. ARIA, escape-close, cz-tokens.
- **Pseudo-locale `en-XA`** — aktiveres med `?pseudo=1`; wrapper alle `t(...)`-output i `[...]` for at fange hardcoded strings i dev.
- **CI key-coverage guard** (`scripts/i18n-check-keys.mjs` + `.github/workflows/i18n-check.yml`) — fail PR hvis en/da har divergerende nøgler. Advisory i Fase 1 (continue-on-error), promotes til required i Fase 5 (#414).
- **Glossary** (`docs/i18n/GLOSSARY.md`) — 20+ domæne-termer + pluraliseringsregler. **Deferred til Fase 5 (#414):** lint-guard mod hardcoded strings + `ml-*`/`mr-*` → `ms-*`/`me-*` migration prereq [#438](https://github.com/NicolaiDolmer/CyclingZone/issues/438).

### Observabilitet & Analytics (v3.20, 2026-05-11, #137)
- **Microsoft Clarity** — UI-heatmaps, session-replays, drop-off-rapporter; konsent-gated via `analytics`-kategori (#297). Tags `manager_id`/`division`/`season_number` stamped per session.
- **player_events** — Supabase-tabel (`team_id, user_id, event_name, event_data jsonb, created_at`) m. RLS-policies så managers kun ser egne rows. 3 indices (pkey + `event_name+created_at` + `team_id+created_at`).
- **logEvent helper** — `frontend/src/lib/logEvent.js`. Consent-gated (samme `analytics`-flag som Clarity), fire-and-forget, swallow-errors så instrumentation aldrig bryder user flow. `KNOWN_EVENTS`-frozen-array er single source of truth for hvilke events der bør være impressions for.
- **10 events instrumenteret:**
  - Game: `session_started`, `auction_view`, `auction_bid_placed`, `transfer_offer_sent`, `notification_clicked`
  - Feature-impressions (slice 14 / #279-canary-mønstret): `feature_rider_development_tab_opened`, `feature_admin_auction_config_opened`, `feature_board_consequences_panel_viewed`, `feature_finance_forecast_card_viewed`, `feature_hall_of_fame_opened`
  - Resterende ~10 events fra #137-scope-udvidelsen er flyttet til [#306](https://github.com/NicolaiDolmer/CyclingZone/issues/306).
- **Detector E** — `audit-feature-liveness.js` queryer `feature_liveness_event_counts(window_days)` RPC; flagger events i `KNOWN_EVENTS` med 0 impressions sidste 30 dage. Skipper PR-runs (events tager dage at akkumulere), kører ugentligt cron mandage 04:00 UTC + workflow_dispatch. Tracking-issue åbnes ved findings (label `quality-drift`). `feature_board_consequences_panel_viewed` er midlertidigt whitelistet, fordi board consequences er milestone-gated indtil sæson 1-flowet producerer naturlige impressions (#284/#335).

---

## 🔴 Broken / Kendte bugs


---

## 📋 Planlagt (backlog)

- Aktiv feature- og forbedringsbacklog vedligeholdes som GitHub issues (`gh issue list --label "claude:todo" --state open`); backlog-fil arkiveret 2026-05-06 per [#68](https://github.com/NicolaiDolmer/CyclingZone/issues/68).
- **Aktiv teknisk hardening efter #325/#326-close-out (2026-05-13):** #325 runtime-status er kendt: RLS audit workflow grønt + feature-liveness workflow uden RPC-missing fejl. Den kendte Detector E-finding (`feature_board_consequences_panel_viewed`) håndteres i #335 med en midlertidig milestone-gated whitelist. #327 (secret management ADR), #328 (backend rate limiting) og #329 (Playwright smoke/light visual regression) er shipped/lukket; resterende #325-follow-ups: #336, #337.
- **#242 race-import er parkeret til ca. 2026-05-14/15:** kode og race-pool er live som v2.99 (`RacePoolSection` → `/api/admin/seasons/:seasonId/race-selection/preview` + `/race-selection`, `race_pool` migration/seed), men resterende arbejde er manuel admin-handling: vælg sæson 1-kalender i `/admin` før `Sæson-cyklus` køres omkring sæsonstart.
- Economy baseline & simulation gennemført (v1.76 tune applied); næste spor er iteration baseret på live beta-data.
- Team ID-mapping fra PCM
- Cyclist ID-mapping fra PCM
- 3-sæsoners glidende gennemsnit for rangliste
