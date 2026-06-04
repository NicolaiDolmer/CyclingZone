# Decisions Log

> **Master issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)
> **Purpose:** Single source of truth for what's been decided in the brand identity project.
> **Rule:** Append-only. Confirmed decisions are immutable unless user explicitly revisits.
> **Update protocol:** Immediately after each confirmed choice. Never let an undocumented decision sit.

---

## 🟢 2026-06-04 — Phase 1 re-validated (GO) + brought forward to pre-TdF

| # | Decision | Value | Confirmed | Source |
|---|---|---|---|---|
| **RV1** | Phase 1 foundation re-validation | **GO.** Locked direction (Bebas all-caps wordmark + twin lines, dual-form favicon F1a/F1b, sibling fonts, accent `#e8c547`, dark canvas `#0e0f15`) confirmed in real product context: sidebar, landing, browser tab 16px, Discord, light + dark. | 2026-06-04 | `phase1-revalidation.html` go/no-go; user "Jeg synes det ser godt ud. Du får go." |
| **SCOPE** | #481 timeline | **Brought forward: ship the real brand to production before TdF.** (Was: defer logo to V2 post-TdF per #671. #671 stays the consistency baseline; #481 now lands on top before launch.) | 2026-06-04 | User: "Ægte brand live før TdF." |

**BF1 — body/UI font: ✅ RESOLVED 2026-06-04 = hybrid (3-role).** DM Sans for prose/reading; **Inter Tight for data** (stat tables, rankings, KPI numbers, prices/watts, dates/timers, dense chrome); Bebas for display/wordmark. Implement as a single `font-data` token applied to numeric/data components, DM Sans stays the default body. Comparisons: `font-comparison.html` (full swap) + `font-hybrid.html` (the chosen hybrid). User: "Lås som anbefalet."

**Contrast gate (`scripts/brand-contrast-check.mjs`, WCAG AA) — 2 findings to honor:** (1) **gold `#e8c547` as a foreground accent FAILS on every light canvas** (1.3–1.6:1) — in light mode the accent/lines/CTA text must be **navy or deep-gold `#a07800`**, not bright gold. This is a sub-decision riding on the light-canvas pick (P2). (2) Dark `text-3 #6b6d7e` fails AA at 3.75:1 — fix in Phase 4 token pass.

**P2 light-mode canvas: ✅ RESOLVED 2026-06-04 = E "Chalk" `#f4f2ec`** (refined warm near-white; surface ladder card `#fcfbf7`, elevated `#ffffff`). Chosen over current cream `#f0ede6` (too beige), C Race-bib `#faf8ee` (flatter), and A Newsprint (too large a yellow commitment). Comparison: `light-canvas-v2.html`. User: "Vi vælger E."

