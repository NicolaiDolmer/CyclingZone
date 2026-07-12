// Race Engine v3 (#2224), slice S4 (#1176) — styrt/mekaniske uheld + DNF.
//
// Pr.-rytter seeded uheldsmodel: hit-sandsynlighed afhænger af etapeprofil,
// finale (descent-multiplikator) og rytterens positioning-evne (dæmper hittet).
// Et hit falder enten som time_loss (sekunder lagt til stageGap) eller abandon
// (rytteren udgår resten af løbet = DNF; ingen etape-række → automatisk
// GC-eksklusion via raceClassifications.filterCompletedEntrants).
//
// Determinisme-regler (spec §5, samme mønster som raceDayForm.js S2):
//   - PER-RYTTER-HASHET: hver rytters udfald afledes af (stageSeed, rider_id)
//     alene — én tilmelding mere i feltet kan ALDRIG flytte en anden rytters
//     uheldsudfald.
//   - DEDIKERET rng-stream ("incident:"-præfiks) — konsumerer INTET fra
//     simulateStage's main rng, så noise/breakaway-sekvenserne er upåvirkede.
//   - Ren lib (rollIncidents/incidentProbability): ingen DB/fs/Math.random/Date.
//     loadAbandonedRiderIds (I/O) bor her af co-location, spejler
//     raceStageRoles.js's mønster (ren lib + én DB-loader i samme fil).
//
// Alle balance-konstanter bor i RACE_V3_TUNING (raceRoles.js) — én tunings-flade.

import { makeRng } from "./fictionalRiderGenerator.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

