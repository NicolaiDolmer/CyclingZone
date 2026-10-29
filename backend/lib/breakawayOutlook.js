// backend/lib/breakawayOutlook.js
// #6912 (designbord S7, variant B): udbrudschancen beregnet af motoren for netop det
// løb, den etape og det felt, i stedet for den faste tabel variant A fjernede.
// Design: docs/superpowers/specs/2026-10-26-6912-engine-breakaway-odds-design.md
//
// SÅDAN:
//  1. Etapens motor-input bygges af den ÆGTE afviklingssti: raceRunner.simulateStageByIndex
//     med dryRun (skriver intet). En indpakning om v4-motoren fanger netop etapens
//     argumenter (felt, roller, form, træthed, klassement, trøjer, regel-revision).
//  2. Motoren køres derefter OUTLOOK_SEEDS gange på de fangede argumenter med egne
//     forecast-seeds. De er uafhængige af løbets rigtige (saltede) seed, så tallet
//     aldrig afslører dagens faktiske udfald. Mellem hver kørsel gives event-loopet
//     tilbage, så API'et ikke står stille.
//  3. Andelen af kørsler hvor udbruddet vinder, bliver til "cirka k af n", og
//     holdene der hentede udbruddet giver den korte årsag.
//
// PRIVATLIV: holdenes taktik-ordrer (team_orders) er private. De fjernes fra
// prognosen (rollernes og AI-holdenes standardordrer gælder), så tallet ikke kan
// bruges til at aflure et andet holds ordre. Samme tal for alle seere.
//
// KUN NÅR MOTOREN KAN STÅ INDE FOR TALLET: flaget er tændt for seeren, v4-motoren
// kører, løbets regel-revision er s5_profiles_v3 eller nyere, etapen er den næste
// der skal køres, den har et morgenudbrud, og alle kørsler lykkedes. Ellers
// { available: false, reason } og UI'et viser ingen chance.
//
// Hard rule 17: ingen målte fordelinger i repoet; de står i balance-internals/6912/.

import { createHash } from "node:crypto";

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { teamInRaceSquadPool } from "./raceBinding.js";
import { isRaceLineupLockedNow } from "./raceStartLock.js";
import { fetchAllRows } from "./supabasePagination.js";

export const BREAKAWAY_OUTLOOK_FLAG_KEY = "race_breakaway_outlook";
export const OUTLOOK_SEEDS = 40;
export const OUTLOOK_CACHE_TTL_MS = 30 * 60 * 1000;
// #6912-opfølgning: en fejlet prognose huskes kort, så samme ødelagte løb ikke kører
// dry-run + Sentry-rapport igen ved hver visning af jægerboksen.
export const OUTLOOK_ERROR_TTL_MS = 5 * 60 * 1000;
export const OUTLOOK_ERROR = Object.freeze({ available: false, reason: "error" });

const NO_BREAKAWAY_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isBreakawayOutlookEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, BREAKAWAY_OUTLOOK_FLAG_KEY), opts);
}

/** Løbs-id'et skal være et UUID før nogen forespørgsel (ellers en Postgres-fejl pr. kald). */
export function isValidRaceId(raceId) {
  return typeof raceId === "string" && UUID_RE.test(raceId);
}

/** Har etapeprofilen et morgenudbrud at regne på? Tidskørsler og manglende profil: nej. */
export function stageAllowsBreakaway(profileType) {
  return typeof profileType === "string" && profileType.length > 0 && !NO_BREAKAWAY_PROFILES.has(profileType);
}

/** Løbet har en næste etape at regne på (ikke færdigt, ikke alle etaper kørt). */
export function raceHasNextStage(race) {
  const totalStages = Number(race?.stages) || 1;
  const stageIndex = Number(race?.stages_completed) || 0;
  return race?.status !== "completed" && stageIndex < totalStages;
}

