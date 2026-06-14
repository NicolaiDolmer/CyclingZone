import { buttonClass } from "./buttonStyles.js";

export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  className = "",
  children,
  ...rest
}) {
  return (
    <button
      className={`${buttonClass({ variant, size, fullWidth })} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}
