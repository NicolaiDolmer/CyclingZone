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
 * INJICERBAR seam: rytterens traeningskvalitet ∈ [0,1] i optakten til et peak-
 * vindue. DENNE increment (S5-wiring) wirer peak/payback-VINDUE-mekanikken; DB-
 * signal-udledningen (konsistens/fokus-match/sundhed/trætheds-styring over et
 * PEAK_LEADUP_DAYS-optaktsvindue via racePeaks.computeTrainingQuality) lander i
 * NÆSTE increment SAMMEN med koblings-scorecardet der kalibrerer den. Indtil da:
 * loft (tq=1) = ren vindue-mekanik.
 *
 * Dette er PRÆCIS samme dormant-seam-mønster som S1's effort-kobling (raceRoles.js
 * FATIGUE_MULTIPLIER-kommentaren: raceRunner kaldte ind med effort='normal' indtil
 * S3 fyldte rigtige værdier ind). SIKKERT at shippe loft-only: peak virker kun når
 * en rytter har en rider_peak_plans-række, og hverken API'et (byggerækkefølge §7
 * step 3) eller Planner-UI'et (step 5) der SKABER dem findes endnu → 0 planer i
 * prod → peak=0 for alle. Koblings-resolveren lander FØR planer kan skabes.
 *
 * @returns {number} traeningskvalitet ∈ [0,1]
 */
export function resolvePeakTrainingQuality(/* { riderId } */) {
  return 1;
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
 * (eksisterende v3-runs uden peaks beholder deres checksum). Vinduer sorteres
 * pr. rytter; trainingQuality afrundes til 6 decimaler (float-stabil nøgle).
 *
 * @param {Array<{rider_id:string, peakWindows?:Array<{start:number,end:number}>, peakTrainingQuality?:number}>} simEntrants
 * @returns {Array<[string, Array<[number,number]>, number]>}
 */
export function serializePeakInputs(simEntrants) {
  const out = [];
  for (const e of simEntrants || []) {
    const windows = e.peakWindows || [];
    if (!windows.length) continue;
    const w = windows
      .map((x) => [x.start, x.end])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const tq = Math.round((Number(e.peakTrainingQuality ?? 1) || 0) * 1e6) / 1e6;
    out.push([e.rider_id, w, tq]);
  }
  out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return out;
}
