import { statusBadgeClass, STATUS_TONE } from "./badgeStyles.js";

const TONE_DOT = {
  info: "bg-cz-info",
  success: "bg-cz-success",
  danger: "bg-cz-danger",
  warning: "bg-cz-warning",
};

// Pulse-ringen udledes af samme tone som prikken, så ringen altid matcher
// status-farven (ikke hårdkodet --info uanset tone).
const TONE_RING = {
  info: "--info",
  success: "--success",
  danger: "--danger",
  warning: "--warning",
};

export default function StatusBadge({ state, emphasis = false, pulse = false, children, className = "" }) {
  const tone = STATUS_TONE[state] ?? "info";
  return (
    <span className={`${statusBadgeClass(state, { emphasis })} ${className}`}>
      <span
        aria-hidden="true"
        className={`h-[7px] w-[7px] rounded-full ${TONE_DOT[tone]}`}
        style={pulse ? { boxShadow: `0 0 0 3px rgb(var(${TONE_RING[tone]}) / 0.18)` } : undefined}
      />
      {children}
    </span>
  );
}
