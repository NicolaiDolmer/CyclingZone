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
  - Card header: flex `items-baseline justify-between`, `mb-4` (16px); title **15px / 600** sentence case; right slot is EITHER a quiet action (12px / 500, `--accent-t`, chevron-right 13px) OR an uppercase meta label (data font `text-2xs`, tracking .08em, `--text-3`) — never both.
  - Sibling cards stack with `gap: 14px`.
- Gold is rationed: one primary button per view + leader markers. Meters/progress fills may use accent per the ProgressMeter component. Foreground gold on light is always `--accent-t` (#a07800).
- Numerals: data font + `tabular-nums`, currency `CZ$ 1,340,000` (exact, comma-grouped).
- **Micro type — exactly two steps below `text-xs` (12px)** (owner call 2026-07-25, audit finding F8). Tailwind has no named step under 12px, so 632 callsites had invented 8 arbitrary values (8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11 / 11.5px) for the same job. Canon:
  - `text-2xs` = **11px** — table header cells, card meta labels, any uppercase meta line.
  - `text-3xs` = **10px** — stat labels, table sublines, zone pills, badge micro-text, SVG axis labels.
  - Nothing renders below 10px. Never write `text-[Npx]` under 12px again — if neither step fits, the content is wrong, not the scale.

## T1 · Standard content page
Reading pages (Board, Training, Finance detail, settings…).
- Container: **max-w-4xl (896px)**, centered.
- Body = stacked section cards per the shared recipe. Row lists inside cards: 13.5px/500 title + data-font 11px uppercase meta line (`--text-3`), separated by 1px `--border` top rules, 13px vertical padding.
- Status language: StatusBadge green "On track" / amber "At risk" / red "Behind"; meters `ProgressMeter` (danger tone below ~60).

## T2 · Wide data page
Dense tables (Riders, Transfers, Standings, Rankings, Results, Finance…).
- Container: full-bleed, **capped at 1600px**, centered; filter bar shares the cap, `mb-4`.
- Filter bar: search Input (sm, 240px) + up to 3 Selects (sm) + optional Checkbox; right-aligned data-font count/meta (12px `--text-3`).
- Table (`cz-table` recipe): wrap = **5px radius (`rounded-cz`)** + hairline border on `--bg-card` (12px was the system's only radius outlier; converged 2026-07-24, owner call); header cells **`text-2xs` uppercase, tracking .06em, `--text-3`**; numeric columns right-aligned tabular; row cells 13px pad 16px; row action buttons are **secondary sm** (never gold in rows).
- **Sticky first column** (entity name): `position: sticky; left: 0`, opaque cell background, 1px `--border` right rule. Cell = name (13.5/500, jersey/classification dot) + data-font `text-3xs` uppercase subline.
- **Zone row tints** (promotion/relegation recipe): full-row `--success-bg` / `--danger-bg` with a 2px semi-opaque success/danger separator on the zone boundary + a `text-3xs` uppercase zone pill in-row. Same recipe wherever rows form zones (standings zones, listings closing, etc.). No hover highlight on tinted rows.
- Under the table: data-font 12px `--text-3` count line ("Showing 8 of 412 riders").
- **Mobile ≤640px:** name column pinned (min ~148px), secondary text columns (age, type, contract) fold into the name cell's subline; numeric columns scroll horizontally under the pinned column. Filter bar collapses to search + two half-width selects.

## T3 · Profile / detail page
Rider, team, race detail. **Revised 2026-07-24 (owner): the hero is a CARD, not a full-bleed band** — containment and air on all sides beat edge-to-edge. The rider profile is the reference implementation.
- Page container: **max-w-5xl (1024px)**, centered, `pt-4 md:pt-6 px-4 md:px-8`; content continues in the same width, `pb-16` (mobile `pb-24` clears MobileQuickNav).
- **Back link** (12px/500 `--text-2`) sits ABOVE the hero card, on the page background.
- Optional **context strip** (roster switcher etc.): inset sticky card above the hero — `--bg-elevated`, hairline border, 5px radius on sm+ (edge-to-edge strip on mobile), `mb-4`. Carries the team/context name (display font uppercase, 14px) + index pill. No keyline here.
- **Hero card (the ONE anatomy):** canonical card — `--bg-card`, 1px `--border`, **5px radius** — with a **2px gold keyline on its top edge** (the T3 signature; the line follows the rounded corner). Padding 20-24px.
  - Identity slot left (people/teams): **96px square**, 5px radius, `--bg-subtle` + hairline; initials in Bebas + optional `text-3xs` uppercase "PHOTO" label where real photos may come later (riders, staff). Entity pages without portraits (races) omit the slot.
  - **Name FIRST** in **Bebas Neue 40px, ALL CAPS, line-height .92** — CategoryTags + data-font meta line sit UNDER the name (tags are metadata; the name is the page's most important word).
  - Quiet icon/secondary actions top-right; the view's action row sits at the card's bottom after a hairline rule (ONE gold primary).
  - **Stat row:** 1px top rule, `pt-4`; label `text-3xs` uppercase tracking .1em `--text-3`; value data font **20px/650** tabular; optional `text-2xs` delta in success/danger. **Rating renders as a color plate** (statColor value on a 16%-alpha same-color tint, 5px radius). **Potential renders stars only** (qualitative label in tooltip, never inline; no level badge).
  - Duplication rule: the team/context name lives in the context strip when present; the hero shows its own team line only when there is no strip. Nothing appears twice.
- **Tabs sit BELOW the hero card** on the page background: own 1px `--border` bottom rule; active tab = gold 2px underline overlapping the rule (`margin-bottom: -1px`); 14px/500 labels; horizontal scroll on mobile.
- Content: same **max-w-5xl**; two-column grid `1.55fr / 1fr`, `gap 14px` where content naturally splits; all blocks are canonical section cards.
- Data-as-imagery: stage profiles / sparklines are inline SVG strokes (2px `--text-1` line, `--bg-subtle` flat fill, data-font `text-3xs` axis labels). Never photos, never gradients.

## Canonical states (inside a section card — chrome always renders, only the body swaps)
- **Loading:** skeleton lines 12px tall, 12px gap, radius 4, widths echoing real content (~88/64/76/52%), accent-tinted shimmer 1.4s. Never a spinner inside cards.
- **Empty:** `EmptyState` — dashed hairline inset; stroke icon 26px `--text-3`; title 15px/600; ONE sentence description (13px `--text-2`, sentence case, e.g. "Draft your first rider in the live auction."); ONE action = the section's primary, size sm.
- **Error:** `ErrorState` — same anatomy; `alert-triangle` icon in danger (no red fills/panels); message says what is safe ("Nothing was lost. Your bids are safe."); retry = **secondary** sm ("Try again"), never gold. **No em-dash in player-facing copy** — `scripts/tone-check-em-dash.mjs` fails the build; use a full stop, comma or colon (rule: `docs/TONE_OF_VOICE.md` §Punktuation).

## Hard don'ts
No gradients · no drop shadows (overlay shadow is for modals/popovers only) · no rounded-2xl (ONE surface radius: 5px `rounded-cz` everywhere — cards, table wraps, modals, state insets; pills use `rounded-cz-pill`, skeleton lines 4px; converged 2026-07-24) · no emoji (stroke icon set only) · no second gold button per view · no per-page header or container inventions · **no arbitrary `text-[Npx]` below 12px** — `text-2xs` / `text-3xs` only (converged 2026-07-25).

## Migration order (suggested)
Dashboard → Standings → Riders → the rest of Marked → Season & results → League → settings pages. One template per PR batch; check each page against the artboards in `Manager Page Templates (standalone).html`.
