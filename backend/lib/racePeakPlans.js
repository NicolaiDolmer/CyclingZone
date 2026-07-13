// Race Engine v3 (#2224), slice S5 — I/O + resolution for form-peaks.
//
// Co-location-mønster som raceStageRoles.js: den impure loader bor her, men
// dato→ordinal-konvertering + resolution er REN og testbar uden supabase-mock.
//
// Motoren (racePeaks.js) er ENHEDS-AGNOSTISK (dag-ints); DENNE fil vælger dag-
// enheden: CET-kalenderdag-ordinal — PRÆCIS samme skala som raceBinding.js's
// binding-vindue (cetDayOrdinal). Derfor er en etapes scheduled_at (timestamptz)
// og et peak-vindues DATO-grænser (rider_peak_plans.window_start/end, date-
// kolonner) sammenlignelige heltal. UTC-midnat for en dato er altid et multiplum
// af DAY_MS → divisionen giver et eksakt heltal (samme argument som raceBinding).
//
// KRITISK INVARIANT (raceRunner.js's ansvar, ikke denne fils): peak-kontekst
// hentes/anvendes KUN når race_engine_v3_scoring er ON — flag-off skal forblive
// bit-identisk med motoren før S5 (samme mønster som S1-S4's øvrige v3-seams).

import { copenhagenDateString } from "./copenhagenTime.js";
import { RACE_V3_TUNING } from "./raceRoles.js";
import { TRAINING_FOCUSES } from "./training.js";
import { trainingQualityForWindow } from "./racePeaks.js";

const DAY_MS = 86_400_000;

// PostgREST .in() encoder id-listen i URL'en — hold chunks små nok til at undgå
// 414/proxy-grænser (samme hensyn som raceRunner.js's batchede id-opslag).
const IN_CHUNK = 200;

/**
 * "YYYY-MM-DD" (date-kolonne) → CET-kalenderdag-ordinal (heltal). Ugyldig → null.
 * @param {string} dateStr
 * @returns {number|null}
 */
export function dateStringToOrdinal(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / DAY_MS : null;
}

/**
 * CET-kalenderdag-ordinal → "YYYY-MM-DD" (invers af dateStringToOrdinal). Til
 * query-grænser på date-kolonner (training_day_runs.tick_date). Ugyldig → null.
 * @param {number} ordinal
 * @returns {string|null}
 */