// Lokal FNV-1a 32-bit (samme algoritme/kontrakt som raceSimulator.stableSeed —
// duplikeret bevidst for at undgå cyklisk import raceSimulator ⇄ raceIncidents,
// spejler raceDayForm.js's samme duplikation).
function fnv1a32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * p(uheld) for én rytter på én etape: basis (profil) × descent-finale-
 * multiplikator × positioning-dæmpning. Ren, deterministisk.
 *
 * @param {{stageProfile:{profile_type:string, finale_type?:string}, positioning?:number|null, tuning?:object}} args
 *   tuning: test-/sweep-override (default tunings-fladen) — bevidst læst FRA
 *   dette argument (ikke raceRoles.incidentBaseProbability's globale lookup),
 *   så et override af tuning.INCIDENT_BASE_BY_PROFILE i tests/harness faktisk
 *   ændrer p (samme mønster som raceDayForm.jourSansProbability's `t`-param).
 * @returns {number} sandsynlighed ∈ [0, ∞) i praksis lille (base ≤ ~0.025 × 1.5 = 0.0375)
 */
export function incidentProbability({ stageProfile, positioning = null, tuning = RACE_V3_TUNING } = {}) {
  const map = tuning.INCIDENT_BASE_BY_PROFILE;
  const raw = map[stageProfile?.profile_type];
  const base = Number.isFinite(raw) ? raw : map._default;
  const descentMult = stageProfile?.finale_type === "descent" ? tuning.INCIDENT_DESCENT_FINALE_MULT : 1;
  const pos = Number.isFinite(Number(positioning)) ? clamp(Number(positioning), 0, 99) : 0;
  const reduction = tuning.INCIDENT_POSITIONING_MAX_REDUCTION * (pos / 99);
  return base * descentMult * (1 - reduction);
}

/**
 * Rul uheld for ét felt på ÉN etape. Pr. rytter: dedikeret rng-stream
 * (`incident:${stageSeed}:${riderId}`) — u1 = Bernoulli-hit vs. p; på hit:
 * u2 = udfald (abandon vs. time_loss), u3 = art (crash vs. mechanical),
 * u4 = magnitude (sekunder eller skadedage). Rækkefølgen er FAST, så en
 * senere ændring af p/tuning aldrig flytter en ANDEN rytters draw-sekvens
 * (streamen er per-rytter, uafhængig af andre riders behandlingsrækkefølge).
 *
 * CAP: hvis antallet af hits overstiger ⌈INCIDENT_MAX_FIELD_SHARE × felt⌉,
 * beholdes kun de MEST AFGØRENDE hits (lavest u1) — deterministisk hard bound,
 * stabil tiebreak på rider_id.
 *
 * @param {{entrants:Array<{rider_id:string, abilities?:{positioning?:number}}>, stageProfile:object, stageSeed:number, tuning?:object}} args
 * @returns {Array<{rider_id:string, kind:'crash'|'mechanical', outcome:'time_loss'|'abandon', time_loss_seconds:number|null, injury_days:number|null, u:number}>}
 */
export function rollIncidents({ entrants = [], stageProfile, stageSeed, tuning = RACE_V3_TUNING } = {}) {
  if (!Number.isInteger(stageSeed)) throw new Error("stageSeed (integer) required");
  if (!stageProfile) return [];

  // Stabil rider_id-orden — rng-sekvensen (hvilken rytter behandles hvornår) er
  // uafhængig af input-rækkefølge, men hver rytters EGET udfald er alligevel
  // 100% bestemt af sin egen (stageSeed, rider_id)-stream, ikke af naboerne.
  const ordered = [...entrants].sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)));

  const hits = [];
  for (const e of ordered) {
    const p = incidentProbability({ stageProfile, positioning: e?.abilities?.positioning, tuning });
    if (p <= 0) continue;
    const rng = makeRng(fnv1a32(`incident:${stageSeed >>> 0}:${e.rider_id}`));
    const u1 = rng();
    if (u1 >= p) continue; // intet hit — INGEN yderligere draws for denne rytter (bevarer streamens korthed)

    const u2 = rng();
    const outcome = u2 < tuning.INCIDENT_ABANDON_SHARE ? "abandon" : "time_loss";
    const u3 = rng();
    const kind = u3 < tuning.INCIDENT_MECHANICAL_SHARE ? "mechanical" : "crash";
    const u4 = rng();

    let time_loss_seconds = null;
    let injury_days = null;
    if (outcome === "time_loss") {
      time_loss_seconds = Math.round(
        tuning.INCIDENT_TIME_LOSS_MIN_S + u4 * (tuning.INCIDENT_TIME_LOSS_MAX_S - tuning.INCIDENT_TIME_LOSS_MIN_S)
      );
    } else {
      injury_days = Math.round(
        tuning.INCIDENT_INJURY_MIN_DAYS + u4 * (tuning.INCIDENT_INJURY_MAX_DAYS - tuning.INCIDENT_INJURY_MIN_DAYS)
      );
    }
    hits.push({ rider_id: e.rider_id, kind, outcome, time_loss_seconds, injury_days, u: u1 });
  }

  const maxHits = Math.ceil(tuning.INCIDENT_MAX_FIELD_SHARE * ordered.length);
  if (hits.length <= maxHits) return hits;

  // Deterministisk hard bound: behold de MEST afgørende hits (lavest u1, dvs.
  // dem der ramte "sikrest" under deres egen p-tærskel). Stabil tiebreak på
  // rider_id for et helt reproducerbart udvalg ved u1-lighed.
  const kept = new Set(
    [...hits]
      .sort((a, b) => a.u - b.u || String(a.rider_id).localeCompare(String(b.rider_id)))
      .slice(0, maxHits)
      .map((h) => h.rider_id)
  );
  return hits.filter((h) => kept.has(h.rider_id));
}

/**
 * rider_ids der er udgået (DNF) et race, uanset hvilken etape de styrtede på —
 * bruges af raceRunner.simulateStageByIndex til at ekskludere abandons fra
 * FØLGENDE etapers felt (og fra #1844-startfelt-snapshottet, så en abandon
 * aldrig fejlagtigt rapporteres som en "forsvundet" start-felt-rytter).
 *
 * @param {{supabase, raceId:string}} args
 * @returns {Promise<Set<string>>}
 */
export async function loadAbandonedRiderIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_incidents")
    .select("rider_id")
    .eq("race_id", raceId)
    .eq("outcome", "abandon");
  if (error) throw new Error(`race_incidents (abandoned): ${error.message}`);
  return new Set((data || []).map((r) => r.rider_id));
}
