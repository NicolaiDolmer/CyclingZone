const BUBBLE =
  "cz-tooltip pointer-events-none absolute z-overlay w-max max-w-xs rounded-cz border border-cz-border " +
  "bg-cz-elevated px-2.5 py-1.5 text-xs text-cz-1 shadow-overlay opacity-0 " +
  "group-hover:opacity-100 group-focus-within:opacity-100";

const SIDE = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function tooltipClass({ side = "top" } = {}) {
  return `${BUBBLE} ${SIDE[side] ?? SIDE.top}`;
}