export function ordinalToDateString(ordinal) {
  if (ordinal == null) return null;
  const n = Number(ordinal);
  if (!Number.isFinite(n)) return null;
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * scheduled_at (timestamptz) → CET-kalenderdag-ordinal. Vi udleder den DANSKE
 * kalenderdato (DST-robust, præcis samme metode som raceBinding.cetDayOrdinal) og
 * mapper den til ordinalen — så et etape-tidspunkt kl. 23:30 CET lander på den
 * danske dag, ikke UTC-dagen. Ugyldig → null.
 * @param {string} scheduledAt
 * @returns {number|null}
 */
export function scheduledAtToOrdinal(scheduledAt) {
  const ms = Date.parse(scheduledAt);
  if (!Number.isFinite(ms)) return null;
  return dateStringToOrdinal(copenhagenDateString(new Date(ms)));
}

/**
 * Reducér en rytters optakts-dags-entries (report.riders-linjer der falder i
 * optaktsvinduet) → { trainedDays, focusCounts }. Ren. "rest"-status tæller ikke
 * som en trænet dag (konsistens-signalet); trænede dages fokus tælles op til
 * fokus-match-signalet.
 * @param {Array<{status?:string, focus?:string}>} riderDayEntries
 * @returns {{trainedDays:number, focusCounts:Record<string,number>}}
 */
export function summarizeLeadupTraining(riderDayEntries) {
  let trainedDays = 0;
  const focusCounts = {};
  for (const e of riderDayEntries || []) {
    if (!e || e.status === "rest") continue;
    trainedDays++;
    if (e.focus) focusCounts[e.focus] = (focusCounts[e.focus] || 0) + 1;
  }
  return { trainedDays, focusCounts };
}

/**
 * Gennemsnit af et mål-løbs etape-demand-vektorer → ét aggregeret demand (evne→
 * vægt). Ren. Fokus-match måles mod dette (raceAutopick.suitabilityScore
 * gennemsnitter terrainScore over etaper på samme vis). Ingen gyldige → null.
 * @param {Array<{demand_vector?:Record<string,number>}>} stageProfiles
 * @returns {Record<string,number>|null}
 */
export function aggregateDemandVector(stageProfiles) {
  const sum = {};
  let n = 0;
  for (const s of stageProfiles || []) {
    const dv = s?.demand_vector;
    if (!dv || typeof dv !== "object") continue;
    n++;
    for (const [k, v] of Object.entries(dv)) {
      const w = Number(v);
      if (Number.isFinite(w)) sum[k] = (sum[k] || 0) + w;
    }
  }
  if (n === 0) return null;
  for (const k of Object.keys(sum)) sum[k] /= n;
  return sum;
}

/**
 * Indlæs de involverede holds training_day_runs i et dato-interval → normaliseret
 * form { team_id, ord, riderMap: Map(rider_id → {status, focus}) }. report.riders
 * pakkes ud pr. dag, så orkestratoren kan slå en rytters dag-entry op i O(1).
 * @param {{supabase, teamIds:string[], startDate:string, endDate:string}} args
 * @returns {Promise<Array<{team_id:string, ord:number, riderMap:Map}>>}
 */
export async function loadTeamTrainingRuns({ supabase, teamIds, startDate, endDate }) {
  const out = [];
  const ids = [...new Set(teamIds || [])];
  if (!ids.length || !startDate || !endDate) return out;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("training_day_runs")
      .select("team_id, tick_date, report")
      .in("team_id", slice)
      .gte("tick_date", startDate)
      .lt("tick_date", endDate);
    if (error) throw new Error(`training_day_runs (peak leadup): ${error.message}`);
    for (const row of data || []) {
      const ord = dateStringToOrdinal(row.tick_date);
      if (ord == null) continue;
      const riderMap = new Map();
      for (const r of row.report?.riders || []) {
        if (r?.rider_id) riderMap.set(r.rider_id, { status: r.status, focus: r.focus });
      }
      out.push({ team_id: row.team_id, ord, riderMap });
    }
  }
  return out;
}

/**
 * rider_condition for de angivne ryttere → Map(rider_id → {injured_until, fatigue}).
 * @param {{supabase, riderIds:string[]}} args
 * @returns {Promise<Map<string,{injured_until:string|null, fatigue:number}>>}
 */
export async function loadRiderConditions({ supabase, riderIds }) {
  const out = new Map();
  const ids = [...new Set(riderIds || [])];
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("rider_condition")
      .select("rider_id, injured_until, fatigue")
      .in("rider_id", slice);
    if (error) throw new Error(`rider_condition (peak): ${error.message}`);
    for (const row of data || []) {
      out.set(row.rider_id, { injured_until: row.injured_until ?? null, fatigue: row.fatigue });
    }
  }
  return out;
}

/**
 * Aggregeret demand_vector pr. mål-løb → Map(race_id → demandVector|null).
 * @param {{supabase, raceIds:string[]}} args
 * @returns {Promise<Map<string, Record<string,number>|null>>}
 */
export async function loadTargetRaceDemands({ supabase, raceIds }) {
  const out = new Map();
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("race_stage_profiles")
      .select("race_id, demand_vector")
      .in("race_id", slice);
    if (error) throw new Error(`race_stage_profiles (peak target): ${error.message}`);
    const byRace = new Map();
    for (const row of data || []) {
      if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
      byRace.get(row.race_id).push({ demand_vector: row.demand_vector });
    }
    for (const [raceId, profiles] of byRace) out.set(raceId, aggregateDemandVector(profiles));
  }
  return out;
}

