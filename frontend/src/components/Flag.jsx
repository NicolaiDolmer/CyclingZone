import { getCountryName } from "../lib/countryUtils";

export function Flag({ code, className = "", squared = false, title }) {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) return null;

  const variant = squared ? "fis" : "";
  const label = title ?? getCountryName(normalized.toUpperCase());

  return (
    <span
      className={`fi fi-${normalized} ${variant} ${className}`.trim()}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
