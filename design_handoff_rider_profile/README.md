# Handoff: Rider Profile page (Cycling Zone)

## Overview
A redesigned **Rider Profile** — the manager's key decision surface. It must answer at a
glance: *who is he, what can he do, what will he become, and what is he worth to ME right
now — keep, train, promote, sell, or buy?* Two viewer contexts: **your own rider** (full
management) and **another team's / AI rider** (scouting view, fuzzy potential, no
form/fatigue).

## About the design files
The files in this bundle are **design references created in HTML** — prototypes that show
the intended look, layout and behavior. They are **not** production code to copy.

The task is to **recreate these designs inside the existing Cycling Zone codebase**
(`frontend/` — React + Tailwind, the `cz-*` design system) using its established patterns,
tokens and components. The current rider page is `frontend/src/pages/RiderStatsPage.jsx`;
this redesign replaces/extends it. **Reuse the real data model, hooks and components listed
under "Mapping to the real codebase" — do not invent new data.**

The prototype is authored as a "Design Component" (`.dc.html`); ignore that wrapper. What
matters is the markup, the inline styles (which map 1:1 to the `cz-*` tokens) and the
behavior described below. The live HTML references are in the downloadable handoff package
(`Rider-Profile-standalone.html` opens offline in any browser — the most reliable visual
source of truth); ask the design owner for it if it is not alongside this file.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, bar semantics and interactions are
intentional. Recreate pixel-faithfully using the codebase's existing libraries. Every
color is a `cz-*` token (no raw hex except the division-blue chip and rider-photo
fallbacks); every number uses the data font with tabular figures.

---

## Layout — page shell
Single scrollable page; one rider. Top→bottom:

1. **Rider switcher bar** (full width, `bg-elevated`, hairline bottom): `‹ prev-name`
   · `TEAM NAME` · index pill `9 / 24` · hint "‹ › skift rytter" · `next-name ›`.
   Cycles the **roster of whichever team is being viewed** (own team or the viewed
   rival/AI team). Wire to keyboard `←/→` as well.
2. **Hero** (`bg-card`, 2px gold top-rule). Two-column on desktop, single column ≤640px:
   - **Left:** rider photo (portrait placeholder ~70×92, initials + "FOTO" until a real
     photo exists), big rider **name** (Bebas, `clamp(34px,4.6vw,46px)`, uppercase),
     meta row (flag+code chip · age · U23/U25 badge · primary-type chip · division chip),
     team name (+ "AI" tag for AI teams), and **"Vinder på"** (1–2 terrain types).
   - **Right cluster** (`320px`, hairline divider): **overall rating** circle (1–99,
     color-coded via `statColor`) + **potential** as **stars** (never a raw number) +
     qualitative label; then **market value** (large, mono) with salary + contract-end.
   - **Status banner** (conditional, gold-tinted): "På transferlisten · pris …" /
     "I auktion · slutter om … · højeste bud …" / "Akademirytter". Contract-expiry shows
     a short amber alert: *"Kontrakt udløber efter Sæson 2."*
   - **Action row** — adapts to viewer + lifecycle (see Interactions).
3. **Sticky tab bar** (`sticky top:0`, `bg-body`): Overblik · Fysiologi · Træning ·
   Udvikling · Scouting · Historik · Resultater · Interesse.
4. **Tab content.**

---

## Screens / Tabs

### Overblik (default)
The objective snapshot. **No scout verdict here** (it lives in Scouting).
- **Ability columns** (full width, 3 cards): **Fysisk / Mental / Teknisk** with the
  category header pinned (icon + Bebas header + count, 2px gold underline). Each skill:
  name · **thin gold bar = training progress toward next +1** (own rider only) · the 1–99
  value (color-coded). Legend clarifies the bar = training progress.
- **Rider-type radar** (`Ryttertyper`, left): 8-axis spider (sprinter, puncheur, brosten,
  baroudeur, rouleur, enkeltstart/ITT, GC, klatrer). **Solid gold polygon = now**,
  **dashed faint polygon = ceiling (scouted)**. Footer: "Bedst som <type> ★★★…" +
  link to Scouting.
- **Røverkøb? is NOT here** (moved to Scouting). Right column = **compact Fysiologi**
  (FTP / VO₂max / Pmax with vs-division bars + "Watt-kurve & zoner →" link).

### Fysiologi
Physiological layer — must include **everything the current page shows, plus more**.
- **Headline cards (4):** FTP (W + W/kg), VO₂max (ml/kg/min), Pmax (W), **Zone 2** (W/kg).
  Each with a benchmark bar vs division mean + over/under delta.
