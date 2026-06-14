const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-cz border " +
  "transition-colors duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none";

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-[15px]",
};

const VARIANTS = {
  primary: "bg-cz-accent text-cz-on-accent border-transparent hover:brightness-105 active:translate-y-px",
  secondary: "bg-transparent text-cz-1 border-cz-border hover:border-cz-3",
  ghost: "bg-transparent text-cz-2 border-transparent hover:bg-cz-subtle hover:text-cz-1",
  danger: "bg-transparent text-cz-danger border-cz-danger/50 hover:bg-cz-danger/10",
};

export function buttonClass({ variant = "primary", size = "md", fullWidth = false } = {}) {
  return [
    BASE,
    SIZES[size] ?? SIZES.md,
    VARIANTS[variant] ?? VARIANTS.primary,
    fullWidth ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
