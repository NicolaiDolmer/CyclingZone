# ARCHITECTURE — Teknisk Reference

## Stack

| Lag | Teknologi | Deploy |
|-----|-----------|--------|
| Frontend | React 18 + Vite + Tailwind CSS | Vercel |
| Backend | Node.js + Express (ES modules) | Railway |
| Database / Auth | Supabase (PostgreSQL + RLS) | Supabase cloud |
| Realtime sync | Cron (backend/cron.js, 60s interval) | Railway (via backend-processen) |
| UCI sync (automatisk) | GitHub Actions cron (mandag 06:00 UTC) → scripts/uci_scraper.py → ProCyclingStats → Google Sheets + Supabase | GitHub Actions |
| UCI sync (manuel) | Admin: POST /api/admin/sync-uci → sheetsSync.js → Google Sheets CSV | — |
| Stats sync (dyn_cyclist) | Admin: POST /api/admin/sync-dyn-cyclist → dynCyclistSync.js → Google Sheets | — |

`recharts` er installeret i frontend og bruges til rytterens `Udvikling`-tab.

---

## Frontend Routes

```
/login                → LoginPage
/dashboard            → DashboardPage
/riders               → RidersPage
/riders/:id           → RiderStatsPage
/auctions             → AuctionsPage
/auctions/history     → AuctionHistoryPage
/transfers            → TransfersPage
/team                 → TeamPage
/teams                → TeamsPage
/teams/:id            → TeamProfilePage
/standings            → StandingsPage
/board                → BoardPage
/notifications        → NotificationsPage
/compare              → RiderComparePage
/profile              → ProfileRedirect → /managers/:ownTeamId
/managers/:teamId     → ManagerProfilePage
/activity             → ActivityPage
/activity-feed        → redirect til /notifications
/watchlist            → WatchlistPage
/finance              → FinancePage
/help                 → HelpPage
/hall-of-fame         → HallOfFamePage
/season-preview       → SeasonPreviewPage
/season-end           → SeasonEndPage
/head-to-head         → HeadToHeadPage
/patch-notes          → PatchNotesPage
/races                → RacesPage
/resultater           → ResultaterPage
/rider-rankings       → RiderRankingsPage
/race-archive         → RaceArchivePage
/race-archive/:raceSlug → RaceHistoryPage
/admin                → AdminPage
```

---

## Backend API Endpoints (primært `backend/routes/api.js`)

### Riders
```
GET  /api/riders                  q, team_id, free_agent, u25, min_uci, max_uci, sort, order, page
GET  /api/riders/:id
GET  /api/riders/:id/watchlist-count
POST /api/riders/:id/view
```

### Auctions
```
GET  /api/auctions
POST /api/auctions                 { rider_id, starting_price, requested_start }
POST /api/auctions/:id/bid         { amount }
POST /api/auctions/:id/finalize
```

### Transfers
```
GET    /api/transfers
POST   /api/transfers              { rider_id, asking_price }
DELETE /api/transfers/:id
POST   /api/transfers/offer        { listing_id, offer_amount }
POST   /api/transfers/:id/offer    { offer_amount }
GET    /api/transfers/my-offers
PATCH  /api/transfers/offers/:id   { action: accept|reject|counter, counter_amount }
GET    /api/transfers/swaps
POST   /api/transfers/swaps        { offered_rider_id, requested_rider_id, cash_adjustment }
PATCH  /api/transfers/swaps/:id    { action: accept|reject|counter|withdraw, counter_cash }
```

### Rider Loans
```
GET   /api/loans
POST  /api/loans                  { rider_id, from_team_id, loan_fee, end_season, buy_option_price }
PATCH /api/loans/:id              { action: accept|reject }
```

### Finance Loans
```
GET   /api/finance/loans
POST  /api/finance/loans          { loan_type, amount }
POST  /api/finance/loans/:id/repay { amount }
```

### Teams & Managers
```
GET /api/teams/my
PUT /api/teams/my                { name, manager_name }
GET /api/teams/:id
GET /api/managers/:teamId
```

### Notifications
```
GET   /api/notifications
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```
- Frontend læser og markerer i praksis notifikationer direkte mod Supabase-tabellen under RLS; backend-routes findes stadig til samme domæne