- **Watt-curve:** max power per duration on a **log scale**, durations
  `5s · 15s · 1min · 5min · 10min · 20min · FTP(60min)`. Rider line (gold) + **division
  average (dashed)**; shaded "his zone" where he beats the division. **W ↔ W/kg toggle.**
- **Watt-profile bars:** `5s / 1min / 5min / 10min / 20min / FTP`, each benchmarked vs
  division mean (distinct from the training-progress bars).
- **Critical Power model:** CP (W) + W′ anaerobic capacity (kJ) + one-line read.
- **Power zones Z1–Z7** (Coggan), segmented bar + watt ranges derived from FTP.

### Træning (own rider only; scouting shows a locked card)
Mirrors the real training system.
- **Focus chips:** VO2max · Tærskel · Spurt · Udholdenhed · Teknik · Aero (one active).
- **Intensity:** Hvile / Let / Normal / Hård (segmented).
- Slots used this season ("2 / 3"); active focus + progress to next +1; note that **hard =
  faster but risk of setback**, effect lands at season change.
- **"Hvert fokus træner …"** reference (focus → abilities), matching today's page.
- **Træningsscore (0–100)** with 30-day sparkline (a quality metric to compare riders).
- **Daily training log** (last 7 days: focus · load · score).
- **Form & restitution** (form, fatigue, injury chip).

### Udvikling
- **Rating per type over seasons** (multi-line chart, solid = recorded, dashed = projected
  to ceiling, with a ceiling reference line).
- **Vækst pr. sæson** (growth/season, seasons to ceiling, age at ceiling).
- **Udviklingslog** — season-by-season **training → ability-gain report**: focus used,
  rating delta, concrete ability gains (+X chips), note; plus a projected next season.
  Hidden for scouted riders (training is not visible on rivals).

### Scouting
- **Scout verdict** ("Din spejders vurdering" for own / "Talentspejder-rapport" for
  scouting) — plain-language headline (`Behold & udvikl` / `Bud værd at overveje`), a
  confidence chip, one paragraph of reasoning, and 4 supporting factors. **No jargon.**
- **Potentiale pr. ryttertype:** all 8 types, each with current value, a bar (current fill
  + **fuzzy ceiling band**), and **fuzzy ceiling stars** (always a range until fully
  scouted — also for own riders). Scouting view adds a "Scout igen" action.
- **Røverkøb?** card (market value vs expected value for age + potential). **No "Underpris"
  verdict label** — show the comparison and the one-line read only.

### Historik
Compact **table** (handles 20–40 rows): `Dato | Type (chip) | Begivenhed | Beløb`. Types:
Auktion, Bud, Kontrakt, Transfer, Resultat, Scouting, Interesse, Oprindelse.

### Resultater (PCS-style)
- **Season totals on top** (Sejre, Løb, Top 5, Trøjer, Ranking-point, Præmiepenge) with a
  season filter (Sæson 2 / Sæson 1 / Alle).
- **Results table:** `Dato | Løb | Klasse | Terræn | Plac. | Point | Præmie`. **Stage races
  (2.x) are expandable** — the row shows the big-picture (GC) line with a chevron; clicking
  expands all stage results (etaper + samlet) as indented sub-rows.

### Interesse
- One-line summary; stat cards (Følger, Profilvisninger, Scoutet af).
- **"Hvem scouter din rytter?"** (own rider only) — moved here from Scouting.
- Activity feed.

---

## Interactions & behavior
- **Tabs:** swap content; tab bar stays sticky. Default = Overblik.
- **Rider switcher:** prev/next loads adjacent roster member; keyboard `←/→`.
- **Stage-race expand:** click toggles the stage list (local state per race id).
- **Watt unit toggle:** W ↔ W/kg recomputes the curve + profile bars.
- **Actions adapt** to viewer + lifecycle:
  - Own · active: Forlæng kontrakt · Tildel træning · Sæt til salg · Start auktion · Frigiv
  - Own · listed: **Fjern fra transferliste** + the above
  - Own · auction: **Se auktion** · Tildel træning · Frigiv
  - Own · academy: **Promovér til senior** + full senior actions. **This is a deliberate
    rule change (confirmed):** academy riders may be listed/auctioned/sold/released and have
    their contract extended — which reverses the current game rule that blocks that. Ship it.
  - Scouting · active: Giv transferbud · Byttehandel (swap) · Føj til liste · Scout
  - Scouting · auction: **Byd nu · min. …** · Føj til liste · Scout
