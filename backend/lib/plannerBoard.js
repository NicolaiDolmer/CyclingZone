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
//
// Eneste afhængighed er motorens tuning-konstanter (rene tal, ingen I/O) — samme
// import som racePeaks.js bruger. Konsekvens-omregningen nedenfor SKAL afledes af
// dem frem for at være hardkodet.

import { RACE_V3_TUNING } from "./raceRoles.js";

// Trænings-status-tærskel: en peak hvis realiserede træningskvalitet er under dette
// får "↓ Peak at risk"-chippen (spec §3A); over → "✓ Taper on track". Rundt tal,
// afstemt mod PEAK_TQ_FLOOR=0.2 (elendig optakt) og 1.0 (perfekt) — 0.6 er "klart i
// den gode halvdel". Præsentations-konstant (ikke score-balance), så den bor her.
export const PEAK_STATUS_ONTRACK_TQ = 0.6;

// ── Konsekvens i formpoint (#2905) ──────────────────────────────────────────
//
// Motoren regner i score-space: form bidrager ((form−50)/50)×FORM_RACE_WEIGHT_V3,
// og en peak adderer PEAK_MAX×traeningskvalitet oveni. De tal betyder intet for en
// manager. Formpoint gør: han læser allerede 0-100-formen i sin trup, så "denne peak
// er +24" er en størrelse han kan sammenligne med rytterens egen form.
//
// Omregningen afledes af konstanterne frem for at blive skrevet i en tekststreng.
// Ellers divergerer copy'en i samme øjeblik balancen tunes — PEAK_MAX-kommentaren i
// raceRoles.js siger selv at værdierne er startkandidater indtil S5-harness-sweepet.
// Det er samme fejlklasse som #3071 (to alders-formler der var ens indtil de ikke var).

/**
 * Score-space-komponent → formpoint. Ét formpoint bidrager
 * FORM_RACE_WEIGHT_V3/50 til finalScore, så en komponent svarer til
 * komponent ÷ (vægt/50) formpoint. Vægt 0 (flag/env-override) → null frem for
 * en division med nul.
 *
 * @param {number} component  score-space-bidrag (fortegnsbærende)
 * @param {object} [tuning]
 * @returns {number|null}  afrundet til hele formpoint (spiller-vendt enhed)
 */
export function scoreComponentToFormPoints(component, tuning = RACE_V3_TUNING) {
  const weight = Number(tuning?.FORM_RACE_WEIGHT_V3);
  const c = Number(component);
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(c)) return null;
  return Math.round((c * 50) / weight);
}

/**
 * Hvad en peak er værd, i formpoint — gulvet, loftet, det aktuelle estimat, og
 * hvad den koster bagefter. Ét objekt pr. peak, så UI'et kan vise hele spændet
 * (ejer-valg 27/7: option C) uden selv at kende motorens konstanter.
 *
 * `trainingQuality` er PR. VINDUE (racePeaks addendum §2) og ligger i
 * [PEAK_TQ_FLOOR, 1] efter computeTrainingQuality's clamp. Er den endnu ukendt
 * (optakten er ikke begyndt), er `current` null — spændet gulv..loft står alene,
 * hvilket er den ærlige tilstand på planlægningstidspunktet.
 *
 * @param {{trainingQuality?:number|null, tuning?:object}} [args]
 * @returns {{floor:number|null, ceiling:number|null, current:number|null, payback:number|null}}
 */
export function peakValueFormPoints({ trainingQuality = null, tuning = RACE_V3_TUNING } = {}) {
  const max = Number(tuning?.PEAK_MAX);
  const tqFloor = Number(tuning?.PEAK_TQ_FLOOR);
  const ceiling = scoreComponentToFormPoints(max, tuning);
  const floor = scoreComponentToFormPoints(max * tqFloor, tuning);
  const payback = scoreComponentToFormPoints(-Number(tuning?.PEAK_PAYBACK), tuning);

  let current = null;
  const tq = Number(trainingQuality);
  if (trainingQuality != null && Number.isFinite(tq)) {
    // Samme clamp som computeTrainingQuality, så et rå-signal udefra ikke kan
    // vise en værdi motoren aldrig ville realisere.
    const clamped = Math.min(1, Math.max(tqFloor, tq));
    current = scoreComponentToFormPoints(max * clamped, tuning);
  }
  return { floor, ceiling, current, payback };
}

