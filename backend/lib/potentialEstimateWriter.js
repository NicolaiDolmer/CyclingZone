// #7685 (Udvikling 2.0 trin 5, spec 2026-10-23-6110 §3.3): skriver de gemte
// potentiale-skøn. Samler holdets viden om en rytter, spørger planEstimateWrite
// (potentialEstimate.js) og upserter i rider_potential_estimates.
//
// Tre kaldere, alle bag flaget potential_estimate_writes:
//   recordScoutLooks                 et kig er fuldført (de tre scout_actions-steder)
//   sundayPotentialEstimateSweep.js  søndagskørslen
//   potentialEstimateTeamChangeSweep.js  holdskifte
//
// Ryttere uden talent_ceiling springes over: det sande loft findes først efter
// omregningen (byggetrin 12), og uden det er der intet at skønne over.
//
// Intet her må forlade serveren: tabellen er server-only, og logs tæller kun
// rækker. Tal og ord når først spilleren via publicEstimateView.

import { planEstimateWrite } from "./potentialEstimate.js";
import { isPotentialEstimateWritesEnabled } from "./potentialEstimateWritesFlag.js";
import { privateConfigHash, readPrivateConfig } from "./privateConfig.ts";
import { learningSpeed } from "./academyProspectKnowledge.ts";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";

export const POTENTIAL_ESTIMATES_TABLE = "rider_potential_estimates";
export const POTENTIAL_ESTIMATE_PARAMS_KEY = "potential_estimate_params";
export const ESTIMATE_RIDER_COLUMNS = "id, team_id, talent_ceiling, is_retired";

const UPSERT_CHUNK_SIZE = 500;

// Samme nøgle som scoutLevel i potentialEstimate.js. Nøglen er det eneste sted,
// hvor scoutens niveau ved et kig er gemt: scout_actions kender det ikke.
const SCOUT_KEY_RE = /^s(\d+)t(\d+)$/;

function parseScoutKey(key) {
  const match = SCOUT_KEY_RE.exec(String(key ?? ""));
  return match ? { looks: Number(match[1]), tier: Number(match[2]) } : null;
}

/**
 * Flag + kalibrering. { enabled: false, reason } eller { enabled: true, params,
 * paramsVersion }. Versionen er en hash af kalibreringen, så en ny kalibrering kan
 * spores uden at tallene står i tabellen. Selve værdien sættes af ejeren (hard
 * rule 17); indtil da skrives intet, heller ikke med flaget tændt.
 */
export async function loadEstimateWriteConfig(supabase) {
  if (!(await isPotentialEstimateWritesEnabled(supabase))) return { enabled: false, reason: "flag_off" };
  const params = await readPrivateConfig(supabase, POTENTIAL_ESTIMATE_PARAMS_KEY);
  if (!params) return { enabled: false, reason: "params_missing" };
  return { enabled: true, params, paramsVersion: privateConfigHash(params) };
}

/**
 * Hvad holdet ved fra scouting, når skønnet skrives. Ren funktion.
 *
 * scout_actions gemmer ikke scoutens niveau, så et kig bruger holdets nuværende
 * scout. Det må kun ske ved et kig: at ansætte en bedre scout er ikke ny viden om
 * en rytter, han aldrig har set (§3.3), og søndagskørslen må ikke flytte tallet af
 * den grund (H2). Uden et nyt kig gælder derfor det, der står i den gemte nøgle.
 *
 *   freshLook  dette er selve kigget, så det bedste niveau kan stige
 *   !stored    første skrivning for parret (fx et kig fra før flaget)
 *   flere kig end nøglen kender  en skrivning er gået tabt, og den indhentes her
 *   anden nøgle  holdets egen viden har allerede overhalet kiggene
 */
