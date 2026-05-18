# Decisions Log

> **Master issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)
> **Purpose:** Single source of truth for what's been decided in the brand identity project.
> **Rule:** Append-only. Confirmed decisions are immutable unless user explicitly revisits.
> **Update protocol:** Immediately after each confirmed choice. Never let an undocumented decision sit.

---

## ✅ Confirmed (immutable unless user revisits)

| # | Decision | Value | Confirmed | Source |
|---|---|---|---|---|
| C1 | Identity-type | Wordmark-first (monogram is derived) | 2026-05-18 | AskUserQuestion answer in initial logo session |
| C2 | Cycling-DNA visibility | Subtle / hidden (no literal cyclist illustration) | 2026-05-18 | AskUserQuestion answer in initial logo session |
| C3 | Taste anchor | Whoop (premium athletic minimalism) | 2026-05-18 | AskUserQuestion answer in initial logo session |
| C4 | Working palette (starting point) | Yellow `#e8c547` + navy `#0e0f15` (may be tuned in Decision 3) | 2026-05-18 | Existing brand assets + favicon |

## 🟡 In progress

| # | Decision | Status | Options visible in |
|---|---|---|---|
| D1 | Overall personality | Awaiting user pick: A/B/C/D | `logo-explorations.html` (preview panel) |

**D1 options on the table:**
- **A** — Refined Minimal (Whoop-pure, lowercase, Inter Tight, no symbol)
- **B** — Warm Crafted (Manrope title case, warmer black, thin accent line)
- **C** — Sport Athletic (Bebas all caps, race-broadcast underline)
- **D** — Tech Smart (DM Sans 900 camelCase, geometric precision dot)

## ⏳ Queued

| # | Decision | Triggers after |
|---|---|---|
| D2 | Type refinement (weight, spacing, custom letterform details) | D1 confirmed |
| D3 | Palette nuance (warm vs cool black, accent intensity, accessibility check) | D2 confirmed |
| D4 | Symbol direction (wordmark-only / abstract mark / hidden cycling-DNA letterform) | D3 confirmed |
| D5 | Application mockups validation (Discord, browser, social, merchandise context) | D4 confirmed |

## 📝 User feedback (calibration rules — apply forward)

| Date | Feedback | Application |
|---|---|---|
| 2026-05-18 | "Stil mig spørgsmål, men vis valgmuligheder visuelt PÅ SAMME TID" | Never use abstract text-only AskUserQuestion when topic is visual. Always render side-by-side cards first. |
| 2026-05-18 | "Det er for useriøst at bede mig om at vælge uden at sende mulighederne med" | Same rule, stronger. Visual + question together in the same turn. |
| 2026-05-18 | "Kom nu ind i kampen" — wants confidence + delivery over deliberation | Lead with the work, not the meta-discussion. State what you're doing in 1 sentence, then do it. |

## 🚫 Anti-decisions (what's been ruled out)

| Item | Why ruled out |
|---|---|
| Esports/gaming-aggressive aesthetics (italic, glow, neon) | Conflicts with refined-premium tone in TONE_OF_VOICE.md |
| Literal cyclist illustration in logo | Ruled out by C2 (subtle DNA) |
| Em-dash in any logo type | Ruled out by TONE_OF_VOICE.md punctuation rule |
| Pro-designer route ($2k-15k) | User said "skal ikke være pro designer" — AI-driven iteration confirmed |

## Notes

- The working file `logo-explorations.html` is reset to reflect the current decision in progress. Don't read it as history — read this log for history.
- After D5 is confirmed and Phase 1 exits, this log feeds Phase 2 asset production directly.
