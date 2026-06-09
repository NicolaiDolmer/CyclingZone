# Mini Brand Guidelines — Cycling Zone

> **Master issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) · TdF-subset [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)
> **Owner:** Nicolai Dolmer Mikkelsen (founder)
> **Established:** 2026-06-09
> **Status:** The "mini brand guidelines" deliverable from `BRAND_BRIEF.md` §8. Companion to `ASSETS.md` (what was produced) and `DECISIONS_LOG.md` (why). This doc is the rule-book for *using* the marks.

The marks are the locked, fully-outlined SVG masters in [`frontend/public/brand/`](../../frontend/public/brand/). They carry exact geometry + twin movement-lines and have **no live-font dependency** — render them as-is, never re-typeset.

---

## 1. The marks

| Mark | File | What it is |
|---|---|---|
| **Wordmark** | `wordmark-ondark.svg` / `wordmark-onlight.svg` / `wordmark-on-yellow.svg` / `wordmark-mono-black.svg` / `wordmark-mono-white.svg` | ALL-CAPS `CYCLING ZONE` + twin movement-lines. The primary identity (BRAND_BRIEF §7.4 — wordmark-first). |
| **Monogram** | `monogram-cz.svg` | `CZ` on a gold rounded square. Derived mark for small / square slots. |
| **Stacked mark** | `favicon-stacked.svg` | Stacked `CYCLING` / `ZONE` on a gold rounded square. App-icon / hero / social. |

In the app these are wrapped by [`frontend/src/components/Brand.jsx`](../../frontend/src/components/Brand.jsx) (`<Wordmark>`, `<Monogram>`, `<StackedMark>`) — use those, do not hand-roll a gold box with a letter in it.

## 2. Which variant on which canvas

The wordmark exists in five color variants so it always meets WCAG AA. Pick by background, never recolor the SVG:

| Canvas | Wordmark variant | Why |
|---|---|---|
| Dark navy `#0e0f15` / `#161824` | `wordmark-ondark.svg` (gold text + bright-gold lines) | — |
| Light "Chalk" `#f4f2ec` / white | `wordmark-onlight.svg` (navy text + deep-gold `#a07800` lines) | Bright gold `#e8c547` fails AA as foreground on light (1.3–1.6:1). |
| Brand-yellow fill `#e8c547` ("gold = leader") | `wordmark-on-yellow.svg` (navy text + navy lines) | — |
| Single-colour print / knockout | `wordmark-mono-black.svg` / `wordmark-mono-white.svg` | One-colour contexts. |

`<Wordmark>` auto-switches on-light ⇄ on-dark via the app theme; pass `forceDark` on the always-navy sidebar. The monogram and stacked mark are theme-independent (gold tile works on any canvas).

## 3. Clear space

Keep a margin clear of other elements around every mark, so it never feels crowded.

- **Wordmark:** clear space = **½ the cap-height** of the letters (≈ the height of the top movement-line gap) on all four sides. As a quick rule at render size: leave padding ≥ 50% of the wordmark's rendered height.
- **Monogram / stacked mark:** clear space = **¼ the tile width** on all sides. Never let UI chrome touch the gold tile edge.

## 4. Minimum size

| Mark | Digital min | Below that, use… |
|---|---|---|
| Wordmark (standalone) | **80px wide** (≈ 23px tall) | the **monogram** — the twin-lines + letterforms blur below this |
| Wordmark in a monogram lockup | **~50px wide** | the monogram carries small-size recognition, so the wordmark may sit smaller than its standalone floor (e.g. the sidebar lockup) |
| Monogram | **16px** | nothing smaller; it is the floor (favicon size) |
| Stacked mark | **48px** | the **monogram** (its locked `F1a ≥48px / F1b ≤32px` split) |

The monogram is the small-size fallback by design (locked 2026-05-20, F1a/F1b). The browser-tab favicon already uses it.

## 5. Do / Don't

**Do**
- Use the SVG masters / `Brand.jsx` components directly.
- Match the variant to the canvas (§2) so contrast stays AA.
- Scale proportionally (lock aspect ratio — wordmark is ~3.43:1).
- Give the mark its clear space (§3).

**Don't**
- ❌ Recolor, re-fill, or swap the gold/navy for another hue.
- ❌ Re-typeset the name in a live font as a substitute for the wordmark (the outlined geometry is the mark).
- ❌ Stretch, condense, skew, rotate, or add a drop-shadow/gradient/glow/3D bevel (BRAND_BRIEF §7.5 — no effects that date). *(A soft brand-gold ambient glow behind the tile on hero/login is an allowed canvas treatment, not an effect on the mark itself.)*
- ❌ Put the bright-gold wordmark on a light canvas (use `wordmark-onlight.svg`).
- ❌ Place the mark on a busy photo without a solid tile/scrim behind it.
- ❌ Make the monogram the primary mark in marketing — it is derived; the wordmark leads (BRAND_BRIEF §7.4).

## 6. Where the marks live in the product (wired 2026-06-09, #481)

| Surface | Mark |
|---|---|
| Sidebar lockup (desktop + mobile topbar) | Monogram + `forceDark` wordmark |
| Login hero | Stacked mark |
| Landing / Founder page top-bar | Monogram + theme-aware wordmark |
| Browser tab favicon | Monogram (`favicon.svg` = `monogram-cz.svg`) |
| App icon / PWA / Discord / social / OG | Stacked mark + rasters (`icon-192/512`, `apple-touch-icon`, `discord-*`, `avatar-*`) |

## 7. Validation

Before approving any new placement, run the BRAND_BRIEF §10 tests (size, silhouette, peer, recall, loyalty). For contrast specifically, every locked pairing is verified AA by [`scripts/brand-contrast-check.mjs`](../../scripts/brand-contrast-check.mjs).
