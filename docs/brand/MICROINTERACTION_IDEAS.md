# Micro-interaction & attention-to-detail ideas

> **Status:** Discussion backlog — NOT locked decisions. Captured 2026-06-04 after #481 Phase 4 PR-2 (sidebar gold bullet + hover accent-dash) landed and Nicolai liked the feel. Purpose: carry that polish across the rest of the UI/UX in a brand-coherent, restrained way. Revisit at the next UI-polish session.
> **Tone guardrail:** the brand is *refined-premium*, not esports-aggressive (`TONE_OF_VOICE.md`). Every idea below should feel like attention to detail, never decoration for its own sake. Default to subtle, fast, and skippable.

---

## The through-line

PR-2 took **one brand signature** (the wordmark's short thick accent-dash + the "gold = leader" dot) and turned it into a **functional affordance** in the nav. That's the pattern worth repeating everywhere: reuse the brand's own vocabulary — the **twin movement-lines**, **gold = the leader**, the **data font** — as the building blocks of interaction, so polish reads as *the brand being consistent*, not as random animation. Three reusable primitives:

1. **The accent-dash** (short gold line, `origin-left scale-x` grow) → "this is active / you're here / you're about to act".
2. **Gold = leader** (maillot jaune) → rank, primacy, your-attention-here.
3. **The data font + tabular-nums** (already shipped) → numbers that can *move* width-stably.

---

## Recommended next set (highest impact × brand-coherence)

These four reuse PR-2's exact language and would make the polish feel system-wide, not one-off:

1. **Active-tab accent-dash on in-page tab bars.** Team (Squad/tabs), Auctions (Active / My-situation), Finance, Admin tabs all use plain text/underline tabs today. Give the *active* tab the same short→grown gold dash under it (and inactive tabs the grow-on-hover dash). One shared `<TabBar>` treatment = instant cross-site consistency with the sidebar. **Low effort, high payoff.**
2. **Mobile bottom-nav parity** (`MobileQuickNav`). The sidebar now has the gold-dot active language; the mobile bottom bar should match (active item = solid gold dot/label, same hover/active feel) so desktop↔mobile read as one system. **Low effort.**
3. **Number roll / pulse on live values.** The data font already does tabular-nums (width-stable). When balance, prize money, market value, watts, or online-count *change*, roll the digits (odometer) or reuse the existing gold `cz-pulse-flash` (#196, today only on auction price cells). Makes the data feel alive and pays off the self-hosted-font investment. **Medium effort, high delight.**
4. **Gold = leader, everywhere** (this is PR-3's job — flagged here as part of the same family). Rank-1 maillot-bar on every standings/ranking/H2H surface; your-team → navy. Top-3 podium tint (gold/silver/bronze) as a consistent treatment. **Owner-verify gate — mockups first.**

---

## Full catalogue (grouped)

### A. Extend the movement-line language
- **Section-heading masthead motif.** Key page H1s (Bebas) could carry the twin-lines (long thin underline + short accent dash) as a subtle masthead, echoing the wordmark. Use *very* sparingly — 1 per page max, or it stops being special.
- **Primary-CTA hover.** A thin gold movement-line that sweeps/grows under or across the primary button on hover (the "speed line" metaphor) — restrained, no glow.
- **Actionable table rows.** Rows you can act on (bid, view rider) get the accent-dash or a gold left-edge tick on hover, matching the nav affordance.

### B. Motion as the "race" metaphor (cycling-native)
- **Live-leader transitions in auctions.** When the current high bidder changes, the leader name gets the gold treatment + a subtle slide/flash (builds on the #980 stale-name fix). Reinforces "gold = whoever's in front".
- **Standings position changes.** Up/down arrow + brief highlight when a team/rider moves rank between race days.
- **Progress as a peloton/route line.** Season progress (`x/28 race days`) could render as a route line filling in, rather than a plain bar — on-theme without being gimmicky.

### C. Presence, state & perceived speed
- **Breathing online-dot.** The green "online now" dot gently pulses to feel live (reduced-motion: static).
- **Branded skeleton loaders.** Replace spinners on data-heavy pages (Riders, Auctions, Standings) with Chalk/navy skeletons — cuts perceived latency, looks premium. Biggest "feels fast" win.
- **Optimistic action feedback.** Bid/transfer/watchlist buttons give instant micro-feedback (gold tick, subtle scale) before the server confirms.
- **Notification bell.** A single subtle ring/shake when a real-time notification arrives (not on every render).

### D. Navigation depth (extends PR-2)
- **Smoother group collapse/expand** in the sidebar (animate height/opacity, not just the chevron rotate).
- **"You are here" left-rail.** Consider a thin gold left-rail on the active nav item *in addition to* the bullet — evaluate against over-egging; A/B the two.
- **Consistent focus-ring.** A gold (brand) focus-ring across all interactive elements — improves keyboard UX *and* looks intentional. A11y + polish in one.

### E. Page-level cohesion
- **Route transitions.** Subtle fade/slide on navigation so the SPA feels like one continuous surface (reduced-motion: instant).
- **Dashboard card stagger-in.** Cards fade-up in sequence on load — cheap, premium, one-time per visit.
- **Branded empty states.** Replace plain "Ingen X" with the twin-lines motif + a one-line cycling-flavoured message. Turns dead ends into brand moments.

### F. Delight at milestones (rare, earned)
- **Promotion / first-win / season-end** get a tasteful gold maillot-jaune flourish or restrained confetti (you already do 🎉 on "grundforløb gennemført"). Reserve for genuinely big moments so it stays special.

---

## Foundation that makes this systematic (do this first or alongside)

- **Motion tokens.** Define a small shared set — e.g. `--motion-fast` (≈150ms), `--motion-base` (≈200ms), one or two easings — so every interaction shares a rhythm instead of ad-hoc durations. This is what turns "a few nice animations" into "a system with attention to detail".
- **Global `prefers-reduced-motion` policy.** PR-2 used `motion-reduce:transition-none` per-element; a global policy (utility or CSS layer) keeps it consistent and removes the chance of forgetting it on a new component.
- **Performance budget.** Everything transform/opacity-based (GPU-cheap), no layout-thrash; nothing that touches the font-swap CLS work from PR-1. Animations must never block input.

## Guardrails (so polish stays premium, not noisy)
- One signature moment per surface — restraint is the brand.
- Always skippable (reduced-motion) and always fast (sub-250ms for affordances).
- Never animate just because we can; each one must answer "what does this tell the player?".
- Verify in **light + dark + mobile** via Playwright-mocks, same as PR-2 (and remember sidebar/shared-chrome changes may sit below the core-smoke 0.05 threshold → force-refresh desktop baselines + verify unmasked).

---

_Related: `DECISIONS_LOG.md` (Phase 4 / Track 3 build order), `ASSETS.md` (shipped tokens/fonts), `UI_NAV_IA.md` (nav/IA audit), PR [#1050](https://github.com/NicolaiDolmer/CyclingZone/pull/1050) (PR-2, the first two micro-interactions)._
