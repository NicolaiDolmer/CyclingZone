const CONTROL_BASE =
  "w-full rounded-cz border bg-cz-card text-cz-1 placeholder:text-cz-3 " +
  "transition-colors duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed";

const CONTROL_SIZES = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-3.5 py-2.5 text-[15px]",
};

export function controlClass({ size = "md", error = false } = {}) {
  return [
    CONTROL_BASE,
    CONTROL_SIZES[size] ?? CONTROL_SIZES.md,
    error ? "border-cz-danger focus:border-cz-danger" : "border-cz-border focus:border-cz-3",
  ].join(" ");
}

export function labelClass() {
  return "mb-1.5 block font-data text-[11px] font-semibold uppercase tracking-[.12em] text-cz-2";
}

export function helperClass({ error = false } = {}) {
  return error ? "mt-1.5 text-xs text-cz-danger" : "mt-1.5 text-xs text-cz-3";
}
