// backend/lib/squadBelowMinimumCheck.js
// #3043 · Detektér + varsl hold der er under løbs-minimum EFTER sæsonskiftets
// automatiske afgangs-faser (kontraktudløb + pension).
//
// BAGGRUND: #2748/#2834 spærrer allerede for at en manager SELV (salg/frigivelse/
// auktion) kan presse truppen under markedets buffer — squadRiskGuard.js/
// marketUtils.getSquadRiskViolation regner kontraktudløb + pensionsrisiko SAMLET
// og blokerer handlen. Ejerens egen worst-case-måling (23/7, #2748-tråden) viste at
// selv i det absolut værste tilfælde (alle kontraktudløb + alle 36+ pensionerer
// samtidig) faldt intet hold under den daværende buffer i bestanden.
// #5867: selve startadvarslen bruger nu raceRunner/raceAutopicks deltagelsesgulv,
// så en manager med en lovlig sekser ikke får besked om at han ikke kan starte.
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
// #5864 (ejer 28/9 valg B: håndhæv udløbne kontrakter straks, også når en
// ungdomstrup bliver for lille): sæsonskiftet frigiver nu også udløbne U23-,
// junior- og akademiryttere på menneskehold (#6309). Tjekket gælder derfor PR TRUP:
//   senior  alle menneskehold (uændret siden #3043)
//   u23     menneskehold med en U23-pulje (teams.u23_league_division_id)
//   junior  menneskehold med en junior-pulje (teams.junior_league_division_id)
// Et hold uden pulje for en ungdomstrup stiller aldrig op i det felt
// (raceBinding.teamInRaceSquadPool), så det får ingen varsling for den trup.
// Startgulvet er det samme flade MIN_RACE_ENTRIES for alle trupper (raceRunner
// dropper ethvert hold under det, uanset trup). Én notifikation pr. hold+trup+
// sæson: dedupe-nøglen (team, squad, season) ligger i metadata og slås op før
// hver levering, så en genkørsel af transitionen aldrig varsler samme trup to gange.
//
// Additivt + isoleret (samme disciplin som contract_expiry_release/
// retirement_release i seasonTransition.js): kaldes EFTER begge frigivelses-faser
// (så den ser den ENDELIGE post-transition trup), kaster aldrig ind i resten af
// transitionen, og er REN detekt+varsl — intet auto-køb/auto-fill (#2748
// ejer-beslutning: "ingen automatisk erstatning denne gang").
//
// Diskriminator: applyHumanTeamFilter (#2852, humanTeamFilter.js) — samme
// "rigtigt menneske-hold"-filter som resten af motoren og samme ejendomsfilter
// som contractExpiryRelease (ikke AI, bank, frosset eller testkonto).

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { buildKeyedNotification, notifyUser as defaultNotifyUser } from "./notificationService.js";
import { captureException } from "./sentry.js";
import { applySeniorSquadFilter, isSeniorSquadRider, isYouthSquad } from "./squads.js";
import { SQUAD_POOL_COLUMN } from "./raceBinding.js";

export const SQUAD_BELOW_MINIMUM_TYPE = "squad_below_minimum";

/** Trupperne tjekket pr. hold, i den rækkefølge de varsles. */
export const CHECKED_SQUADS = Object.freeze(["senior", "u23", "junior"]);

const YOUTH_KEYS = Object.freeze({
  u23: { titleCode: "notif.squadBelowMinimum.titleU23", messageCode: "notif.squadBelowMinimum.messageU23" },
  junior: { titleCode: "notif.squadBelowMinimum.titleJunior", messageCode: "notif.squadBelowMinimum.messageJunior" },
});

/** #5864 · Dedupe-nøglen (team, squad, season). null når sæsonen er ukendt. */
export function squadBelowMinimumDedupeKey({ teamId, squad, seasonNumber }) {
  if (!teamId || !squad || !Number.isFinite(seasonNumber)) return null;
  return `${SQUAD_BELOW_MINIMUM_TYPE}:${teamId}:${squad}:${seasonNumber}`;
}

/**
 * #3043/#5864 · Byg payloaden for "din trup er under løbs-minimum"-notifikationen.
 * Senior beholder sin oprindelige ordlyd (notif.squadBelowMinimum.title/message).
 * U23/junior bruger en variant med trupnavnet, der forklarer at en rytter med
 * udløbet kontrakt forlader holdet, og at truppen ikke kan stille til start før
 * den er fyldt op (ejer 28/9: konsekvensen skal forklares tydeligt).
 * EN-first fallback (#1068); locale-aware rendering via metadata-koderne (#666).
 */