### Board
```
GET  /api/board/status            → { board, outlook, personality, identity_profile, standing, riders, snapshots, request_status, request_options }
POST /api/board/proposal          { plan_type, focus }
POST /api/board/sign              { plan_type, focus, negotiations? }
POST /api/board/request           { request_type }
POST /api/board/renew
```

### Misc
```
POST /api/presence
POST /api/login-streak
GET  /api/online-count
GET  /api/achievements
POST /api/achievements/check
GET  /health
```

### Transfer Window
```
GET  /api/transfer-window                 → { open, status, season_id }
```

### Admin
```
POST /api/admin/seasons                   { number, race_days_total }
POST /api/admin/races                     { season_id, name, race_type, stages, start_date, prize_pool, race_class? }
POST /api/admin/import-results            multipart: file + race_id
POST /api/admin/seasons/:id/start
POST /api/admin/seasons/:id/end
POST /api/admin/seasons/:id/rebuild-standings
POST /api/admin/sync-uci
POST /api/admin/override-rider
POST /api/admin/approve-results
POST /api/admin/finalize-expired-auctions
PATCH /api/admin/loan-config
POST /api/admin/adjust-balance
GET  /api/admin/season-end-preview/:seasonId
POST /api/admin/transfer-window/open      { season_id } → { riders_processed }
POST /api/admin/transfer-window/close     → { success }
POST /api/admin/beta/cancel-market
POST /api/admin/beta/reset-rosters
POST /api/admin/beta/reset-balances       { clear_transactions? }
POST /api/admin/beta/reset-divisions
POST /api/admin/beta/reset-board
POST /api/admin/beta/reset-calendar
POST /api/admin/beta/reset-seasons
POST /api/admin/beta/reset-manager-progress
POST /api/admin/beta/reset-achievements
POST /api/admin/beta/full-reset           { clear_transactions?, reset_mode? }
```

Season flow notes:
- `POST /api/admin/import-results` og `POST /api/admin/approve-results` deler nu samme result-write path via `backend/lib/raceResultsEngine.js`
- Result-finalisering skriver `race_results`, bogfører prize-transaktioner med gyldig finance-type og recalculerer derefter `season_standings` fra persisted data
- `POST /api/admin/seasons/:id/end` stopper hvis der stadig findes `pending_race_results` for løb i sæsonen
- `POST /api/admin/seasons/:id/rebuild-standings` er repair-pathen for aktive/afsluttede sæsoner, hvis standings skal genopbygges fra persisted `race_results`
- `backend/routes/api.js` er nu den kanoniske ejer af admin season/import-routes; `backend/server.js` monterer routeren, `sync-uci` og health-checks, men ejer ikke længere parallelle season/import handlers
- Beta-reset endpoints delegerer til `backend/lib/betaResetService.js`, så del-reset og fuld reset bruger samme scope: aktive manager-hold (`is_ai=false`, `is_bank=false`, `is_frozen=false`) og aldrig AI-/bank-/frosne hold

---

## Canonical Runtime Paths

### Auktioner
- UI læser aktive auktioner direkte fra Supabase (`auctions`) og placerer bud via `POST /api/auctions/:id/bid`
- Manuel afslutning (`POST /api/auctions/:id/finalize`), admin-bulkfinalisering (`POST /api/admin/finalize-expired-auctions`) og cron (`backend/cron.js`) delegérer alle til `backend/lib/auctionFinalization.js`
- Finalisering skriver til `auctions`, `riders`, `teams`, `finance_transactions`, `notifications` og `activity_feed`
- `seller_team_id` kan blive nulstillet ved afslutning af ikke-ejede auktionsflows for at undgå falsk historik
- Transfer window og squad limit håndhæves ved finalisering, ikke kun ved oprettelse eller bud

### Sæsonflow
- Admin starter flowet via `POST /api/admin/seasons`, `POST /api/admin/races`, `POST /api/admin/seasons/:id/start`, derefter enten `POST /api/admin/import-results` eller `POST /api/admin/approve-results`, og til sidst `POST /api/admin/seasons/:id/end`
- De admin-entrypoints ejes nu kun af `backend/routes/api.js`, så season-flowets guardrails ikke kan drive mellem router og bootstrap-server
- Den kanoniske season engine ligger i `backend/lib/economyEngine.js`
- `race_results` er persisted sandhed for standings; `season_standings` recalculeres derfra og persisterer også `rank_in_division`
- `backend/lib/raceResultsEngine.js` er shared execution path for result-finalisering, prize-write og standings-recalculation
- `backend/lib/adminImportResultsHandler.js` binder den direkte xlsx-import til samme shared result-engine som pending-approval flowet
- Transfer-window-state er del af season-flowets runtime-kontrakt

