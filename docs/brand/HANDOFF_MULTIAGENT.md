# #481 Brand — Multi-Agent Continuation Prompt

> Paste the block below verbatim as the first message of a fresh Claude Code session to continue the brand overhaul (#481) at world-class standard. Written 2026-06-04 after OG-refresh + on-light accent-fix landed. Source of truth stays `DECISIONS_LOG.md`; this file is a pointer.

---

## PROMPT (copy from here)

You are continuing the Cycling Zone brand identity overhaul, GitHub issue #481. This is "once-and-for-all" work — built to last 5+ years, shipped before the TdF launch (deadline 2026-06-20). The bar is **world-class**: execute the whole chain (decision → asset → wiring → contrast/visual verify → docs), never leave a half-finished feature or a task-list. Fix gaps you find rather than just flagging them. Verify before you claim done.

### 0. Read first, in this order (do not skip)
1. `docs/brand/DECISIONS_LOG.md` — **the single source of truth.** What is locked vs open. Append-only; never silently reopen a locked decision.
2. `docs/brand/PROJECT_PLAN.md` — reconciled phase model (foundation → color → assets → UI integration → docs).
3. `docs/brand/ASSETS.md` — what has been *produced* from the locked decisions and what remains.
4. `scripts/brand-contrast-check.mjs` (WCAG gate) + `scripts/brand-export.mjs` (SVG→PNG/ICO rasteriser) — the two tools you must use, not reinvent.

### 1. LOCKED — do not reopen (these are settled; treat as immutable)
- **Wordmark:** ALL-CAPS Bebas Neue, tight tracking, twin movement-lines (long thin + short accent dash). Outlined master in `frontend/public/brand/wordmark-*.svg`.
- **Favicon:** dual-form. F1a = stacked CYCLING/ZONE on gold square (≥48px). F1b = `CZ` Inter Tight Black (≤32px). Production `favicon.svg` + raster set (`favicon.ico`/apple-touch/manifest icons) shipped.
- **Fonts (BF1 hybrid, 3-role):** Bebas Neue = display/wordmark · DM Sans = prose/reading · Inter Tight = data (stat tables, rankings, prices/watts, dates/timers, dense chrome). Implement as a `font-data` token; DM Sans stays default body.
- **Color:** dark canvas `#0e0f15` · light canvas `#f4f2ec` "Chalk" (card `#fcfbf7`, elevated `#ffffff`) · accent gold `#e8c547` (bright `#ffd966` on dark). **Contrast rule:** bright gold fails as a *foreground* on any light canvas (1.3–1.6:1) — on Chalk, foreground accent = navy `#0e0f15` or deep-gold `#a07800`; bright gold is reserved for *fills* + the leader signal.
- **Brand rule "gold = the leader":** rank-1 team/rider gets a gold-bar + maillot-jaune treatment in every ranking/standings. The L'Auto heritage story is a feature-band on landing/about + the OG image.
- **Phase 4 micro-interactions (owner liked, queued):** (1) gold dot/bullet by each nav item (active = solid gold); (2) on hover, animate in the short accent-dash from the wordmark as the hover indicator.

### 2. OPEN work — three tracks
**Track 1 · Color sub-decisions (HUMAN-IN-LOOP, visual, sequential).** These need the owner's eye — agents prepare, owner picks. ONE variable per decision, rendered side-by-side in `docs/brand/logo-explorations.html`, every candidate run through `brand-contrast-check.mjs` first.
- P4 surface ladder (dark + light elevation steps)
- P5 semantic colors (success/error/warning/info on both canvases, WCAG AA, must not fight gold)
- Dark `text-3 #6b6d7e` AA fix (currently ~3.75:1, fails 4.5 normal-text)
- P3b race-night navy `#0a1024` as a light-mode foreground option (owner reserved it — present, don't assume)

**Track 2 · Remaining assets (HEADLESS, parallelizable — derive only from LOCKED marks).**
- Discord server icon (512×512, circular-safe) + banner (960×540) from `favicon-stacked.svg`
- Social avatars (X, LinkedIn, Bluesky, GitHub-org)
- Variant completeness check (full-color / inverse / pure-black / white / on-yellow — mono-black/white already exist)
- OG headline outlining: `og-cycling-zone.svg` brand marks are outlined, but the headline + eyebrow still use `<text font-family="DM Sans">`. Social scrapers rasterise without Google Fonts → prose renders in a fallback. Outline it (fonttools, same pipeline as the masters) if pixel-exact prose is wanted.

**Track 3 · Phase 4 UI integration (player-facing; depends on Track 1 colors landing first).**
- Self-host + wire the font-hybrid (`font-data` token on data components; Bebas for the sidebar wordmark)
- Wordmark into `Layout.jsx` sidebar; micro-interactions (gold dot + hover accent-dash) in the nav component
- "gold = leader" in every ranking/standings surface
- `bg-cz-*` token audit (no raw-color hardcodes left) + light/dark parity + apply the text-3 fix
- Playwright `core-smoke.spec.js` regression — run **all 3 projects** (desktop + mobile-chromium + mobile-webkit) and refresh snapshots if visuals change

### 3. Multi-agent execution (how to be efficient)
Tracks 1-prep, 2, and 3-scoping are independent → fan out in parallel, then converge for owner review.

- **Agent A (Track 1 prep):** build the open color candidates into `logo-explorations.html` as one-variable-at-a-time visual cards; run every pairing through `brand-contrast-check.mjs`; return a contrast report + which candidates pass. **Does not decide** — leaves a ready-to-review page.
- **Agent B (Track 2):** produce Discord/social assets from the locked stacked mark via `brand-export.mjs`; update `ASSETS.md`. Verify each output renders (no blank/fallback-font) before claiming done.
- **Agent C (Track 3 scope):** map every Phase 4 touch-point — grep `bg-cz-*`, font usages, ranking/standings components for "gold=leader", the nav component for micro-interactions. Return an implementation plan + handoff spec. **No code edits** — just the map.

Then: present Agent A's color page to the owner (one variable at a time, visual + question together), lock picks in `DECISIONS_LOG.md`, and only then execute Track 3 from Agent C's map. Adversarially verify anything player-facing (contrast, light+dark, mobile) before close-out.

### 4. Hardcoded working rules (violating these is a regression)
1. One visual decision at a time. Never queue 2+ open.
2. Visual + question **simultaneously** — never abstract text-only when the topic is visual. Render side-by-side cards first.
3. After each confirmed choice: update `DECISIONS_LOG.md` immediately (append-only).
4. Never promote a verbal preference to ✅ Confirmed without the owner seeing options side-by-side AND explicitly picking.
5. Match `docs/TONE_OF_VOICE.md` (founder-led, premium-restrained, fairness-promise load-bearing, no em-dash).
6. Test every mark at favicon size; light AND dark for every mockup.
7. Patch notes for any player-facing change; EN-first/DA-second copy.

### 5. Pre-flight + close-out
- **Pre-flight before any push:** `pwsh -File scripts/verify-local.ps1` (backend + frontend tests + build); for visual changes run all 3 Playwright projects.
- **Close-out:** update `DECISIONS_LOG.md` + `ASSETS.md` + `docs/NOW.md` (🎯 Next action + reset 🤖 Working agent), PatchNotes for player-facing changes, comment #481.

### Current state (as of 2026-06-04, this hand-off)
Phase 1 foundation complete + GO-revalidated. Raster favicon set live. OG-image refreshed with outlined marks + on-light wordmark accent fixed to deep-gold `#a07800` (committed in the same slice as this prompt). The highest-leverage next chunk is **Track 1 color decisions → Track 3 Phase 4 UI integration**, because that is what players actually see; Track 2 social/Discord assets are lower-risk and can run in parallel anytime.

## (end of prompt)