export function buildSquadBelowMinimumNotification({
  activeRiders,
  minRiders = MIN_RACE_ENTRIES,
  squad = "senior",
  teamId = null,
  seasonNumber = null,
}) {
  const dedupeKey = squadBelowMinimumDedupeKey({ teamId, squad, seasonNumber });
  const context = {
    squad,
    ...(teamId ? { teamId } : {}),
    ...(Number.isFinite(seasonNumber) ? { seasonNumber } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
  };

  const youth = YOUTH_KEYS[squad];
  if (youth) {
    return {
      type: SQUAD_BELOW_MINIMUM_TYPE,
      relatedId: null,
      ...buildKeyedNotification({
        titleCode: youth.titleCode,
        titleParams: {},
        messageCode: youth.messageCode,
        messageParams: { count: activeRiders, min: minRiders },
        metadata: context,
      }),
    };
  }

  return {
    type: SQUAD_BELOW_MINIMUM_TYPE,
    title: "Squad below race minimum",
    message: `Your squad has ${activeRiders} race-eligible rider${activeRiders === 1 ? "" : "s"}, below the ${minRiders}-rider minimum needed to field a race day. Sign free agents or bid in an auction before your next race.`,
    relatedId: null,
    metadata: {
      ...context,
      titleCode: "notif.squadBelowMinimum.title",
      titleParams: {},
      messageCode: "notif.squadBelowMinimum.message",
      messageParams: { count: activeRiders, min: minRiders },
    },
  };
}

export async function defaultFetchHumanTeams({ supabase }) {
  return fetchAllRows(() =>
    applyHumanTeamFilter(
      supabase.from("teams").select(`id, name, user_id, ${SQUAD_POOL_COLUMN.u23}, ${SQUAD_POOL_COLUMN.junior}`)
    )
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
// Bruges også af selectionWarningSweep.js og seniorStartReminder.js: SENIOR-only.
export async function defaultFetchActiveRiderCounts({ supabase, teamIds }) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    applySeniorSquadFilter(
      supabase
        .from("riders")
        .select("id, team_id")
        .in("team_id", chunk)
    )
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
 * #5864 · Hvilken tjekket trup tæller rytteren i? Senior via isSeniorSquadRider
 * (samme prædikat som applySeniorSquadFilter); ungdom via en eksplicit
 * u23/junior-trup. En akademirytter uden ungdomstrup tæller ingen steder.
 */
export function checkedSquadOf(rider) {
  if (isSeniorSquadRider(rider)) return "senior";
  if (isYouthSquad(rider?.squad)) return rider.squad;
  return null;
}

/** Tæl rækker (id, team_id, squad, is_academy) pr. hold og trup. */
export function countRidersBySquad(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const squad = checkedSquadOf(row);
    if (!squad) continue;
    if (!counts.has(row.team_id)) counts.set(row.team_id, { senior: 0, u23: 0, junior: 0 });
    counts.get(row.team_id)[squad] += 1;
  }
  return counts;
}

/** #5864 · Ikke-pensionerede ryttere pr. hold og trup (senior/u23/junior). */
export async function defaultFetchSquadRiderCounts({ supabase, teamIds }) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase
      .from("riders")
      .select("id, team_id, squad, is_academy")
      .in("team_id", chunk)
      .eq("is_retired", false)
      .order("id")
  );
  return countRidersBySquad(rows);
}

/** Har holdet en pulje for truppen? Senior: altid (uændret #3043-adfærd). */
export function teamFieldsSquad(team, squad) {
  if (squad === "senior") return true;
  const column = SQUAD_POOL_COLUMN[squad];
  return Boolean(column) && team?.[column] != null;
}

/**
 * #5864 · Ren plan: hvilke hold+trupper er under gulvet? Bruges af
 * sæsonskiftet og af det read-only preview i enforce5864ExpiredContracts.mjs.
 *
 * @param {object} args
 * @param {object[]} args.teams  menneskehold (id, name, user_id, pulje-kolonner)
 * @param {Map<string,{senior:number,u23:number,junior:number}>} args.counts
 * @param {number} [args.minRiders]
 * @returns {Array<{teamId:string, name:string, userId:string, squad:string, activeRiders:number}>}
 */
