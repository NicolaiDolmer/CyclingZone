// Ren beslutnings-logik for division-specifik kalender-reset (Task 4).
//
// Holdt DB-fri og side-effekt-fri, så reset-scriptet (scripts/dev/reset-division-calendar.mjs)
// kan unit-testes uden Supabase: scriptet henter rows og delegerer beslutningen hertil.
//
// "Ægte hold"-diskriminatoren er IDENTISK med isRealManager i seasonCalendarMaterializer.js
// og aiTeamGenerator (#1688) — HOLD I SYNC: en division regnes kun som sikker at nulstille
// hvis den IKKE indeholder noget hold der hører til en rigtig spiller.

/**
 * Et hold er en "ægte manager" hvis det IKKE er AI, bank, frosset eller en test-konto.
 * @param {{is_ai?: boolean, is_bank?: boolean, is_frozen?: boolean, is_test_account?: boolean}} team
 * @returns {boolean}
 */
export function isRealManager(team) {
  return team?.is_ai === false && !team.is_bank && !team.is_frozen && !team.is_test_account;
}

/**
 * Afgør om en divisions kalender må nulstilles (kun AI-divisioner uden ægte spillere)
 * og udled de race-ids der ville blive slettet.
 *
 * REN funktion: ingen DB, ingen side-effekter. allowed=false betyder at scriptet skal
 * afbryde (medmindre --force eksplicit overstyrer i CLI-laget).
 *
 * @param {object}   args
 * @param {Array<{id: string|number}>} [args.races=[]]  divisionens races (kun id bruges).
 * @param {Array<object>}              [args.teams=[]]  divisionens hold (liveness-flag).
 * @returns {{ allowed: boolean, reason?: string, raceIds: Array<string|number>, hasRealTeams: boolean }}
 */
export function planDivisionReset({ races = [], teams = [] } = {}) {
  const realTeams = (teams || []).filter(isRealManager);
  const hasRealTeams = realTeams.length > 0;

  // Dedup + frasortér null/undefined race-ids (defensivt mod skæve rows).
  const raceIds = [...new Set((races || []).map((r) => r?.id).filter((id) => id != null))];

  if (hasRealTeams) {
    return {
      allowed: false,
      reason: `Divisionen har ${realTeams.length} ægte hold (real manager) — reset blokeret for at beskytte spillere`,
      raceIds,
      hasRealTeams: true,
    };
  }

  return { allowed: true, raceIds, hasRealTeams: false };
}
