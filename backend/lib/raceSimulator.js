// Race Engine light-motor (#1102), slice 2 — deterministisk single-stage simulator.
//
// Ren funktion: scorer rider_derived_abilities mod en etapes demand_vector +
// bounded seeded variation → rangering + per-rytter tids-gab for den etape.
// Ingen DB/fs. raceRunner.js aggregerer på tværs af etaper (GC + trøjer) og
// broer til den UÆNDREDE applyRaceResults.
//
// Kontrakt (FROSSEN — #1021 fylder seams ud INDE i loopet, ændrer IKKE signaturen,
// så light → fuld er et dybde-løft, ikke en omskrivning):
//   simulateStage({ entrants, stageProfile, seed }) → { seed, ranked }
//
// Score-model (slice 2 + #1307 udbrud + #1307 hold):
//   finalScore = terrain + noise + form(0) − fatigue(0) + team + breakaway
//     terrain   = Σ ability[k]/99 · demand[k]      (k ∈ de 10 abilities)
//     noise     = gaussian(rng, 0, demand.randomness · NOISE_SD_SCALE)
//     breakaway = seeded chance-bonus til 1-3 lavere-rangerede ryttere på egnede profiler
//     team      = hjælperkvalitet × friskhed booster den beskyttede leder (#1307, spec 8.2)
//   form/fatigue er ÆGTE seam-funktioner der returnerer neutralt (#1306-placeholder) og
//   bærer præcis den signatur den fulde fysiologiske motor (#1021) fylder ud.
//   team-seamen er aktiveret (#1307); #1021 kan uddybe modellen i samme signaturer.
//
// Determinisme: makeRng (mulberry32) + Box-Muller (gaussian), begge genbrugt fra
//   fictionalRiderGenerator.js (issue-krav). Entrants scores i STABIL rider_id-
//   orden, så rng-sekvensen er uafhængig af input-rækkefølge. Samme seed + input
//   → samme rang. Stabil tiebreaker (rider_id) ved score-lighed. Ingen Math.random/Date.

import { makeRng, gaussian } from "./fictionalRiderGenerator.js";
import { workCost, teamRaceWeightV3, formRaceWeightV3 } from "./raceRoles.js";
// S2 (#2353): dagsform + jour sans — per-rytter-hashede, dedikerede streams
// (raceDayForm.js); kaldes KUN når v3=true, konsumerer intet fra main-rng.
import { dayFormComponent, jourSansComponent } from "./raceDayForm.js";

export const ENGINE_VERSION = 1;
// Race v3 S1 (#2352): motor-version stemplet på runs når `race_engine_v3_scoring`
// er ON (raceRunner.js vælger mellem denne og ENGINE_VERSION ud fra flaget —
// simulateStage selv er version-agnostisk, den tager blot `v3`-boolean'en).
export const ENGINE_VERSION_V3 = 2;

// rider_derived_abilities-kolonnerne = terræn-scoringens dimensioner. Skal matche
// ABILITY_DIMENSIONS i raceStageProfileGenerator.js (demand_vector-nøgler ⊆ disse
// ∪ {randomness}). 'randomness' er IKKE en ability — den skalerer kun støjen.
export const ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobblestone", "acceleration", "recovery", "tactics", "positioning",
  // Plan 1 (#1122): aktiverede evner — flat/tempo er terræn-kraft (vægtes i
  // DEMAND_VECTORS), durability/aggression/descending er seam/dynamik/modifier
  // (loades, men vægtes ikke i terrain-scoren).
  "flat", "tempo", "durability", "aggression", "descending",
]);

const ABILITY_MAX = 99;

// Støjens standardafvigelse = demand.randomness · NOISE_SD_SCALE. Terræn-scoren
// ligger i [0, 1], så denne skalar afgør hvor ofte stjerner slås (tunes via
// distributions-testene → acceptance: "stjerner vinder oftest, men ikke 100%").
// ÉT sted at tune varians-niveauet for hele motoren.
export const NOISE_SD_SCALE = 0.16;

