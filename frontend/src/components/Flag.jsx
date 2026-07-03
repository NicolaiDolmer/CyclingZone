import { getCountryName } from "../lib/countryUtils";
import { useTranslation } from "react-i18next";
// #2047: flag-icons-CSS scopes hertil (ud af global boot i main.jsx) — loades kun
// når et flag faktisk renderes. Vite deduper på tværs af Flag.jsx/LanguageSwitcher.jsx.
import "flag-icons/css/flag-icons.min.css";

export function Flag({ code, className = "", squared = false, title }) {
  const { i18n } = useTranslation();
  if (typeof code !== "string") return null;
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) return null;

  const variant = squared ? "fis" : "";
  const label = title ?? getCountryName(normalized.toUpperCase(), i18n.language);

  return (
    <span
      className={`fi fi-${normalized} ${variant} ${className}`.trim()}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