/**
 * Er prognosen relevant for seeren? Kun løb i den aktive sæson med en næste etape, og
 * kun når seerens hold er tilmeldt (har ryttere i race_entries) eller stadig kan
 * tilmelde sig (holdets pulje for løbets trup, og truppen er ikke låst endnu).
 * Billige tjek først; højst tre små opslag (sæson-status, trup-lås, holdets tilmelding).
 *
 * @param {{ supabase: any, race: any, team: any, now: Date, isLineupLocked?: Function }} args
 * @returns {Promise<boolean>}
 */
export async function isOutlookRelevantForViewer({ supabase, race, team, now, isLineupLocked = isRaceLineupLockedNow }) {
  if (!team?.id || !race?.id || !race?.season_id) return false;
  if (!raceHasNextStage(race)) return false;
  const { data: season, error: seasonError } = await supabase
    .from("seasons").select("id, status").eq("id", race.season_id).maybeSingle();
  if (seasonError) throw new Error(`seasons (breakaway outlook): ${seasonError.message}`);
  if (season?.status !== "active") return false;
  if ((Number(race.stages_completed) || 0) === 0 && teamInRaceSquadPool({ team, race })
    && !(await isLineupLocked({ supabase, race, now }))) return true;
  const { data: entry, error: entryError } = await supabase
    .from("race_entries").select("rider_id").eq("race_id", race.id).eq("team_id", team.id).limit(1).maybeSingle();
  if (entryError) throw new Error(`race_entries (breakaway outlook): ${entryError.message}`);
  return Boolean(entry);
}

// Et løb har én profil pr. etape (en grand tour ~21), så loftet er en sikkerhedsgrænse, ikke en trunkering.
const MAX_STAGE_PROFILES = 100;

/** Profiltypen for løbets næste etape (stages_completed-indeks i sorteret rækkefølge, som raceRunner), eller null. */
export async function loadNextStageProfileType({ supabase, race }) {
  const { data, error } = await supabase
    .from("race_stage_profiles").select("stage_number, profile_type").eq("race_id", race.id)
    .order("stage_number", { ascending: true }).limit(MAX_STAGE_PROFILES);
  if (error) throw new Error(`race_stage_profiles (breakaway outlook): ${error.message}`);
  const sorted = [...(data || [])].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));
  return sorted[Number(race.stages_completed) || 0]?.profile_type ?? null;
}

/**
 * Fingeraftryk af løbets startfelt (hold, rytter, rolle). Ændrer et hold sin udtagelse
 * eller rollefordeling, ændres aftrykket, og prognosen før etape 1 beregnes forfra.
 * Rækkefølge-uafhængigt; tomt felt giver sit eget aftryk.
 */
export function entriesFingerprint(rows) {
  const lines = (rows || []).map((r) => `${r?.team_id ?? ""}|${r?.rider_id ?? ""}|${r?.race_role ?? ""}`).sort();
  return `${lines.length}-${createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 16)}`;
}

export async function loadEntriesFingerprint({ supabase, raceId }) {
  const rows = await fetchAllRows(() => supabase
    .from("race_entries").select("team_id, rider_id, race_role").eq("race_id", raceId).order("rider_id", { ascending: true }));
  return entriesFingerprint(rows);
}

/** Forecast-seed k for (løb, etape). Aldrig løbets rigtige seed. */
export function outlookSeedString(raceId, stageNumber, k) {
  return `breakaway-outlook:${raceId}:${stageNumber}:${k}`;
}

// "k af n"-brøker vi viser. Tallet er en sandsynlighed fra et endeligt antal kørsler,
// så vi runder til en enkel brøk i stedet for at vise falsk præcision.
const FRACTIONS = [
  [1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [1, 3], [1, 2], [2, 3], [3, 4], [4, 5], [9, 10],
];

/**
 * Sandsynlighed → nærmeste viste brøk. 0 udbrudssejre → { under: 10 } ("under 1 af 10"),
 * fordi et endeligt antal kørsler uden sejr ikke beviser at chancen er nul.
 * Alle kørsler med sejr → { over: [9, 10] }.
 */
export function oddsFraction(wins, runs) {
  if (!Number.isInteger(runs) || runs <= 0 || !Number.isInteger(wins) || wins < 0 || wins > runs) return null;
  if (wins === 0) return { under: [1, 10] };
  if (wins === runs) return { over: [9, 10] };
  const p = wins / runs;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) {
    if (Math.abs(f[0] / f[1] - p) < Math.abs(best[0] / best[1] - p)) best = f;
  }
  return { about: best };
}

