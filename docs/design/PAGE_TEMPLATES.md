# Cycling Zone · Canonical Page Templates (normative)

Status: **decided 2026-07-23** · header = Option A "App standard" · supersedes all 9 legacy header styles and all legacy container widths.
Suggested repo location: `docs/design/PAGE_TEMPLATES.md`.

## Add this to the repo's CLAUDE.md

```markdown
## Page templates (binding)
Every manager-app page uses one of the 3 canonical templates in docs/design/PAGE_TEMPLATES.md:
T1 standard content (max-w-4xl), T2 wide data (max-w-[1600px]), T3 profile/detail (hero + tabs, max-w-5xl).
Never invent a new page header, container width, section-card padding, or loading/empty/error markup —
compose the recipes from that file. One gold primary button per view, hairline borders (no shadows),
5px card radius, tabular figures for all numerics, stroke icons only (no emoji).
```

## Shared rules (all templates)
- App shell: always-navy sidebar `w-52` (208px); main content scrolls independently.
- Page padding: `pt-7 px-8 pb-16` (28 / 32 / 64px). Mobile (≤640px): 16px side padding.
- **Page header (the ONE recipe):** flex row, `items-center justify-between gap-4`, `mb-6` (24px).
  - Title: Inter Tight (`font-data`) **20px / 700**, tracking −0.01em, `--text-1`, sentence case.
  - Subtitle: one line, **13px**, `--text-2`, `mt-1`.
  - Action cluster (optional, right): **one** `Select` (sm) + **one** primary `Button` (sm). Nothing else. Mobile: cluster wraps below the title block.
- **Section card (the ONE recipe):** `Card` = `--bg-card`, 1px `--border`, **5px radius**, **padding 20px** (16px mobile), no shadow.
  - Card header: flex `items-baseline justify-between`, `mb-4` (16px); title **15px / 600** sentence case; right slot is EITHER a quiet action (12px / 500, `--accent-t`, chevron-right 13px) OR an uppercase meta label (data font 11px, tracking .08em, `--text-3`) — never both.
  - Sibling cards stack with `gap: 14px`.
- Gold is rationed: one primary button per view + leader markers. Meters/progress fills may use accent per the ProgressMeter component. Foreground gold on light is always `--accent-t` (#a07800).
- Numerals: data font + `tabular-nums`, currency `CZ$ 1,340,000` (exact, comma-grouped).

## T1 · Standard content page
Reading pages (Board, Training, Finance detail, settings…).
- Container: **max-w-4xl (896px)**, centered.
- Body = stacked section cards per the shared recipe. Row lists inside cards: 13.5px/500 title + data-font 11px uppercase meta line (`--text-3`), separated by 1px `--border` top rules, 13px vertical padding.
- Status language: StatusBadge green "On track" / amber "At risk" / red "Behind"; meters `ProgressMeter` (danger tone below ~60).

## T2 · Wide data page
Dense tables (Riders, Transfers, Standings, Rankings, Results, Finance…).
- Container: full-bleed, **capped at 1600px**, centered; filter bar shares the cap, `mb-4`.
- Filter bar: search Input (sm, 240px) + up to 3 Selects (sm) + optional Checkbox; right-aligned data-font count/meta (12px `--text-3`).
- Table (`cz-table` recipe): wrap = 12px radius + hairline border on `--bg-card`; header cells **11px uppercase, tracking .06em, `--text-3`**; numeric columns right-aligned tabular; row cells 13px pad 16px; row action buttons are **secondary sm** (never gold in rows).
- **Sticky first column** (entity name): `position: sticky; left: 0`, opaque cell background, 1px `--border` right rule. Cell = name (13.5/500, jersey/classification dot) + data-font 10.5px uppercase subline.
- **Zone row tints** (promotion/relegation recipe): full-row `--success-bg` / `--danger-bg` with a 2px semi-opaque success/danger separator on the zone boundary + a 9px uppercase zone pill in-row. Same recipe wherever rows form zones (standings zones, listings closing, etc.). No hover highlight on tinted rows.
- Under the table: data-font 12px `--text-3` count line ("Showing 8 of 412 riders").
- **Mobile ≤640px:** name column pinned (min ~148px), secondary text columns (age, type, contract) fold into the name cell's subline; numeric columns scroll horizontally under the pinned column. Filter bar collapses to search + two half-width selects.

## T3 · Profile / detail page
Rider, team, race detail.
- **Hero band:** `--bg-card` with 1px `--border` bottom rule, full-bleed; inner content **max-w-5xl (1024px)**, `pt-5 px-8`.
  - Back link (12px/500 `--text-2`, chevron-left) → Avatar (lg, initials, never gold) → CategoryTags (specialty, nationality) + data-font meta line → name in **Bebas Neue 40px, ALL CAPS, line-height .92**.
  - Actions right: one secondary (icon allowed) + the view's one primary.
  - **Stat row:** 1px top rule, `pt-4`; blocks separated by 1px `--border` right rules (24px padding/margin); label 10px uppercase tracking .1em `--text-3`; value data font **20px/650** tabular; optional 11px delta in success/danger.
  - Tabs sit on the band's bottom edge (gold 2px underline on active; 14px/500 labels; `margin-bottom: -1px` so tab rule fuses with the band rule).
- Content: **max-w-5xl (1024px)**, `pt-6 px-8 pb-16`; two-column grid `1.55fr / 1fr`, `gap 14px`; all blocks are canonical section cards.
- Data-as-imagery: stage profiles / sparklines are inline SVG strokes (2px `--text-1` line, `--bg-subtle` flat fill, data-font 10px axis labels). Never photos, never gradients.

## Canonical states (inside a section card — chrome always renders, only the body swaps)
- **Loading:** skeleton lines 12px tall, 12px gap, radius 4, widths echoing real content (~88/64/76/52%), accent-tinted shimmer 1.4s. Never a spinner inside cards.
- **Empty:** `EmptyState` — dashed hairline inset; stroke icon 26px `--text-3`; title 15px/600; ONE sentence description (13px `--text-2`, sentence case, e.g. "Draft your first rider in the live auction."); ONE action = the section's primary, size sm.
- **Error:** `ErrorState` — same anatomy; `alert-triangle` icon in danger (no red fills/panels); message says what is safe ("Nothing was lost — your bids are safe."); retry = **secondary** sm ("Try again"), never gold.

## Hard don'ts
No gradients · no drop shadows (overlay shadow is for modals/popovers only) · no rounded-2xl (radii are 5/8/12px) · no emoji (stroke icon set only) · no second gold button per view · no per-page header or container inventions.

## Migration order (suggested)
Dashboard → Standings → Riders → the rest of Marked → Season & results → League → settings pages. One template per PR batch; check each page against the artboards in `Manager Page Templates (standalone).html`.
