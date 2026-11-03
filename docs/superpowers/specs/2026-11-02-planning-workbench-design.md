# Planning Workbench: design (2026-11-02)

Issue: #7535 · Prototype: https://claude.ai/artifact/4tEvfHZmh3r2NM2iX1p2SY
Designed with the owner in Discord #build-a-feature, 2 Nov 2026. **Design is final. Code starts only after taktik, race engine and udvikling 2.0 are followed through (owner 2 Nov 20:41).** Beta flag first.

## Why

PostHog, 14 days to 2 Nov: 1,390 views of `/planning`; 1,280 were Udtagelse (day view), the calendar had 68, Form and Strategi had 1 each. Clarity, 3 days: average active time 28 s on PC and 10 s on mobile; dead clicks on table headers and race names. Players come to sort out the next races fast.

## The page (direction 1, "Workbench")

One page replaces the four tabs (Udtagelse, Form, Strategi, Kalender). English first, design system per `docs/design/TASTE.md` and `PAGE_TEMPLATES.md`: 5 px radius, hairlines, square badges, one gold primary, tabular figures. No pill shapes, no rider chips, no line-up slot cards.

### Header
- Title "Planning", sub line: season, division, "N races need a squad in the next 8 days".
- Two toggles, top right: **Week board** and **Race list**. The player chooses; each remembers the player's last choice. Both may be on. A "Month calendar" button keeps the month grid as a separate view.

### Week board (optional, top)
- Timeline of the week across race days. Races that share race days stack in lanes, so overlap is visible at a glance.
- Each bar: short race name, stage-type glyph strip (one-day: one glyph), **"x/6"** picked. Left edge green when ready, amber when the squad is short. Click selects the race.

### Race list (optional, left)
- Upcoming races grouped by week; this week open, later weeks folded to one line ("Week 46 · 7 races · 5 missing").
- Row: name, date, class, stage count, glyph strip, overlap warning ("Shares race days with …"), status badge (Ready / N missing).
- "Show past" checkbox; past races are hidden by default (they live in Results).
- Other teams' line-ups are not here; they belong on the race page (start list, favourites).

### Race header
- Name, start date and time (Europe/Copenhagen), class, stages, "x of 6 picked", overlap note, "unsaved" marker.
- Buttons: Copy squad from…, Suggest squad (fills a proposal the player reviews and saves; never saves itself), primary Save (label follows the view: Save squad / Save tactics / Save peaks).
- **Unsaved changes:** switching race with unsaved changes shows an inline bar "Unsaved changes in X: Stay here / Discard / Save and open". Nothing is lost silently.

### Route profile
- Always opens on stage 1. Arrows and dots step through stages. Real elevation and categorised climbs (same component as the stage page).
- "Hide profile" folds it to the stage line; remembers the player's last choice.
- **One-day races: no arrows and no dots**, just the profile and Hide.
- The Tactics view highlights the column of the stage shown here.

### Views: Squad | Tactics | Peak form
Segmented control under the profile.

**Squad**
- Columns: Pick (checkbox, max 6), Rider, Status, Role, Rating, Form, Fatigue, After race, Route match, one column per route profile in the race ("High mtn ×1"), every column sortable.
- Default sort: route match for the whole race.
- Status: the same `RiderBadges` used everywhere (U23, INJ, …) plus "In <race>" for riders picked for an overlapping race (row dimmed, checkbox disabled).
- Injured riders show the expected return date ("INJ · back 9 Nov") and can be picked for races after it.
- Rating: the rider's best current role rating.
- Fatigue: number with a small bar; no "Tired" badge (owner: number only).
- **After race:** expected fatigue after the last stage at normal effort, from the condition model (`conditionModelV2`: per-stage load by profile, length and stage position; one day of recovery per stage; the rider's own recovery ability). Shown as "~38", amber at 60+. It must use the same model as the engine, never a separate formula.

**Tactics**
- Picked riders × stages. Each cell: role and effort, the same choices as the race page (roles: Captain, Shared captain, Sprint captain, Luxury helper, Breakaway hunter, Free role, Rider only; efforts: Normal, Save, All out, Protect, Grupetto, Attack). Same validation as the race page (one captain per stage, shared captain needs a captain, …).
- No CPT badge by the name; the role lives in the stage cells.
- "Copy stage N to all stages".
- Tactics work the same everywhere: a plan made here shows on the race page and the reverse.

**Peak form**
- Tick one or more riders, choose the race to peak for, "Apply to selected". No form curve.
- Columns: rider, rating, form, fatigue, peak target (select), race starts (date and days to go). Training plans adjust towards the peak date.

## Mobile
- Race list (or week board) is the first screen. Tapping a race opens the squad as a bottom sheet covering about 90 %; swipe down closes.
- The sheet header has arrows to the previous and next race; a horizontal swipe on the header does the same.
- Table: name + 3 columns (D-047): route match, form, fatigue. Same three views.

## Removed
Rider chips ("ledige ryttere" pool), line-up slot cards, the Form and Strategi tabs as separate pages, the drag-and-drop day columns.

## Later
Keyboard shortcuts (arrows to move, space to pick, left/right for stages) go into the planned keyboard-shortcut session.

## Build steps (owner OK)
1. Race list + week board + squad table + route profile + unsaved bar.
2. Tactics view (shared with the race page).
3. Peak form view + mobile sheet.

## Decision log (owner, 2 Nov)
- Direction 1 chosen over the week-board-first direction; week board kept as an optional toggle.
- Remember last choice for week board, race list and profile; the player controls both panels.
- Sort default route match; Copy stage yes; peak target is a race; mobile columns route match / form / fatigue; no Tired badge.
- Approved additions: expected fatigue after the race, unsaved warning, x/6 on the timeline; keyboard later.

## Tester feedback 2 Nov evening (JeppeK, cybersimon) and changes made
- Every column in all three views must sort (cybersimon). Done in the prototype.
- Copy squad from opens a list of races with a squad to choose from; riders busy in an overlapping race are skipped (JeppeK).
- Race list scope "Next 7 days" / "Whole season"; week board steps between weeks (JeppeK: set the whole season at once must be possible).
- Route profile uses real elevation and graded, categorised climbs, matching the race page (JeppeK).
- **Tactics corrected:** it is the race page's stage plan along the route (`StagePlanBoard`, spec 2026-10-25-taktik-roller-design §11): a chain of tasks per rider that switch at a categorised climb, the last km, or "when he's dropped"; assistant plan button. The earlier role+effort grid was wrong (JeppeK 21:15).
- Roles are chosen in Squad while picking (JeppeK); validation as on the race page.
- Peak form targets the race you are on (JeppeK).
- Injured riders greyed out like an overlap; tired riders are not sorted away (JeppeK).
- Open owner decisions where testers differ: default sort (JeppeK: first stage / first column; owner chose route match for the whole race), whether tactics belong here at all (JeppeK: race page only), rail default scope.
