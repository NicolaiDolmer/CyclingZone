/**
 * WatchlistStar — delt stjerne-knap til at tilføje/fjerne en rytter fra ønskelisten.
 *
 * Brugt i:
 * - RidersPage (rytteroversigt) — toggle på/af baseret på `active`
 * - WatchlistPage (ønskeliste) — `active` er altid true; klik fjerner
 * - ActivityPage (ønskeliste-tab) — `active` er altid true; klik fjerner
 *
 * Stopper event propagation så klik på stjernen ikke trigger row-navigation.
 */
import { useTranslation } from "react-i18next";
import { StarIcon } from "./ui/icons";

export default function WatchlistStar({ active, onToggle, className = "" }) {
  const { t } = useTranslation("common");
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      title={active ? t("controls.watchlistRemove") : t("controls.watchlistAdd")}
      className={`transition-all hover:scale-110 flex-shrink-0 ${active ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"} ${className}`}
    >
      <StarIcon size={18} style={{ fill: active ? "currentColor" : "none" }} aria-hidden="true" />
    </button>
  );
}
