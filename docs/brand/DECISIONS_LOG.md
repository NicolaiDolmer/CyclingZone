# Decisions Log

> **Master issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)
> **Purpose:** Single source of truth for what's been decided in the brand identity project.
> **Rule:** Append-only. Confirmed decisions are immutable unless user explicitly revisits.
> **Update protocol:** Immediately after each confirmed choice. Never let an undocumented decision sit.

---

## ✅ Confirmed (immutable unless user revisits)

| # | Decision | Value | Confirmed | Source |
|---|---|---|---|---|
| C4 | Working palette (starting point) | Yellow `#e8c547` + navy `#0e0f15` (may be tuned in Decision 3) | 2026-05-18 | Existing brand assets + favicon |
| C3 | Wordmark | **ALL CAPS Bebas Neue**, letter-spacing 2, yellow `#e8c547` on navy `#0e0f15`, size scales proportionally. **Twin lines below** (long thin ls=1.8 + short rounded accent dash ls=2.8, both `#ffd966`). **No subtitle when paired with lines.** | 2026-05-19 | Final head-to-head pick: user "Vi arbejder videre med B" |
| F1 | Favicon (primary mark) | **Stacked CYCLING / ZONE** in Bebas Neue, yellow `#e8c547` rounded square (6px radius), navy `#0e0f15` text + thin separator line. Canonical across all platforms (browser, Discord, social). | 2026-05-19 | User reaction: "Jeg har meget godt kunne lide dette favicon du har lavet" |
| C2 | Cycling-DNA visibility | **None on the wordmark itself.** Cycling-signal lives entirely in the twin lines + stacked favicon (which are already locked). No additional symbols, dots, rings, or letterform modifications. Premium-restrained. | 2026-05-19 | User "Jeg er lige nu mest glad for a" after seeing 4-card C2 comparison (A=none, B=wheel-ring, C=period-dot, D=both) |

## 🔄 Reopened 2026-05-19

User flagged that C1/C2/C3 were never actually confirmed visually. Original "confirmed" entries claimed `AskUserQuestion answer in initial logo session` as source — text-only answers, which violates the project's own working rule (#2: visual + question simultaneously) and the calibration feedback already in this log (2026-05-18 entries). Rolled back to pending; must be re-decided with visual options before D1 can resume.

| # | Decision | Prior assumed value | Status |
|---|---|---|---|
| C1 | Identity-type | (assumed) Wordmark-first | Queued for next session — likely auto-resolved by C3 + F1, needs single-page confirmation |
| C2 | Cycling-DNA visibility | (assumed) Subtle / hidden | ✅ **LOCKED 2026-05-19** — None on wordmark; lines + favicon do the cycling-signaling. See Confirmed table above. |
| C3 | Wordmark direction (was: "Taste anchor") | (assumed) Whoop | ✅ **LOCKED 2026-05-19** — ALL CAPS Bebas Neue ls 2 + twin lines + stacked Bebas favicon. See Confirmed table above. |

### C3 Pivot 2026-05-19 — rationale

User feedback on first C3 attempt (4 "taste anchor" cards mixing typography + color + background): _"For meget på én gang — vi bør tage tingene én ad gangen, professionel måde."_ Agreed. Stripped C3 to pure wordmark exploration so casing/typography is isolated from color and background. Color palette becomes its own phase (light + dark mode) AFTER wordmark locks.

## 🎨 Design constraints captured 2026-05-19 (apply to all forward decisions)

| Constraint | Source | Apply to |
|---|---|---|
| Tracking should be **tight**, not wide | User reaction to A's wide letter-spacing | All wordmark candidates |
| **Yellow accent** (not white) for primary type | User reaction to A's white wordmark | All wordmark candidates on dark bg |
| **Sans-serif** for wordmark | User rejected Playfair Display serif (B) | Eliminates serif from wordmark exploration |
| **Subtitle / secondary text** under primary wordmark is liked | User reaction to D's "SEASON 2026 · MANAGER" subtitle | Available as a variant in wordmark exploration |
| **No bordered emblems** / yellow stroke outlines | User reaction to D's bordered favicon variant ("amatøragtig") | All favicon/monogram derivations |

## 🗺️ Recommended phase order (locked 2026-05-19)

Per user request for "most professional approach, one thing at a time":

1. **C3 — Wordmark direction** (active) — pure typography, locked bg/color
2. **C2 — Cycling-DNA visibility** — within chosen wordmark
3. **C1 — Identity-type** — wordmark / monogram / lockup
4. **D1 — Personality refinement** — narrow within C1-C3 foundation
5. **D2 — Type weight + tracking final** — exact metrics
6. **Phase 2 — Color palette** — light + dark mode primary, accent, surfaces, semantic colors (separate sprint, AFTER wordmark locks)
7. **Phase 3 — Type system** — heading + body + mono fonts beyond the logo
8. **Phase 4 — UI primitives + tokens** — buttons, cards, inputs, spacing, motion
9. **Phase 5 — Applications** — favicon, Discord, social, OG image
10. **Phase 6 — Implementation** — apply to actual codebase, light+dark parity audit

