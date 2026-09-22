// #5435 — React-adgang til rating-kontakten (riderRatingMode.js).
//
// useBestRoleDisplay(): true når ratingen er "bedste rolle nu" og type-badget
// hedder "Natural role". Komponenter der skifter ETIKET eller layout efter
// kontakten (rollenavn ved tallet, badge-label, skjulte loft-tal) læser den her,
// så de re-renderer hvis kontakten flipper mens siden er åben.
import { useSyncExternalStore } from "react";
import { isBestRoleDisplayOn, subscribeBestRoleDisplay } from "./riderRatingMode.js";

// Prerender/SSR: dagens visning (off) — landing-siderne viser ingen ratings.
const serverSnapshot = () => false;

export function useBestRoleDisplay() {
  return useSyncExternalStore(subscribeBestRoleDisplay, isBestRoleDisplayOn, serverSnapshot);
}
