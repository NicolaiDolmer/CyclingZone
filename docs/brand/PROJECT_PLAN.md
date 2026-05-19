# Brand Identity Project — Master Plan

> **GitHub issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) (master tracker — reference in commits via `Refs #481`)
> **Goal:** Complete Cycling Zone brand identity (logo, favicon, Discord, design manual, UI/UX-tokens) "once and for all".
> **Owner:** Nicolai Dolmer Mikkelsen
> **Started:** 2026-05-18
> **Status:** **Phase 1 LOCKED 2026-05-20** — Bebas Neue wordmark + dual-form favicon system (stacked F1a ≥48px, Inter Tight Black CZ F1b ≤32px) + sibling-font system. Phase 2 — color palette (light + dark mode) starts next session.

---

## North star

A brand that matches `docs/TONE_OF_VOICE.md` — founder-led, build-in-public, premium without flashy, fair-promise as identity load-bearer. Whoop as taste anchor. Built to last 5+ years without redesign.

## In scope

| Asset | Phase |
|---|---|
| Wordmark | Phase 1-2 |
| Monogram | Phase 1-2 |
| Lockup (wordmark + monogram) | Phase 2 |
| Favicon set (16, 32, 64, 192, 512) | Phase 2 |
| Apple touch icon | Phase 2 |
| Discord server icon (512×512 rounded) | Phase 2 |
| Discord banner | Phase 2 |
| Social avatars (X, LinkedIn, Bluesky, GitHub-org) | Phase 2 |
| OG-image template | Phase 2 |
| Color tokens (refined CSS vars) | Phase 3 |
| Typography scale | Phase 3 |
| Spacing scale | Phase 3 |
| Component pattern library | Phase 3 |
| Icon-style direction | Phase 3 |
| Light + dark mode parity check | Phase 4 |
| Existing UI integration | Phase 4 |
| Mini brand guidelines (PDF) | Phase 5 |
| Future decision framework | Phase 5 |

## Out of scope (intentionally deferred)

- ❌ Bespoke custom typography (use Google Fonts initially; commission custom only if scale demands)
- ❌ Full Figma library (only if visual prototyping becomes a bottleneck — not now)
- ❌ Marketing campaign creative (waits for product-market-fit signal)
- ❌ Print collateral, jerseys, physical merchandise (post-launch consideration)
- ❌ Illustration system (Phase 3 picks direction; production deferred)

## Five phases

### Phase 1 — Decisions Sprint (~5 visual decisions)
Lock the logo direction through iterative visual A/B/C/D choices. ONE decision at a time. User points, AI narrows. See `DECISIONS_LOG.md` for state. Working file: `logo-explorations.html` (always reflects current decision).

**Decisions queue:**
1. Overall personality (Refined Minimal / Warm Crafted / Sport Athletic / Tech Smart) — IN PROGRESS
2. Type refinement (weight, spacing, custom letterform details)
3. Palette nuance (warm-black vs cool-navy, accessibility, accent variants)
4. Symbol direction (wordmark-only / abstract mark / hidden cycling-DNA letterform)
5. Application mockups (Discord avatar, browser favicon, social post, t-shirt context)

**Exit criteria:** All 5 decisions logged, final lockup approved.

### Phase 2 — Asset Production
Produce every required file at every required size.

**Activities:**
- Final SVG master file (logo + monogram)
- PNG export at 16, 32, 64, 128, 192, 256, 512, 1024, 2048
- Favicon set (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, manifest icons)
- Discord server icon (512×512 PNG, circular-safe)
- Discord banner (960×540)
- Social avatars per platform spec
- OG-image template (1200×630 SVG)
- All variants: full color / inverse / pure black / pure white / on yellow

**Exit criteria:** Asset folder `frontend/public/brand/` populated, favicon swapped in production.

### Phase 3 — Design System Extension
Match the logo's DNA to the full design system.

**Activities:**
- Refine `tailwind.config.js` + `index.css` color tokens
- Establish typography scale (display, heading, body, mono) matched to logo type
- Spacing scale (4/8/12/16/24/32/48/64 etc.)
- Component patterns aligned to brand DNA (buttons, cards, inputs, modals)
- Icon style direction (line weight, corner radius, fill rules)
- Light + dark mode parity audit

**Skills to invoke:** `design:design-system` for audit and documentation.

**Exit criteria:** All UI primitives match brand DNA. Light + dark mode visually consistent.

### Phase 4 — UI Integration
Apply brand to existing UI without regressions.

**Activities:**
- Replace current `frontend/public/favicon.svg`
- Update `Layout.jsx` header brand-mark
- Update `LoginPage.jsx`, `FounderSupporterPage.jsx`, `LandingPage` brand references
- Audit all `bg-cz-*` token usages — any drift?
- Visual regression test via Playwright `core-smoke.spec.js`
- Dark mode toggle test

**Skills to invoke:** `frontend-design:frontend-design` for production-quality integration, `design:design-handoff` for spec writing.