## 🟡 In progress

_None active. C1 (identity-type) queued for next session — likely auto-resolved by C3 + F1 already locked (wordmark-first with favicon-derived monogram), but needs user confirmation on a single visual sanity-check page._

## ⏳ Queued

| # | Decision | Triggers after |
|---|---|---|
| D1 | Overall personality (was IN PROGRESS; demoted because depends on C1-C3 foundation) | C1+C2+C3 re-confirmed |
| D2 | Type refinement (weight, spacing, custom letterform details) | D1 confirmed |
| D3 | Palette nuance (warm vs cool black, accent intensity, accessibility check) | D2 confirmed |
| D4 | Symbol direction (wordmark-only / abstract mark / hidden cycling-DNA letterform) | D3 confirmed; may collapse into C2 if C2 picks the symbol direction |
| D5 | Application mockups validation (Discord, browser, social, merchandise context) | D4 confirmed |

## 📝 User feedback (calibration rules — apply forward)

| Date | Feedback | Application |
|---|---|---|
| 2026-05-18 | "Stil mig spørgsmål, men vis valgmuligheder visuelt PÅ SAMME TID" | Never use abstract text-only AskUserQuestion when topic is visual. Always render side-by-side cards first. |
| 2026-05-18 | "Det er for useriøst at bede mig om at vælge uden at sende mulighederne med" | Same rule, stronger. Visual + question together in the same turn. |
| 2026-05-18 | "Kom nu ind i kampen" — wants confidence + delivery over deliberation | Lead with the work, not the meta-discussion. State what you're doing in 1 sentence, then do it. |
| 2026-05-19 | "Jeg er ikke enig i at jeg har godkendt dette" (re: C1/C2/C3) | Don't promote directional preferences from prior conversations into ✅ Confirmed status. A decision is only confirmed when (a) the user has seen visual options side-by-side AND (b) the user has explicitly picked one. Verbal/text-only answers go into a "🟡 Working assumption" bucket, never ✅. Re-confirm visually before locking. |
| 2026-05-19 | "Bør vi ikke få tingene på plads en af gangen?... mest muligt professionelle måde?" | One variable at a time per visual decision. Don't mix typography + color + background in the same card-set. If three variables differ, the user can't isolate which one drives their preference. Each visual exploration page locks N-1 variables and varies only ONE. |
| 2026-05-19 | "Jeg vil i denne process også gerne have inputs til ui og design af hele hjemmesiden" | User wants brand work to flow through to full site UI redesign (not just logo). Honored in the locked 10-phase sequence above — wordmark first, then color, then type system, then UI primitives, then implementation. Site-wide UI redesign is Phase 4-6, not bundled into wordmark exploration. |
| 2026-05-19 | First C3 pure-wordmark round: liked screenshot-A's `cyclingzone` lowercase text + screenshot-C's "streger der viser bevægelse" (race-broadcast underlines). Disliked all-caps compactness. Suggested blend of new B+C with screenshot-C's lines. | C3 direction locked at typographic level: **lowercase wordmark + race-broadcast movement-lines (long thin underline + short thick accent dash) + optional subtitle**. Next C3-refinement round shows 4 variants varying ONLY decoration density (lines none/some/all + subtitle yes/no). All-caps treatments and title-case neutral eliminated from forward consideration. |
| 2026-05-19 | C3 refinement round: still torn between **new A (lowercase + twin lines)** AND **screenshot C (Bebas Neue ALL CAPS + twin lines)**, "those are the two I love most". Disliked subtitle when combined with lines; said subtitle is OK *only* without lines. Said Bebas-Neue letter spacing was a bit too wide. Also loved the stacked "CYCLING / ZONE" favicon from screenshot C. | Resurrected ALL CAPS Bebas Neue as a candidate (after eliminating in prior round) — user's actual preference is twin-lines aesthetic, which transcends casing. C3 final round: head-to-head lowercase vs all-caps with tightened tracking. **New rule: lines + subtitle never combined.** Stacked "CYCLING / ZONE" favicon adopted as canonical favicon design for all forward variants (regardless of which hero wordmark wins). |

## 🎨 Confirmed micro-decisions (within C3)

| Micro | Value | Source |
|---|---|---|
| Twin lines (long underline + short accent dash) | ✅ Loved | 2026-05-19 refinement feedback |
| Subtitle | ❌ Rejected when combined with lines; ✅ OK only alone | 2026-05-19 refinement feedback |
| Letter spacing on Bebas Neue all caps | Tighter than screenshot-C's original (was 6, target ≤ 2) | 2026-05-19 refinement feedback |
| Stacked "CYCLING / ZONE" favicon (Bebas, yellow square) | ✅ Loved, adopted as canonical | 2026-05-19 refinement feedback |

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
