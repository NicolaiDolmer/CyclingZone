// Categorical chart/donut palette, token-backed so colors theme via CSS.
// CSS vars (space-separated RGB triplets) defined in frontend/src/index.css
// (--cz-chart-1..9). recharts accepts rgb()/var() strings as `fill`, so we
// return rgb(var(--...)) — no raw hex in component source (#986/#671 slop rule).
export const CHART_PALETTE = Array.from(
  { length: 9 },
  (_, i) => `rgb(var(--cz-chart-${i + 1}))`,
);

// Wraps by index so any number of donut segments stays in-palette.
export const chartColor = (i) => CHART_PALETTE[((i % 9) + 9) % 9];