**New brand rule: ✅ "Gold = the leader" (maillot jaune).** A's yellow + maillot-jaune story is reused as a *semantic accent*, not a canvas: rank-1 team/rider gets a gold-bar + "Maillot jaune" treatment in every ranking/standings; the L'Auto heritage story lives as a feature-band (in A's `#f5edcf`) on landing/about, plus the OG/social image. Gold-as-fill is WCAG-safe on light; gold as thin foreground is not (use navy or deep-gold).

**Accent (P3): effectively locked** = gold `#e8c547` (+ bright `#ffd966` in dark). Light-mode foreground accent = navy `#1a1f38` or deep-gold `#a07800`; gold reserved for fills + the leader signal. Remaining color/token work (Phase 2/3): surface ladders, semantic colors, the dark `text-3` fix.

**Phase 4 UI micro-interactions (liked, queued 2026-06-04):** From the `phase1-revalidation.html` sidebar mockup, Nicolai liked (1) the **gold dot/bullet** by each nav item (active = solid gold), and (2) **on hover** of a nav item, animating in the **short accent-dash** from the wordmark's twin-lines as the hover indicator. Build both into the real sidebar nav component in Phase 4.

**Open color decisions to close next** (user wants a recap + to discuss): **P2** light-mode canvas (4 candidates in `logo-explorations.html`), **P3** accent refinement, **P3b** race-night navy in light mode, **P4** surfaces, **P5** semantic colors. Dark canvas `#0e0f15` is the only canvas locked so far.

---

## 🟢 2026-06-04 — Phase 2 color sub-decisions (multi-agent prep → owner picks, one at a time)

Agent A built each as one-variable side-by-side cards in `logo-explorations.html` ("Phase 2 color sub-decisions" container), every candidate run through `scripts/brand-contrast-check.mjs` (now testing the locked Chalk canvas). Owner picked from rendered screenshots.

| # | Decision | Value | Confirmed | Source |
|---|---|---|---|---|
| **D-SURF** | Surface elevation ladder (both canvases) | **Incumbent ladders.** Dark: card `#161824` · elevated `#1f2233`. Light Chalk: card `#fcfbf7` · elevated `#ffffff`. Tight/restrained steps over the wider-step + warm-consistent alternatives; matches the locked Chalk spec + shipped dark tokens, zero churn. All steps pass WCAG UI-separation 12–19:1. | 2026-06-04 | Owner picked incumbent for both dark + light after side-by-side render. |
| **D-SEM** | Semantic colors (success/error/warning/info) | **Set 2 — warning shifted off gold.** Dark: success `#5fd98a` · error `#fb8484` · warning `#f0a830` · info `#7ab0fb`. Light Chalk: success `#15772f` · error `#a81e1e` · warning `#9a5b00` · info `#1a47c0`. Warning moved to amber-orange so it never collides with brand gold `#e8c547` (Set 1's `#fbbf24` was 1.0:1 same-hue) — protects the "gold = leader" signal. All pass WCAG AA (light warning `#9a5b00` a tight 4.85:1). | 2026-06-04 | Owner picked Set 2 after side-by-side render with the gold-collision called out. |
| **D-TEXT3** | Dark tertiary text (`--text-3`) AA fix | **`#888ba0`** (5.69:1 on `#0e0f15`, AA). Replaces incumbent `#6b6d7e` (3.75:1, FAILed AA). Comfortable margin while staying a clear step below text-2 `#9da0b3` (7.4:1); the lighter Cand 3 `#9396ab` was rejected for crowding text-2 (0.85:1 apart). One-token change in `index.css` dark, 0 callsites touched. | 2026-06-04 | Owner picked Cand 2 after side-by-side body-text render. |
| **D-P3B** | Light-mode foreground navy | **Locked navy `#0e0f15`** (same as dark canvas) — NOT the reserved race-night `#0a1024`. One navy across light + dark = simplest 5-year system; the two are close enough that mixing them reads as inconsistency rather than intent. Contrast a non-factor (both ~17:1 AAA on Chalk). Closes the `#0a1024` reservation from 2026-05-19. (Note: sidebar/`on-accent` `#1a1f38` remains a separate navy — out of scope here.) | 2026-06-04 | Owner picked locked navy after side-by-side headline+body+feature-band render on Chalk. |

**Phase 2 color palette now fully locked.** All canvases (dark `#0e0f15` / Chalk `#f4f2ec`), surface ladders, semantic set, the dark `text-3` AA fix, and the light-mode foreground navy are decided. Remaining brand work = Phase 4 UI integration (Track 3) + the two strategy decisions below.

**Phase 4 strategy decisions (surfaced by Agent C's touch-point map) — ✅ RESOLVED 2026-06-04:**

| # | Decision | Value | Source |
|---|---|---|---|
| **PF1** | Font loading | **Self-host woff2 + `font-display:swap` + size-adjusted fallback metrics.** Avoids repeating #479 (async-font experiment caused CLS 0→0.092 + mobile Perf −3/−4); render-safe vs adding 2 families to the render-blocking Google Fonts link. | Owner picked self-host. |
| **PF2** | Gold ownership in rankings | **Gold = the leader (maillot jaune).** Rank-1 gets the gold maillot-bar; "your team" (`isMe`, currently gold in `StandingsPage.jsx`/`TeamsPage.jsx`) is reassigned to a distinct non-gold treatment (navy outline + navy "YOU" badge). Honors the locked "gold = leader" brand rule; resolves the gold-overload collision. | Owner picked gold=leader / you=navy. |

These unblock Track 3 (Phase 4 UI integration). Track 3 build order (per Agent C's map): PR-1 apply locked palette to `index.css`/`tailwind.config.js` (Chalk canvas + surfaces + D-SEM Set 2 + D-TEXT3 `#888ba0`) **+** self-host fonts + `font-data` token (redefine `mono`→Inter Tight, zero-churn) + Bebas sidebar wordmark → PR-2 sidebar micro-interactions (gold dot + hover accent-dash in `NavItem`) → PR-3 gold=leader across ranking surfaces (you→navy) → PR-4 raw-hex→token sweep. Refresh all 3 Playwright projects on the visual PRs.

**🟢 PR-1 (foundation) SHIPPED 2026-06-04** (`feat/481-phase4-foundation`, PatchNotes 4.75). Locked Phase 2 palette migrated into `index.css` + `tailwind.config.js`: Chalk canvas `#f4f2ec` / card `#fcfbf7` / new `--bg-elevated` `cz-elevated` `#ffffff`; dark card `#161824` / elevated `#1f2233`; D-SEM Set 2 semantic (light + dark, `-bg` tints retuned in dark); dark `--text-3` `#888ba0`; light foreground navy `--text-1` `#0e0f15` (D-P3B). Old cream `#f0ede6` retired; `--bg-subtle` retuned to a Chalk-recessed inset `#ece9e1`. Fonts SELF-HOSTED (woff2, `frontend/public/fonts/`, `@font-face` + `font-display:swap` + `unicode-range` latin/latin-ext split): Inter Tight (variable) redefines `font-mono` + adds `font-data` (zero churn across ~366 sites) with `font-variant-numeric: tabular-nums` + a **metric-matched `local('Arial')` fallback anchored to the tabular-digit advance @ w500** (size-adjust 110.88%) so numeric columns stay width-stable on swap; Bebas → `font-display` on the sidebar wordmark (desktop + mobile topbar), all-caps. Data-font latin subset `<link rel=preload>`-ed; NOT on the render-blocking Google link (avoids #479). **Owner-verify gate (CLS):** worst-case font-swap CLS = **0.021** (Playwright, fonts force-delayed 1.5s; prod lower via preload) vs #479's 0.092. `scripts/brand-contrast-check.mjs` green on every locked pairing; all-3 Playwright projects refreshed. Reproducible fallback metrics: `scripts/compute-font-fallback-metrics.py`.

## ✅ Confirmed (immutable unless user revisits)

| # | Decision | Value | Confirmed | Source |
|---|---|---|---|---|
| C4 | Working palette (starting point) | Yellow `#e8c547` + navy `#0e0f15` (may be tuned in Decision 3) | 2026-05-18 | Existing brand assets + favicon |
| C3 | Wordmark | **ALL CAPS Bebas Neue**, letter-spacing 2, yellow `#e8c547` on navy `#0e0f15`, size scales proportionally. **Twin lines below** (long thin ls=1.8 + short rounded accent dash ls=2.8, both `#ffd966`). **No subtitle when paired with lines.** | 2026-05-19 | Final head-to-head pick: user "Vi arbejder videre med B" |
| F1 | Favicon (primary mark) | **Stacked CYCLING / ZONE** in Bebas Neue, yellow `#e8c547` rounded square (6px radius), navy `#0e0f15` text + thin separator line. Canonical across all platforms (browser, Discord, social). | 2026-05-19 | User reaction: "Jeg har meget godt kunne lide dette favicon du har lavet" |
| C2 | Cycling-DNA visibility | **None on the wordmark itself.** Cycling-signal lives entirely in the twin lines + stacked favicon (which are already locked). No additional symbols, dots, rings, or letterform modifications. Premium-restrained. | 2026-05-19 | User "Jeg er lige nu mest glad for a" after seeing 4-card C2 comparison (A=none, B=wheel-ring, C=period-dot, D=both) |
| **P1** | **Dark mode canvas** | **`#0e0f15` "locked navy"** — same value as C4 working navy, now elevated from "working" to "final canvas". Surface stack: card `#161824` · elevated `#1f2233`. RGB 14·15·21, HSL L 6.9%, neutral-cool. Closest peer: Whoop dark UI. | **2026-05-19** | A vs B head-to-head with landing + app + surface mocks. User: "a er den vi vælger" — picked incumbent over slightly-darker Tech coal #0a0b10. No re-verification needed; Phase 1 already validated on this exact navy. |

## 🔄 Reopened 2026-05-20

F1 reopened during C1 sanity-check. C1's "browser tab @ 16×16" context surfaced that the stacked CYCLING/ZONE favicon is unreadable mush at 16px — the 7-letter CYCLING + 4-letter ZONE compress to ~2px per letter. Working rule #7 ("If unreadable at 32×32, reject") had been bypassed when F1 was locked on visual approval at large sizes. The C1 sanity-check pattern worked exactly as intended.

User direction 2026-05-20: _"Det skal være muligt at se hvad der står"_ + _"Hvis ikke der kan stå CyclingZone, så skal der stå CZ eller noget ala det."_ → F1 expands to a **dual-form system**: stacked CYCLING/ZONE for ≥48px (preserved — user loved), readable monogram for ≤32px (TBD via F1b decision).

| # | Decision | Prior assumed value | Status |
|---|---|---|---|
| F1 | Favicon (canonical, all sizes) | Stacked CYCLING/ZONE on yellow rounded square — same across all sizes | ✅ **Split-resolved 2026-05-20** — F1a (stacked, large-form) + F1b (CZ monogram, small-form) |
| F1a | Favicon — large form (≥48px) | (split off) | ✅ **LOCKED 2026-05-20** — Stacked CYCLING/ZONE on yellow rounded square, Bebas Neue, navy text + thin separator. Used for Discord, social, OG-image, app icon. |
| F1b | Favicon — small form (≤32px) | (split off) | ✅ **LOCKED 2026-05-20** — **Variant B: Inter Tight Black 900 "CZ", plain.** Yellow rounded square, navy CZ text. Used for browser tab, mobile address bar, OS chrome. User direction: "Det skal være muligt at se hvad der står" — Inter Black's thicker strokes survive 16×16 worst-case where Bebas Neue's condensed strokes thin out. |
| C3-revisit | Wordmark font — single-font system or Bebas/Inter siblings? | (raised by user 2026-05-20 after F1b locked) | ✅ **LOCKED 2026-05-20 = A (sibling system)** — Bebas Neue stays for wordmark, Inter Tight Black for small favicon. User saw direct head-to-head (Bebas vs Inter Tight wordmark) + peer-table from Spotify/Whoop/Stripe/Strava/Rapha and picked A. C3 wordmark direction reaffirmed. Brand uses display-font + UI-font as siblings, function-matching not uniformity. |

## 🔄 Reopened 2026-05-19

User flagged that C1/C2/C3 were never actually confirmed visually. Original "confirmed" entries claimed `AskUserQuestion answer in initial logo session` as source — text-only answers, which violates the project's own working rule (#2: visual + question simultaneously) and the calibration feedback already in this log (2026-05-18 entries). Rolled back to pending; must be re-decided with visual options before D1 can resume.

| # | Decision | Prior assumed value | Status |
|---|---|---|---|
| C1 | Identity-type | (assumed) Wordmark-first | Queued — sanity-check started 2026-05-20, paused mid-flight when F1 reopened. Resumes after F1b locks. |
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

**Phase 2 active.** P1 (dark canvas) locked 2026-05-19. **P2 — Light mode canvas** now active in `logo-explorations.html` — 4 candidates varying only the light surface, wordmark + accent locked.

**Asset production started 2026-06-04** (decoupled from the in-flight P2 colour pick — only locked marks were produced). Outlined SVG masters for the wordmark (5 variants) + F1a stacked mark + F1b `CZ` monogram shipped to `frontend/public/brand/`; production `favicon.svg` swapped from the Arial-Black placeholder to the locked F1b. See [`ASSETS.md`](ASSETS.md). Pending: PNG/ICO raster, OG-image refresh, Discord/social, Phase 4 site-font integration.

## ⏳ Queued

| # | Decision | Triggers after |
|---|---|---|
| P2 | Light mode canvas (cream / off-white / pure white / cool gray) | P1 locked ✅ — ACTIVE NOW |
| P3 | Accent yellow refinement — keep `#e8c547` or fine-tune (warmer/cooler/brighter) against both canvases | P2 locked |
| **P3b** | **Brand-navy foreground refinement** — for light mode text/foreground/feature-sections, use `#0e0f15` (same as dark canvas) or `#0a1024` (D's race-night navy, reserved 2026-05-19). User flagged D's color as wanting to "be one of the options" in light mode. | P3 yellow locked |
| P4 | Surface depth — flat single-surface vs layered elevation. Sets Phase 4 UI rhythm. | P3 locked |
| P5 | Semantic colors — success / error / warning / info hues that don't fight brand yellow. WCAG AA on both canvases. | P4 locked |
| D1 | Overall personality (legacy queue — likely subsumed by Phase 1+2 work) | Phase 2 complete |
| D2 | Type refinement (weight, spacing, custom letterform details) | D1 confirmed |
| D5 | Application mockups validation (Discord, browser, social, merchandise context) | Phase 2 complete |

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
| 2026-05-20 | Mid C1 sanity-check at 16×16 browser tab: _"Når vi har noget der er lige så småt som det der, så skal det selvfølgelig være læsbart. Hvis ikke der kan stå CyclingZone, så skal der stå CZ eller noget ala det, sådan det er nemmere at genkende. Det skal være muligt at se hvad der står."_ | F1 was locked on large-size visual approval only; small-size legibility wasn't tested. C1 sanity-check (working rule pattern doing its job) surfaced this on the 16×16 browser-tab context. F1 expands to dual-form system: stacked CYCLING/ZONE for ≥48px (kept — user loved), readable monogram for ≤32px (F1b active decision). New rule: **every favicon must pass 16×16 legibility test — readable means a reader can identify what it says, not just recognize the shape.** Working rule #7 already required this; calibration is to actually run the test, not assume large-size approval extrapolates. |
| 2026-05-20 | After picking F1b=B (Inter Tight Black): _"Men skal vi så ikke overveje at undersøge at bruge den skrifttype i alt vores branding, sådan det ikke er forskellige? Hvad synes du om det. Er det ikke best practice?"_ | Smart instinct, but the "one font everywhere" rule is a beginner-version of brand consistency. Mature brand systems (Spotify Circular+Mix, Whoop Helvetica Now Display+Text, Stripe Sans display+UI, Strava Maison Neue display+text) all use 2-3 carefully-chosen fonts where each does its specific job: display fonts optimize for memorability/personality, UI fonts optimize for legibility/density. Bebas Neue (display, condensed, distinctive) + Inter Tight (UI, geometric, workhorse) is a sibling-pair, not a clash. AI recommends keeping the dual-font sibling system. But sibling-check rendered visually in logo-explorations.html so user can see the alternative and decide. |
| 2026-05-20 | After seeing wordmark head-to-head: _"Vi tager A"_ (keep Bebas wordmark + Inter Tight small favicon as sibling system). | C3-revisit locked = A. User confirmed sibling-font system after seeing direct comparison + peer-table from mature multi-font brand systems. Phase 1 effectively wrapped. Forward calibration: when introducing a new font, always show side-by-side comparison + peer reference, not just text-argument. The visual proof + peer-context combo unlocks confident decisions. |
| 2026-05-19 | First P1 4-card render: user immediately knew C+D were wrong, wanted A vs B narrowed: _"a er den vi vælger"_ after seeing A vs B head-to-head with landing + app + surface mocks. Also: _"D vil jeg ikke have til dark mode, men vi kan godt overveje at bruge farven til det almindelige mode senere. Det skal i hvert fald være en af mulighederne."_ | When subtle-variant pairs survive a 4-card cull (here A vs B), render head-to-head with realistic UI context (landing + app + surfaces) — that's where the small differences become felt vs imagined. Also: a ruled-out canvas color may still have brand value elsewhere — track as "reserved" in queue, not killed in anti-decisions. P3b created to honor D's reservation. |

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
| **Warm noir `#16110c` (C variant in P1)** | Too Rapha-luxury / leather-bag aesthetic. Drifts from manager-game category toward cycling-fashion brand. User: "C vil jeg ikke have under alle omstændigheder" (2026-05-19). |
| **Race-night `#0a1024` as dark-mode canvas (D in P1)** | Saturated navy is too flavored for the foundational canvas — leans cinematic, would fight UI minimalism over 5-year horizon. **Reserved**, not killed: user flagged D's color for consideration in light mode / brand-foreground. Tracked as P3b in queue. |

## Notes

- The working file `logo-explorations.html` is reset to reflect the current decision in progress. Don't read it as history — read this log for history.
- After D5 is confirmed and Phase 1 exits, this log feeds Phase 2 asset production directly.
