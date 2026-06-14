# Brand-asset-audit — produceret asset-sæt mod anti-slop-standarden

> **Issue:** [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) (brand identity) · subset [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) (UI/UX-fundament)
> **Dato:** 2026-06-14 · **Auditør:** Claude Code (design-critique-framework, tilpasset)
> **Scope:** Alle produktions-brand-assets i `frontend/public/` + `frontend/public/brand/` (favicon, monogram, 5 wordmark-varianter, stacked mark, Discord-icon/banner, social avatars, app-ikoner, OG-billede).
> **Auditeret MOD:** anti-slop-standarden (eget feel, 0 AI-slop, ingen glow/gradient-blobs/effekter-der-daterer), `BRAND_BRIEF.md` §7 (logo-principper), `GUIDELINES.md` (brug-regler), den låste palette + det netop merged'e #671-token-fundament (PR #1388).

---

## Verdict

**Asset-sættet er disciplineret og overvejende slop-frit.** Alle marks er fuldt outlined (ingen live-font-afhængighed), bærer ingen effekter (ingen drop-shadow/glow/gradient/3D-bevel **på selve marken**), holder sig til den låste palette, og dækker hele variant-matricen WCAG-sikkert. Dual-form favicon-systemet (stacked ≥48px / `CZ`-monogram ≤32px) løser 16px-læsbarheden korrekt.

**Én ægte slop-rest:** banner + OG-billede bruger to diagonale gradient-glow-blobs i baggrunden — det generiske "ambient SaaS-hero"-mønster. Subtilt (0.16 opacity), men det er den eneste rest af generisk æstetik i et ellers stramt sæt. Resten af findings er trivielle konsistens-punkter.

**Launch-relevans:** favicon, wordmark og OG er det første kold TdF-trafik (20/6) og landing #672 (deadline 16/6) møder. Marks selv er ship-bare. **Men auditen afdækkede ét reelt launch-problem — F5: OG-billedet serveres som SVG, og sociale scrapers understøtter typisk ikke SVG → link-previews er sandsynligvis brudte ved deling.** Det er separat fra blob-fixet og bør tages som egen opgave før 20/6.

## Udført 2026-06-14 (ejer-godkendt)

- **F1 + F4 FIXED.** De to glow-blobs fjernet i `discord-banner.svg` + `og-cycling-zone.svg` (inkl. ubrugt `radialGradient#glow`-def); banner+OG canvas-gradient normaliseret til `#161824`. `discord-banner.png` regenereret (960×540, sharp). OG'en er SVG → SVG-edit'en er selve fixet (ingen raster at regenerere). Verificeret visuelt (rent, fladt navy) + XML-velformet + 0 `url(#glow)`-rester.
- **F2/F3 udskudt** (post-launch polish, ingen synlig effekt).
- **F5 åben** — kræver egen beslutning/opgave (OG-raster-pipeline + wiring).

---

## Hvad er stærkt (ingen slop)

- **Fuldt outlined marks.** 0 `<text>`/`font-family` i nogen mark-SVG → renderer pixel-identisk hos social-scrapers, browser-chrome og offline (hvor Google Fonts ikke loader). Eneste `<text>` i hele sættet er `✓`-glyphen (U+2713) i OG'en — dokumenteret umulig at outline fra DM Sans, bevidst efterladt.
- **Ingen effekter på marks.** Ingen gradient/glow/filter/shadow/bevel på logo-geometrien. Matcher `BRAND_BRIEF` §7.5 ("no effects that date") + `GUIDELINES` §5 don't.
- **Farve-disciplin.** Marks bruger kun låst palette: navy `#0e0f15`, gold `#e8c547`, bright-gold lines `#ffd966`, deep-gold on-light `#a07800`, white `#ffffff`. Light-varianten er korrekt WCAG-sikker (navy tekst + deep-gold linjer — bright gold ville fejle AA som forgrund på light).
- **Komplet variant-matrix.** on-dark / on-light / on-yellow / mono-black / mono-white / dark-bg → dækker alle 5 `BRAND_BRIEF` §5-kombinationer.
- **Korrekt wiring.** `favicon.svg` er bit-identisk med `monogram-cz.svg` (browser-tab = small-form). Avatars er full-bleed gold (ingen transparente hjørner → cirkulær crop afslører aldrig et hul).
- **OG-billedet er stærkt redaktionelt.** Klar fairness-promise ("Premium will never buy stronger riders…"), ægte tone, on-brand typografi-hierarki. Ingen "free forever"-formulering.

---

