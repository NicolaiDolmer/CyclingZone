// Træningssidens fremdrift pr. rytter (/api/training/me).
//
// progress: rider_id -> ability_progress (bjælken som brøk, som i dag).
// capped:   rider_id -> synlige evner på livstidsloftet (#2578), så UI'et kan vise
//           "færdigudviklet i dette fokus". Kun evne-nøgler forlader serveren; selve
//           loft-tallene forbliver skjulte (#1162).
// xpBar:    #6110 tændingsliste pkt. 2 (#8210): under XP (params sat) får egen manager
//           bjælken i XP og prisen for næste point pr. evne ("x af y XP" i stedet for
//           procent). Der findes intet loft under XP, så capped er tom. Uden XP er
//           xpBar null, og progress og capped er præcis som før.
import { cappedVisibleAbilities } from "./training.js";
import { xpBarsFor } from "./developmentXp.ts";

export function trainingProgressView(rows, xpParams = null) {
  const progress = {};
  const capped = {};
  const xpBar = xpParams ? {} : null;
  for (const row of rows ?? []) {
    progress[row.rider_id] = row.ability_progress ?? {};
    if (xpBar) {
      xpBar[row.rider_id] = xpBarsFor(row, row.ability_progress ?? {}, xpParams);
      continue;
    }
    const cappedForRider = cappedVisibleAbilities(row);
    if (cappedForRider.length) capped[row.rider_id] = cappedForRider;
  }
  return { progress, capped, xpBar };
}
