import { getCountryName } from "../lib/countryUtils";
import { useTranslation } from "react-i18next";
// #2047 + #5177: flag-icons-CSS scopes hertil — loades kun når et RYTTER-flag
// faktisk renderes. Sprite-CSS'en dækker ~260 nationaliteter (421 KB rå / 84,7 KB
// gzippet) og kan derfor ikke inlines som SVG; til gengæld ligger ALLE forbrugere
// af <Flag> bag lazy ruter/komponenter (NationCell, RiderFilters, Dashboard,
// Transfers, Resultater, planner …), så importen her ender i en lazy chunk og
// rører ikke entry'ens kritiske sti. Sprogvælgerens to flag ligger i
// LanguageSwitcherFlag.jsx som inline SVG præcis for at holde det sådan — læg
// ALDRIG en <Flag> i sidehovedet eller i et andet ikke-lazy modul uden at måle
// entry-chunkens CSS-graf igen (`grep flag-icons dist/assets/index-*.js`).
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
