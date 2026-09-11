// #5150 — alpha-capable farvetoken. Tailwind erstatter `<alpha-value>` med
// opacity-modifieren (`bg-cz-card/40` → 0.4) og med `1` når der ingen modifier
// er. Et token defineret som rå `var(--x)` har INGEN plads til den værdi, så
// Tailwind springer klassen helt over: `bg-cz-card/40`, `border-cz-border/60`
// og `stroke-cz-1/30` blev aldrig genereret, selv om koden bad om dem.
//
// `color-mix` i stedet for mønstret `rgb(var(--x) / <alpha-value>)`, fordi
// sidstnævnte kræver at variablen er en kanal-tripel (`14 15 21`). De 19
// tokens herunder er hex (`#0e0f15`) eller rgba (`rgba(21,119,47,.08)`) og
// læses ~90 steder direkte som `var(--x)` i index.css og inline SVG-styles;
// en omskrivning til tripler ville kræve at ALLE de kaldsteder samtidig blev
// til `rgb(var(--x))`, og rgba-tokens kan slet ikke udtrykkes som tripel.
// color-mix tager farven som den er. Ved alpha = 1 er resultatet identisk med
// kilden (100 % af farven, 0 % transparent), så eksisterende brug UDEN
// opacity-modifier er pixel-uændret.
const alphaToken = (cssVar) =>
  `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      keyframes: {
        ticker: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        ticker: "ticker 60s linear infinite",
      },
      opacity: {
        3:  "0.03",
        8:  "0.08",
        12: "0.12",
      },
      // #2849 bølge 6 — mikro-typografi-tokens (audit-fund F8). Under Tailwinds
      // `text-xs` (12px) fandtes ingen navngivne trin, så 632 callsites havde
      // opfundet 8 forskellige arbitrære px-værdier (8 / 8.5 / 9 / 9.5 / 10 /
      // 10.5 / 11 / 11.5) til det SAMME formål. Ejer-beslutning 2026-07-25:
      // to trin, så label/sub-label-hierarkiet i tæt sportsdata bevares.
      //   text-2xs (11px) — tabel-headers, kort-meta-labels, uppercase-meta
      //   text-3xs (10px) — stat-labels, sublines, zone-pills, badge-mikrotekst
      // Line-height er sat eksplicit, så trinnene ikke arver Tailwinds
      // default-leading og skifter rytme mellem sider.
      fontSize: {
        "3xs": ["10px", { lineHeight: "1.3" }],
        "2xs": ["11px", { lineHeight: "1.35" }],
      },
      fontFamily: {
        // #1578 WP0: `sans` is the prose/UI body face (DM Sans), matching the
        // `body { font-family: 'DM Sans' … }` rule in index.css so `font-sans`
        // resolves to the brand body font instead of Tailwind's stock stack.
        // Self-hosted (see index.css @font-face); no render-blocking Google link.
        sans:    ['"DM Sans"', "system-ui", "-apple-system", "sans-serif"],
        // #481 Phase 4 (PF1): Inter Tight is the de-facto data font. `mono` is
        // redefined to it so all ~366 existing `font-mono` data sites inherit the
        // brand workhorse with zero churn; `data` is the explicit alias for new
        // code. `display` = Bebas wordmark. Each lists its metric-matched Arial
        // fallback (see index.css @font-face) so the swap is CLS-free.
        mono:    ['"Inter Tight"', '"Inter Tight Fallback"', "system-ui", "sans-serif"],
        data:    ['"Inter Tight"', '"Inter Tight Fallback"', "system-ui", "sans-serif"],
        // Bebas is super-condensed; a normal-width metric fallback can't match it
        // without grotesque distortion, and the wordmark (2 sidebar sites) drives
        // no content reflow — so we lean on Impact, a naturally-condensed system
        // face of similar width, for the brief swap window instead.
        display: ['"Bebas Neue"', "Impact", '"Arial Narrow"', "sans-serif"],
      },
      colors: {
        "cz-body":      alphaToken("--bg-body"),
        "cz-card":      alphaToken("--bg-card"),
        "cz-elevated":  alphaToken("--bg-elevated"),
        "cz-subtle":    alphaToken("--bg-subtle"),
        "cz-border":    alphaToken("--border"),
        "cz-1":         alphaToken("--text-1"),
        "cz-2":         alphaToken("--text-2"),
        "cz-3":         alphaToken("--text-3"),
        "cz-accent":    "rgb(var(--accent) / <alpha-value>)",
        "cz-accent-t":  "rgb(var(--accent-t) / <alpha-value>)",
        "cz-on-accent": alphaToken("--on-accent"),

        "cz-sidebar":         alphaToken("--bg-sidebar"),
        "cz-sidebar-hover":   alphaToken("--bg-sidebar-hover"),
        "cz-sidebar-border":  alphaToken("--border-sidebar"),
        "cz-sidebar-1":       alphaToken("--text-sidebar-1"),
        "cz-sidebar-2":       alphaToken("--text-sidebar-2"),
        "cz-sidebar-3":       alphaToken("--text-sidebar-3"),

        "cz-success":    "rgb(var(--success) / <alpha-value>)",
        "cz-success-bg": alphaToken("--success-bg"),
        "cz-danger":     "rgb(var(--danger) / <alpha-value>)",
        "cz-danger-bg":  alphaToken("--danger-bg"),
        "cz-warning":    "rgb(var(--warning) / <alpha-value>)",
        "cz-warning-bg": alphaToken("--warning-bg"),
        "cz-info":       "rgb(var(--info) / <alpha-value>)",
        "cz-info-bg":    alphaToken("--info-bg"),

        // `cz-{status}-bg0` er FJERNET i #2849 bølge 6 (ejer-valg 25/7). Aliaset
        // var en typo for `cz-{status}` og skabte to familier til det samme:
        // 69 callsites blandede deres egen tone med 10 forskellige alfa-værdier,
        // mens `-bg` stod som den designede token. Nu findes kun `-bg` som
        // statusFLADE (retunet i index.css så udseendet er bevaret) og
        // `cz-{status}/N` til hover/badges, hvor en eksplicit alfa er meningen.

        // Discord brand (Blurple) — ekstern brand-farve til Discord-CTA'er.
        "cz-discord":       "rgb(var(--discord) / <alpha-value>)",
        "cz-discord-hover": "rgb(var(--discord-hover) / <alpha-value>)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
      },
      zIndex: {
        // #2880: single canonical scale. `nav` = persistent, always-mounted
        // navigation chrome (MobileQuickNav bottom bar + the desktop static
        // sidebar). It sits between sticky content and the overlay tier so
        // page-sticky headers/cells can never cover it, and it can never cover
        // a dismissible layer (drawer/modal/portaled menu). `overlay` is for
        // TRANSIENT/dismissible layers only (mobile drawer, backdrops, tours) —
        // giving persistent chrome that tier buries anything portaled near it
        // (regression: LanguageSwitcher's document.body-portaled dropdown).
        dropdown: "1000", sticky: "1100", nav: "1150", overlay: "1200", modal: "1300", toast: "1400",

        // #2952: table-local intra-sticky layering — deliberately OUTSIDE the
        // page-chrome scale above (hence the separate quoted/hyphenated key
        // style; zIndexScale.test.js locks the 6 canonical layers by name and
        // does not scan these). Only needed by tables that combine a sticky
        // TOP header row with sticky LEFT/RIGHT columns (AuctionsPage,
        // TransfersPage market view): the header row + its corner cells must
        // out-rank the body's sticky columns during vertical scroll, or the
        // columns cover the header. Kept far below "dropdown" (1000) so this
        // local scale can never accidentally outrank real page chrome.
        "table-col": "1",
        "table-head": "2",
      },
    },

    // #1578 WP0 — radius token-lock. Overriding (NOT extending) borderRadius
    // removes Tailwind's stock xl/2xl/3xl so `rounded-xl`/`rounded-2xl`/
    // `rounded-3xl` no longer resolve to a class (they become no-ops) — slop
    // radii can't drift back in. The brand tokens are the only "soft" radii:
    //   rounded-cz       = 5px  (cards, inputs, buttons — the default surface)
    //   rounded-cz-pill  = 9999 (pills/chips)
    // none/sm/DEFAULT/md/lg/full are kept verbatim from Tailwind's defaults
    // because ~470 legitimate callsites (rounded, rounded-md, rounded-lg,
    // rounded-full) rely on them and are NOT in scope for this token-lock.
    // (Values mirror tailwindcss/defaultTheme borderRadius so the kept scale
    // is byte-identical; only xl/2xl/3xl are dropped.)
    borderRadius: {
      none: "0px",
      sm: "0.125rem",
      DEFAULT: "0.25rem",
      md: "0.375rem",
      lg: "0.5rem",
      full: "9999px",
      cz: "var(--radius-sm)",
      "cz-pill": "var(--radius-pill)",
    },

    // #1578 WP0 — blur token-lock. The Modal primitive deliberately ships a
    // flat scrim (no blur, see modalStyles.js + modal.source.test.js A9), and
    // backdrop-blur is a classic AI-slop tell. Emptying the scale makes every
    // `backdrop-blur*` utility a no-op so it can't be reintroduced; the five
    // hand-rolled overlays/headers that used it now carry a plain semi-opaque
    // backdrop instead. (Full migration to <Modal> is WP4.)
    backdropBlur: {},
  },
  plugins: [],
};