/**
 * Den korte årsag ("holdenes interesse"): hvor mange hold der typisk arbejder for at
 * hente udbruddet i de kørsler hvor det blev hentet. Median over de hentede kørsler.
 *  - "nobodyChases": udbruddet bliver sjældent hentet, eller ingen hold jager.
 *  - "fewChase": et eller to hold har grund til at jage.
 *  - "manyChase": flere hold har grund til at jage.
 */
export function chaseReason(samples) {
  const caught = samples.filter((s) => s.caught);
  if (caught.length * 2 < samples.length) return { kind: "nobodyChases" };
  const counts = caught.map((s) => s.chasingTeams).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  if (median <= 0) return { kind: "nobodyChases" };
  if (median <= 2) return { kind: "fewChase" };
  return { kind: "manyChase" };
}

/** Én motorkørsels udfald: vandt udbruddet, blev det hentet, og af hvor mange hold. */
export function sampleFromStageResult(res) {
  const events = res?.v4Output?.timeline?.events;
  const caughtEvents = Array.isArray(events) ? events.filter((e) => e?.type === "breakaway_caught") : [];
  const teams = new Set(caughtEvents.flatMap((e) => (Array.isArray(e?.params?.chasing_team_ids) ? e.params.chasing_team_ids : [])));
  const winner = Array.isArray(res?.ranked) ? res.ranked[0] : null;
  return {
    breakawayWin: winner?.breakaway_win === true,
    known: typeof winner?.breakaway_win === "boolean",
    caught: caughtEvents.length > 0,
    chasingTeams: teams.size,
  };
}

/** Samler kørslerne til svaret. Ukendt udfald i blot én kørsel → ingen chance. */
export function summarizeOutlook(samples) {
  if (!samples.length || samples.some((s) => !s.known)) return { available: false, reason: "engine_unsure" };
  const wins = samples.filter((s) => s.breakawayWin).length;
  return { available: true, runs: samples.length, odds: oddsFraction(wins, samples.length), chase: chaseReason(samples) };
}

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Motor-prognosen for løbets næste etape. Afhængigheder injiceres (tests); default er
 * den ægte afviklingssti i dryRun.
 *
 * @param {object} args
 * @param {object} args.race  races-rækken (id, season_id, stages, stages_completed, status, ...)
 * @param {Function} args.runDryStage  ({ stageIndex, resolveV4Engine }) => Promise — raceRunner.simulateStageByIndex(dryRun)
 * @param {Function} args.resolveRaceEngineV4  raceRunner.resolveRaceEngineV4
 */
