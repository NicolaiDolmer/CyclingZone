# Brand assets — production manifest

> **Master issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) (Phase 2 · Asset Production) · TdF-subset [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)
> **Source of truth for decisions:** [`DECISIONS_LOG.md`](DECISIONS_LOG.md). This file documents what has been *produced* from those locked decisions.

## Shipped assets (`frontend/public/brand/`)

All text is **outlined to SVG `<path>`** — no web-font dependency, so the marks render identically in browser chrome, social scrapers, and offline contexts (where Google Fonts do not load).

| File | Form | Spec source | Use |
|---|---|---|---|
| `wordmark-ondark.svg` | Wordmark | C3 | Yellow `#e8c547` text + `#ffd966` twin lines. Place on dark canvas `#0e0f15`. |
| `wordmark-onlight.svg` | Wordmark | C3 | Navy `#0e0f15` text + `#a07800` deep-gold accent lines (WCAG-safe on the Chalk canvas; bright gold fails as foreground on light). Place on light canvas. |
| `wordmark-dark-bg.svg` | Wordmark | C3 + P1 | Same as on-dark but with the navy canvas baked in (standalone use). |
| `wordmark-mono-black.svg` | Wordmark | C3 | All `#0e0f15` (single-colour print / dark-on-light). |
| `wordmark-mono-white.svg` | Wordmark | C3 | All `#ffffff` (knockout / white-on-dark). |
| `favicon-stacked.svg` | F1a (≥48px) | F1a (locked 2026-05-20) | Stacked `CYCLING`/`ZONE` on yellow rounded square. Discord icon, social avatar, app icon, OG mark. |
| `monogram-cz.svg` | F1b (≤32px) | F1b (locked 2026-05-20) | `CZ` in Inter Tight Black on yellow rounded square. Browser tab / OS chrome. |
| `wordmark-on-yellow.svg` | Wordmark (inverse) | C3 | Navy `#0e0f15` text + navy twin lines on the brand-yellow `#e8c547` canvas. Completes the variant matrix (full-color / inverse / pure-black / white). Use when the wordmark sits on a gold/leader fill. |
| `discord-icon.svg` → `discord-icon-512.png` | F1a, square 512 | F1a | Discord server icon / circular-safe avatar master. Full-bleed gold field, stacked `CYCLING`/`ZONE` centered in the inner safe circle. |
| `discord-banner.svg` → `discord-banner.png` | F1a + C3 + P1 | F1a/C3/P1 | Discord profile banner **960×540**. Navy gradient canvas, stacked-mark corner lockup, centered Bebas wordmark + twin lines. Fully outlined (no live fonts). |
| `avatar-460.png` / `avatar-400.png` | F1a, square | F1a | Social avatars rasterized from `discord-icon.svg`. 460 = GitHub-org; 400 = X / LinkedIn / Bluesky. One master, four platforms. |

**Raster outputs are derived, not hand-made:** `discord-icon-512.png`, `avatar-460.png`, `avatar-400.png` and `discord-banner.png` are rasterized from the outlined SVG masters above via `sharp` (same engine as `scripts/brand-export.mjs`). Square avatars are full-bleed gold (no transparent corners) so a circular crop never reveals a gap; the stacked text stays inside the inner ~80% safe circle.

**Production wiring:** [`frontend/public/favicon.svg`](../../frontend/public/favicon.svg) is a copy of `monogram-cz.svg` (referenced by `index.html` as the site `rel="icon"`). It replaced an Arial-Black placeholder that used the wrong navy (`#0a0a0f`).

## Locked palette

| Token | Hex | Role |
|---|---|---|
| Navy | `#0e0f15` | Foreground / dark canvas (P1 locked) |
| Yellow | `#e8c547` | Accent / mark background |
| Accent-bright | `#ffd966` | Wordmark twin lines on dark |

Light-mode canvas (P2) **locked 2026-06-04 = E "Chalk" `#f4f2ec`** (surface ladder: card `#fcfbf7`, elevated `#ffffff`). The on-light wordmark uses navy `#0e0f15` text + deep-gold `#a07800` accent lines — bright gold `#e8c547` fails WCAG AA as a foreground on any light canvas (1.3–1.6:1), so on Chalk the lines/foreground accent are navy or deep-gold; bright gold is reserved for fills + the "gold = leader" signal.

