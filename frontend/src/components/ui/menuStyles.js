const MENU_BASE = "min-w-[12rem] rounded-cz border border-cz-border bg-cz-card p-1.5 shadow-overlay";

const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-cz px-2.5 py-1.5 text-left text-sm transition-colors duration-150";

export function menuClass({ className = "" } = {}) {
  return `${MENU_BASE} ${className}`.trim();
}

export function menuItemClass({ active = false, danger = false } = {}) {
  const tone = danger ? "text-cz-danger hover:bg-cz-danger/10" : "text-cz-1 hover:bg-cz-subtle";
  return `${ITEM_BASE} ${tone} ${active ? "bg-cz-subtle" : ""}`.trim();
}