/**
 * Kobling-resolveren (erstatter S5-wiring-increment'ets dormant loft-seam):
 * beregner rytterens ÆGTE traeningskvalitet PR. PEAK-VINDUE (addendum §2) ud fra
 * fire optakts-signaler over et PEAK_LEADUP_DAYS-vindue FØR hvert vindue —
 * konsistens (training_day_runs), fokus-match (mål-løbets demand_vector), sundhed
 * (rider_condition.injured_until) og trætheds-styring (rider_condition.fatigue) —
 * og MUTERER hvert vindue i peakPlansByRider med `.trainingQuality`. Batch-loader
 * (ét kald pr. tabel for HELE feltet, samme mønster som loadPeakPlans), pure
 * per-vindue-vægtning via racePeaks.trainingQualityForWindow.
 *
 * Kaldes KUN når v3=true (raceRunner.attachPeakContext), efter loadPeakPlans.
 * Sub-loaderne er injectable (default = de ægte) så orkestreringen kan testes uden
 * DB-mock. Ingen vinduer → ingen loader-kald (bit-identisk med v3-uden-plan).
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Array<{rider_id:string, team_id:string}>} args.entrants
 * @param {Map<string, Array<{start:number,end:number,targetRaceId:string|null}>>} args.peakPlansByRider
 * @param {object} [args.tuning=RACE_V3_TUNING]
 * @param {Record<string,string[]>} [args.focusAbilitiesMap=TRAINING_FOCUSES]
 * @returns {Promise<void>}  muterer peakPlansByRider's vinduer in-place
 */
export async function resolvePeakTrainingQualities({
  supabase,
  entrants,
  peakPlansByRider,
  tuning = RACE_V3_TUNING,
  focusAbilitiesMap = TRAINING_FOCUSES,
  loadTeamTrainingRuns: loadRunsFn = loadTeamTrainingRuns,
  loadRiderConditions: loadCondFn = loadRiderConditions,
  loadTargetRaceDemands: loadDemandsFn = loadTargetRaceDemands,
}) {
  const leadup = tuning.PEAK_LEADUP_DAYS;
  // Ryttere med mindst ét vindue + deres hold (fra entrants).
  const withPlans = [];
  for (const e of entrants || []) {
    const windows = peakPlansByRider?.get(e.rider_id);
    if (windows?.length) withPlans.push({ riderId: e.rider_id, teamId: e.team_id, windows });
  }
  if (!withPlans.length) return; // intet at gøre — ingen loader-kald

  // Union-dato-interval for ALLE optaktsvinduer (min start − leadup … max start).
  let minLeadupStart = Infinity, maxWinStart = -Infinity;
  const teamIds = new Set(), riderIds = new Set(), raceIds = new Set();
  for (const { riderId, teamId, windows } of withPlans) {
    riderIds.add(riderId);
    if (teamId) teamIds.add(teamId);
    for (const w of windows) {
      if (w.start == null) continue;
      minLeadupStart = Math.min(minLeadupStart, w.start - leadup);
      maxWinStart = Math.max(maxWinStart, w.start);
      if (w.targetRaceId) raceIds.add(w.targetRaceId);
    }
  }
  const startDate = ordinalToDateString(minLeadupStart);
  const endDate = ordinalToDateString(maxWinStart); // eksklusiv: optakt slutter dagen før vinduets start

  const [runs, condByRider, demandByRace] = await Promise.all([
    loadRunsFn({ supabase, teamIds: [...teamIds], startDate, endDate }),
    loadCondFn({ supabase, riderIds: [...riderIds] }),
    loadDemandsFn({ supabase, raceIds: [...raceIds] }),
  ]);

  // Indeksér runs pr. hold: Map(team_id → Array<{ord, riderMap}>).
  const runsByTeam = new Map();
  for (const r of runs || []) {
    if (!runsByTeam.has(r.team_id)) runsByTeam.set(r.team_id, []);
    runsByTeam.get(r.team_id).push(r);
  }

  for (const { riderId, teamId, windows } of withPlans) {
    const cond = condByRider.get(riderId) || {};
    const teamRuns = runsByTeam.get(teamId) || [];
    for (const w of windows) {
      if (w.start == null || w.end == null) continue;
      const leadupStart = w.start - leadup;
      const leadupEnd = w.start; // eksklusiv
      // Rytterens dag-entries for de optakts-dage hvor holdet kørte et tick.
      const dayEntries = [];
      for (const run of teamRuns) {
        if (run.ord < leadupStart || run.ord >= leadupEnd) continue;
        const entry = run.riderMap.get(riderId);
        if (entry) dayEntries.push(entry);
      }
      const { trainedDays, focusCounts } = summarizeLeadupTraining(dayEntries);
      w.trainingQuality = trainingQualityForWindow({
        trainedDays,
        leadupDays: leadup,
        focusCounts,
        demandVector: w.targetRaceId ? demandByRace.get(w.targetRaceId) : null,
        focusAbilitiesMap,
        injuredUntil: cond.injured_until != null ? dateStringToOrdinal(cond.injured_until) : null,
        leadupStart,
        leadupEnd,
        fatigue: cond.fatigue,
      }, tuning);
    }
  }
}

