// #5435 — React-adgang til rating-kontakten (riderRatingMode.js).
//
// useBestRoleDisplay(): true når ratingen er "bedste rolle nu" og type-badget
// hedder "Natural role". Komponenter der skifter ETIKET eller layout efter
// kontakten (rollenavn ved tallet, badge-label, skjulte loft-tal) læser den her,
// så de re-renderer hvis kontakten flipper mens siden er åben.
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { isBestRoleDisplayOn, subscribeBestRoleDisplay } from "./riderRatingMode.js";

// Prerender/SSR: dagens visning (off) — landing-siderne viser ingen ratings.
const serverSnapshot = () => false;

export function useBestRoleDisplay() {
  return useSyncExternalStore(subscribeBestRoleDisplay, isBestRoleDisplayOn, serverSnapshot);
}

// Overskriften på type-badge-kolonnen i rytter-tabellerne. Med kontakten tændt
// er badget anlægget, og kolonnen hedder "Natural role / Naturlig rolle" — ét
// sted, så de fem tabeller ikke kan kalde den hver sin ting. Slukket: sidens
// egen overskrift (`fallback`) som i dag.
export function useTypeColumnLabel(fallback) {
  const on = useBestRoleDisplay();
  const { t } = useTranslation("riderTypes");
  return on ? t("natural.roleLabel") : fallback;
}
