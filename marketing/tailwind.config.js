/** @type {import('tailwindcss').Config}
 * Subset af frontend/tailwind.config.js (#4067-port) — kun de tokens landing-
 * fladen bruger. Ændringer i frontendens token-værdier skal spejles her.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontSize: {
        "3xs": ["10px", { lineHeight: "1.3" }],
        "2xs": ["11px", { lineHeight: "1.35" }],
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "-apple-system", "sans-serif"],
        data: ['"Inter Tight"', "system-ui", "sans-serif"],
        display: ['"Bebas Neue"', "Impact", '"Arial Narrow"', "sans-serif"],
      },
      colors: {
        "cz-body": "var(--bg-body)",
        "cz-card": "var(--bg-card)",
        "cz-elevated": "var(--bg-elevated)",
        "cz-subtle": "var(--bg-subtle)",
        "cz-border": "var(--border)",
        "cz-1": "var(--text-1)",
        "cz-2": "var(--text-2)",
        "cz-3": "var(--text-3)",
        "cz-accent": "rgb(var(--accent) / <alpha-value>)",
        "cz-accent-t": "rgb(var(--accent-t) / <alpha-value>)",
        "cz-on-accent": "var(--on-accent)",
        "cz-success": "rgb(var(--success) / <alpha-value>)",
        "cz-danger": "rgb(var(--danger) / <alpha-value>)",
        "cz-danger-bg": "var(--danger-bg)",
      },
      zIndex: {
        sticky: "1100",
        toast: "1400",
      },
    },
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
  },
  plugins: [],
};
