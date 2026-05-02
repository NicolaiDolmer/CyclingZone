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
      colors: {
        "cz-body":      "var(--bg-body)",
        "cz-card":      "var(--bg-card)",
        "cz-subtle":    "var(--bg-subtle)",
        "cz-border":    "var(--border)",
        "cz-1":         "var(--text-1)",
        "cz-2":         "var(--text-2)",
        "cz-3":         "var(--text-3)",
        "cz-accent":    "var(--accent)",
        "cz-accent-t":  "var(--accent-t)",
        "cz-on-accent": "var(--on-accent)",

        "cz-sidebar":         "var(--bg-sidebar)",
        "cz-sidebar-hover":   "var(--bg-sidebar-hover)",
        "cz-sidebar-border":  "var(--border-sidebar)",
        "cz-sidebar-1":       "var(--text-sidebar-1)",
        "cz-sidebar-2":       "var(--text-sidebar-2)",
        "cz-sidebar-3":       "var(--text-sidebar-3)",

        "cz-success":    "var(--success)",
        "cz-success-bg": "var(--success-bg)",
        "cz-danger":     "var(--danger)",
        "cz-danger-bg":  "var(--danger-bg)",
        "cz-warning":    "var(--warning)",
        "cz-warning-bg": "var(--warning-bg)",
        "cz-info":       "var(--info)",
        "cz-info-bg":    "var(--info-bg)",
      },
    },
  },
  plugins: [],
};
