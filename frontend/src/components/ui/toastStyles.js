export const TOAST_TONE = {
  info: "info",
  success: "success",
  danger: "danger",
  warning: "warning",
};

const BASE = "pointer-events-auto flex items-start gap-3 rounded-cz border bg-cz-card px-4 py-3 shadow-overlay";

const TONE_BORDER = {
  info: "border-cz-info/40",
  success: "border-cz-success/40",
  danger: "border-cz-danger/40",
  warning: "border-cz-warning/40",
};

export function toastClass({ tone = "info" } = {}) {
  return `${BASE} ${TONE_BORDER[tone] ?? TONE_BORDER.info}`;
}
