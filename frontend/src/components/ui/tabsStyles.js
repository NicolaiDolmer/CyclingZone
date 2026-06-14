const TAB_BASE =
  "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150";

export function tabClass({ active = false } = {}) {
  return active
    ? `${TAB_BASE} border-cz-accent text-cz-1`
    : `${TAB_BASE} border-transparent text-cz-3 hover:text-cz-2`;
}

export function tabListClass({ className = "" } = {}) {
  return `flex gap-1 overflow-x-auto border-b border-cz-border ${className}`.trim();
}
