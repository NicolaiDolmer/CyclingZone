import { controlClass } from "./fieldStyles.js";

export default function Input({ size = "md", error = false, className = "", ...rest }) {
  return (
    <input
      className={`${controlClass({ size, error })} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}
