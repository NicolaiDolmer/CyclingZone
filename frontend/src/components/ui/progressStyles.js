const TRACK_BASE = "h-2 w-full overflow-hidden rounded-cz-pill bg-cz-subtle";

const FILL_TONE = {
  accent: "bg-cz-accent",
  success: "bg-cz-success",
  danger: "bg-cz-danger",
  warning: "bg-cz-warning",
  // #4265: monokromt fyld til maalere der KUN viser fremdrift uden status
  // (Sponsors-sidens "stages ridden"). Guld er rationeret til fire steder
  // (TASTE.md §3 / fork 3), og en neutral tael-maaler er ikke et af dem —
  // den ejer-godkendte mockup 6/9 tegner netop denne maaler i --text-1.
  neutral: "bg-cz-1",
};

export function trackClass({ className = "" } = {}) {
  return `${TRACK_BASE} ${className}`.trim();
}

export function fillClass({ tone = "accent" } = {}) {
  return `cz-progress-fill h-full rounded-cz-pill ${FILL_TONE[tone] ?? FILL_TONE.accent}`;
}

// Normalisér value/max -> 0-100. Robust mod NaN/negativ/0-max (returnér 0).
export function clampPercent(value, max = 100) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
