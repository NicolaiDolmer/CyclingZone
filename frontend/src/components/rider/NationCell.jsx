import { Flag } from "../Flag";
import { getCountryCode3 } from "../../lib/countryUtils";

// Kompakt nation-visning: flag + IOC 3-bogstavskode (fx 🇫🇷 FRA).
// Bruges som <td>-indhold — kaldersiden styrer selv <td>-wrapper, bredde og
// responsiv-klasse. Tom/ugyldig kode → ingenting (tom celle).
export default function NationCell({ code, className = "" }) {
  const code3 = getCountryCode3(code);
  if (!code3) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
      <Flag code={code} className="flex-shrink-0" />
      <span className="text-cz-3 text-xs font-mono">{code3}</span>
    </span>
  );
}