- **Scouting hides:** form, fatigue, training, exact ceiling. Potential is a fuzzy star
  range; unscouted (level 0) rivals show "Ikke scoutet" + a Scout button (no estimate).
- **Motion:** short, eased (`cubic-bezier(.2,.7,.2,1)`, 120–240ms). No bounce/glow. Respect
  `prefers-reduced-motion`.
- **Responsive:** hero is 2-col on desktop, single column at ~380–640px; the big name uses
  `clamp()` so it never breaks layout; tab bar scrolls horizontally on mobile.
- **Dark mode:** everything is token-driven — flips via `[data-theme="dark"]`.

## State management
Prototype-local: `activeTab`, `wattUnit`, `expandedRaces`. In the app, source the rest from
existing hooks/endpoints:
- Rider core + physiology: `GET /api/riders/:id`.
- Potential estimate (stars + label, fuzzy/exact, hidden): `useScouting` →
  `POST /api/scouting/estimates` (the raw potential number is never sent to the client).
- Training (focus/intensity/progress): `useTraining` + `lib/training.js`,
  `lib/trainingReport.js`.
- Academy / promote-demote: `useAcademy` + `RiderManageActions`.

## Mapping to the real codebase (use these — do not reinvent)
- **15 abilities & labels:** `frontend/src/lib/abilities.js`. Groups: Physical (climbing,
  tempo, punch, sprint, acceleration, flat, time_trial, endurance, durability, recovery),
  Mental (aggression, tactics), Technical (descending, cobblestone, positioning).
- **Overall rating (1–99):** `frontend/src/lib/riderRating.js`.
- **Stat color gradient:** `frontend/src/lib/statColor.js` (single source of truth — used
  for the rating circle, ability numbers, training-score). The prototype reproduces this
  exact ramp.
- **Potential stars:** `frontend/src/components/PotentialeStars.jsx` (0–6 in half-steps,
  fuzzy `range`/exact `value`, old-rider neutral tone) +
  `components/rider/ScoutablePotentiale.jsx` (server estimate, scout button, hidden state).
- **Physiology fields** (`GET /api/riders/:id`, today rendered in `RiderStatsPage`'s
  `RacePhysiologyPreview`): `zone2_power_wkg`, `ftp_wkg`, `vo2max_power_wkg`, `pmax_watts`,
  `power_5s_wkg`, `power_15s_wkg`, `power_1m_wkg`, `power_5m_wkg`. **Add** 10-min & 20-min
  curve points, the rider-vs-division overlay, W↔W/kg, CP/W′ and the Z1–Z7 model on top.
- **Training focuses & ability mapping:** `frontend/src/lib/training.js` (vo2max →
  climbing/punch/tempo; threshold → time_trial/tempo; sprint → sprint/acceleration;
  endurance → endurance/recovery/durability; technique → descending/positioning/cobbles;
  aero → time_trial/flat).
- **Management actions:** `components/rider/RiderManageActions.jsx`,
  `AcademyTransferConfirmModal.jsx`, transfer-list/auction/bid/swap buttons,
  `useAcademy.js`.
- **Condition:** `components/rider/ConditionChips.jsx` (form/fatigue/injury).
- **Flags:** `components/Flag.jsx` (flag-icons). **Type badge:**
  `components/rider/RiderTypeBadge.jsx` + `RIDER_TYPE_KEYS`.
- **Badges (auction/U23/AI/IN/OUT):** `components/rider/RiderBadges.jsx`.
- **Currency:** `CZ$` with thousands separators, data font, tabular figures.
- **Icons:** the bundled `Icon` stroke set (24×24, `currentColor`, width 2, no fill) —
  never emoji.

## Design tokens (from the design system; do not hardcode)
- **Color:** Navy `#0e0f15`, Gold `#e8c547` (fills / `--accent`), foreground gold
  `#a07800` (`--accent-t`, AA-safe on chalk), Chalk `#f4f2ec`. Surface ladder
  `--bg-body → --bg-card → --bg-elevated → --bg-subtle`; text `--text-1/2/3`; hairline
  `--border`; semantic `--success/--danger/--warning/--info`; division chip = blue
  `rgb(96 165 250)`. Gold is **rationed** (primary action / leader only).