/**
 * Map<stage_number, ordinal> for et løbs etaper — giver simulateStage en 'peakDay'
 * pr. etape. Manglende/ugyldig schedule-række → etapen udelades af mappen (peak=0
 * dér, defensivt som andre manglende-data-guards i motoren).
 *
 * @param {{supabase, raceId: string}} args
 * @returns {Promise<Map<number, number>>}
 */
export async function loadStageDayOrdinals({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_stage_schedule")
    .select("stage_number, scheduled_at")
    .eq("race_id", raceId);
  if (error) throw new Error(`race_stage_schedule (peak days): ${error.message}`);
  const out = new Map();
  for (const row of data || []) {
    const ord = scheduledAtToOrdinal(row.scheduled_at);
    if (ord != null) out.set(row.stage_number, ord);
  }
  return out;
}

/**
 * Indlæs aktive peak-planer for en sæson, grupperet rider_id → [{start,end,
 * targetRaceId}] i CET-ordinaler. Ubetinget hentning for de angivne ryttere
 * (motoren skal se HELE feltets planer, ikke kun ét holds — som loadStageRole-
 * Overrides). window_start/end konverteres til ordinaler her, så racePeaks får
 * rene dag-ints. Ugyldige datoer → planen udelades.
 *
 * @param {{supabase, seasonId: string, riderIds: string[]}} args
 * @returns {Promise<Map<string, Array<{start:number,end:number,targetRaceId:string|null}>>>}
 */
export async function loadPeakPlans({ supabase, seasonId, riderIds }) {
  const out = new Map();
  if (!seasonId || !riderIds?.length) return out;
  const ids = [...new Set(riderIds)];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("rider_peak_plans")
      .select("rider_id, window_start, window_end, target_race_id")
      .eq("season_id", seasonId)
      .in("rider_id", slice);
    if (error) throw new Error(`rider_peak_plans: ${error.message}`);
    for (const row of data || []) {
      const start = dateStringToOrdinal(row.window_start);
      const end = dateStringToOrdinal(row.window_end);
      if (start == null || end == null) continue;
      if (!out.has(row.rider_id)) out.set(row.rider_id, []);
      out.get(row.rider_id).push({ start, end, targetRaceId: row.target_race_id ?? null });
    }
  }
  return out;
}

/**
 * Deterministisk, sorteret fladliste af peak-inputs for et løbs entrants — til
 * input_checksum (samme rolle som serializeStageRoleOverrides). Kun entrants MED
 * vinduer inkluderes, så payloaden er bagudkompatibel når ingen planer findes
 * (eksisterende v3-runs uden peaks beholder deres checksum). traeningskvalitet er
 * PR. VINDUE (addendum §2) → serialiseres som [start, end, tq] pr. vindue; tq
 * afrundes til 6 decimaler (float-stabil nøgle), manglende → 1.
 *
 * @param {Array<{rider_id:string, peakWindows?:Array<{start:number,end:number,trainingQuality?:number}>}>} simEntrants
 * @returns {Array<[string, Array<[number,number,number]>]>}
 */
export function serializePeakInputs(simEntrants) {
  const out = [];
  for (const e of simEntrants || []) {
    const windows = e.peakWindows || [];
    if (!windows.length) continue;
    const w = windows
      .map((x) => [x.start, x.end, Math.round((Number(x.trainingQuality ?? 1) || 0) * 1e6) / 1e6])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    out.push([e.rider_id, w]);
  }
  out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return out;
}
