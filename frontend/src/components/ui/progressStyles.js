const TRACK_BASE = "h-2 w-full overflow-hidden rounded-cz-pill bg-cz-subtle";

const FILL_TONE = {
  accent: "bg-cz-accent",
  success: "bg-cz-success",
  danger: "bg-cz-danger",
  warning: "bg-cz-warning",
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
