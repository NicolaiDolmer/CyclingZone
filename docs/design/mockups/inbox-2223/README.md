# Inbox rework (#2223): three mockup variants + recommendation

> Design-gate deliverable only. No app code in this PR. The three HTML files in this
> folder are the mockups; this file is the recommendation, the notification-type
> table, and the test plan.

## Context - this does not reopen a locked decision

Issue [#2223](https://github.com/NicolaiDolmer/CyclingZone/issues/2223) already carries an
**owner-approved direction from 2026-08-07** (issue comment + spec
[`docs/superpowers/specs/2026-08-07-inbox-triage-rework-design.md`](../../superpowers/specs/2026-08-07-inbox-triage-rework-design.md)):
Direction A ("Triage-indbakken" - a two-layer page: an action queue above a
"since your last visit" digest), with a tier-split contract (`action` badge-counts,
everything else is `fyi`) and a specific UI that the spec calls "mockup = kontrakt,
vist og godkendt 7/8" but which had never actually been committed to the repo as a
visual artifact.

This deliverable does **not** reopen that decision. **Variant A below formalises the
already-approved direction as a real, reviewable mockup** (satisfying #2223's own
acceptance criterion: "Design-mockup godkendt af ejer FØR byg"). Variants B and C are
built from the same sample data so the owner can see, side by side, why the approved
direction wins over the two most obvious alternatives - not to relitigate the 7/8 call.

**Recommendation: Variant A.**

## The three variants

| | Approach | Verdict |
|---|---|---|
| [`variant-a.html`](variant-a.html) | **Needs you / Happened.** Two zones: an action queue (badge-driven, inline actions, countdowns on time-critical items) above a collapsible "since your last visit" digest grouped by day. | **Recommended.** Matches the owner-approved spec. The manager sees exactly the 5 things that need a decision, in one place, at the top - nothing else competes for that attention. |
| [`variant-b.html`](variant-b.html) | **Grouped by type + filter chips.** Everything (action and FYI) organised by game area (Auctions, Transfers, Board, Races, Finance, Scouting), red "Action" tag on the items that need a decision, chips to narrow to one area. | Not recommended. Matches the game's mental model ("what area"), but the 7 action items are scattered across 6 group cards instead of being pulled together - the manager has to scan every group to find what needs them. The chip row is also the exact "second sorting idiom next to structure that already sorts" pattern TASTE.md P1 flags on today's Transfers page. |
| [`variant-c.html`](variant-c.html) | **Timeline with inline actions.** One reverse-chronological rail (closest to today's flat "Mine" list), action items get a red "Needs you" tag and inline buttons, everything else reads as plain history. | Not recommended. Cheapest to build (least change from today), but the badge count (5) doesn't match "position on the page" - action items are interleaved with FYI rows, so the manager still scrolls past yesterday's salary payment to find today's contract deadline. |

All three use the same sample data (5-7 action-tier items, ~13 FYI items across 4
days) drawn from real notification types (§ below) so the comparison is apples to
apples. Numbers and rider names are illustrative, not real prod data.

## What changes in `NotificationsPage.jsx` (Variant A)

- The **"Mine" and "Skal handles" tabs merge into one "Inbox" tab** with the two-zone
  layout. The **"Ligaen" (league feed) and "Activity" tabs stay separate** - they are
  a different content type (global feed / own-activity log), not personal
  action/FYI items, and the spec doesn't touch them.
- **Badge count changes source:** today's `pending.counts.total` (from
  `useActionSummary`, which only covers `transfer_offers`/`swap_offers` via
  `/api/inbox/pending`) becomes the full action-tier count once the tier mapping
  lands in `notificationTypes.js` - the 7-row table below is that mapping.
- The **action queue merges two existing data sources**: today's `pendingItems`
  (transfer/swap offers, already has inline navigation) and the subset of
  `notifications` rows whose type is in the action tier (today rendered flat in
  "Mine", no inline actions). Both need the same card shape once merged.
- The **FYI digest is `groupNotifications.js`'s existing aggregate pattern, extended
  with a day-bucket layer** on top of its existing same-type/same-day aggregation -
  the type-level grouping doesn't change, only the outer day wrapper (`<details>`,
  collapsed by default except the most recent day) is new.