export function scoutKnowledgeForWrite({ stored = null, looks = 0, scoutTier = null, freshLook = false, maxLooks }) {
  const seen = parseScoutKey(stored?.knowledge_key);
  const capped = Math.min(Math.max(0, Number(looks) || 0), maxLooks);
  if (freshLook || (seen && capped > seen.looks)) {
    return { looks: capped, bestScoutTier: Math.max(seen?.tier ?? 0, Number(scoutTier) || 0) || null };
  }
  if (seen) return { looks: seen.looks, bestScoutTier: seen.tier };
  if (!stored) return { looks: capped, bestScoutTier: scoutTier };
  return { looks: 0, bestScoutTier: null };
}

/**
 * Planlægger skrivningen for ét hold. Ren funktion; `now` er et ISO-tidsstempel.
 * Returnerer { rows, counts }. rows er præcis det, der skal upsertes.
 *
 * Søndagskørslen skriver også par, der har et kig men ingen række. Det er ikke
 * søndagens opdatering men en indhentning, så grunden gemmes som "backfill".
 */
export function planTeamEstimates({
  teamId, riders, storedByRider, looksByRider, datesByRider, staffSpeed = 0, scoutTier = null,
  trigger, params, paramsVersion, now,
}) {
  const rows = [];
  const counts = { written: 0, changed: 0, kept: 0, noKnowledge: 0, noCeiling: 0 };
  for (const rider of riders) {
    if (rider.talent_ceiling == null) { counts.noCeiling += 1; continue; }
    const stored = storedByRider.get(rider.id) ?? null;
    const own = rider.team_id === teamId;
    const scout = scoutKnowledgeForWrite({
      stored,
      looks: looksByRider.get(rider.id) ?? 0,
      scoutTier,
      freshLook: trigger === "new_knowledge",
      maxLooks: params.scout.maxLooks,
    });
    const plan = planEstimateWrite({
      stored,
      truePot: rider.talent_ceiling,
      riderId: rider.id,
      teamId,
      knowledge: { own, trainingDates: datesByRider.get(rider.id) ?? 0, staffSpeed, ...scout },
      trigger: trigger === "sunday" && !stored && !own ? "backfill" : trigger,
      paramsVersion,
      now,
    }, params);
    if (plan.action === "none") counts.noKnowledge += 1;
    else if (plan.action === "keep") counts.kept += 1;
    else {
      rows.push(plan.row);
      counts.written += 1;
      if (plan.changed) counts.changed += 1;
    }
  }
  return { rows, counts };
}

// Holdets bedste aktive scout. Eget lille opslag frem for loadScout: den bor i
// scoutAssignmentService.js, som selv importerer scoutTargetMaturation.js, så et
// import herfra ville lukke en cirkel gennem kig-stien.
async function loadScoutTier(supabase, teamId) {
  const { data, error } = await supabase
    .from("team_staff").select("tier").eq("team_id", teamId).eq("role", "scouting").eq("status", "active");
  if (error) throw new Error(`team_staff: ${error.message}`);
  return (data ?? []).reduce((best, row) => Math.max(best, Number(row.tier) || 0), 0) || null;
}

// Afregnede datoer pr. egen rytter på DETTE hold (S18). Træning på en tidligere
// periode på holdet tæller med: filteret er historikkens hold, ikke rytterens.
async function loadTrainingDates(supabase, teamId, riderIds) {
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("training_rider_ticks")
    .select("rider_id, tick_date, season_id, game_day")
    .eq("team_id", teamId)
    .in("rider_id", chunk)
    .order("rider_id").order("season_id").order("game_day"));
  const dates = new Map();
  for (const row of rows) {
    if (!dates.has(row.rider_id)) dates.set(row.rider_id, new Set());
    dates.get(row.rider_id).add(row.tick_date);
  }
  return new Map([...dates].map(([riderId, set]) => [riderId, set.size]));
}

async function loadStoredEstimates(supabase, teamId, riderIds) {
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from(POTENTIAL_ESTIMATES_TABLE)
    .select("rider_id, value, certainty, uncertainty, knowledge_key, ceiling_at_write, previous_value, previous_certainty, changed_at")
    .eq("team_id", teamId)
    .in("rider_id", chunk)
    .order("rider_id"));
  return new Map(rows.map((row) => [row.rider_id, row]));
}

