# UI/UX-fundament - design system (regelbog + primitiv-lag + udrulning)

> **Etableret:** 2026-06-14 (brainstorm-session m. visual companion)
> **Ejer:** Nicolai Dolmer Mikkelsen
> **Status:** Visuel retning låst (typografi, overflade, primitiver, focus-ring, ikoner, badges). Klar til implementerings-plan.
> **Issues:** #671 (brand-minimum, umbrella), #481 (brand identity overhaul), gater #672 (landing) + app-sweep.
> **Relateret:** [`2026-06-14-landing-page-brand-direction-design.md`](2026-06-14-landing-page-brand-direction-design.md), [BRAND_BRIEF.md](../../brand/BRAND_BRIEF.md), [TONE_OF_VOICE.md](../../TONE_OF_VOICE.md).

## Formål + problemet

UI'et er drevet mod et generisk look fordi der **ikke findes genbrugelige UI-primitiver** - alt er inline-kopieret 20-150x. Resultatet: inkonsistens, "AI-slop"-tells (rounded-2xl, glow, emoji-ikoner), ingen global focus-ring, ustandardiserede empty/loading/error-states. Dette fundament lægges én gang, rulles live over hele sitet, og forhindrer fremtidig drift med en indbygget guard.

**Hele programmet skal være live før launch (20/6), gjort ordentligt - ingen quick fixes, ingen faser udskudt** (ejer-beslutning 14/6).

### Program (én rød tråd)

| Fase | Hvad | Leverance |
|---|---|---|
| **0 - Regelbog** | Lås + dokumentér alle tokens/skalaer/politikker | CSS-vars + tailwind-tokens + dette dokument |
| **1 - Primitiv-lag** | Byg genbrugelige primitiver der forbruger tokens | `frontend/src/components/ui/` + kitchen-sink |
| **2 - Udrulning** | Migrér hver flade til primitiverne, live | Side-for-side PR'er + anti-drift-guard |

## Hvad er ALLEREDE live (genbruges, laves ikke om)

- **Farve- & surface-tokens:** fuldt sæt CSS-vars i [`index.css`](../../../frontend/src/index.css), begge temaer (light "Chalk" + dark navy), AA-tunet. Surfaces (body/card/elevated/subtle), 3 tekst-niveauer, accent + accent-t + on-accent, semantiske states (success/danger/warning/info med base + bg), sidebar-tokens (altid mørk).
- **Tailwind-mapping:** `cz-*`-utilities → CSS-vars i [`tailwind.config.js`](../../../frontend/tailwind.config.js). **Bevares uændret** (backward-compat for ~366 eksisterende callsites).
- **Fonte:** DM Sans (Google Fonts), Bebas Neue + Inter Tight (self-hosted, CLS-frit metric-matched fallback). `font-display`, `font-data`, `font-mono`→Inter Tight.
- **Tone of voice + brand-DNA:** dokumenteret (se referencer). Ikke en del af dette spec ud over at copy-reglerne respekteres.

Det nye i Fase 0 er derfor: **type-skala, spacing, radius, elevation-politik, global focus-ring, motion, z-index, ikon-spec, anti-slop do/don't** - de dele der ikke var defineret ét sted.

---

## DEL A - REGELBOGEN (Fase 0)

### A1. Typografi (låst)

| Token | Font | Størrelse | Vægt / spacing | Brug |
|---|---|---|---|---|
| `display-hero` | Bebas Neue | 54px / lh .96 | ls .012em | Landing-hero |
| `display-lg` | Bebas Neue | 40px / lh 1.0 | ls .01em | Store marketing-sektioner |
| `section` | Bebas Neue | 24px / lh 1.0 | ls .02em **+ guld-keyline** | Sektions-overskrifter (in-app + landing) |
| `h2` | DM Sans | 21px | 600 / ls -.01em | Under-overskrifter |
| `h3` | DM Sans | 17px | 600 | Mindre overskrifter |
| `body-lg` | DM Sans | 18px / lh 1.6 | 400 | Lede / intro |
| `body` | DM Sans | 16px / lh 1.6 | 400 | Brødtekst |
| `body-sm` | DM Sans | 14px / lh 1.5 | 400 | Sekundær / helper |
| `label` | Inter Tight | 12px | 600 / ls .14em / UPPERCASE | Kolonne-/sektions-labels |
| `data-xl` | Inter Tight | 28px | 600 / tabular | KPI-tal |
| `data` | Inter Tight | 15px | 500 / tabular | Tal i tabeller |
| `data-sm` | Inter Tight | 13px | 500 / tabular | Tætte tal |

**Guld-keyline på `section`:** `border-top: 2px solid <gold>; padding-top: 12px; display: inline-block`. Det editoriale fingeraftryk på sektions-titler.

**Retning:** editorial-restrained. Bebas til hero + sektioner (signaturen), DM Sans bærer al sub-struktur, Inter Tight tabular til alle tal. Ikke bold-display overalt.

### A2. Spacing (4px-base)

`2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80` (px). Brug skalaen; ingen vilkårlige værdier. Editorial = generøs luft; default sektion-padding ≥ 32-48px.

