// Race Engine v3 (#2224), slice S5 — Season Planner cockpit: rene aggregat-hjælpere.
// Spec: docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md (§3/§5).
//
// REN lib (ingen DB/Date/Math.random): peak-status-udledning, etape-profil-resumé
// (terræn + summit finish), og rival-neutraliserings-optælling. Den impure
// orkestrering (routes/api.js GET /peak-plans/board) laver DB-opslaget + kalder
// disse med allerede-hentede rækker. "Nu" gives ind som CET-dag-ordinal (samme
// dag-enhed som racePeakPlans.js), så alt er deterministisk og testbart uden mock.
//
// Egnetheds-scoring (rytter mod løbs-demand) bor bevidst i frontend, som beregner
// den fra board'ets abilities + demandVector via en spejling af raceSimulator's
// terrainScore — det holder payloaden lille (én demand-vektor pr. løb frem for et
// N×M rangerings-kryds) og lader UI'et rangere/tooltip'e uden ekstra kald.

// Trænings-status-tærskel: en peak hvis realiserede træningskvalitet er under dette
// får "↓ Peak at risk"-chippen (spec §3A); over → "✓ Taper on track". Rundt tal,
// afstemt mod PEAK_TQ_FLOOR=0.2 (elendig optakt) og 1.0 (perfekt) — 0.6 er "klart i
// den gode halvdel". Præsentations-konstant (ikke score-balance), så den bor her.
export const PEAK_STATUS_ONTRACK_TQ = 0.6;

/**
 * Status for en peak set fra Planneren (spec §3A trænings-status-chip).
 * - "pending"  : optakts-vinduet er ikke begyndt endnu → tq er ren prognose.
 * - "on_track" : optakten kører + træningskvalitet ≥ tærskel.
 * - "at_risk"  : optakten kører + træningskvalitet < tærskel (utilstrækkelig træning).
 * "Nu" og vindue-start er CET-dag-ordinaler; optakten begynder leadupDays før start.
 *
 * @param {{trainingQuality:number|null, todayOrdinal:number, windowStartOrdinal:number|null, leadupDays:number, onTrackTq?:number}} args
 * @returns {"pending"|"on_track"|"at_risk"}
 */
export function peakStatus({ trainingQuality, todayOrdinal, windowStartOrdinal, leadupDays, onTrackTq = PEAK_STATUS_ONTRACK_TQ }) {
  const start = Number(windowStartOrdinal);
  const now = Number(todayOrdinal);
  if (Number.isFinite(start) && Number.isFinite(now) && now < start - leadupDays) {
    return "pending";
  }
  if (trainingQuality == null) return "pending";
  const tq = Number(trainingQuality);
  if (!Number.isFinite(tq)) return "pending";
  return tq >= onTrackTq ? "on_track" : "at_risk";
}

// profile_type → kort terræn-nøgle til Planner-kalenderen (samme buckets som race-
// hub'ens chips, men lokalt så libben ikke afhænger af raceCalendar's interne map).
const PROFILE_TERRAIN = Object.freeze({
  flat: "flat",
  rolling: "hilly",
  hilly: "hilly",
  mountain: "mountain",
  high_mountain: "mountain",
  itt: "itt",
  ttt: "ttt",
  cobbles: "cobbles",
  classic: "hilly",
});

/**
 * Kort terræn-nøgle for en etape-profil (default "flat" ved ukendt/manglende).
 * @param {string|null} profileType
 * @returns {"flat"|"hilly"|"mountain"|"itt"|"ttt"|"cobbles"}
 */
export function terrainKey(profileType) {
  return PROFILE_TERRAIN[profileType] || "flat";
}

// Etaper der ender på toppen af en stigning (spec §8.1 "summit finishes"). En summit
// finish = bjerg-profil ELLER en finale der afgøres på en lang stigning.
const SUMMIT_PROFILES = new Set(["mountain", "high_mountain"]);
const SUMMIT_FINALES = new Set(["long_climb"]);

/**
 * Er en etape en summit finish? (bjerg-profil eller lang-klatrings-finale.)
 * @param {string|null} profileType
 * @param {string|null} finaleType
 * @returns {boolean}
 */
export function isSummitFinish(profileType, finaleType) {
  return SUMMIT_PROFILES.has(profileType) || SUMMIT_FINALES.has(finaleType);
}

/**
 * Normalisér et løbs etape-profil-rækker → sorteret [{stage, terrain, summit}] til
 * race-skuffens etape-strip (progressive disclosure, Option B). Sorteret efter
 * stage_number for stabil rendering.
 * @param {Array<{stage_number?:number, profile_type?:string, finale_type?:string}>} rows
 * @returns {Array<{stage:number, terrain:string, summit:boolean}>}
 */
export function stageProfileStrip(rows) {
  return (rows || [])
    .slice()
    .sort((a, b) => (a.stage_number ?? 0) - (b.stage_number ?? 0))
    .map((r) => ({
      stage: r.stage_number ?? 1,
      terrain: terrainKey(r.profile_type),
      summit: isSummitFinish(r.profile_type, r.finale_type),
    }));
}

/**
 * Kort menneske-læsbar profil-resumé-nøgletal for et løb (frontend formaterer copy).
 * @param {Array<{stage:number, summit:boolean}>} strip
 * @returns {{stages:number, summitFinishes:number}}
 */
export function raceProfileSummary(strip) {
  const s = strip || [];
  return { stages: s.length, summitFinishes: s.filter((x) => x.summit).length };
}

/**
 * Rival-neutralisering (spec §3B): antal DISTINKTE rival-hold (ikke mit) der topper
 * hvert løb. Ren optælling over (target_race_id, team_id)-rækker for hele sæsonens
 * peak-planer — service_role-læsningen ser alle holds planer, denne funktion tæller.
 * @param {Array<{target_race_id:string|null, team_id:string|null}>} rows
 * @param {string} myTeamId
 * @returns {Map<string, number>}  race_id → antal rival-hold
 */
export function countRivalPeaks(rows, myTeamId) {
  const byRace = new Map();
  for (const row of rows || []) {
    const raceId = row.target_race_id;
    if (!raceId || !row.team_id || row.team_id === myTeamId) continue;
    if (!byRace.has(raceId)) byRace.set(raceId, new Set());
    byRace.get(raceId).add(row.team_id);
  }
  const out = new Map();
  for (const [raceId, teams] of byRace) out.set(raceId, teams.size);
  return out;
}
