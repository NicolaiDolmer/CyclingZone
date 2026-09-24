// backend/lib/youthSquadRoom.js
// #5568: "hvor mange er der i ungdomstruppen, og hvad er loftet?" — ét svar til
// alle læse-flader (budrummets bud-gate, nedrykningsdialogens quote og
// akademi-sidens trup-linje "U23 5/12 · Junior 3/10").
//
// Før #5568 spurgte fladerne getTeamAcademyCount (ALLE akademiryttere) og
// sammenlignede med det flade ACADEMY.SLOTS = 8, mens RPC'erne siden #5547
// tæller pr. mål-trup med SQUAD_CAPS. Resultatet var at 8 akademiryttere spærrede
// bud og signeringer, selv om rytterens trup havde plads.
//
// Tællingen er countSquadMembers (academyGraduation.js) og loftet capForSquad
// (squads.js) — samme par som Graduation Day's hasRoomInTargetSquad, så ingen
// flade kan blive uenig med motoren om truppens størrelse. Ingen tal her.

import { capForSquad, isYouthSquad, SQUADS } from "./squads.js";
import { countSquadMembers } from "./academyGraduation.js";

/** Ungdomstrupperne i visningsrækkefølge (U23 før junior, ældst først). */
export const YOUTH_SQUAD_ORDER = Object.freeze(SQUADS.filter(isYouthSquad).reverse());

/**
 * Brugte pladser + loft for ÉN ungdomstrup.
 *
 * @param {any} supabase
 * @param {{teamId:string, squad:string}} args
 * @returns {Promise<{squad:"junior"|"u23", used:number, max:number}>}
 * @throws {Error} 'invalid_squad' ved en ikke-ungdomstrup (programmeringsfejl)
 */
export async function youthSquadRoom(supabase, { teamId, squad } = /** @type {any} */ ({})) {
  const max = capForSquad(squad);
  if (!isYouthSquad(squad) || max === null) throw new Error("invalid_squad");
  const used = await countSquadMembers(supabase, { teamId, squad });
  return { squad: /** @type {"junior"|"u23"} */ (squad), used, max };
}

/**
 * Brugte pladser + loft for BEGGE ungdomstrupper, fx til akademi-sidens linje.
 *
 * @param {any} supabase
 * @param {string} teamId
 * @returns {Promise<Record<"u23"|"junior", {used:number, max:number}>>}
 */
export async function youthSquadRooms(supabase, teamId) {
  const rooms = await Promise.all(YOUTH_SQUAD_ORDER.map((squad) => youthSquadRoom(supabase, { teamId, squad })));
  return Object.fromEntries(rooms.map(({ squad, used, max }) => [squad, { used, max }]));
}