// Per-terræn tids-gab-model (F3, ejer-besluttet 2026-06-07): omsætter score-deficit
// (bag etapevinderen) til sekunder. bunch = deficit under tærsklen → samme tid
// (peloton); spread = sekunder pr. score-point over tærsklen. Flade etaper
// neutraliseres (felt-finish, gab≈0), bjerg/ITT åbner ægte gab → GC afgøres i
// bjergene. Display-only (gc-RANK driver points); tunbar ÉT sted.
const GAP_MODEL = Object.freeze({
  flat:          { bunch: 0.06, spread: 40 },
  rolling:       { bunch: 0.04, spread: 90 },
  hilly:         { bunch: 0.02, spread: 200 },
  mountain:      { bunch: 0.0,  spread: 600 },
  high_mountain: { bunch: 0.0,  spread: 800 },
  itt:           { bunch: 0.0,  spread: 700 },
  ttt:           { bunch: 0.0,  spread: 500 },
  cobbles:       { bunch: 0.02, spread: 250 },
  classic:       { bunch: 0.02, spread: 220 },
});
const GAP_MODEL_DEFAULT = Object.freeze({ bunch: 0.03, spread: 150 });
const MAX_STAGE_GAP_SECONDS = 1800; // sikkerhedsloft (30 min)

// ── Seams til #1021 (returnerer neutralt i light-motoren) ─────────────────────
// Signaturerne er bevidst rige nok til at den fulde motor kan fylde dem ud uden
// at ændre simulateStage's kontrakt: light → fuld = depth INDE i loopet.
//   form    — seeded dagsform pr. rytter/etape.
//   fatigue — akkumuleret træthed over et etapeløb (kræver cross-stage state → runner).
//   team    — leadout/beskyttelse/holdstyrke (AKTIVERET #1307, spec 8.2).

// Form/Træthed-seams (#1306): max ~±3 % af typisk terrain-score (~0.65) per spec 6.4.
// Kalibreres i race:gate (B4); #1021 erstatter med fuld model i samme signaturer.
export const FORM_RACE_WEIGHT = 0.012;     // form 0↔100 → ±0.012
export const FATIGUE_RACE_WEIGHT = 0.030;  // #1021: træthed 100 → 0.030 (kalibreret via race:gate:condition — durability levende; trækkes fra på call-site)
// Plan 1 (#1122): durability-evnen dæmper trætheds-straffen (fade sent i hårde
// løb). durability 99 → halv straf, durability 0 → fuld straf. Effekten findes
// kun når der ER træthed (condition-mode / #1021), ikke i neutral-mode.
export const DURABILITY_FATIGUE_DAMPING = 0.5;

// S2 (#2353): vægten er parametriseret — v1-kald bruger default FORM_RACE_WEIGHT
// (bit-identisk flag-off), v3-kald sender formRaceWeightV3() (spec §7: 0.012 er
// "reelt usynlig"; v3 gør formstyring til spillerens våben).
function formComponent(entrant, weight = FORM_RACE_WEIGHT) {
  const raw = entrant?.form;
  // null/undefined/NaN = ingen condition-data → neutral (IKKE worst-form 0).
  if (raw == null || !Number.isFinite(Number(raw))) return 0;
  const form = clamp(Number(raw), 0, 100);
  return ((form - 50) / 50) * weight;
}

