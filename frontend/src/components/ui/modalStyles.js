const PANEL_BASE = "w-full rounded-cz border border-cz-border bg-cz-card shadow-overlay";

const PANEL_SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function panelClass({ size = "md" } = {}) {
  return `${PANEL_BASE} ${PANEL_SIZES[size] ?? PANEL_SIZES.md}`;
}

export function backdropClass() {
  return "cz-overlay-backdrop absolute inset-0 bg-black/60";
}