**Exit criteria:** All UI surfaces reflect new brand. Playwright smoke passes. No raw-color hardcodes left.

### Phase 5 — Documentation & Long-term
Lock the brand for future maintenance.

**Activities:**
- Write `docs/brand/BRAND_GUIDELINES.md` (mini guideline PDF-ready)
- Document clear-space rules, minimum-size, do/don't, voice-pairing
- Establish future-decision framework (when to deviate, when to refresh)
- ADR for any major DNA decisions (use `engineering:architecture` skill)
- Update `CLAUDE.md` with brand-canonical references

**Exit criteria:** Brand guidelines doc complete. Any new asset request has a documented path.

## Tools (use proactively)

| Tool | Purpose |
|---|---|
| Claude Code | Orchestration, SVG generation, file writing, planning, documentation |
| ChatGPT (GPT-5 + image gen) | High-quality image generation when SVG is insufficient; refinement of AI-generated logos |
| Midjourney v7 | Alternative aesthetic exploration (more painterly, less control) |
| GitHub via `gh` CLI | Progress tracking via master issue + sub-issues per phase |
| Playwright | Visual regression tests during Phase 4 |
| Skills: `design:design-system` | Phase 3 audit and documentation |
| Skills: `design:design-handoff` | Phase 2 + Phase 4 dev specs |
| Skills: `design:design-critique` | Review of candidate logos before Phase 2 |
| Skills: `frontend-design:frontend-design` | Phase 4 production UI integration |
| Skills: `engineering:architecture` | ADRs for major brand decisions in Phase 5 |

## Working rules (hardcoded)

1. **One visual decision at a time.** Never queue 2+ open decisions.
2. **Visual + question simultaneously.** No abstract text-only questions when the topic is visual.
3. **Show side-by-side in `logo-explorations.html`** for every decision. User picks A/B/C/D from preview.
4. **After each confirmed choice:** update `DECISIONS_LOG.md` immediately. Never let an undocumented decision sit.
5. **Match `TONE_OF_VOICE.md`** in every visual decision — premium without flashy, founder-led warmth, fair-promise integrity.
6. **No regret-prone choices early.** When in doubt, defer the decision rather than lock it prematurely.
7. **Test at favicon-size** every wordmark/logo proposal. If unreadable at 32×32, reject.
8. **Light AND dark mode** for every visual mockup from Phase 3 onward.
9. **Never restart settled decisions.** If user wants to revisit, they must explicitly say so.
10. **Commit + push after each phase end.** Cross-PC continuity depends on it.

## Files map (canonical sources)

```
docs/brand/
├── PROJECT_PLAN.md          # This file — master plan, status, scope
├── BRAND_BRIEF.md           # DNA fundamentals — audience, personality, principles
├── MOODBOARD.md             # ~35 reference brands with takeaways
├── DECISIONS_LOG.md         # Single source of truth for what's been decided
├── HANDOFF_PROMPT.md        # First-session prompt for new AI contexts
├── logo-explorations.html   # Current visual state — always reflects active decision
└── (future) BRAND_GUIDELINES.md   # Phase 5 output

docs/TONE_OF_VOICE.md        # Voice guide (load-bearing)
frontend/public/brand/       # (future) Final asset output folder
frontend/tailwind.config.js  # (future) Refined color tokens
frontend/src/index.css       # (future) Refined CSS variables
```

## Cross-PC continuity protocol

Before switching PCs:
1. `git status` — confirm clean or commit
2. `git add docs/brand/ && git commit -m "wip(brand): phase 1 decision N progress"` if dirty
3. `git push origin main` — push to make state available on next PC
4. Verify OneDrive-context has synced memory + secrets

On the new PC:
1. `git pull origin main` first
2. Open `HANDOFF_PROMPT.md`, paste content as first message to AI
3. AI reads `PROJECT_PLAN.md` + `DECISIONS_LOG.md` + `logo-explorations.html`
4. Resume from current decision

## Success criteria

Project is done when:
- ✅ All Phase 1-5 exit criteria met
- ✅ `BRAND_GUIDELINES.md` complete and PDF-exported
- ✅ All `frontend/public/brand/` assets shipped
- ✅ Light + dark mode UI fully on-brand
- ✅ Discord server fully branded
- ✅ Social avatars deployed
- ✅ One Pull Request consolidates all changes for review
- ✅ Master GitHub issue closed with `claude:done` label

## Estimated effort

Realistic estimate, given iteration cycles:
- Phase 1: 2-4 sessions (~3-6 hours total interaction time)
- Phase 2: 1-2 sessions (~2-3 hours)
- Phase 3: 2-3 sessions (~3-5 hours)
- Phase 4: 1-2 sessions (~2-4 hours, includes testing)
- Phase 5: 1 session (~1-2 hours)

Total: **8-13 hours** of focused interaction, spread across as many sessions as needed. No hard deadline — quality > speed for "once and for all" work.