- **Deep links need to land on the action**, per the spec's contract: `/transfers`
  must accept `?offer=<id>` and `/auctions` must accept `?auction=<id>` and open/
  highlight that item - today neither page can receive an id. This is real backend/
  frontend work for the implementation slice, not covered by this PR.
- **Livecycle:** an action item must disappear from the queue when its underlying
  state resolves (offer answered, new bid placed, lineup set, etc.) - generalises the
  terminator pattern that already exists for some types.
- `EVENT_CONFIG` / the Ligaen feed and the Activity tab are untouched.

## What's reusable from the kit - no new primitives needed

- `EmptyState` (already requires an `action` prop since #4657/#4625 - the "beskrivende
  tom tilstand" finding from the 2026-09 audit row #5 is already fixed in the current
  `NotificationsPage.jsx`; the two-zone rework doesn't need to touch it further beyond
  giving each zone its own empty copy).
- `Section`/`Card`, `Tabs`/`TabList`/`Tab`, `Button` (`secondary` size `sm` for every
  inline action - action buttons inside cards/rows are never gold, same rule T2 tables
  already enforce for row actions; the queue has zero gold buttons, which trivially
  respects "one gold primary per view").
- `ClockIcon`, `AlertTriangleIcon`, `ExchangeIcon`, `TrophyIcon`, `PodiumIcon`,
  `FlagIcon`, `CoinIcon`, `SearchIcon`, `ClipboardIcon`, `StarIcon`, `LightningIcon`,
  `ChevronRightIcon`/`ChevronDownIcon` - all already exist in `components/ui/icons`,
  used as-is in the mockups. No new icon needed.
- `groupNotifications.js` - extend, don't replace.
- T1 template's row-list recipe (13.5/500 title + `text-2xs`/`text-3xs` uppercase
  meta, hairline top rules, 13px vertical padding) for the FYI digest rows.
- Longer term (per the spec's "Grænseflader til parallelle sessioner"): the dashboard's
  `useActionSummary`/"Next move" module should eventually read the same action-tier
  queue as its SSOT instead of its own pending logic - that's the dashboard session's
  call, not this one's.

## Notification types: action or information

Derived from the canonical list in `backend/lib/notificationTypes.js` (54 types) and
the owner-approved tier mapping in the spec. The 7 rows the spec names explicitly are
marked **Action**; the spec's catch-all rule ("alt andet = FYI") covers everything
else. A handful of types aren't explicitly named either way in the spec - those are
marked **FYI (default, unconfirmed)** and should get an explicit yes/no in
implementation-slice 1, not be assumed silently.

| Type | Tier | Note |
|---|---|---|
| `transfer_offer_received` | **Action** | Spec row 1 |
| `transfer_counter` | **Action** | Spec row 1 |
| `auction_outbid` | **Action** | Spec row 2 - only when the player is genuinely behind |
| `board_critical` | **Action** | Spec row 3 |
| `selection_warning` | **Action** | Spec row 4 - one per race, replaces today's spam |
| `contract_expiring` | **Action** | Spec row 5 |
| `squad_below_minimum` | **Action** | Spec row 6 |
| `emergency_loan_breach` | **Action** | Spec row 6 |
| `academy_graduation_ready` | **Action** | Spec row 7 |
| `auction_proxy_outbid` | FYI | Proxy auto-rebid held the lead - no decision needed (see `proxyBidding.js`) |
| `bid_received` | FYI | Spec catch-all |
| `bid_placed` | FYI | Own bid confirmation |
| `auction_won` | FYI | Spec catch-all |
| `auction_lost` | FYI | Spec catch-all |
| `auction_sold` | FYI | Seller-side sibling of `auction_won` |
| `auction_cancelled` | FYI | Outcome, already resolved |
| `transfer_offer_accepted` | FYI | Outcome |
| `transfer_offer_rejected` | FYI | Outcome |
| `transfer_offer_withdrawn` | FYI | Outcome |
| `transfer_interest` | FYI | Spec catch-all |
| `watchlist_rider_listed` | FYI | Spec catch-all |
| `watchlist_rider_auction` | FYI | Spec catch-all |
| `watchlist_departed` | FYI | Spec catch-all |
| `new_race` | FYI | Calendar announcement |
| `race_result` | FYI | Spec catch-all - grouped per day, own team in focus |
| `stage_result` | FYI | Spec catch-all - grouped per day, own team in focus |
| `race_results_imported` | FYI | System/admin |
| `season_started` | FYI | Spec catch-all |
| `season_ended` | FYI | Spec catch-all |
| `board_update` | FYI | Explicit in spec's board-rework interface note |
| `salary_paid` | FYI | Spec catch-all |
| `sponsor_paid` | FYI | Spec catch-all |
| `loan_created` | FYI | Economy, part of spec's "lån" catch-all |
| `emergency_loan` | FYI | The loan itself (distinct from the breach, which is Action) |
| `loan_paid_off` | FYI | Economy outcome |
| `market_value_level_correction` | FYI | Weekly system correction, no decision |
| `academy_intake_ready` | FYI (default, unconfirmed) | Reads action-shaped; spec's "akademi-drip" catch-all likely covers it, confirm in slice 1 |
| `academy_drip` | FYI | Spec catch-all ("akademi-drip") |
| `academy_signed` | FYI | Outcome |
| `academy_rejected` | FYI | Outcome |
| `academy_graduated` | FYI | Outcome/milestone |
| `academy_promoted` | FYI | Outcome |
| `academy_demoted` | FYI | Outcome |
| `academy_intake_expired_compensation` | FYI | Outcome, already resolved automatically |
| `contract_expired_release` | FYI | Outcome, already resolved automatically |
| `squad_enforced` | FYI | System already corrected the squad automatically |
| `rider_retired` | FYI | Life event |
| `scout_report_ready` | FYI | Spec catch-all |
| `scout_changed` | FYI | Informational, no decision required |
| `career_milestone` | FYI | Spec catch-all ("milepæle") |
| `admin_notice` | FYI | Spec catch-all |
| `welcome` | FYI | Spec catch-all |
| `forum_thread_reply` | FYI | Social, not a gameplay decision |
| `deadline_day_warning` | FYI (default, unconfirmed) | Reads action-shaped (a deadline reminder); **not named in the spec's closed action list** - flag for an explicit owner call in slice 1 rather than assume |

**14 rows are the spec's confirmed action tier (7 named types plus their
group-mates); 2 rows are flagged unconfirmed; the remaining 38 are FYI by the spec's
explicit catch-all rule.**