async function loadLooks(supabase, teamId, riderIds) {
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("scout_actions").select("id, rider_id").eq("team_id", teamId).in("rider_id", chunk).order("id"));
  const looks = new Map();
  for (const row of rows) looks.set(row.rider_id, (looks.get(row.rider_id) ?? 0) + 1);
  return looks;
}

// Træner og facilitet fremskynder holdets viden om egne ryttere (som i akademiets
// kendskabstrin). learningSpeed er en faktor med 1 som neutral; lib'en vil have
// fremskyndelsen alene.
async function loadStaffSpeed(supabase, teamId) {
  return Math.max(0, learningSpeed(await loadTrainingStaffContext(supabase, teamId)) - 1);
}

/**
 * Skriver skønnene for ét hold. `riders`: rækker med ESTIMATE_RIDER_COLUMNS.
 * Kaster ved databasefejl; kalderne isolerer selv pr. hold.
 */
export async function writeTeamEstimates({ supabase, teamId, riders, trigger, config, now = new Date() }) {
  const candidates = riders.filter((rider) => rider.is_retired !== true);
  if (!candidates.length) return { written: 0, changed: 0, kept: 0, noKnowledge: 0, noCeiling: 0 };
  const riderIds = candidates.map((rider) => rider.id);
  const ownIds = candidates.filter((rider) => rider.team_id === teamId).map((rider) => rider.id);
  const [storedByRider, looksByRider, datesByRider, scoutTier, staffSpeed] = await Promise.all([
    loadStoredEstimates(supabase, teamId, riderIds),
    loadLooks(supabase, teamId, riderIds),
    ownIds.length ? loadTrainingDates(supabase, teamId, ownIds) : new Map(),
    loadScoutTier(supabase, teamId),
    ownIds.length ? loadStaffSpeed(supabase, teamId) : 0,
  ]);
  const { rows, counts } = planTeamEstimates({
    teamId, riders: candidates, storedByRider, looksByRider, datesByRider, staffSpeed, scoutTier,
    trigger, params: config.params, paramsVersion: config.paramsVersion, now: now.toISOString(),
  });
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const { error } = await supabase
      .from(POTENTIAL_ESTIMATES_TABLE)
      .upsert(rows.slice(i, i + UPSERT_CHUNK_SIZE), { onConflict: "rider_id,team_id" });
    if (error) throw new Error(`${POTENTIAL_ESTIMATES_TABLE} upsert: ${error.message}`);
  }
  return counts;
}

/** Hold der kan se et skøn: alle undtagen AI-hold og banken. */
export async function loadEstimateTeamIds(supabase) {
  const rows = await fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_bank").order("id"));
  return rows.filter((team) => !team.is_ai && !team.is_bank).map((team) => team.id);
}

/**
 * Et kig er fuldført (§3.3 punkt 1). Kaldes efter scout_actions-indsættelsen, så
 * kigget er talt med. Kaster ALDRIG: kigget er allerede betalt og gemt, og et
 * skøn der ikke blev skrevet, indhentes af søndagskørslen.
 */
export async function recordScoutLooks({ supabase, teamId, riderIds, now = new Date() }) {
  try {
    const config = await loadEstimateWriteConfig(supabase);
    if (!config.enabled) return { skipped: config.reason };
    const ids = [...new Set((riderIds ?? []).filter(Boolean))];
    const riders = await fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("riders").select(ESTIMATE_RIDER_COLUMNS).in("id", chunk).order("id"));
    return await writeTeamEstimates({ supabase, teamId, riders, trigger: "new_knowledge", config, now });
  } catch (err) {
    console.error(`  potential estimate after look failed for team ${teamId}:`, err.message);
    captureException(err, { tags: { flow: "potential-estimate", stage: "new-look" }, teamId });
    return { failed: true };
  }
}