- **Type:** Bebas Neue (display/headers, uppercase, tight), Inter Tight (data/UI, tabular
  numerics — `font-data`), DM Sans (body). Headers uppercase; eyebrows `.12–.16em` tracking.
- **Shape:** radii 5px (cards/buttons/inputs), 8px (nav/pills); **1px hairlines, no drop
  shadows** (one overlay-only shadow token); the 2px gold top/left-rule is the structural
  accent.
- **Two distinct bar meanings — keep visually separate:** thin gold bar = *training
  progress to next +1*; thicker bar with a navy tick = *magnitude vs division mean*.

## Two bar meanings & three "now vs ceiling" patterns
1. Ability column bars = training progress (thin, gold, own only).
2. Magnitude bars (physiology, watt-profile, per-type) = value vs division mean (tick).
3. "Now vs ceiling" = solid (now) + dashed/faint (ceiling) on the radar and the
   per-type/development views; ceiling is always fuzzy until fully scouted.

## Assets
- Real country flags via **flag-icons** (already used in the app, `Flag.jsx`).
- Rider photo: a tidy **placeholder** (initials + reserved portrait area) until real
  photos exist. No AI/stock imagery (brand forbids it).
- No new icons — use the bundled stroke `Icon` set.

## Files in the handoff package
- `ProfileScreen.dc.html` — the full rider profile (hero + 8 tabs), prop-driven by
  `viewer` (own/scouting), `mode` (desktop/mobile), `lifecycle`
  (active/listed/auction/academy), `tab`.
- `Rider Profile.dc.html` — a presentation shell that frames `ProfileScreen` as
  desktop + 390px-mobile, own + scouting, with a light/dark toggle. (Reference only —
  not part of the app; do not port the shell.)
- `Rider-Profile-standalone.html` — a **self-contained, offline build** of the shell (all
  CSS/JS/fonts inlined). Open it in any browser to inspect exact pixels, colors, spacing
  and behavior — the most reliable reference while building.
- `screenshots/` — reference captures. `01–08-own-light` = the eight tabs **in order**
  (Overblik, Fysiologi, Træning, Udvikling, Scouting, Historik, Resultater, Interesse) for
  the own-rider light view. `01–03-context` = scouting/auction hero, dark-mode hero, and a
  390px mobile view.

> Note: this PR carries the spec (`README.md`) only. The HTML references, the offline
> standalone build and the screenshots live in the downloadable handoff package — keep that
> package alongside this file (or drop its contents into `design_handoff_rider_profile/`)
> while building.

---

## How to drive Claude Code (recommended)
1. Open the **Cycling Zone repo** in Claude Code and add this folder (`README.md` +
   the HTML references from the package) to its context.
2. Have it **read the real sources first** (the files under "Mapping to the real
   codebase"), then build **tab by tab**, reusing existing components/hooks/tokens — not
   re-implementing them.
3. Build order (each verified against the HTML before moving on):
   hero + rider-switcher + lifecycle/actions → Overblik (ability columns + type radar) →
   Fysiologi → Scouting (verdict + per-type potential + Røverkøb) → Træning → Udvikling
   (incl. Udviklingslog) → Resultater (expandable, totals on top) → Historik (table) →
   Interesse.
4. Enforce: token-only colors (no hex), `statColor` for all ability/rating colors, stars
   (never raw potential), scouting hides form/fatigue/exact-ceiling, the two distinct bar
   meanings, dark mode, ≤380px responsive, `prefers-reduced-motion`, 44px hit targets.
5. Confirm the **academy-can-be-listed/auctioned** behavior is a deliberate rule change
   before shipping it (it reverses a current rule).

### Suggested kickoff prompt
> Read `design_handoff_rider_profile/README.md` and the two HTML references. Then read
> `frontend/src/pages/RiderStatsPage.jsx`, `lib/abilities.js`, `lib/statColor.js`,
> `lib/riderRating.js`, `components/PotentialeStars.jsx`,
> `components/rider/{ScoutablePotentiale,RiderManageActions,ConditionChips,RiderTypeBadge}.jsx`,
> `lib/{training,trainingReport}.js`, `lib/useAcademy.js`. Recreate the redesigned Rider
> Profile in our React + Tailwind `cz-*` system, reusing those components and hooks and the
> real `/api/riders/:id` + scouting/training/academy data. Build it tab by tab, match the
> HTML pixel-faithfully with tokens only, and keep both viewer contexts (own/scouting) and
> the lifecycle states (active/listed/auction/academy). Don't ship until each tab matches
> the reference in light and dark.
