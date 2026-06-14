// Status = farve baerer betydning. Tone -> cz-semantiske farver.
export const STATUS_TONE = {
  live: "info",
  won: "success",
  outbid: "danger",
  closing: "warning",
  info: "info",
};

const TONE_TEXT = {
  info: "text-cz-info",
  success: "text-cz-success",
  danger: "text-cz-danger",
  warning: "text-cz-warning",
};
const TONE_BG = {
  info: "bg-cz-info/10",
  success: "bg-cz-success/10",
  danger: "bg-cz-danger/10",
  warning: "bg-cz-warning/10",
};

const BC_BASE =
  "inline-flex items-center gap-1.5 font-data text-[11px] font-semibold uppercase tracking-[.08em] tabular-nums";

export function statusBadgeClass(state, { emphasis = false } = {}) {
  const tone = STATUS_TONE[state] ?? "info";
  const parts = [BC_BASE, TONE_TEXT[tone]];
  if (emphasis) parts.push("rounded-cz px-2 py-0.5", TONE_BG[tone]);
  return parts.join(" ");
}

const TAG_BASE =
  "inline-flex items-center font-data text-[10px] font-semibold uppercase tracking-[.08em] text-cz-2";

export function categoryTagClass({ dense = false } = {}) {
  if (dense) return `${TAG_BASE} tracking-[.1em] pl-2 border-l-2 border-cz-accent`;
  return `${TAG_BASE} rounded-cz border border-cz-border bg-cz-subtle px-2 py-0.5`;
}
