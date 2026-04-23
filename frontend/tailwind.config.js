/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "cz-body":   "var(--bg-body)",
        "cz-card":   "var(--bg-card)",
        "cz-subtle": "var(--bg-subtle)",
        "cz-border": "var(--border)",
        "cz-1":      "var(--text-1)",
        "cz-2":      "var(--text-2)",
        "cz-3":      "var(--text-3)",
        "cz-accent": "var(--accent)",
        "cz-accent-t": "var(--accent-t)",
      },
    },
  },
  plugins: [],
};
