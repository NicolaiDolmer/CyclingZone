# Discord patch notes catch-up — draft for #patch-notes (Cycling Zone server)

> Copy-paste ready. Written 2026-08-18. Source: `frontend/src/data/patchNotes.js` v7.123-v7.142.
> Last version actually posted in #patch-notes (channel 1504952588578193480, guild 1504615050831466669): **v7.125** (2026-08-14 11:54 UTC). v7.123 was drafted (`docs/discord/2026-08-14-patch-notes-7123.md`) but never posted. v7.121, v7.124 and v7.125 were posted individually. Everything from v7.123 onward except v7.124/v7.125 is the gap this post closes.
> Owner reviews and posts manually — Claude never posts to Discord.

---

**Catch-up: v7.123 to v7.142**

A lot landed between August 14 and 18. Here is everything that hasn't been posted yet, by area. Full detail always at cyclingzone.org/patch-notes.

**Races & results**
- New: every finished stage now has a race film. Scrub through the stage on its real profile, follow the event feed as it plays, and read the key moments picked out for you
- The Final Kilometre replay now matches the stage tab you're actually looking at, instead of always replaying the most recently run stage
- Race Centre is live: one page under Races for today's racing — your live, upcoming and finished races first, then a strip of results from the other divisions
- Stuck race lineups from two overlapping race days now heal themselves instead of staying broken
- Under the hood: rider double-booking is now blocked at the database level, and forced sales complete safely even after an interruption

**Market & auctions**
- You now pick your auction's exact end time, 1 to 48 hours ahead, instead of a fixed 1 hour window
- Auctions are easier to use: sortable on mobile, salary sort follows what you see, pick a duration when starting from a rider's profile, and the bid panel warns up front if your squad is full
- A negotiated swap offer can now actually be rejected after the other manager has countered it
- Market cleanups: sortable seller column, no-sale auctions hidden from history by default, youth proxy bids accept a free academy slot
- Bid confirmation now warns you when a rider is close to or certain to retire
- Sorting by potential now follows the band you actually see, instead of silently falling back to market value
- A traded academy rider can no longer push you over your 8-slot squad cap
- 139 old youth free agents recalibrated to match the current youth band
- Cleaner transfer history: no-sale auctions no longer clutter it, and AI teams are named properly
- A sale can no longer leave the seller below the 8 rider minimum
- Deleting a defective rider now cancels their active auctions first, instead of the auction just disappearing

**Riders & training**
- Moving a rider to or from the academy no longer cuts their contract short
- The scouting job now counts down to when the report is ready
- Positioning and tactics finally have a real, much higher training ceiling
- Picking a training focus is now a panel that shows what every focus actually trains
- The misleading "limited upside" warning is gone from the training page
- Training now decides how a rider develops, not just how high his ceiling is
- Academy riders train under the same rules as your senior squad now
- You pick the training day first (rest, active recovery, skill, training), then the session; active recovery is a new day type
- The ceiling increase from August 14 was rolled back the next day after it went further than intended
- New riders are now born with a locked-in second type from day one
- 60 existing riders had a missing second type corrected
- Injury days now agree everywhere they're shown, and 11 contracts that lost a year got repaired
- Scouting missions can now target a rider type, and the whole shortlist gets a free report
- Academy riders can be listed on the market or put up for auction directly
- Two staff slots per role now, the strongest one counts toward your bonus
- Rider popularity now shows on the profile and as a sortable market column
- New teams keep their starting squad: starter contracts always run 2 to 3 seasons
- The scout button no longer offers an upgrade that would buy you nothing

**Economy**
- Extending a contract no longer gets wrongly refused right after a successful extension
- The finance forecast now labels the sponsor figure as next season's, not this one
- The prize list under Finance sorts by date and its columns are sortable
- Accepted board bonus offers can no longer vanish
- Teams created mid season now get a fair, prorated share of sponsor money instead of none

**UI & help**
- Six actions no longer sit stuck in a loading spinner when your connection drops
- A small dot now marks unread patch notes in the menu
- Inbox messages take you straight to the right place: transfer offers, scout reports, stage notifications
- New help sections explain where auction and free-agent riders come from, and how season money works
- Dashboard "Upcoming races" only counts races your team is actually entered in
- Disabled buttons and rejected actions now explain themselves instead of doing nothing
- Notification badge counts up to 99+, and season dates are fixed for players west of UTC
- Auctions, dashboard and rider profiles now share a more consistent look and feel
