# ARCHITECTURE — Teknisk Reference

## Stack

| Lag | Teknologi | Deploy |
|-----|-----------|--------|
| Frontend | React 18 + Vite + Tailwind CSS | Vercel |
| Backend | Node.js + Express (ES modules) | Railway |
| Database / Auth | Supabase (PostgreSQL + RLS) | Supabase cloud |
| Realtime sync | Cron (backend/cron.js, 60s interval) | — |
| UCI sync | Google Sheets CSV export | — |

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
/profile              → ProfilePage
/managers/:teamId     → ManagerProfilePage
/activity             → ActivityPage
/activity-feed        → ActivityFeedPage
/watchlist            → WatchlistPage
/finance              → FinancePage
/help                 → HelpPage
/hall-of-fame         → HallOfFamePage
/season-preview       → SeasonPreviewPage
/season-end           → SeasonEndPage
/head-to-head         → HeadToHeadPage
/patch-notes          → PatchNotesPage
/races                → RacesPage
/admin                → AdminPage
```

---

## Backend API Endpoints (`backend/routes/api.js`)

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

### Loans
```
GET   /api/loans
GET   /api/loans/my
POST  /api/loans                  { rider_id, from_team_id, loan_fee, end_season, buy_option_price }
PATCH /api/loans/:id              { action: accept|reject }
POST  /api/loans/:id/repay        { amount }
```

### Teams & Managers
```
GET /api/teams/my
GET /api/teams/:id
GET /api/managers/:teamId
```

### Notifications
```
GET   /api/notifications
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

### Board
```
GET  /api/board/status
POST /api/board/sign              { plan_type, focus }
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

### Admin
```
POST /api/admin/import-results            multipart: file + race_id
POST /api/admin/seasons/:id/start
POST /api/admin/seasons/:id/end
POST /api/admin/sync-uci
POST /api/admin/override-rider
POST /api/admin/approve-results
POST /api/admin/finalize-expired-auctions
PATCH /api/admin/loan-config
POST /api/admin/adjust-balance
GET  /api/admin/season-end-preview/:seasonId
```

---

## Backend Lib-moduler

| Fil | Eksporterede funktioner |
|-----|------------------------|
| `auctionEngine.js` | `calculateAuctionEnd`, `checkBidExtension`, `isAuctionExpired`, `formatAuctionEnd` |
| `economyEngine.js` | `processSeasonStart`, `processSeasonEnd`, `calculateBoardSatisfaction`, `satisfactionToModifier`, `generateBoardGoals`, `updateStandings` |
| `loanEngine.js` | `getLoanConfig`, `getTotalDebt`, `createLoan`, `createEmergencyLoan`, `repayLoan`, `processLoanInterest` |
| `sheetsSync.js` | `handleSyncRequest` |
| `discordNotifier.js` | `notifySeasonEvent` |

---

## Database-tabeller

```
users            id(uuid), email, username, role(admin|manager), created_at
teams            id, user_id, name, is_ai, division(1-3), balance, sponsor_income,
                 is_frozen, is_bank, manager_name, created_at
riders           id, pcm_id, firstname, lastname, full_name(gen), birthdate,
                 nationality_code, height, weight, popularity, uci_points,
                 price(gen), salary, team_id, ai_team_id, is_u25,
                 stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
                 stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
                 stat_res, stat_ftr
seasons          id, number, status(upcoming|active|completed), start_date,
                 end_date, race_days_total, race_days_completed
races            id, season_id, name, race_type(single|stage_race), stages,
                 start_date, status(scheduled|active|completed), prize_pool
race_results     id, race_id, stage_number, result_type(stage|gc|points|mountain|young|team),
                 rank, rider_id, team_id, finish_time, points_earned, prize_money
auctions         id, rider_id, seller_team_id, starting_price, current_price,
                 current_bidder_id, min_increment, requested_start, calculated_end,
                 actual_end, status(active|extended|completed|cancelled),
                 extension_count, is_guaranteed_sale, guaranteed_price
auction_bids     id, auction_id, team_id, amount, bid_time, triggered_extension
transfer_listings  id, rider_id, seller_team_id, asking_price,
                   status(open|negotiating|sold|withdrawn)
transfer_offers    id, listing_id, buyer_team_id, offer_amount,
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
finance_transactions  id, team_id, type(sponsor|prize|salary|transfer_in|transfer_out|
                      interest|bonus|starting_budget), amount, description,
                      season_id, race_id
season_standings   id, season_id, team_id, division, total_points, races_completed,
                   stage_wins, gc_wins  (unique: season_id + team_id)
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
