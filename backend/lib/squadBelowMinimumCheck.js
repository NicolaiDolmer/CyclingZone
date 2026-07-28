// backend/lib/squadBelowMinimumCheck.js
// #3043 · Detektér + varsl hold der er under løbs-minimum EFTER sæsonskiftets
// automatiske afgangs-faser (kontraktudløb + pension).
//
// BAGGRUND: #2748/#2834 spærrer allerede for at en manager SELV (salg/frigivelse/
// auktion) kan presse truppen under MIN_RIDERS_FOR_RACE=8 — squadRiskGuard.js/
// marketUtils.getSquadRiskViolation regner kontraktudløb + pensionsrisiko SAMLET
// og blokerer handlen. Ejerens egen worst-case-måling (23/7, #2748-tråden) viste at
// selv i det absolut værste tilfælde (alle kontraktudløb + alle 36+ pensionerer
// samtidig) falder intet hold under 8 i dagens bestand.
//
// HULLET denne fil lukker: den spærre gater kun FRIVILLIGE handlinger. Den rører
// ALDRIG selve de automatiske faser (contractExpiryRelease.js/retirementRelease.js)
// — og ingenting tjekkede EFTER dem om et hold rent faktisk endte under minimum.
// Hvis worst-case-antagelsen nogensinde brister (flere pensioneringer i en senere
// sæson, en fremtidig regel-ændring, eller en admin-handling uden om squad-spærren)
// ville et hold kunne stå tavst uden mulighed for at stille et løbshold — præcis
// den situation #3043 undersøgte (de 2 konkrete hold i #3043 viste sig at være
// frosne/test-konti, ikke et reelt sæsonskifte-hul — se PR-beskrivelsen — men
// selve DETEKTIONEN manglede, og det er den denne fil tilføjer).
//
// Additivt + isoleret (samme disciplin som contract_expiry_release/
// retirement_release i seasonTransition.js): kaldes EFTER begge frigivelses-faser
// (så den ser den ENDELIGE post-transition trup), kaster aldrig ind i resten af
// transitionen, og er REN detekt+varsl — intet auto-køb/auto-fill (#2748
// ejer-beslutning: "ingen automatisk erstatning denne gang").
//
// Diskriminator: applyHumanTeamFilter (#2852, humanTeamFilter.js) — samme
// "rigtigt menneske-hold"-filter som resten af motoren, IKKE den forkortede
// is_ai=false-udgave #3043's oprindelige SQL brugte (som fangede frosne/test-
// konti som falske positiver).

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { captureException } from "./sentry.js";

export const SQUAD_BELOW_MINIMUM_TYPE = "squad_below_minimum";

/**
 * #3043 · Byg payloaden for "din trup er under løbs-minimum"-notifikationen.
 * EN-first fallback (#1068); locale-aware rendering via metadata-koderne
 * (notif.squadBelowMinimum.*, #666-mønster).
 */
export function buildSquadBelowMinimumNotification({ activeRiders, minRiders = MIN_RIDERS_FOR_RACE }) {
  return {
    type: SQUAD_BELOW_MINIMUM_TYPE,
    title: "Squad below race minimum",
    message: `Your squad has ${activeRiders} race-eligible rider${activeRiders === 1 ? "" : "s"}, below the ${minRiders}-rider minimum needed to field a race day. Sign free agents or bid in an auction before your next race.`,
    relatedId: null,
    metadata: {
      titleCode: "notif.squadBelowMinimum.title",
      titleParams: {},
      messageCode: "notif.squadBelowMinimum.message",
      messageParams: { count: activeRiders, min: minRiders },
    },
  };
}

async function defaultFetchHumanTeams({ supabase }) {
  return fetchAllRows(() =>
    applyHumanTeamFilter(supabase.from("teams").select("id, name, user_id"))
      .not("user_id", "is", null)
      .order("id")
  );
}

