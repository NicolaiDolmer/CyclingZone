const HEADER = "px-3 py-2 font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3";
const CELL = "px-3 py-2.5 text-sm text-cz-1 border-t border-cz-border";

export function cellClass({ numeric = false, header = false } = {}) {
  const base = header ? HEADER : CELL;
  return numeric ? `${base} text-right font-data tabular-nums` : `${base} text-left`;
}