## Fonts

- **Bebas Neue** (Regular) — display wordmark + F1a stacked mark + the live site's sidebar wordmark. OFL.
- **Inter Tight** (variable wght 100–900) — F1b `CZ` monogram + the live site's data/UI font (`font-mono`/`font-data`). OFL.
- **DM Sans** — body/prose font (unchanged; still loaded via Google Fonts CDN).

**Self-hosted on the live site since Phase 4 PR-1 (2026-06-04).** `frontend/public/fonts/` holds woff2 for both families (latin + latin-ext subsets):
`bebas-neue-latin-400-normal.woff2`, `bebas-neue-latin-ext-400-normal.woff2`, `inter-tight-latin-wght-normal.woff2`, `inter-tight-latin-ext-wght-normal.woff2`. They are wired in `frontend/src/index.css` via `@font-face` (`font-display: swap`, `unicode-range` subset-splitting, metric-matched `local('Arial')` fallback for the data font). NOT added to the render-blocking Google Fonts `<link>` (avoids #479's CLS regression). The data-font latin subset is `<link rel=preload>`-ed in `index.html`. woff2 fetched from the `@fontsource` / `@fontsource-variable` mirrors of the `google/fonts` OFL repo. For the outlined asset masters the same families were fetched and outlined (no live-font dependency in SVG).

## Reproducing / regenerating

The masters are generated deterministically with `fonttools` (text → outlined paths, exact locked geometry):

```bash
pip install fonttools brotli
# fetch OFL TTFs from github.com/google/fonts (ofl/bebasneue, ofl/intertight)
# instance Inter Tight to wght=900, extract glyph paths via SVGPathPen,
# place at the locked font-size / baseline / letter-spacing per logo-explorations.html
```

The generator script (`gen_brand.py`) is kept out of the repo (throwaway tooling); the geometry it encodes is the locked spec in `DECISIONS_LOG.md` + the hero/favicon SVGs in `logo-explorations.html`. Re-run only if a locked decision changes.

## Brand-asset-audit 2026-06-14 (#481)

Full audit of the produced set against the anti-slop standard + the locked #671 token foundation: [`docs/audits/2026-06-14-brand-asset-audit.md`](../audits/2026-06-14-brand-asset-audit.md). Verdict: disciplined, slop-free marks. Owner-approved fix applied: the two decorative gradient-glow **blobs were removed** from `discord-banner.svg` + `og-cycling-zone.svg` (generic SaaS-hero pattern, off the editorial line); canvas-gradient normalized to `#161824`; `discord-banner.png` regenerated. **F5 FIXED (2026-06-14):** the OG image was served as SVG (`og:image:type image/svg+xml`) with no raster — most social scrapers (Facebook, LinkedIn, X/Twitter) don't render SVG `og:image`, so link previews were likely broken. A `frontend/public/og-cycling-zone.png` (1200×630, flat opaque) is now rasterized from the cleaned outlined master via `npm run brand:export:og`, and `og:image` + `twitter:image` point at it (`og:image:type image/png`). The SVG is no longer referenced as an og:image (a single unambiguous raster avoids scrapers picking the unsupported form).

## Follow-ups (not in this slice)

- **PNG / `.ico` raster set** — DONE 2026-06-04 via `scripts/brand-export.mjs` (sharp + png-to-ico, reconciled onto main in #1036). Shipped: `frontend/public/favicon.ico` (CZ monogram 16/32/48), `apple-touch-icon.png` (stacked 180), `brand/icon-192.png` + `brand/icon-512.png` (stacked, for PWA manifest / Discord / social). Wired into `index.html` (`alternate icon` + `apple-touch-icon`).
- **OG-image refresh** — DONE 2026-06-04. `frontend/public/og-cycling-zone.svg` embeds the outlined F1a stacked mark + the outlined Bebas wordmark (with twin lines). **Headline + eyebrow + promise prose now also fully outlined (2026-06-04, Agent B):** the `<text font-family="DM Sans">` nodes for "FAIR CYCLING MANAGER MMO", "Build your team. / Race the world.", and the two promise lines were converted to vector `<path>` via fonttools (DM Sans variable instanced to wght 700/900/600/400, opsz 14). The OG is now font-independent prose-and-all — scrapers render pixel-exact DM Sans regardless of font availability. **Only remaining `<text>` = the `✓` (U+2713), which is NOT a DM Sans glyph (it was always a system-fallback glyph); outlining it from DM Sans is impossible, so it is intentionally left as `<text>`.** Reproduce: `pip install fonttools brotli`, fetch `ofl/dmsans/DMSans[opsz,wght].ttf` from github.com/google/fonts, instance per-weight with `fontTools.varLib.instancer`, lay out each string glyph-by-glyph (advance + letter-spacing) with `SVGPathPen`, emit `<g fill=…><path transform="translate(x baseline) scale(s -s)" …/></g>` at the original node's x/y/size. **OG raster (#481-F5, 2026-06-14):** the SVG master is rasterized to `frontend/public/og-cycling-zone.png` (1200×630, flat opaque, no alpha) via `npm run brand:export:og` (sharp, `density: 200` supersample → downscale, `.flatten('#0e0f15')`). The PNG — not the SVG — is the served `og:image`/`twitter:image`, because social scrapers don't render SVG og:image. Re-run `brand:export:og` whenever the OG SVG changes.
- **Discord server icon + banner, social avatars** — DONE 2026-06-04 (Agent B). Outlined SVG masters `discord-icon.svg` (512² square, full-bleed gold) + `discord-banner.svg` (960×540) added, plus rasters `discord-icon-512.png`, `discord-banner.png`, `avatar-460.png` (GitHub-org), `avatar-400.png` (X / LinkedIn / Bluesky). All derived from `favicon-stacked.svg` geometry + `wordmark-ondark.svg`; rasterized with sharp. Every PNG verified non-blank via sharp metadata + pixel-colour distribution (gold-field vs navy-text ratio) + visual render.
- **Site-font integration (Phase 4)** — DONE 2026-06-04 (PR-1). The running UI now self-hosts Bebas Neue (sidebar wordmark) + Inter Tight (`font-mono`→data font, ~366 sites inherited with zero churn). DM Sans stays the body/prose font (the locked 3-role hybrid). Tokens migrated to the locked Phase 2 palette in the same PR (see below). Worst-case font-swap CLS measured at **0.021** (fonts force-delayed 1.5s in Playwright; preload makes prod lower) — well under the 0.1 "good" bar and below #479's 0.092.
- **Token migration to the locked palette (Phase 4 PR-1)** — DONE 2026-06-04. `frontend/src/index.css` + `tailwind.config.js` migrated off the old cream `#f0ede6` to the locked Phase 2 palette: Chalk canvas `#f4f2ec` (card `#fcfbf7`, new `--bg-elevated`/`cz-elevated` `#ffffff`), dark surfaces card `#161824`/elevated `#1f2233`, D-SEM Set 2 semantic colours (light + dark), dark `--text-3` `#888ba0` (AA fix), and light foreground navy `#0e0f15` (D-P3B). Verified by `scripts/brand-contrast-check.mjs` (every locked pairing AA+) and all-3 Playwright projects refreshed.
- **Sidebar micro-interactions (Phase 4 PR-2)** — DONE 2026-06-04. `NavItem` in `frontend/src/components/Layout.jsx` now renders (1) a gold bullet per nav item (active = solid `bg-cz-accent`, inactive = muted `bg-cz-sidebar-3` → lights up on hover) and (2) a hover accent-dash echoing the wordmark's short thick movement-line (gold, 20×2px, rounded, `origin-left scale-x` grow on `group-hover`, inactive only, `aria-hidden` + `motion-reduce:transition-none`). Reuses existing PR-1 tokens (`cz-accent`, sidebar tokens). Sidebar is always navy (option A) so the gold is theme-identical; verified via unmasked Playwright-mock screenshots in light + dark + mobile. 8 desktop core-smoke baselines force-refreshed; mobile snapshots unchanged (sidebar `hidden` on mobile). PatchNotes 4.76.