// #1308/#2748-diskriminator: akademi- og pensionerede ryttere tæller ikke mod
// løbs-klar trupstørrelse — samme filter som squadEnforcement.getSquadSnapshot.
// fetchAllRowsChunkedIn (ikke dbChunk.selectInChunks): pagineret PR CHUNK, ikke
// kun pr. request — et 100-holds-chunk kan sagtens rumme >1000 rytter-rækker
// (30/hold-cap), og uden .range() pr. side ville PostgREST tavst afskære ved
// 1000 (#2375-mønsteret, se raceEntryGenerator.js-headeren).
async function defaultFetchActiveRiderCounts({ supabase, teamIds }) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase
      .from("riders")
      .select("id, team_id")
      .in("team_id", chunk)
      .eq("is_academy", false)
      .eq("is_retired", false)
      .order("id")
  );
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.team_id, (counts.get(row.team_id) || 0) + 1);
  }
  return counts;
}

/**
 * #3043 · Detektér + varsl menneske-hold under MIN_RIDERS_FOR_RACE.
 *
 * Kaldes fra seasonTransition.js som en ny, isoleret fase EFTER både
 * contract_expiry_release og retirement_release (parallelt med de øvrige
 * additive faser) — en fejl her må ALDRIG vælte resten af transitionen, samme
 * disciplin som de to nabo-faser.
 *
 * Partial-failure-observability spejler contractExpiryRelease/retirementRelease:
 * kaster funktionen FØR pr.-hold-loopet (fetch-fejl), hænges de indtil da
 * akkumulerede stats på `err.partialStats`. Pr.-hold-notifikation er isoleret i
 * sit eget try/catch (ét holds notif-fejl stopper ikke resten).
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} [args.minRiders] — injicerbar (test), default MIN_RIDERS_FOR_RACE
 * @param {Function} [args.notify] — injicerbar (test)
 * @param {Function} [args.fetchHumanTeams] — injicerbar (test)
 * @param {Function} [args.fetchActiveRiderCounts] — injicerbar (test)
 * @returns {Promise<{checked:number, belowMinimum:number, notified:number, notifyFailed:number, teams:Array}>}
 */
export async function detectAndNotifySquadsBelowMinimum({
  supabase,
  minRiders = MIN_RIDERS_FOR_RACE,
  notify = defaultNotifyUser,
  fetchHumanTeams = defaultFetchHumanTeams,
  fetchActiveRiderCounts = defaultFetchActiveRiderCounts,
}) {
  const stats = { checked: 0, belowMinimum: 0, notified: 0, notifyFailed: 0, teams: [] };
  if (!supabase?.from) throw new Error("Supabase client required");

  let teams;
  try {
    teams = await fetchHumanTeams({ supabase });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }
  stats.checked = teams.length;
  if (!teams.length) return stats;

  let counts;
  try {
    counts = await fetchActiveRiderCounts({ supabase, teamIds: teams.map((t) => t.id) });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }

  const affected = teams
    .map((t) => ({ teamId: t.id, name: t.name, userId: t.user_id, activeRiders: counts.get(t.id) || 0 }))
    .filter((t) => t.activeRiders < minRiders);

  stats.belowMinimum = affected.length;
  if (!affected.length) return stats;

  for (const team of affected) {
    stats.teams.push({ teamId: team.teamId, name: team.name, activeRiders: team.activeRiders });
    try {
      const payload = buildSquadBelowMinimumNotification({
        activeRiders: team.activeRiders, minRiders,
      });
      const res = await notify({ supabase, userId: team.userId, ...payload });
      if (res?.delivered) stats.notified += 1;
    } catch (err) {
      stats.notifyFailed += 1;
      console.error(`  ❌ squad-below-minimum-notifikation fejlede (hold ${team.teamId}):`, err?.message || err);
      captureException(err, {
        tags: { flow: "notifications", stage: "squad-below-minimum" },
        extra: { teamId: team.teamId, activeRiders: team.activeRiders },
      });
    }
  }

  return stats;
}