### A3. Radius (låst)

| Token | Værdi | Brug |
|---|---|---|
| `--radius-none` | 0 | Tabel-celler, full-bleed kanter |
| `--radius-sm` | **5px** | Arbejdshesten: knapper, inputs, kort, paneler, data-tags, modaler |
| `--radius-pill` | 999px | KUN hero-chip + status-prik |

Ingen `rounded-xl/2xl`. 5px = skarp nok til at undgå generisk look, ikke hård.

### A4. Elevation-politik (låst)

- **Hairline-border = standard** for kort/paneler i siden. Fladt, ingen skygge.
- **Soft lift** (`--shadow-overlay`, diskret, ingen blur-glow) = **kun** overlays: modaler, dropdowns, popovers, toasts.
- **Glow = aldrig.** Ingen `shadow-[0_0_40px...]`, ingen accent-glow.

`--shadow-overlay` (dark): `0 12px 30px -8px rgba(0,0,0,.6)`; (light): `0 12px 28px -10px rgba(14,15,21,.18)`.

### A5. Focus-ring (global, låst)

```css
:where(a, button, input, select, textarea, [tabindex="0"], [role="button"]):focus-visible {
  outline: 2px solid rgb(var(--accent-t));  /* tema-bevidst: dyb guld light / lys guld dark */
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
```

- **`:focus-visible`** (kun tastatur, aldrig museklik).
- **2px / 1px offset** - delikat men findbar + i WCAG 2.2-benchmark. Offset-gabet viser den rigtige baggrund → fungerer på alle flader inkl. guld-knap.
- **`outline` (ikke box-shadow)** - overlever Windows høj-kontrast-mode.
- Generaliserer den eksisterende board-only regel ([`index.css:224`](../../../frontend/src/index.css)) til hele sitet.

### A6. Motion

| Token | Værdi | Brug |
|---|---|---|
| `--dur-fast` | 120ms | Hover, små state-skift |
| `--dur` | 150ms | Default transitions |
| `--dur-slow` | 240ms | Større reveals |
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | Gentle ease-out |

**`prefers-reduced-motion: reduce`** → deaktivér ikke-essentiel animation (skeleton-shimmer, puls, transforms). Hard krav.

### A7. Z-index-skala

`--z-base 0 · --z-dropdown 1000 · --z-sticky 1100 · --z-overlay 1200 · --z-modal 1300 · --z-toast 1400`.

### A8. Ikonografi (custom, låst-retning)

**Eget ikon-sæt - ikke Lucide** (ejer-valg: distinkt, ikke "hver-anden-side-bruger-Lucide").

**Hus-spec:** 24×24 viewBox · `stroke-width: 2` · `stroke-linecap/linejoin: round` · `fill: none` · `stroke: currentColor` · geometrisk minimal linje. Render-størrelser 16 / 20 / 24px.

- Leveres som individuelle tree-shakeable React-komponenter i `ui/icons/`.
- **Erstatter ALLE emoji-ikoner** i appen.
- Sæt dækker generelle (search, settings, bell, chevron, plus, close, check, alert, info, filter, sort, calendar, team, user) + **cykel-specifikke** (trophy, auction/tag, jersey, mountain/KOM, sprint, time-trial). Anslået 30-50 ikoner - reelt arbejde, byg til spec så de er konsistente.

### A9. Anti-AI-slop do/don't (gælder hele sitet)

**Undgå:** `rounded-xl/2xl`, guld-glows, gradient-blobs + grid-overlay-baggrunde, `backdrop-blur` på alt, **emoji som ikoner**, centreret-alt hero, ens kort-grids, samme `accent/30`-tint overalt, farve-piller som default badge.

**Foretræk:** editorial hairline-layouts, stor kondenseret Bebas, ægte cykel-data (resultat-lister, tidsgab, trøjefarver), masser af luft, 2-farvet (guld `#e8c547` + navy `#0e0f15`), INGEN glow/gradient.

**Guld-disciplin:** guld er KUN til primær handling, leder/vinder, og nøgle-accenter. Aldrig på rutine-badges (det udvander betydningen).

---

## DEL B - PRIMITIV-LAGET (Fase 1)

### B1. Arkitektur

- **Placering:** ny mappe `frontend/src/components/ui/` - én fokuseret fil pr. primitiv + barrel-export `ui/index.js`. Ikoner i `ui/icons/`.
- **Tokens:** udvid `index.css` (nye CSS-vars: radius, motion, z-index, shadow-overlay, focus håndteres via eksisterende `--accent-t`) + `tailwind.config.js` theme (radius, transitionDuration, zIndex). **Eksisterende `cz-*` røres ikke.**
- **Naming:** PascalCase-komponenter; props `variant` / `size` / `state`; forward `className` + rest-props; `as`-prop hvor relevant.
- **Kitchen-sink:** dev-rute `/ui` der rendrer hver primitiv i alle states. Gated (ikke-prod eller admin). Fungerer som levende dokumentation + visuel regressions-target.

### B2. Primitiv-inventar

