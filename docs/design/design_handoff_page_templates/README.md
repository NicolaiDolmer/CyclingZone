# Handoff: Cycling Zone — Canonical Manager-App Page Templates

## Overview
An audit of all 52 production pages found 9 competing page-header styles and 10+ container widths. This package defines the **3 canonical page templates + 1 states sheet** that every page migrates to. It was designed against the Cycling Zone design system (the tokens/components ported from `frontend/src/index.css`, `tailwind.config.js` and `frontend/src/components/ui/*` in `NicolaiDolmer/CyclingZone`).

**Decision log:** Page-header **Option A "App standard"** was chosen (2026-07-23) over the editorial Bebas variant. All templates in this package use it.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these templates in the CyclingZone React + Tailwind codebase** using its established primitives (`frontend/src/components/ui/*`) and token classes — not to ship this HTML. The JSX in this bundle uses React but composes a bundled design-system namespace that does not exist in production; treat it as an exact visual spec.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy tone are final and token-exact. Recreate pixel-perfectly with the codebase's existing components.

## The Normative Spec
`PAGE_TEMPLATES.md` in this folder is the single normative rules file — commit it to the repo (suggested: `docs/design/PAGE_TEMPLATES.md`) and reference it from the repo's `CLAUDE.md` so Claude Code applies it to every page it touches. A ready-to-paste CLAUDE.md snippet is at the top of that file.

## Screens / Views
Open `Manager Page Templates (standalone).html` (self-contained, works offline) to see all artboards:
1. **Template 1 — Standard content page** ("Board" example, 1280px): 896px reading column, canonical header, two section cards.
2. **Template 2 — Wide data page** ("Riders" transfer market, 1280px): 1600px-capped full-bleed, filter bar, sticky-first-column table with zone row tints.
3. **Template 3 — Profile / detail page** (rider profile, 1280px): hero band + tabs + 1024px tabbed content.
4. **Mobile 375 variants** of templates 1 and 2.
5. **States sheet**: canonical loading / empty / error inside a section card.

All measurements, colors, and type specs are enumerated in `PAGE_TEMPLATES.md` (kept in one place on purpose — do not fork the values).

## Interactions & Behavior
- Buttons/links use the production hover rules: primary `brightness(1.05)` + 1px press nudge; secondary lifts border color; quiet links are `--accent-t`.
- Motion: 120/150/240ms, `cubic-bezier(.2,.7,.2,1)`, no bounce/glow; respect `prefers-reduced-motion`.
- Table rows: no hover highlight on zone-tinted rows; sticky first column stays opaque while the numeric columns scroll horizontally.
- Loading = skeleton shimmer (1.4s) inside the section card — never a spinner in cards. Empty/error recipes per the states sheet.

## State Management
Templates are layout contracts, not features — page data/state stays as-is. The only template-owned state: active tab (Template 3), filter/sort values (Template 2), and per-section loading/empty/error which swap ONLY the card body (chrome always renders).

## Design Tokens
All values reference the existing token system (`--bg-body #f4f2ec`, `--bg-card #fcfbf7`, `--border #e5e0d5`, `--text-1 #0e0f15`, `--text-2 #66637a`, `--text-3 #9896b0`, accent gold `#e8c547` / deep-gold foreground `#a07800`, `--success-bg #dcfce7`, `--danger-bg #fee2e2`; radii 5/8/12px; 4px spacing scale; fonts Bebas Neue / Inter Tight / DM Sans). No new tokens were introduced. Full usage table in `PAGE_TEMPLATES.md`.

## Assets
- `assets/brand/wordmark-ondark.svg` — the existing on-dark wordmark (sidebar/mobile bar). Already in the repo at `frontend/public/brand/`.
- Icons: the production 47-icon stroke set (`frontend/src/components/ui/icons`) — `search, filter, sort, chevron-*, star, bell, menu, clipboard, inbox, alert-triangle, mountain, sprint, time-trial, road`, etc. No emoji anywhere.
- No photography; the stage-profile SVG motif is drawn data, not an image asset.

## Files
- `Manager Page Templates (standalone).html` — self-contained canvas with all 7 artboards (open in any browser).
- `PAGE_TEMPLATES.md` — **the normative spec + Claude Code instructions. Commit this to the repo.**
- `src-reference/Manager Page Templates.html` + `tpl-shared.jsx`, `tpl-frames.jsx`, `tpl-mobile-states.jsx` — the design source (reads the design-system bundle; reference only, not runnable outside the design project).
