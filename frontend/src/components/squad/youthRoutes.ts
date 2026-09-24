// #5631 (plan S8): Youth races-sidens rute og dens ?squad=-parameter.
//
// Ren .ts uden React-import, så node --test kan loade den.
import { isYouthSquad, type YouthSquad } from "../../lib/youthSquadPages.ts";

export const YOUTH_RACES_PATH = "/youth-races";

/** Truppen i ?squad=; ukendt eller manglende → U23 (første punkt i vælgeren). */
export function youthRacesSquadFromSearch(search: string): YouthSquad {
  const value = new URLSearchParams(search).get("squad");
  return isYouthSquad(value) ? value : "u23";
}

/** ?pool= som league_division_id, eller null ("alle grupper"). */
export function youthRacesPoolFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("pool");
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function youthRacesHref(squad: YouthSquad, pool: number | null = null): string {
  const query = new URLSearchParams({ squad });
  if (pool != null) query.set("pool", String(pool));
  return `${YOUTH_RACES_PATH}?${query.toString()}`;
}
