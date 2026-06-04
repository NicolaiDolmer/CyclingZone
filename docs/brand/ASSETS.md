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

**Production wiring:** [`frontend/public/favicon.svg`](../../frontend/public/favicon.svg) is a copy of `monogram-cz.svg` (referenced by `index.html` as the site `rel="icon"`). It replaced an Arial-Black placeholder that used the wrong navy (`#0a0a0f`).

## Locked palette

| Token | Hex | Role |
|---|---|---|
| Navy | `#0e0f15` | Foreground / dark canvas (P1 locked) |
| Yellow | `#e8c547` | Accent / mark background |
| Accent-bright | `#ffd966` | Wordmark twin lines on dark |

Light-mode canvas (P2) **locked 2026-06-04 = E "Chalk" `#f4f2ec`** (surface ladder: card `#fcfbf7`, elevated `#ffffff`). The on-light wordmark uses navy `#0e0f15` text + deep-gold `#a07800` accent lines — bright gold `#e8c547` fails WCAG AA as a foreground on any light canvas (1.3–1.6:1), so on Chalk the lines/foreground accent are navy or deep-gold; bright gold is reserved for fills + the "gold = leader" signal.

## Fonts

- **Bebas Neue** (Regular) — display wordmark + F1a stacked mark. OFL.
- **Inter Tight** (Black, wght 900) — F1b `CZ` monogram + future UI. OFL.

No font files are committed (the live site loads them via Google Fonts CDN). For asset generation they were fetched from the `google/fonts` OFL repo and outlined.

## Reproducing / regenerating

The masters are generated deterministically with `fonttools` (text → outlined paths, exact locked geometry):

```bash
pip install fonttools brotli
# fetch OFL TTFs from github.com/google/fonts (ofl/bebasneue, ofl/intertight)
# instance Inter Tight to wght=900, extract glyph paths via SVGPathPen,
# place at the locked font-size / baseline / letter-spacing per logo-explorations.html
```

The generator script (`gen_brand.py`) is kept out of the repo (throwaway tooling); the geometry it encodes is the locked spec in `DECISIONS_LOG.md` + the hero/favicon SVGs in `logo-explorations.html`. Re-run only if a locked decision changes.

## Follow-ups (not in this slice)

- **PNG / `.ico` raster set** — DONE 2026-06-04 via `scripts/brand-export.mjs` (sharp + png-to-ico, reconciled onto main in #1036). Shipped: `frontend/public/favicon.ico` (CZ monogram 16/32/48), `apple-touch-icon.png` (stacked 180), `brand/icon-192.png` + `brand/icon-512.png` (stacked, for PWA manifest / Discord / social). Wired into `index.html` (`alternate icon` + `apple-touch-icon`).
- **OG-image refresh** — DONE 2026-06-04. `frontend/public/og-cycling-zone.svg` now embeds the outlined F1a stacked mark + the outlined Bebas wordmark (with twin lines) instead of the old `<text font-family="DM Sans">` "C". Headline uses Chalk `#f4f2ec` on the navy canvas; fairness-promise copy kept. Headline/eyebrow body copy still uses `<text font-family="DM Sans">` — acceptable since scrapers fall back to a near-identical geometric sans for prose, and the load-bearing brand marks (wordmark + stacked) are outlined. If pixel-exact prose is wanted later, outline the headline too.
- **Discord server icon + banner, social avatars** — derive from `favicon-stacked.svg`; mostly export/cropping once a rasteriser is available.
- **Site-font integration (Phase 4)** — the app currently loads **DM Sans**, not the locked Bebas Neue + Inter Tight sibling system. Applying the brand fonts to the running UI is Phase 4 (UI Integration), with Playwright snapshot regression — separate from this asset slice.