## Test plan (per hard rule 28 - testplan is part of the design)

This PR itself is docs-only: `pwsh -File scripts/preflight-pr.ps1` is the only
verification (no frontend/backend code changed, so lint/build/tests don't apply here).

For the **implementation slices** that follow once the owner picks a variant:

- **Test tier: FULL** (backend + shared frontend hooks + i18n all change - tier
  table in `docs/AI_OPS_REFERENCE.md`). Each slice needs `scripts/verify-local.ps1`
  green, plus the full `npm run test:e2e` (all 3 Playwright projects, since this is a
  visual/snapshot change) before merge.
- **New backend coverage needed:** paritetstest mapping `NOTIFICATION_TYPES` against
  the tier map (closes the same class of gap `discordDmPrefs` had - spec's forward-
  guard §), plus a test that every action-tier type has a livecycle resolver.
- **New frontend coverage needed:** `/transfers?offer=<id>` and `/auctions?auction=<id>`
  actually open/highlight the target item (today neither page reads the query param);
  badge count reflects action-tier only, not total unread.
- **What the owner should see on preview per slice** (owner-must-test-on-preview
  rule): seeded test account with at least one item per action type (transfer offer,
  a losing auction bid, a `board_critical` demand, an unset lineup inside the 36h
  window, an expiring contract) so the queue isn't empty on first look; both light and
  dark; desktop and the owner's actual Android device, not a simulated viewport.
- **Staging tester round** (hard rule 28, "for store pakker") once slice 2 (the
  action-queue rebuild) lands - this is a rework of the app's most-visited page
  (4,012 sessions/30d per the 2026-09 audit), not a small tweak.

## Sample data disclosure

All rider names, offer amounts, and timings across the three mockups are invented
for illustration. They are not real prod data and are not a promise of specific
numeric thresholds (no balance weights, formulas, or engine-internal figures appear
here, per hard rule 17).
