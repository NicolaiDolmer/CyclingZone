// max-h + intern scroll (#2948): et panel højere end viewporten (fx 5 sponsor-
// kort på mobil) skal scrolle internt — uden dette ligger indhold under folden
// permanent uden for skærmen (wrapperens p-4 = 2rem samlet luft).
const PANEL_BASE =
  "w-full rounded-cz border border-cz-border bg-cz-card shadow-overlay max-h-[calc(100dvh-2rem)] overflow-y-auto";

const PANEL_SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  // #2948: sponsor-tilbud (5 kort) behøver bredere lærred end lg.
  xl: "max-w-4xl",
};

export function panelClass({ size = "md" } = {}) {
  return `${PANEL_BASE} ${PANEL_SIZES[size] ?? PANEL_SIZES.md}`;
}

export function backdropClass() {
  return "cz-overlay-backdrop absolute inset-0 bg-black/60";
}
