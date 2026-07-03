# Design — Player-configurable Discord DM notifications (per-type)

- **Date:** 2026-07-03
- **Status:** Approved (design), ready for implementation plan
- **Branch:** `feat/discord-dm-per-type-notifications`
- **Scope owner:** Nicolai

## Problem & motivation

Today a player has exactly **one** Discord control: `users.discord_dm_enabled` (boolean, default `true`).
It is all-or-nothing — turning it off silences *every* Discord DM. Players want to keep the DMs they
care about (e.g. "I got outbid") while muting ones they find noisy. There is no per-type control.

## Current state (verified)

- Player DMs are sent by `notifyDiscordDM({ teamId, type, ... })` in `backend/lib/discordNotifier.js`.
  It resolves `teamId → teams.user_id → users.discord_id` and honors `users.discord_dm_enabled`
  via `getDmRecipient(teamId)` (skips when the flag is `false`).
- **DM'd today (4):** `auction_outbid` (`notifyOutbid`), `auction_won` (`notifyAuctionWon`),
  `transfer_offer` (`notifyTransferOffer`), transfer replies (`notifyTransferResponse` →
  `transfer_accepted` / `transfer_rejected`). Call sites: `api.js` (auctions/transfers),
  `cron.js` (auction-won), `proxyBidding.js` (auto-bid outbid).
- **In-app only today (become new DMs):** `watchlist_rider_auction` (in-app emit at `api.js:2710`),
  board updates (`board_update` / `board_critical`, emitted by `boardAutoAccept.js` /
  `boardConsequences.js`).
- Existing UI/API: ProfilePage has the Discord ID field + master toggle + test-DM button, backed by
  the profile-discord endpoints in `api.js` (~L4842 GET status, L4855 test, L4872 update flag).

## Goals / non-goals

**Goals**
- Per-type on/off control over Discord DMs, in the player's existing Discord settings section.
- Keep the master `discord_dm_enabled` toggle as the top-level kill switch.
- Add DM delivery for two events that currently only appear in-app (watchlist, board) so the new
  toggles govern something real.

**Non-goals (out of scope)**
- In-app bell preferences or email preferences (Discord-only per owner decision — YAGNI).
- The `race_result` in-app notification fix (tracked separately).
- `deadline_day_warning` — excluded; the underlying mechanic may not stay in the game.
- Any refactor unifying in-app + Discord into a single fan-out notifier.

## The catalog — 6 events, 3 groups

| Group | Player-facing label (EN) | Pref key | DM today? |
|-------|--------------------------|----------|-----------|
| Auctions | Outbid | `auction_outbid` | yes |
| Auctions | Auction won | `auction_won` | yes |
| Auctions | Watchlisted rider up for auction | `watchlist_rider_auction` | **new** |
| Transfers | Transfer offer received | `transfer_offer` | yes |
| Transfers | Reply to your offer | `transfer_response` | yes |
| Club | Board update | `board_update` | **new** |

**DM `type` → pref key mapping** (the enforcement layer maps the low-level DM type to a pref key):

| DM `type` | Pref key |
|-----------|----------|
| `auction_outbid` | `auction_outbid` |
| `auction_won` | `auction_won` |
| `watchlist_rider_auction` | `watchlist_rider_auction` |
| `transfer_offer` | `transfer_offer` |
| `transfer_accepted`, `transfer_rejected` | `transfer_response` |
| `board_update`, `board_critical` | `board_update` |

`board_critical` DMs are gated by the same `board_update` toggle. The in-app bell still shows every
board notification regardless of the Discord toggle, so opting out of Discord never hides critical
board information entirely.

## Data model

New column on `users`:

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_dm_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- Semantics: `{ "<pref key>": false }` means muted. **Absent key = enabled** (default-on).
  Storing only the opt-outs keeps rows small and makes "default on" the natural behavior.
- `discord_dm_enabled` stays as the master switch (unchanged).
- **Why jsonb over a normalized `notification_preferences` table:** one channel, 6 keys, no query
  needs beyond "load this user's prefs." A table is over-engineering now; jsonb is one migration,
  one read, and trivially extendable if we later add channels.

RLS: the `users` row is already owner-readable/updatable for self; the new column inherits existing
policies. Verify no cross-user exposure (the column is non-PII but should follow the same lockdown as
the rest of the row — see `.claude/learnings/2026-05-22-rls-permissive-public-policies.md`).