export async function computeBreakawayOutlook({ race, runDryStage, resolveRaceEngineV4, seeds = OUTLOOK_SEEDS }) {
  if (!race?.id) return { available: false, reason: "no_race" };
  const totalStages = Number(race.stages) || 1;
  const stageIndex = Number(race.stages_completed) || 0;
  if (!raceHasNextStage(race)) return { available: false, reason: "race_done" };

  let engine = null;
  let captured = null;
  const resolveV4Engine = async (args) => {
    const resolved = await resolveRaceEngineV4(args);
    if (!resolved?.v4Engine) return resolved;
    engine = resolved.v4Engine;
    return {
      // Private taktik-ordrer indgår ikke i prognosen (se filhovedet).
      teamOrderRows: [],
      v4Engine: {
        ...engine,
        simulateStage: (stageArgs) => {
          captured = { ...stageArgs };
          // Legacy race_stage_roles effort is private too. Omit the override so
          // the existing bridge default and AI-order path apply unchanged.
          if (Array.isArray(stageArgs.entrants)) {
            captured.entrants = stageArgs.entrants.map((entrant) => {
              const forecastEntrant = { ...entrant };
              delete forecastEntrant.effort;
              return forecastEntrant;
            });
          }
          return engine.simulateStage({ ...captured, seedString: outlookSeedString(race.id, stageArgs.stageNumber, 0) });
        },
      },
    };
  };

  await runDryStage({ stageIndex, resolveV4Engine });
  if (!engine || !captured) return { available: false, reason: "engine_off" };
  if (!isS5ProfilesV3OrLater(captured.rulesRevision)) return { available: false, reason: "old_rules" };
  const profileType = captured.stageProfile?.profile_type;
  if (!profileType || NO_BREAKAWAY_PROFILES.has(profileType)) return { available: false, reason: "no_breakaway" };

  const samples = [];
  for (let k = 0; k < seeds; k++) {
    await yieldToLoop();
    const res = engine.simulateStage({ ...captured, seedString: outlookSeedString(race.id, captured.stageNumber, k) });
    samples.push(sampleFromStageResult(res));
  }
  // Etapenummeret kun for etapeløb; et endagsløb har kun én etape at tale om.
  return { ...summarizeOutlook(samples), ...(totalStages > 1 ? { stageNumber: captured.stageNumber } : {}), profileType };
}

// ── Cache + single-flight: én beregning pr. (løb, næste etape, startfelt) ad gangen,
// genbrugt i OUTLOOK_CACHE_TTL_MS. Nøglen indeholder stages_completed, så en kørt etape
// giver en ny prognose for den næste, og startfeltets fingeraftryk, så en ændret
// udtagelse før etape 1 giver en ny prognose.
//
// Fejl: den første kalder får fejlen (og rapporterer den); svaret huskes som
// OUTLOOK_ERROR i OUTLOOK_ERROR_TTL_MS, og samtidige/efterfølgende kald for samme nøgle
// får det uden ny beregning og uden ny rapport.
//
// Arbejdsloft på tværs af løb (Codex-review): én prognose kører ad gangen i hele
// processen, og højst OUTLOOK_MAX_QUEUED løb står i kø. Er køen fuld, svares
// { available: false, reason: "busy" } uden cache, så næste visning prøver igen.
export const OUTLOOK_MAX_QUEUED = 6;
const cache = new Map();
let workChain = Promise.resolve();
let queued = 0;

function runSerialized(compute) {
  queued += 1;
  const run = workChain.then(() => compute());
  workChain = run.then(() => {}, () => {}).finally(() => { queued -= 1; });
  return run;
}

export function outlookCacheKey(race, entriesKey = "") {
  return `${race?.id}:${Number(race?.stages_completed) || 0}:${entriesKey}`;
}

export async function getBreakawayOutlookCached({
  race, compute, entriesKey = "", now = Date.now,
  ttlMs = OUTLOOK_CACHE_TTL_MS, errorTtlMs = OUTLOOK_ERROR_TTL_MS, maxQueued = OUTLOOK_MAX_QUEUED,
}) {
  const key = outlookCacheKey(race, entriesKey);
  const hit = cache.get(key);
  if (hit && (hit.pending || now() - hit.at < hit.ttlMs)) return hit.pending ?? hit.value;
  if (queued >= maxQueued) return { available: false, reason: "busy" };
  const owned = runSerialized(compute).then(
    (value) => { cache.set(key, { at: now(), ttlMs, value }); return value; },
    (err) => { cache.set(key, { at: now(), ttlMs: errorTtlMs, value: OUTLOOK_ERROR }); throw err; },
  );
  // Samtidige kald for samme nøgle venter på samme beregning, men får fejlen som svar
  // (ikke som undtagelse), så kun den første kalder rapporterer den.
  cache.set(key, { at: now(), pending: owned.catch(() => OUTLOOK_ERROR) });
  return owned;
}

export function __resetBreakawayOutlookCache() {
  cache.clear();
  workChain = Promise.resolve();
  queued = 0;
}
