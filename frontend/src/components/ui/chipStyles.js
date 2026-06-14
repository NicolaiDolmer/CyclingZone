// Hero-marketing-pille (spec B2 + A9). Neutral - ALDRIG guld (det er et badge-look
// vi bevidst undgaar). Sparsom brug: kun marketing ("Open beta - Free to play").
const CHIP_BASE =
  "inline-flex items-center gap-2 rounded-cz-pill border border-cz-border bg-cz-subtle " +
  "px-3.5 py-1.5 font-data text-xs font-semibold uppercase tracking-[.08em] text-cz-2";

export function chipClass({ className = "" } = {}) {
  return `${CHIP_BASE} ${className}`.trim();
}