## Backend

**Single enforcement choke-point.** Refactor `getDmRecipient(teamId)` into a resolver that returns
both the recipient and their prefs, callable by `teamId` **or** `userId`:

```
resolveDmRecipient({ teamId?, userId? })
  → null if: no user, no discord_id, or discord_dm_enabled === false
  → { discordId, prefs } otherwise
```

`notifyDiscordDM({ teamId?, userId?, type, ... })`:
1. `const target = await resolveDmRecipient({ teamId, userId })` — null → skip (unchanged behavior).
2. `if (prefs[prefKeyFor(type)] === false) return` — new per-type gate.
3. Otherwise send as today (routing/outbox unchanged).

`prefKeyFor(type)` is the mapping table above (pure helper, unit-testable, lives next to the DM
type constants). Because **every** DM — existing and new — flows through `notifyDiscordDM`, the gate
cannot be bypassed.

**New DM wirings (2):**
- **Watchlist:** at `api.js:2710`, after the in-app `notify(...)`, also call
  `notifyDiscordDM({ userId: w.user_id, type: "watchlist_rider_auction", ... })`. (Uses the new
  `userId` path since the watcher's `user_id` is in hand, not a `teamId`.)
- **Board:** at the board-update emit sites (`boardAutoAccept.js`, `boardConsequences.js`), add
  `notifyDiscordDM({ teamId, type: "board_update" | "board_critical", ... })` alongside the existing
  in-app notification.
- Add `COLORS` + `TYPE_LABELS` entries and embed copy for the two new types in `discordNotifier.js`.

## API

Extend the existing profile-discord endpoints (no new routes):
- **GET** returns `discord_dm_prefs` alongside `discord_id` / `dm_enabled`.
- **PATCH** accepts a prefs update. Validate keys against the known pref-key set (reject unknown keys)
  and coerce values to boolean, so the client can't write arbitrary jsonb.

## Frontend

Extend the Discord section in ProfilePage:
- Below the master toggle, render the 6 switches grouped under `Auctions` / `Transfers` / `Club`.
- The group + switch list is **disabled/greyed** when the master toggle is off or `discord_id` is
  unset (with a one-line hint explaining why).
- Optimistic toggle → PATCH; revert on error.
- Styling uses the game's own tokens (Bebas section headers, `cz-*` colors) — the earlier mockup was
  structural only.

## i18n

Player-facing, EN-first + DA. Add label + description strings for all 6 events and the group headers
to the `en` and `da` locale files (same keys, EN authoritative). No invented copy beyond what the
mockup established.

## Defaults

All 6 pref keys **default enabled** (absent key = on). This preserves current behavior for the 4
existing DM types, and the 2 new ones (watchlist, board) are low-frequency + high-signal so
default-on aids discovery. Players opt out per type.

## Testing

- `discordNotifier` unit: `prefKeyFor` mapping; `notifyDiscordDM` skips when `prefs[key] === false`,
  sends when `true` or absent; master-off still short-circuits; both `teamId` and `userId` paths.
- API unit: GET returns prefs; PATCH validates keys + coerces booleans + rejects unknown keys.
- Wiring: watchlist + board sites call `notifyDiscordDM` with the right type (injectable mock, same
  pattern as `proxyBidding.test.js`'s `notifyOutbidDM`).
- Frontend unit (`node --test` in `frontend/`) for the settings component's render + disabled states.

## Migration & rollout

- The `discord_dm_prefs` migration is `database/*.sql` → **owner merges the PR** (auto-applies in
  prod on merge). Column add is additive + idempotent (`IF NOT EXISTS`, `DEFAULT '{}'`).
- Feature is not flag-gated; it ships live for all players (consistent with the no-beta-gate policy).
  The 2 new DM streams begin flowing for connected players on deploy — acceptable per the defaults
  decision above.

## Close-out artifacts

- Patch notes (player-facing change) in `PatchNotesPage.jsx`.
- `help.json` (en + da): note that Discord DMs are now per-type configurable in profile settings.
- Postmortem not applicable (feature, not bugfix).

## Out of scope (restated)

`race_result` in-app fix · in-app bell prefs · email · `deadline_day_warning` · unified notifier
refactor.