### Board
- Board wizard-preview, signering og kontraktfornyelse går gennem `/api/board/*` og den delte `backend/lib/boardEngine.js`
- Frontend vælger mellem server-genererede board-forslag og forhandlingsvarianter i stedet for selv at konstruere de endelige mål
- `GET /api/board/status` er den kanoniske read-path for board-state; både Dashboard og Board-siden læser herfra i stedet for egne board-queries
- Proposal- og request-logik tuner nu mål efter divisionens squad-limits, nuværende standings og en afledt holdprofil baseret på rytternes stats/U25-mix
- Mid-season board requests går gennem `POST /api/board/request`, som både afgør approved/partial/rejected/tradeoff og persisterer svaret i `board_request_log`
- `buildBoardOutlook` leverer personality, identity_profile, feedback og category breakdown til UI, mens `evaluateBoardSeason` bruger samme vægtede runtime-path ved sæsonslut
- `processSeasonEnd` bruger samme board-engine til sæsonevaluering, så sign-flow, status-read og season-end deler board-sandhed

### Notifications
- Backend-genererede notifikationer går gennem `backend/lib/notificationService.js`
- API-routes, cron, economy-engine og loan-engine deler samme notification-writer i stedet for rå `notifications`-inserts
- Shared writer deduplikerer nylige identiske payloads (`user_id`, `type`, `title`, `message`, `related_id`) for at undgå spam ved cron/retries

### Managerprofil / hold-bootstrap
- Signup og Min Profil skriver holdnavn/managernavn via `PUT /api/teams/my` i stedet for direkte browser-writes til `teams`
- `backend/lib/teamProfileEngine.js` er den delte write-path for create/update af managerens eget hold og håndterer også bootstrap af manglende `board_profiles`
- Denne path findes for at holde `teams`-writes bag backend/service-role, fordi runtimeen ikke må være afhængig af direkte klient-writes mod RLS-beskyttede tabeller

### Lån og markedsdomæner
- Rider-lån bruger `loan_agreements` og `/api/loans`
- Finance-lån bruger `loans` + `loan_config` og `/api/finance/loans`
- Fortsatte rider-lån opkræver `loan_fee` ved sæsonstart for hver dækket sæson efter aktivering
- `backend/lib/marketUtils.js` er shared market-state for squad-limit checks og tæller current riders, `pending_team_id` og aktive `loan_agreements` for lånerholdet
- Transfer- og swap-bekræftelse går gennem `backend/lib/transferExecution.js`, som re-checker ejerskab, saldo og squad-limit ved commit-tid
- Auktionsfinalisering bruger samme shared market-state ved squad-limit-vurdering, så cron/admin/API følger samme holdstørrelses-sandhed
- Gennemførte markeds-handler rydder relaterede `transfer_listings`, `transfer_offers` og `swap_offers` op for de involverede ryttere
- Domænerne må ikke dele route-path eller execution path

### Deploy og live-verifikation
- Se `docs/DEPLOYMENT.md` for aktuelle live-URLs, release-path og standard smoke checks

### UCI scraper safety
- `scripts/uci_scraper.py` skal bruge PCS form-route `rankings.php?p=me&s=uci-individual&offset=...`; pretty URL med `?offset=...` returnerer top 1-100 igen.
- Default dry-run skal vise `pages=30`, `total=3000`, `rank_min=1`, `rank_max=3000`, `duplicate_ranks=0` før writes godkendes.
- `--dry-run` må aldrig skrive Google Sheets eller Supabase.
- Supabase-write skal logge safety report med `matched`, `not_found`, `updates`, `restored_from_minimum` og `minimum_downgrades`.
- Mass-nedskrivning til `MIN_UCI_POINTS` kræver manuel audit og må ikke accepteres som normal sync.

---

## Backend Lib-moduler