| Primitiv | Varianter / states |
|---|---|
| **Button** | primary (guld-fyld) · secondary (**neutral outline**) · ghost · danger (outline). Sizes sm/md/lg. States: hover/active/disabled/loading. Ikon-left/right, full-width. |
| **Field-sæt** | Input · Select (chevron) · Textarea · Checkbox · Radio · Toggle. Med Label + Helper + **error-state** (danger border + besked). |
| **StatusBadge** | Broadcast: farvet prik + versal Inter Tight-label, borderless, semantisk farve. "Live" = blød puls-ring. Emphasis-variant = skarp 5px tonet blok (kun det der SKAL gribe fat, fx "Closing 0:14"). |
| **CategoryTag** | Skarp data-tag (5px, tonet flade + hairline, neutral). Dense-variant = borderless guld-keyline-label. |
| **Chip** | Hero-pille (999px) - sparsom, kun marketing ("Open beta · Free to play"). |
| **Card** | Hairline, 5px. Varianter: default · KPI · interactive (hover-border). |
| **Table** | Hairline-rækker, Inter Tight tabular højre-stillet, label-header på subtle-bg, række-hover, sticky første-kolonne, trøje-prik. Konsoliderer eksisterende `.sticky-name-cell`/`.auction-*`-mønstre. |
| **Icon** | Custom sæt (A8). |
| **EmptyState** | Ikon + titel + undertekst + handling. |
| **Skeleton / LoadingState** | Shimmer (ingen glow, reduced-motion-aware) + Spinner (eksisterer). |
| **ErrorState** | Alert-ikon + besked + retry-handling. |
| **Modal/Dialog** | Soft-lift, 5px, backdrop, focus-trap, Esc-luk. |
| **Dropdown/Menu · Tooltip · Toast · Tabs** | Konsoliderer eksisterende ad hoc-varianter (DashboardCustomizeMenu, AdminTabs, OverbidToast). |
| **Avatar · Flag · ProgressMeter · Divider · Link** | Genbrugelige småting; Flag eksisterer allerede. |

---

## DEL C - UDRULNING (Fase 2)

### C1. Anti-re-drift-guard

Tilføj til den eksisterende CI-lint-gate:
- **Forbyd nye rå hex-farver** i `frontend/src/**` (kun tilladt i `index.css` token-definitioner) → tving token-brug.
- **Flag slop-tells** i `className`: `rounded-xl`, `rounded-2xl`, `shadow-[0_0`, emoji i JSX-tekst-noder brugt som ikon.
- Dokumentér reglen: "ny UI bruger `ui/`-primitiver + tokens; ingen rå hex, ingen rounded-2xl/glow."

Uden denne guard er vi tilbage her om en måned.

### C2. Migrations-sekvens (side for side, før launch)

1. **Fundament lander:** tokens + primitiver + kitchen-sink + global focus-ring + error-boundary.
2. **Landing #672** bygges direkte på fundamentet (første ny flade - brug `frontend-design`-skill).
3. **Login/forside:** fjern glow/grid-blob/emoji, ny brand.
4. **Kerne-app-flader migreres:** Dashboard · Auctions · Riders · Team · Finance · Board · Admin - inline-kopi → primitiver, emoji → ikoner, standardiserede empty/loading/error.
5. **Resten af siderne** sweepes.

Hver migration: **ingen adfærdsændring**, kun UI. Visuel diff via core-smoke-snapshots (alle 3 playwright-projekter), a11y-tjek.

### C3. Testing & gates

- **a11y:** focus-visible overalt, kontrast AA (allerede tunet), tastatur-nav, reduced-motion.
- **Visuel:** core-smoke playwright-snapshots refreshes (alle 3 projekter) pr. migreret flade.
- **Unit:** primitiver med logik får `node --test` i `frontend/`.
- **CI:** eksisterende gates (build · warning-budget · i18n · lint · frontend-tests · core-smoke) + den nye anti-drift-lint.

---

## Åbne punkter / afhængigheder

- **Endelig landing-copy:** founder skriver founder-prosa (tone-session); ikke fundament-blokerende.
- **Ikon-sættet** er den største enkelt-delopgave; byg til hus-spec (A8) for konsistens.
- **Light vs dark:** begge temaer understøttes (tokens findes). Landing-default-tema afgøres ved landing-byg (#672), ikke fundament-blokerende.
- **#671** forbliver umbrella; dette spec afløser den smalle "accent+font+wordmark"-scope ved at levere hele systemet.

## Referencer

- [`index.css`](../../../frontend/src/index.css) · [`tailwind.config.js`](../../../frontend/tailwind.config.js) · [`index.html`](../../../frontend/index.html)
- [BRAND_BRIEF.md](../../brand/BRAND_BRIEF.md) · [TONE_OF_VOICE.md](../../TONE_OF_VOICE.md)
- [`2026-06-14-landing-page-brand-direction-design.md`](2026-06-14-landing-page-brand-direction-design.md)
- Companion-mocks (gitignored, regenererbare): `.superpowers/brainstorm/936-1781446786/content/` (typography → surface → components → focus-ring → display-layer → badges)
