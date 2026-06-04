# UI navigation & information-architecture — exploration

> **Status:** **Active — PRE-LAUNCH** (decided 2026-06-04: Nicolai wants the full overhaul done before the 2026-06-20 TdF launch). Tracked in [#1027](https://github.com/NicolaiDolmer/CyclingZone/issues/1027). Connects to [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) Phase 4 (UI Integration) + [#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864) (UX audit).
> **Purpose:** Capture the considerations so the UI sessions resume with a best-practice working method, not a cold start.

## The prompt Nicolai raised

Two things, conflated into one feeling ("I miss a *header*"):

1. **Navigation structure.** The app uses a **left sidebar** for all nav. Nicolai increasingly misses a **top header** with the primary menu items — it "feels more standard" for primary nav. Marked screenshot 1: the top bar (logo + team + balance + survey banner) is the "B" target — i.e. promote primary nav up there.
2. **Whitespace / density.** On data-dense pages (e.g. Riders), there is a lot of empty side-margin whitespace. Hope: a header (or moving filters to the side) could let content reclaim that space. Marked screenshot 2: left + right margins flagged as wasted; filters block flagged as a candidate to move to a side-rail.

## Key reframe: these are TWO problems, not one

Moving nav to the top will **not** fix the whitespace by itself, and fixing whitespace does **not** require moving nav. Tackling them separately de-risks both.

### Problem 1 — nav structure (sidebar vs top vs hybrid)

The honest trade-off, driven by **item count**. The app currently has ~15 nav items in 4 groups (Klubhus, Marked, Sæson & resultater, Liga).

| Model | Benefit | Cost |
|---|---|---|
| **Top header nav** (what Nicolai's instinct points to) | Feels "standard web-app"; frees vertical space; identity/brand sits up top | Top nav shines at **≤7 items**. 15 items forces dropdowns → hides structure, adds clicks, loses at-a-glance scannability. |
| **Sidebar (current)** | Scales to many sections; persistent; the correct pattern for tools/games (Football Manager, Linear, Notion all use it for exactly this density) | Eats horizontal space; on wide screens the content doesn't reclaim it → whitespace. Can feel "heavy". |
| **Hybrid (recommended)** | Keep the scalable sidebar for full nav, but turn the **top bar into a proper app header**: brand mark (ties to #481), context (team / division / season), global state (balance, online), primary contextual actions. Optionally a **collapsible icon-rail** sidebar so wide screens reclaim width. | More design work than a pure swap; needs the header's role clearly scoped vs the sidebar. |

**My recommendation: hybrid.** What Nicolai is actually missing is probably not "nav at the top" but a **stronger top app-header** (identity + context + key state/actions) that the current thin top bar under-delivers. That gives the "header" feeling without throwing away the sidebar, which is the right pattern for this many sections. A pure top-nav swap would fight the item count.

### Problem 2 — whitespace / density (Riders and similar)

Independent of nav. The whitespace comes from a **max-width content container** leaving big side-margins on wide screens, plus a tall filter block pushing the table down. Two standard, low-risk moves:

- **Let data-dense pages go full-width** (or a wider max-width) so the table uses the available space.
- **Move filters to a collapsible left filter-rail** — the standard marketplace pattern (filters left, results fill the rest). Shorter vertical footprint, table starts higher, side whitespace consumed.

These two are likely the **higher-impact, lower-risk** win versus the nav restructure, and can ship sooner / independently.

## Decided plan (2026-06-04)

All of it before launch — but staged so the big pieces are planned, not improvised:

- **Track A — Whitespace/density: starts the NEXT session.** Implement the safe, token-light width wins now (data-dense pages reclaim the side-margins). **The filter-rail relocation is NOT implemented unilaterally** — Nicolai wants visual examples + a dedicated discussion session first. The next session may *produce* filter-placement mockups for that discussion, but not decide/build it.
- **Track B — Top-header upgrade** and **Track C — Nav/sidebar IA restructure**: planned optimally in a **dedicated planning session** (visual options + `AskUserQuestion`) before execution.
- **Method (Nicolai's requirement):** visual examples + `AskUserQuestion` throughout, enough questions to raise quality, ONE visual decision at a time.

## Sequencing / token risk

The brand **colour palette is not locked yet** (P2 light canvas + P3 accent pending in `logo-explorations.html`). Whitespace (Track A) is **structural / token-light** → safe to do now. Heavy *styling* of the header/nav (Track B/C) should ride on **locked design-system tokens** to avoid redoing it twice — consider locking the palette (P2/P3) before B/C styling. Order: A now → (palette-lock) → B/C planned + executed on tokens.

## Best-practice working method for the UI session (when we get there)

Treat it like the brand decisions — **evidence first, then ONE visual decision at a time, options rendered side-by-side** (never abstract text-only):

1. **IA audit.** Inventory every nav item + its real usage/priority (cross with Clarity once #864 is unblocked — actual click-data beats guessing). Group by frequency, not by current section labels.
2. **Decide the model from the inventory**, not vibes. Item count + usage tells you sidebar / top / hybrid.
3. **Prototype 2-3 nav models** in a static HTML mockup (the `logo-explorations.html` pattern) overlaid on real page screenshots. Pick visually.
4. **Page-density as a separate decision:** prototype the Riders page full-width + left filter-rail; compare to current. Ship independently of nav if it wins.
5. **Respect tokens** from the brand Phase 3; don't hardcode colours/spacing.
6. **Verify:** Playwright core-smoke (all 3 projects — this is a visual change), refresh snapshots, PatchNotes, Brugerverifikation in PR.

## Channel routing

This is design exploration + prototyping → a **Claude Code session** (same muscle as the brand work: render visual options, iterate, implement). Strategy-level "should we even" framing can happen in **Claude chat** first if Nicolai wants to think out loud before prototyping.

## Open inputs to capture next session

- Which nav items are actually used most? (Clarity click-data — #864)
- Does Nicolai want the sidebar gone entirely, or a stronger header + slimmer/collapsible sidebar? (the hybrid question)
- Is page-density (Riders full-width + filter-rail) urgent enough to pull before launch?