| Fil | Eksporterede funktioner |
|-----|------------------------|
| `auctionEngine.js` | `calculateAuctionEnd`, `checkBidExtension`, `isAuctionExpired`, `formatAuctionEnd` |
| `boardEngine.js` | Facade — re-eksporterer alt fra boardConstants, boardIdentity, boardGoals, boardRequests, boardEvaluation. Ingen egne funktioner. |
| `boardConstants.js` | Alle board-konstanter og exported configs (`BOARD_IDENTITY_RIDER_SELECT`, `VALID_BOARD_*`, `BOARD_REQUEST_DEFINITIONS`, m.fl.) |
| `boardIdentity.js` | `deriveTeamIdentityProfile`, `deriveBoardPersonality`, `getDivisionSquadLimits`, `normalizeBoardRider`, `hasStrongNationalCore`, `hasStrongStarProfile`, `getNationalCoreIdentityBonus`, `getStarProfilePrestigeBonus`, `getStarProfileGoalPressure`, `getStarProfileSponsorPressure` |
| `boardGoals.js` | `getPlanDuration`, `parseBoardGoals`, `generateBoardGoals`, `buildNegotiatedGoal`, `buildBoardProposal`, `createInitialBoardProfile`, `finalizeBoardGoals`, `inferNegotiationIndexesFromGoals`, `evaluateGoal`, `countGoalsMet`, `evaluateGoalProgress`, `addGoalMetadata`, `normalizeComparableGoal`, `buildGoalLabel` |
| `boardRequests.js` | `isValidBoardFocus`, `isValidBoardPlanType`, `isValidBoardRequestType`, `getBoardRequestDefinition`, `buildBoardRequestOptions`, `resolveBoardRequest` |
| `boardEvaluation.js` | `buildBoardOutlook`, `calculateBoardSatisfaction`, `satisfactionToModifier`, `evaluateBoardSeason`, `calculateBoardPerformance` |
| `boardUtils.js` | `clamp`, `clampSatisfaction`, `roundNumber`, `safeJsonParse`, `averageNumbers`, `averageTopScores`, `clampToStep`, `scoreHigherBetter`, `scoreLowerBetter`, `scoreDebtGoal` |
| `notificationService.js` | `notifyUser`, `notifyTeamOwner` |
| `auctionFinalization.js` | `finalizeAuctionById`, `finalizeExpiredAuctions`, `sellerOwnsAuctionRider`, `calculateAuctionSalary` |
| `adminImportResultsHandler.js` | `createAdminImportResultsHandler` |
| `economyEngine.js` | `processSeasonStart`, `processSeasonEnd`, `updateStandings` |
| `loanEngine.js` | `getLoanConfig`, `getTotalDebt`, `createLoan`, `createEmergencyLoan`, `repayLoan`, `processLoanInterest` |
| `marketUtils.js` | `getTeamMarketState`, `getIncomingSquadViolation`, `getOutgoingSquadViolation`, `getTransferWindowOpen`, `calculateMarketSalary` |
| `raceResultsEngine.js` | `buildRacePrizeLookup`, `buildRaceResultsFromPending`, `applyRaceResults` |
| `sheetsSync.js` | `handleSyncRequest`, `syncUCIPoints` — logger også i `rider_uci_history` |
| `dynCyclistSync.js` | `handleDynCyclistSyncRequest`, `syncDynCyclist` — logger også i `rider_stat_history` |
| `teamProfileEngine.js` | `upsertOwnTeamProfile` |
| `transferExecution.js` | `confirmTransferOffer`, `confirmSwapOffer`, `getTransferExecutionIssue`, `getSwapExecutionIssue` |
| `discordNotifier.js` | `notifySeasonEvent` |

---

## Database-tabeller

