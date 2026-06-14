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
      fontFamily: {
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
        "cz-body":      "var(--bg-body)",
        "cz-card":      "var(--bg-card)",
        "cz-elevated":  "var(--bg-elevated)",
        "cz-subtle":    "var(--bg-subtle)",
        "cz-border":    "var(--border)",
        "cz-1":         "var(--text-1)",
        "cz-2":         "var(--text-2)",
        "cz-3":         "var(--text-3)",
        "cz-accent":    "rgb(var(--accent) / <alpha-value>)",
        "cz-accent-t":  "rgb(var(--accent-t) / <alpha-value>)",
        "cz-on-accent": "var(--on-accent)",

        "cz-sidebar":         "var(--bg-sidebar)",
        "cz-sidebar-hover":   "var(--bg-sidebar-hover)",
        "cz-sidebar-border":  "var(--border-sidebar)",
        "cz-sidebar-1":       "var(--text-sidebar-1)",
        "cz-sidebar-2":       "var(--text-sidebar-2)",
        "cz-sidebar-3":       "var(--text-sidebar-3)",

        "cz-success":    "rgb(var(--success) / <alpha-value>)",
        "cz-success-bg": "var(--success-bg)",
        "cz-danger":     "rgb(var(--danger) / <alpha-value>)",
        "cz-danger-bg":  "var(--danger-bg)",
        "cz-warning":    "rgb(var(--warning) / <alpha-value>)",
        "cz-warning-bg": "var(--warning-bg)",
        "cz-info":       "rgb(var(--info) / <alpha-value>)",
        "cz-info-bg":    "var(--info-bg)",

        // Legacy aliases til base-status-farver. Brugt 74x i source som typo
        // for `cz-{status}` (uden -bg0). Beholdes for backward compat — alle
        // 4 callsites virker semantisk identisk med `cz-{status}`. Tilføjet
        // i v2.20 (DD pressure-dot fix), opgraderet til channel-format i v2.21.
        "cz-success-bg0": "rgb(var(--success) / <alpha-value>)",
        "cz-danger-bg0":  "rgb(var(--danger) / <alpha-value>)",
        "cz-warning-bg0": "rgb(var(--warning) / <alpha-value>)",
        "cz-info-bg0":    "rgb(var(--info) / <alpha-value>)",
      },
      borderRadius: {
        cz: "var(--radius-sm)",
        "cz-pill": "var(--radius-pill)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
      },
      zIndex: {
        dropdown: "1000", sticky: "1100", overlay: "1200", modal: "1300", toast: "1400",
      },
    },
  },
  plugins: [],
};