/**
 * Payback-kollisioner: hvilke af rytterens ANDRE løb falder i formhullet efter en
 * peak? Det er den beslutning planlæggeren i dag slet ikke understøtter — man
 * sætter en peak uden at kunne se at man betaler for den i et løb man også vil vinde.
 *
 * Payback-vinduet er de PEAK_PAYBACK_DAYS dage EFTER peak-vinduets sidste dag
 * (samme afgrænsning som racePeaks.peakPhaseForWindow, der regner payback fra
 * end+1 til end+paybackDays). Ren funktion: kalderen leverer allerede-hentede
 * ordinaler, ingen DB her.
 *
 * @param {object} [args]
 * @param {Array<{targetRaceId?:string|null, endOrdinal:number}>} [args.windows]  rytterens peak-vinduer
 * @param {Array<{raceId:string, ord:number}>} [args.otherRaces]  løb rytteren er udtaget til (ikke peak-målene selv)
 * @param {object} [args.tuning]
 * @returns {Array<{peakTargetRaceId:string|null, raceId:string, daysAfterPeak:number}>}  kronologisk
 */
export function findPaybackCollisions({ windows = [], otherRaces = [], tuning = RACE_V3_TUNING } = {}) {
  const paybackDays = Number(tuning?.PEAK_PAYBACK_DAYS);
  if (!Number.isFinite(paybackDays) || paybackDays <= 0) return [];
  const hits = [];
  for (const w of windows) {
    const end = Number(w?.endOrdinal);
    if (!Number.isFinite(end)) continue;
    for (const r of otherRaces) {
      const ord = Number(r?.ord);
      if (!Number.isFinite(ord)) continue;
      const daysAfterPeak = ord - end;
      if (daysAfterPeak < 1 || daysAfterPeak > paybackDays) continue;
      hits.push({ peakTargetRaceId: w?.targetRaceId ?? null, raceId: r.raceId, daysAfterPeak });
    }
  }
  return hits.sort((a, b) =>
    a.daysAfterPeak - b.daysAfterPeak || String(a.raceId).localeCompare(String(b.raceId))
  );
}

/**
 * Er holdets division KENDT for den sæson planlæggeren kigger på? (#3018)
 *
 * `teams.league_division_id` beskriver holdets placering i den AKTIVE sæson. Den
 * siger intet om en sæson der endnu ikke er startet: op/nedrykning (og S1→S2's
 * pyramide-komprimering, #2851) afgøres først ved sæsonskiftet, og rangeringen
 * sker på season_standings der stadig flytter sig mens sæsonens sidste løb kører.
 *
 * Derfor er den nuværende division IKKE en gyldig kilde for en 'upcoming' sæson.
 * Målt 26/7 mod prod: 140 af 156 ægte managerhold lander i en ANDEN pulje i S2 —
 * at bruge den nuværende division ville vise den forkerte kalender til ~90 %.
 *
 * Gaten ophæver sig selv ved cutoveren uden ny deploy: compressPyramid.js skriver
 * de nye league_division_id FØR transitionen promoverer sæsonen 'upcoming' →
 * 'active' (se scripts/compressPyramid.js's topkommentar), så i det øjeblik
 * status flipper, er holdets division både opdateret og korrekt.
 *
 * @param {string|null|undefined} seasonStatus  seasons.status for den valgte sæson
 * @returns {boolean}
 */
export function teamDivisionKnownForSeason(seasonStatus) {
  return seasonStatus !== "upcoming";
}

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