```
rider_uci_history   id(uuid), rider_id(→riders), uci_points(int), synced_at(timestamptz)
                    INDEX: (rider_id, synced_at DESC)
                    Populeres af: sheetsSync.js (manuel sync) + scripts/uci_scraper.py (automatisk ugentlig)

rider_stat_history  id(uuid), rider_id(→riders), synced_at(timestamptz),
                    stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
                    stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
                    stat_res, stat_ftr, height, weight, popularity
                    INDEX: (rider_id, synced_at DESC)
                    Populeres af: dynCyclistSync.js (manuel sync fra WorldDB/dyn_cyclist ark)

users            id(uuid), email, username, role(admin|manager), created_at
teams            id, user_id, name, is_ai, division(1-3), balance, sponsor_income,
                 is_frozen, is_bank, manager_name, created_at
riders           id, pcm_id, firstname, lastname, full_name(gen), birthdate,
                 nationality_code, height, weight, popularity, uci_points,
                 price(gen), salary, team_id, pending_team_id, ai_team_id, is_u25,
                 stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
                 stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
                 stat_res, stat_ftr
seasons          id, number, status(upcoming|active|completed), start_date,
                 end_date, race_days_total, race_days_completed
races            id, season_id, name, race_type(single|stage_race), stages,
                 start_date, status(scheduled|active|completed), prize_pool
race_results     id, race_id, stage_number, result_type(stage|gc|points|mountain|young|team),
                 rank, rider_id, rider_name, team_id, team_name, finish_time,
                 points_earned, prize_money
auctions         id, rider_id, seller_team_id, starting_price, current_price,
                 current_bidder_id, min_increment, requested_start, calculated_end,
                 actual_end, status(active|extended|completed|cancelled),
                 extension_count, is_guaranteed_sale, guaranteed_price
auction_bids     id, auction_id, team_id, amount, bid_time, triggered_extension
transfer_listings  id, rider_id, seller_team_id, asking_price,
                    status(open|negotiating|sold|withdrawn)
 transfer_offers    id, listing_id, rider_id, seller_team_id, buyer_team_id,
                    offer_amount, round, message,
                    status(pending|accepted|rejected|countered|awaiting_confirmation),
                    counter_amount, buyer_confirmed, seller_confirmed
swap_offers        id, offered_rider_id, requested_rider_id, proposing_team_id,
                   receiving_team_id, cash_adjustment, counter_cash,
                   status(pending|countered|awaiting_confirmation|accepted|rejected|withdrawn),
                   proposing_confirmed, receiving_confirmed
loan_agreements    id, rider_id, from_team_id, to_team_id, loan_fee, start_season,
                   end_season, buy_option_price,
                   status(pending|active|completed|rejected|cancelled|buyout)
board_profiles     id, team_id(unique), plan_type(1yr|3yr|5yr),
                   focus(youth_development|star_signing|balanced), satisfaction(0-100),
                   budget_modifier, current_goals(JSONB), season_id,
                   negotiation_status(pending|completed), plan_start_season_number,
                   plan_end_season_number, seasons_completed,
                   cumulative_stage_wins, cumulative_gc_wins,
                   plan_start_balance, plan_start_sponsor_income
board_plan_snapshots  id, team_id, board_id, season_id, season_number,
                      season_within_plan, stage_wins, gc_wins, division_rank,
                      satisfaction_delta, goals_met, goals_total
board_request_log  id, team_id, board_id, season_id, season_number,
                   request_type, outcome, title, summary, tradeoff_summary,
                   request_payload(JSONB), board_changes(JSONB)
finance_transactions  id, team_id, type(sponsor|prize|salary|transfer_in|transfer_out|
                      interest|bonus|starting_budget), amount, description,
                      season_id, race_id
season_standings   id, season_id, team_id, division, rank_in_division, total_points,
                   races_completed, stage_wins, gc_wins  (unique: season_id + team_id)
notifications      id, user_id, type(...), title, message, is_read, related_id
import_log         id, import_type, filename, rows_processed, rows_updated,
                   rows_inserted, errors(JSONB), imported_by
```

---

## Hardcoded Konstanter

```js
// Squad limits per division
{ 1: {min:20, max:30}, 2: {min:14, max:20}, 3: {min:8, max:10} }
MIN_RIDERS_FOR_RACE = 8

// Salary = 10% af rider UCI-pris, min 1 CZ$
// Interest på negativ balance = 10% per sæson
PROMOTION_SLOTS = 2  RELEGATION_SLOTS = 2

// XP awards
bid_placed:2  auction_won:15  auction_sold:10
transfer_offer_sent:3  transfer_accepted:10
level = min(50, floor(xp/100)+1)

// Auktionsvindue (lokal tid)
Mon–Thu: 17–21  Fri: 17–22  Sat: 09–22  Sun: 09–21
AUCTION_DURATION = 4h  EXTENSION = 10 min (hvis bud inden 10 min af slut)

// Satisfaction → budget_modifier
≥80:×1.20  60–79:×1.10  40–59:×1.00  20–39:×0.90  <20:×0.80
```