## Findings

| # | Severity | Finding | Anbefaling |
|---|---|---|---|
| **F1** | 🟡 Moderat | Dobbelt gradient-glow-blobs i `discord-banner.svg` + `og-cycling-zone.svg` (to diagonale `<circle fill="url(#glow)">`, gold opacity 0.16→0, top-højre + bund-venstre). Generisk SaaS-hero-baggrundsmønster = præcis det anti-slop-standarden kalder "gradient-blobs". | Fjern de to glow-cirkler i begge filer (behold bg linear-gradient eller fladt navy). Regenerér de afledte rastere. **Smag → ejer bekræfter** (før/efter vist). |
| **F2** | 🟢 Minor | Tile-corner-radius inkonsistent: `monogram-cz` rx=5/32 = **15.6%** vs `favicon-stacked` rx=7/64 = **10.9%**. Monogram læser proportionelt rundere end stacked når de ses sammen. | Vælg ét ratio (fx ~12.5%: monogram rx=4, stacked rx=8). Lav-prioritet polish. |
| **F3** | 🟢 Minor | Udokumenteret grå `#8b8d93` i OG-prose (3×). Ligger mellem dark text-2 `#9da0b3` og text-3 `#888ba0` — matcher intet token. | Align mod text-2/text-3-token for systemkonsistens. Trivielt, kun OG. |
| **F4** | 🟢 Minor | Banner-canvas-gradient slutter på `#171a26` (udokumenteret; tæt på dark card `#161824`). | Normalisér til `#161824` eller behold bevidst. Trivielt; fold ind i F1-regenerering hvis F1 godkendes. |
| **F5** | 🔴 Kritisk (launch) | **OG-billedet serveres som SVG** (`og:image` → `og-cycling-zone.svg`, `og:image:type image/svg+xml`); ingen raster findes. De fleste sociale scrapers (Facebook, LinkedIn, X/Twitter) **understøtter ikke SVG som `og:image`** og kræver PNG/JPG → link-previews er sandsynligvis tomme/brudte ved deling. Ingen evidens fra live scrape-test, men SVG-`og:image`-uunderstøttelse er bredt dokumenteret. Rammer kold TdF-trafik der deler links. | Eksportér en `og-cycling-zone.png` (1200×630) fra den rettede SVG og peg `og:image` + `twitter:image` på PNG'en (behold SVG som progressive fallback). **Separat fra blob-scope — egen opgave/issue.** |

### Noter (ikke findings)

- **OG `✓`-glyph** er stadig `<text>` (system-fallback). Dokumenteret i `ASSETS.md`. Hvis pixel-perfektion ønskes hos alle scrapers, kan ✓ erstattes af en lille custom outlined `<path>` (2 linjer). Valgfrit, lav-prioritet.
- **`#f4f2ec` (Chalk) i OG** = den lyse display-tekst på dark canvas. Smart genbrug af canvas-token som tekstfarve — ikke en afvigelse.

---

## Token-alignment med #671 (Plan 1 merged)

- **Radius:** brand-tiles kører deres eget radius-system (rx 5–7px på små grids), separat fra UI-tokenet `--radius-sm: 5px`. Korrekt at holde adskilt — en brand-mark-tile er ikke en UI-card. Ingen konflikt; F2 handler om intern tile-konsistens, ikke om at matche UI-radius.
- **Farve:** brand-paletten (`#e8c547`/`#0e0f15`/…) er identisk med `cz-*`-tokens. Konsistent på tværs af brand + UI-fundament.
- **Anti-slop:** mark-geometrien overholder #671-fundamentets ånd (skarpt, hairline, ingen glow). Den eneste afvigelse er F1's baggrunds-blobs, som lever på canvas — ikke i en UI-komponent.

---

## Anbefalede handlinger (prioriteret)

1. **F1 — fjern glow-blobs** (kræver ejer-OK; før/efter vist). Den eneste ændring med synlig effekt. Regenerér `discord-banner.png` + OG-raster efter. Hvis godkendt, fold F4 ind samtidig.
2. **F2 — ensret tile-radius** (én linje pr. mark + raster-regenerering). Lav-prioritet; kan vente til post-launch.
3. **F3 — token-align OG-grå** (triviel, kun hvis OG alligevel regenereres under F1).

**Konklusion:** Auditen fandt ingen launch-blocker. Assets er ship-bare. F1 er et anbefalet smags-løft der bringer banner + OG fra "fint, men med en generisk hero-rest" til "fuldt på den redaktionelle anti-slop-linje".
