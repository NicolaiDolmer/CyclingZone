import { controlClass } from "./fieldStyles.js";
import { ChevronDownIcon } from "./icons/index.jsx";

export default function Select({ size = "md", error = false, className = "", children, ...rest }) {
  return (
    <div className="relative">
      <select
        className={`${controlClass({ size, error })} appearance-none pr-9 ${className}`}
        aria-invalid={error || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cz-3"
      />
    </div>
  );
}
