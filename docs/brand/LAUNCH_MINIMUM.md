# Brand Minimum — TdF Launch Baseline

> **GitHub issue:** [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) (TdF-focused subset of [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481))
> **Owner:** Nicolai Dolmer Mikkelsen (founder)
> **Established:** 2026-06-04
> **Status:** Launch baseline — the brand we ship for the TdF open-beta launch (deadline 2026-06-15).

---

## Why this doc exists

[#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) is the "once-and-for-all" brand overhaul. Its Phase 1 decisions are **locked** (ALL-CAPS Bebas Neue wordmark, dual-form favicon, Bebas + Inter Tight sibling-font system — see `DECISIONS_LOG.md`) but **not yet implemented** in the codebase, and the full logo/asset production is deliberately deferred to **V2, post-TdF**.

This doc captures the **interim brand that is actually shipped right now** — the launch minimum. It is the source of truth for "is this on-brand for launch?" until the #481 V2 assets land. An audit on 2026-06-04 found the four dimensions below were already ~95% consistent in production; this doc locks them and records the gaps that were closed (one at audit time, a second found 2026-06-09).

**Launch baseline (now) ≠ #481 target (V2).** Where they differ, it is intentional (logo deferred). Each section below flags the V2 successor.

---

## 1. Wordmark

**Canonical player-facing spelling: `Cycling Zone`** — two words, title case (capital C and Z).

Confirmed by owner 2026-06-04 (resolves the "decision pending" in `BRAND_BRIEF.md` §6, candidate #1 = current UI). Used on the page `<title>`, OG/Twitter meta, all `locales/*` strings, the sidebar logo, the landing page and Discord bot copy.

Acceptable variants **in their own domain only** (not player-facing copy):

| Variant | Where it is allowed |
|---|---|
| `cycling-zone` | URL slug / domain (`cycling-zone.vercel.app`) — locked, do not change |
| `CyclingZone` | Repo name, package names, code identifiers, code comments, test fixtures, internal AI-ops docs |
| `Cycling Zones` | The physiology feature name (power curve / VO2max zones) on the rider profile — a **feature**, not the brand name |

> **V2 (#481):** the *display logo* renders the name as ALL-CAPS `CYCLING ZONE` in Bebas Neue with twin movement-lines (Decision C3). That is a typographic treatment of the same two-word name — it does **not** change the text spelling locked here.

## 2. Accent + foundation colors

The implemented tokens (`frontend/src/index.css`, exposed via `frontend/tailwind.config.js` as `cz-*`) already match the confirmed palette in `BRAND_BRIEF.md` §5.

| Role | Value | Token | Use |
|---|---|---|---|
| **Primary accent — gold** | `#e8c547` (rgb `232 197 71`) | `--accent` / `cz-accent` | CTAs, highlights, winner-jersey reference, Discord embed color (`0xe8c547`) |
| Accent bright (dark mode) | `#ffd966` | `--accent-t` (dark) | Hover/glow accents on dark canvas |
| Accent deep (light mode) | `#a07800` | `--accent-t` (light) | Accent text/spinner on light canvas (contrast) |
| **Foundation — navy** | `#1a1f38` | `--bg-sidebar` / `--on-accent` | Sidebar (both themes), text on gold |
| Dark canvas | `#0e0f15` | `--bg-body` (dark) | Dark-mode background (= #481 P1 "locked navy") |
| Light canvas | `#f0ede6` | `--bg-body` (light) | Light-mode background (cream) |

Semantic state colors (success/danger/warning/info) are defined in the same file and are intentionally tuned not to fight the gold. No off-brand accent colors exist in production (verified 2026-06-04).

> **V2 (#481):** Phase 2/3 may fine-tune the exact gold and navy values and add a refined surface-elevation scale. The current values are the launch baseline.

## 3. Font

**`DM Sans`** for both heading and body (single-font system for launch). Weights 400–900 loaded (`frontend/index.html`); use 700–900 for headings, 400–600 for body. Defined in `frontend/src/index.css` body rule and used consistently, including the OG-image SVG.

> **V2 (#481):** the locked target is a two-font sibling system — **Bebas Neue** (display/wordmark) + **Inter Tight Black** (small favicon/UI) (Decision C3-revisit). DM Sans is the interim workhorse until those land. A single well-chosen font for both roles is a valid launch minimum; the sibling system is a V2 upgrade, not a launch blocker.

## 4. Tone of voice

Source of truth: [`docs/TONE_OF_VOICE.md`](../TONE_OF_VOICE.md). No new rules here — the launch requirement is simply that all player-facing copy follows it.

Load-bearing rules for the brand minimum:

- **Founder-led, build-in-public:** the voice is Nicolai's — `I` (EN) / `jeg` (DA), never `we` / `vi`. Address each player 1-to-1 (`you` / `du`).
- **EN primary, DA secondary** for all player-facing content.
- **The fairness promise** is the load-bearing sentence about premium — repeat it, don't water it down.
- **No em-dash** anywhere in player-facing copy.

Audit 2026-06-04 found the founder-led / no-`we`/`vi` part already consistent in player-facing surfaces. **The no-em-dash rule was not:** the 2026-06-04 note wrongly recorded copy as consistent here, but 229 em-dashes remained live across 39 locale files plus 522 in the patch-note history. Swept 2026-06-09 (PR #1193, [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)). Standalone `—` empty-value glyphs (table/dropdown placeholders: `rankNone`, `salaryNone`, `dash`, `noBuyOption`) are kept as a deliberate exception, recorded in [`TONE_OF_VOICE.md`](../TONE_OF_VOICE.md).

---

## Logo — wired into the live UI for launch (updated 2026-06-09)

> **Superseded:** the original "logo udskudt til V2 efter TdF" stance. Owner directive 2026-06-09 brought the produced #481 brand forward — ship it on the site **now**, not post-TdF.

The #481 marks (produced 2026-06-04, see `ASSETS.md`) are now wired into the running app via [`frontend/src/components/Brand.jsx`](../../frontend/src/components/Brand.jsx): outlined wordmark (with twin movement-lines) in the sidebar + landing top-bar, the CZ monogram replacing all hand-rolled gold-letter tiles, and the stacked mark on the login hero. Favicon / app-icons / OG / Discord rasters were already wired in Phase 4. Usage rules: [`GUIDELINES.md`](GUIDELINES.md). The full asset *system* (extended marketing lockups, motion) remains #481 Phase 2+ follow-up, but the launch identity is now the real brand, not a placeholder.

---

## Audit + fix record (2026-06-04)

Full-surface audit of wordmark, font, color and tone. Result: **~95% already consistent.** Gaps closed:

- **Wordmark stragglers (2026-06-04):** 4 player-facing lines used one-word `CyclingZone` instead of canonical `Cycling Zone` — 2 patch-note entries (EN+DA pairs) in `frontend/src/pages/PatchNotesPage.jsx` + 2 unsent Discord drafts + the title in `docs/TONE_OF_VOICE.md`. Corrected.
- **Em-dash in player-facing copy (found 2026-06-09):** the 2026-06-04 audit wrongly recorded the no-em-dash rule (§4) as consistent. In fact 229 em-dashes were live across 39 locale files, plus 522 in the patch-note history. All swept to period / comma / colon / parens / middot per the tone rule (#671); empty-value `—` glyphs kept as a deliberate exception.

Everything else (accent tokens, DM Sans, founder-led tone) was already shipped and consistent — this doc locks that state.