function fatigueComponent(entrant /* , stageProfile */) {
  const raw = entrant?.fatigue;
  if (raw == null || !Number.isFinite(Number(raw))) return 0;
  const fatigue = clamp(Number(raw), 0, 100);
  // Plan 1 (#1122): durability dæmper straffen (fade sent). Manglende durability → fuld straf.
  const dur = Number(entrant?.abilities?.durability);
  const damp = Number.isFinite(dur) ? 1 - (clamp(dur, 0, 99) / 99) * DURABILITY_FATIGUE_DAMPING : 1;
  return (fatigue / 100) * FATIGUE_RACE_WEIGHT * damp;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ── Hold-seam aktiveret (#1307, spec 8.2) ─────────────────────────────────────
// Hjælperkvalitet (terrain-score) × friskhed (1 − træthed-dæmpning) booster den
// beskyttede leder: sprint_captain på flade etaper (fallback captain), ellers
// captain. Hjælpere/hunters er score-neutrale (ingen straf i v1 — kalibrérbart).
// Kalibreret i race:gate:roles (Task 9, 2026-06-12): 0.010 → 0.024. Max boost ved
// helperSupport = 1.0 er ~3,7 % af typisk terrain-score (~0.65), men gate-måling
// i pyramide-populationen: helperSupport median 0.18-0.23 (p90 0.24-0.29, max 0.39)
// → realiseret boost median ~0.0043-0.0054 (~0.7-0.8 % typisk terræn), max ~0.0095
// (~1.45 %). 0.024 er minimum der gør kaptajn-deltaet (roles vs neutral, aggregeret
// over 8 terræner × 300 løb) positivt på alle 3 gate-seeds — ved 0.010-0.018 stjal
// hunter-udbruddene netto sejre fra kaptajnerne.
export const TEAM_RACE_WEIGHT = 0.024;
export const HELPER_FATIGUE_DAMPING = 0.5;   // træthed 100 → hjælper bidrager 50 %
const SPRINT_PROFILES = new Set(["flat"]);

// Plan 1 (#1122): descending som finale-modifier — på descent-finaler får gode
// nedkørere en bonus, dårlige taber (centreret om 50). Lille terræn-bjerg-vægt
// (descending i bjerg-demand) kan tilføjes separat i DEMAND_VECTORS hvis ønsket.
export const DESCENDING_FINALE_WEIGHT = 0.04;
const DESCENT_FINALES = new Set(["descent"]);

function finaleModifier(entrant, stageProfile) {
  if (!DESCENT_FINALES.has(stageProfile?.finale_type)) return 0;
  const d = Number(entrant?.abilities?.descending);
  if (!Number.isFinite(d)) return 0;
  return ((clamp(d, 0, 99) - 50) / 49) * DESCENDING_FINALE_WEIGHT;
}

export function buildTeamContext({ entrants, terrainById, v3 = false }) {
  const byTeam = new Map();
  for (const e of entrants) {
    if (!e.team_id || !e.race_role) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, { captainId: null, sprintCaptainId: null, helpers: [] });
    const t = byTeam.get(e.team_id);
    if (e.race_role === "captain") t.captainId = e.rider_id;
    else if (e.race_role === "sprint_captain") t.sprintCaptainId = e.rider_id;
    // Race v3 S1 (#2352): free_role = "kør dit eget løb" — 0 holdbidrag, tæller
    // IKKE med i helperSupport. v1 (v3=false) kender ikke free_role og forbliver
    // bit-identisk (rollen puttes ind i helpers som i dag — men v1-data kan aldrig
    // indeholde 'free_role', jf. race_entries' CHECK-constraint før S1-migrationen).
    else if (v3 && e.race_role === "free_role") continue;
    else t.helpers.push(e); // helper + hunter arbejder begge for lederen
  }
  const ctx = new Map();
  for (const [teamId, t] of byTeam) {
    if (!t.captainId && !t.sprintCaptainId) continue;
    let support = 0;
    if (t.helpers.length) {
      let sum = 0;
      for (const h of t.helpers) {
        const quality = clamp(terrainById.get(h.rider_id) || 0, 0, 1);
        const raw = Number(h.fatigue);
        const freshness = 1 - (Number.isFinite(raw) ? clamp(raw, 0, 100) / 100 : 0) * HELPER_FATIGUE_DAMPING;
        sum += quality * freshness;
      }
      // gennemsnit, ikke sum — flere middelmådige hjælpere fortynder boostet (kvalitet over kvantitet, naturligt bounded)
      support = clamp(sum / t.helpers.length, 0, 1);
    }
    ctx.set(teamId, { captainId: t.captainId, sprintCaptainId: t.sprintCaptainId, helperSupport: support });
  }
  return ctx;
}

function teamComponent(entrant, stageProfile, teamContext, v3 = false) {
  if (!teamContext || !entrant?.team_id) return 0;
  const t = teamContext.get(entrant.team_id);
  if (!t) return 0;
  const isSprintStage = SPRINT_PROFILES.has(stageProfile?.profile_type);
  const protectedId = isSprintStage ? (t.sprintCaptainId ?? t.captainId) : t.captainId;
  if (!protectedId || entrant.rider_id !== protectedId) return 0;
  // Race v3 S1 (#2352): kaptajnens modydelse hæves (0.024 → teamRaceWeightV3())
  // så holdet reelt køber noget for hjælpernes work-cost-ofre (spec §6).
  const weight = v3 ? teamRaceWeightV3() : TEAM_RACE_WEIGHT;
  return weight * t.helperSupport;
}

// ── Race v3 S1 (#2352): work-cost — arbejde for holdet koster egen placering ──
// Ren, deterministisk lookup (backend/lib/raceRoles.js) — INGEN rng-forbrug,
// så noise/breakaway-sekvenserne er upåvirkede uanset v3-tilstand. Dormant når
// v3=false (returnerer altid 0) → flag-off er bit-identisk.
function workCostComponent(entrant, stageProfile, v3) {
  if (!v3 || !entrant?.race_role) return 0;
  // effort er en S3-seam (race_stage_roles.effort) — 'normal' indtil den findes.
  return workCost(entrant.race_role, stageProfile?.profile_type, entrant.effort || "normal");
}

// ── Udbrud (#1307, spec 8.3) ──────────────────────────────────────────────────
// På udbruds-egnede profiler får 1-3 lavere-rangerede ryttere (aggression-vægtet,
// seeded) en chance-bonus. Dedikeret rng (XOR-scrambled seed) → noise-sekvensen
// er UÆNDRET. Hunter-rollen: altid kandidat + HUNTER_WEIGHT_MULTIPLIER i vægt.
// Bonus = maxBonus · u² (u uniform) → de fleste udbrud hentes, enkelte holder hjem.
//
// KALIBRERET mod den ægte pyramide-population (Task 9, 2026-06-12, race:gate):
// de oprindelige design-værdier (maxBonus 0.10/0.12/0.16, cut 0.4) gav 0,0 %
// escapee-sejre i 140-rytter-felter — ved cut'et er terrain-gabet til feltets
// bedste 0.33-0.55 score-point, så bonussen kunne MATEMATISK aldrig vinde.
// Derfor: (a) maxBonus skal være sammenlignelig med felt-SPREDNINGEN (ikke
// noise-skalaen) for at et udbrud nogensinde kan holde hjem; u²-formen sikrer
// stadig at de fleste udbrud hentes. (b) cut 0.05 (i stedet for 0.4) lader
// næst-lags-ryttere (p5-p10 på terrænet) eskapere — på flade etaper er det
// netop sub-top-SPRINTERE, hvilket holder sprinter ≥90 %-målet kompatibelt
// med udbruds-båndet. (c) hunter-vægt 3 → 2: ved ×3 stjal hunters så mange
// sejre fra kaptajnerne at kaptajn-deltaet blev negativt og rolling røg over
// bånd-loftet i roles-mode. Målte bånd-værdier pr. seed: se KALIBRERINGS-LOG
// i scripts/simulateSeasonDryRun.js. (BREAKAWAY_PROFILES superseded af BREAKAWAY_BONUS, #1021.)
export const BREAKAWAY_TOP_EXCLUDED = 0.05;      // top-5 % (terrain) kan ikke eskapere
export const BREAKAWAY_MAX_RIDERS = 3;
export const HUNTER_WEIGHT_MULTIPLIER = 2;

// ── Finale-gradient-bevidst udbruds-bonus (#1021 Fase 1) ──────────────────────
// Afløser den flade BREAKAWAY_PROFILES-skalar: maxBonus afhænger nu af BÅDE
// profil OG finale_type. finale_type = proxy for finale-gradienten (den vigtigste
// virkelige faktor): long_climb (summit) → favoritterne afgør (~0); descent/flad
// efter sidste stigning → udbruddet holder hjem. itt/ttt/classic: intet udbrud.
// KANDIDAT-værdier — tunes i race:gate (plan Task 5). Grundet i virkelige data
// 2026-06-16 (docs/superpowers/plans/2026-06-16-breakaway-feature-aware-phase1.md).
export const BREAKAWAY_BONUS = Object.freeze({
  flat:          Object.freeze({ bunch_sprint: 0.30, reduced_sprint: 0.30, _default: 0.30 }), // ≤0.30: flat-bonus >0.30 vælter sprinter ≥90% i roles (#1307-fund)
  rolling:       Object.freeze({ breakaway: 0.20, reduced_sprint: 0.17, bunch_sprint: 0.15, _default: 0.17 }),
  hilly:         Object.freeze({ punch: 0.42, reduced_sprint: 0.40, breakaway: 0.46, _default: 0.42 }),
  mountain:      Object.freeze({ descent: 0.50, breakaway: 0.50, long_climb: 0.06, _default: 0.45 }),
  high_mountain: Object.freeze({ descent: 0.42, long_climb: 0.05, _default: 0.08 }),
  cobbles:       Object.freeze({ reduced_sprint: 0.30, breakaway: 0.36, _default: 0.28 }),
});

// → maxBonus for en (profil, finale). Manglende finale → profilens _default.
// Manglende profil (itt/ttt/classic + ukendte) → 0. Bevarer den frosne
// selectBreakawayBonuses-kontrakt: returnerer en skalar, ikke en ny mekanik.
export function breakawayMaxBonus(profileType, finaleType) {
  const p = BREAKAWAY_BONUS[profileType];
  if (!p) return 0;
  const v = (finaleType != null && finaleType in p) ? p[finaleType] : p._default;
  return Number.isFinite(v) ? v : 0;
}

// Aggression = lyst/evne til at køre i udbrud. Plan 1 (#1122): læser den ÆGTE
// aggression-evne (driver udbruds-CHANCEN, jf. rider-ability-system-v2.md §0.1).
// Fallback til den gamle proxy (tactics/endurance/acceleration) når aggression
// mangler — bevarer flag-off / pre-v2-data-adfærd.
export function aggressionScore(abilities) {
  const a = (k) => Number(abilities?.[k]) || 0;
  const aggr = a("aggression");
  if (aggr > 0) return aggr;
  return 0.5 * a("tactics") + 0.3 * a("endurance") + 0.2 * a("acceleration");
}

// → Map(rider_id → bonus) for de udvalgte escapees (tom Map hvis profil uegnet).
function selectBreakawayBonuses({ ordered, terrainById, profileType, finaleType, seed }) {
  const bonuses = new Map();
  const maxBonus = breakawayMaxBonus(profileType, finaleType);
  if (!maxBonus || ordered.length < 4) return bonuses; // under 4 ryttere → intet udbrud (ellers kan næsten hele feltet eskapere)

  const rng = makeRng((seed ^ 0xb4ea0ff5) >>> 0);

  // Terræn-rang: stærkeste først. Kandidater = under top-cuttet, plus hunters (altid).
  const byTerrain = [...ordered].sort((a, b) =>
    (terrainById.get(b.rider_id) - terrainById.get(a.rider_id)) ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const cut = Math.floor(byTerrain.length * BREAKAWAY_TOP_EXCLUDED);
  const candidates = byTerrain.filter((e, i) => i >= cut || e.race_role === "hunter");
  if (!candidates.length) return bonuses;

  const count = Math.min(1 + Math.floor(rng() * BREAKAWAY_MAX_RIDERS), candidates.length);

  // Vægtet udvælgelse uden tilbagelægning (deterministisk over rider_id-stabil liste).
  // Selve win-scoren (terræn + bonus) gør allerede at vinderen af et bjergudbrud er den
  // mest klatre-egnede af de undslupne — derfor er selektionen aggression-drevet (lyst
  // til at angribe), ikke terræn-drevet (#1021: global terræn-vægtning testet + forkastet,
  // den skadede flad uden at flytte bjerg-born-as).
  const pool = candidates.map((e) => ({
    e,
    w: Math.max(1, aggressionScore(e.abilities)) * (e.race_role === "hunter" ? HUNTER_WEIGHT_MULTIPLIER : 1),
  }));
  for (let k = 0; k < count && pool.length; k++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let draw = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && (draw -= pool[idx].w) > 0) idx++;
    const [picked] = pool.splice(idx, 1);
    const u = rng();
    bonuses.set(picked.e.rider_id, maxBonus * u * u);
  }
  return bonuses;
}

// FNV-1a 32-bit → heltals-seed fra en streng. Eksporteret så raceRunner udleder
// en stabil per-etape-seed (`${race.id}:${stage_number}`, #2351: server-side
// saltet via raceSeedSalt.js før den når hertil — usaltet når salt-env ikke er
// sat). Deterministisk (samme input → samme seed, uanset salt).
export function stableSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// terrain = Σ ability[k]/99 · demand[k]. demand-nøgler der ikke er abilities
// (dvs. 'randomness') ignoreres her. Manglende ability → 0 (defensivt).
export function terrainScore(abilities, demandVector) {
  let s = 0;
  for (const k of ABILITY_KEYS) {
    const w = demandVector[k];
    if (!w) continue;
    const a = Number(abilities?.[k]) || 0;
    s += (a / ABILITY_MAX) * w;
  }
  return s;
}

function gapFor(profileType, deficit) {
  const m = GAP_MODEL[profileType] || GAP_MODEL_DEFAULT;
  if (deficit <= m.bunch) return 0;
  return Math.round(clamp((deficit - m.bunch) * m.spread, 0, MAX_STAGE_GAP_SECONDS));
}

/**
 * Simulér ÉN etape. Ren funktion — ingen DB, ingen Math.random/Date.
 * @param {{entrants:Array, stageProfile:object, seed:number, v3?:boolean}} args
 *   entrants: [{ rider_id, team_id?, abilities:{climbing,...positioning} }]
 *   stageProfile: { profile_type, demand_vector, stage_number? }
 *   seed: heltal (udledes typisk af raceRunner via stableSeed)
 *   v3: Race v3 S1 (#2352, flag `race_engine_v3_scoring`) — aktiverer work_cost
 *     + den kalibrerede TEAM_RACE_WEIGHT_V3. default false → BIT-IDENTISK med
 *     dagens motor (ingen rng-forbrug ændres, ingen ny komponent bidrager).
 * @returns {{ seed:number, ranked:Array }}
 *   ranked: [{ rider_id, team_id, rank, finalScore, stageGap, components }]
 *   sorteret bedst→dårligst; rank 1..N; stageGap = sekunder bag etapevinderen (≥0).
 */
export function simulateStage({ entrants = [], stageProfile, seed, v3 = false } = {}) {
  if (!stageProfile?.demand_vector) throw new Error("stageProfile.demand_vector kræves");
  if (!Number.isInteger(seed)) throw new Error("seed (heltal) kræves");

  const demand = stageProfile.demand_vector;
  const profileType = stageProfile.profile_type;
  const noiseSd = (Number(demand.randomness) || 0) * NOISE_SD_SCALE;

  // Stabil scoringsrækkefølge → rng-sekvens uafhængig af input-orden.
  const ordered = [...entrants].sort((a, b) =>
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const rng = makeRng(seed >>> 0);

  // Terræn forberegnes til breakaway-udvælgelse (dedikeret rng — påvirker IKKE
  // main rng-sekvensen, så noise er bit-identisk på ikke-egnede profiler).
  const terrainById = new Map(
    ordered.map((e) => [e.rider_id, terrainScore(e.abilities, demand)])
  );
  const breakawayById = selectBreakawayBonuses({ ordered, terrainById, profileType, finaleType: stageProfile.finale_type, seed });
  const teamCtx = buildTeamContext({ entrants: ordered, terrainById, stageProfile, v3 });

  const scored = ordered.map((e) => {
    const terrain = terrainById.get(e.rider_id);
    const noise = noiseSd > 0 ? gaussian(rng, 0, noiseSd) : 0;
    // S2 (#2353): v3 bruger den hævede form-vægt (formRaceWeightV3); v1-stien
    // er uændret (default-vægt) — flag-off bit-identisk.
    const form = formComponent(e, v3 ? formRaceWeightV3() : FORM_RACE_WEIGHT);
    const fatigue = fatigueComponent(e, stageProfile);
    const team = teamComponent(e, stageProfile, teamCtx, v3);
    const breakaway = breakawayById.get(e.rider_id) || 0;
    const finale = finaleModifier(e, stageProfile);
    // Race v3 S1 (#2352): workCost er allerede negativ (eller 0) — "+" her er
    // korrekt (samme fortegns-konvention som breakaway/finale, modsat fatigue
    // der er en positiv magnitude trukket fra separat).
    const workCostDelta = workCostComponent(e, stageProfile, v3);
    // S2 (#2353): dagsform (symmetrisk) + jour sans (≤0, form-koblet p) —
    // per-rytter-hashede dedikerede streams, INTET forbrug af main-rng
    // (noise-sekvensen ovenfor er bit-identisk med og uden v3).
    const dayform = v3 ? dayFormComponent({ riderId: e.rider_id, stageSeed: seed }) : 0;
    const jourSans = v3 ? jourSansComponent({ riderId: e.rider_id, stageSeed: seed, form: e.form }) : 0;
    const finalScore = terrain + noise + form - fatigue + team + breakaway + finale + workCostDelta + dayform + jourSans;
    return {
      rider_id: e.rider_id,
      team_id: e.team_id ?? null,
      finalScore,
      components: { terrain, noise, form, fatigue, team, breakaway, finale, work_cost: workCostDelta, dayform, jour_sans: jourSans },
    };
  });

  // Rangering: bedste score først; stabil tiebreaker = rider_id.
  scored.sort((a, b) =>
    b.finalScore - a.finalScore ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  );

  const winnerScore = scored.length ? scored[0].finalScore : 0;
  const ranked = scored.map((r, i) => ({
    rider_id: r.rider_id,
    team_id: r.team_id,
    rank: i + 1,
    finalScore: r.finalScore,
    stageGap: gapFor(profileType, winnerScore - r.finalScore),
    components: r.components,
  }));

  return { seed: seed >>> 0, ranked };
}

// ── #1499: DESKRIPTIV udbruds-status (ren read, ZERO balance-effekt) ──────────
// Afleder per-rytter "var i (morgen-)udbruddet" + "holdt hjem vs. blev indhentet"
// UDELUKKENDE fra det eksisterende simulateStage-output (`ranked`). Rører IKKE
// finalScore, rang, point eller kalibrering — det er en efter-løb-etiket oven på
// motorens egne tal, så den fulde race-gate forbliver bit-identisk grøn.
//
// Definitioner (genbruger den ejer-fastsatte, gate-målte konvention):
//   in_breakaway   = components.breakaway > 0  (rytteren var en udvalgt escapee;
//                    den PRÆCISE definition fra kalibrerings-loggen 2026-06-16 +
//                    BREAKAWAY_TARGETS-gaten: "udbruds-sejr = components.breakaway > 0").
//   breakaway_caught = escapee BLEV indhentet før mål = der finishede mindst én
//                    IKKE-escapee FORAN ham (feltet havde slugt ham ved stregen).
//                    "Holdt hjem" (survived) = ingen ikke-escapee foran → den
//                    direkte per-rytter-generalisering af gatens "vinder holdt
//                    hjem" (når vinderen er escapee, holdt alle escapees foran
//                    feltet hjem). Rang-afledt, så den arver motorens rangering 1:1.
//
// @param {Array<{rider_id, rank, components:{breakaway}}>} ranked  fra simulateStage
// @returns {Map<riderId, {in_breakaway:boolean, breakaway_caught:boolean}>}
//   in_breakaway=false → breakaway_caught=false (status gælder kun escapees).
export function deriveBreakawayStatus(ranked = []) {
  const out = new Map();
  if (!ranked.length) return out;
  // Rang for den bedst placerede IKKE-escapee. Inf hvis hele finishet var escapees
  // (kun teoretisk: feltet er altid > 3, escapees ≤ 3 → der er altid ikke-escapees).
  let bestNonEscapeeRank = Infinity;
  for (const r of ranked) {
    if (!((r.components?.breakaway || 0) > 0) && r.rank < bestNonEscapeeRank) {
      bestNonEscapeeRank = r.rank;
    }
  }
  for (const r of ranked) {
    const inBreakaway = (r.components?.breakaway || 0) > 0;
    out.set(r.rider_id, {
      in_breakaway: inBreakaway,
      // Indhentet = escapee med mindst én ikke-escapee foran sig. Ikke-escapees
      // har altid in_breakaway=false → caught=false.
      breakaway_caught: inBreakaway && r.rank > bestNonEscapeeRank,
    });
  }
  return out;
}