export function planSquadsBelowMinimum({ teams, counts, minRiders = MIN_RACE_ENTRIES }) {
  const affected = [];
  for (const team of teams || []) {
    const byS = counts.get(team.id) || {};
    for (const squad of CHECKED_SQUADS) {
      if (!teamFieldsSquad(team, squad)) continue;
      const activeRiders = Number(byS[squad] || 0);
      if (activeRiders >= minRiders) continue;
      affected.push({ teamId: team.id, name: team.name, userId: team.user_id, squad, activeRiders });
    }
  }
  return affected;
}

/** Er der allerede leveret en notifikation med denne dedupe-nøgle? */
export async function defaultHasNotificationForKey({ supabase, userId, dedupeKey }) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", SQUAD_BELOW_MINIMUM_TYPE)
    .eq("metadata->>dedupeKey", dedupeKey)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * #3043/#5867/#5864 · Detektér + varsl menneske-hold under deltagelsesgulvet,
 * pr. trup (senior/u23/junior).
 *
 * Kaldes fra seasonTransition.js som en ny, isoleret fase EFTER både
 * contract_expiry_release og retirement_release (parallelt med de øvrige
 * additive faser) — en fejl her må ALDRIG vælte resten af transitionen, samme
 * disciplin som de to nabo-faser.
 *
 * Partial-failure-observability spejler contractExpiryRelease/retirementRelease:
 * kaster funktionen FØR pr.-hold-loopet (fetch-fejl), hænges de indtil da
 * akkumulerede stats på `err.partialStats`. Pr.-hold+trup-notifikation er isoleret
 * i sit eget try/catch (én fejl stopper ikke resten).
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} [args.seasonNumber] — sæsonen truppen skal stille op i (dedupe-nøgle)
 * @param {number} [args.minRiders] — injicerbar (test), default MIN_RACE_ENTRIES
 * @param {Function} [args.notify] — injicerbar (test)
 * @param {Function} [args.fetchHumanTeams] — injicerbar (test)
 * @param {Function} [args.fetchSquadRiderCounts] — injicerbar (test)
 * @param {Function} [args.hasNotificationForKey] — injicerbar (test)
 * @returns {Promise<{checked:number, belowMinimum:number, notified:number, deduped:number, notifyFailed:number, bySquad:object, teams:Array}>}
 */
export async function detectAndNotifySquadsBelowMinimum({
  supabase,
  seasonNumber = null,
  minRiders = MIN_RACE_ENTRIES,
  notify = defaultNotifyUser,
  fetchHumanTeams = defaultFetchHumanTeams,
  fetchSquadRiderCounts = defaultFetchSquadRiderCounts,
  hasNotificationForKey = defaultHasNotificationForKey,
}) {
  const stats = { checked: 0, belowMinimum: 0, notified: 0, deduped: 0, notifyFailed: 0, bySquad: {}, teams: [] };
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
    counts = await fetchSquadRiderCounts({ supabase, teamIds: teams.map((t) => t.id) });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }

  const affected = planSquadsBelowMinimum({ teams, counts, minRiders });
  stats.belowMinimum = affected.length;
  if (!affected.length) return stats;

  for (const entry of affected) {
    stats.bySquad[entry.squad] = (stats.bySquad[entry.squad] || 0) + 1;
    stats.teams.push({ teamId: entry.teamId, name: entry.name, squad: entry.squad, activeRiders: entry.activeRiders });
    try {
      const payload = buildSquadBelowMinimumNotification({
        activeRiders: entry.activeRiders, minRiders, squad: entry.squad, teamId: entry.teamId, seasonNumber,
      });
      const dedupeKey = payload.metadata?.dedupeKey;
      if (dedupeKey && entry.userId && await hasNotificationForKey({ supabase, userId: entry.userId, dedupeKey })) {
        stats.deduped += 1;
        continue;
      }
      const res = await notify({ supabase, userId: entry.userId, ...payload });
      if (res?.delivered) stats.notified += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      stats.notifyFailed += 1;
      console.error(`  ❌ squad-below-minimum-notifikation fejlede (hold ${entry.teamId}, trup ${entry.squad}):`, err?.message || err);
      captureException(err, {
        tags: { flow: "notifications", stage: "squad-below-minimum" },
        extra: { teamId: entry.teamId, squad: entry.squad, activeRiders: entry.activeRiders },
      });
    }
  }

  return stats;
}
