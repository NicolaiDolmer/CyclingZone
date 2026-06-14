import { controlClass } from "./fieldStyles.js";

export default function Textarea({ size = "md", error = false, rows = 4, className = "", ...rest }) {
  return (
    <textarea
      rows={rows}
      className={`${controlClass({ size, error })} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}
