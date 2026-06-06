// Deterministisk generator for fiktive ryttere (#669).
//
// Producerer komplette, spilbare rytter-records UDEN at røre databasen — kaldt
// af backend/scripts/generateFictionalRiders.js. Designprincipper (se
// docs/slices/669-fictional-riders.md):
//   • Deterministisk: samme (seed, referenceYear) → identisk output. Egen
//     seeded PRNG (mulberry32), aldrig Math.random.
//   • pcm_id ALTID null → markerer "egen rytter", usynlig for PCM-resultat-import.
//   • Sætter ALDRIG generated-kolonner (price/market_value/salary) eller id —
//     DB udleder dem. Ingen team_id (fri agent).
//   • Navne-unikhed håndhæves mod eksisterende DB-navne (foldNameNordic) for ikke
//     at gøre en ægte PCM-rytter "ambiguous" ved resultat-import (§3-fælden).

import { foldNameNordic } from "./pcmRiderMatcher.js";
import { NAME_CLUSTERS, clusterForNationality } from "./fictionalRiderNames.js";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it.value;
  }
  return items[items.length - 1].value;
}

// Box-Muller — bruger to rng()-kald, så determinismen bevares.
// Eksporteret så race-simulatoren (#1102 slice 2) genbruger samme seeded
// normalfordeling (issue-krav: "genbrug makeRng/Box-Muller").
export function gaussian(rng, mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ── De 14 stats (rækkefølge som schema.sql) ───────────────────────────────────
export const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

// Fjern intern `_meta` (audit/inspektion, ikke en DB-kolonne) → ren INSERT-payload.
// Delt af CLI'en og integrationstesten, så de tester præcis samme vej.
export function toInsertPayload(riders) {
  return riders.map(({ _meta, ...row }) => row);
}

// ── Rolle-arketyper: hvilke stats løftes over tier-basen ──────────────────────
const ROLES = [
  { value: "sprinter",   weight: 14, primary: ["stat_sp", "stat_acc", "stat_fl"], secondary: ["stat_res", "stat_ftr"], heightMean: 182, bmi: 22.5 },
  { value: "climber",    weight: 18, primary: ["stat_bj", "stat_kb", "stat_bk"], secondary: ["stat_udh", "stat_acc"], heightMean: 174, bmi: 19.5 },
  { value: "tt",         weight: 10, primary: ["stat_tt", "stat_prl"], secondary: ["stat_fl", "stat_udh"], heightMean: 184, bmi: 22.0 },
  { value: "classics",   weight: 12, primary: ["stat_bro", "stat_fl", "stat_ftr"], secondary: ["stat_acc", "stat_res"], heightMean: 183, bmi: 22.8 },
  { value: "allrounder", weight: 16, primary: ["stat_bj", "stat_tt", "stat_udh"], secondary: ["stat_kb", "stat_res"], heightMean: 178, bmi: 21.0 },
  { value: "domestique", weight: 30, primary: [], secondary: ["stat_udh", "stat_res", "stat_mod"], heightMean: 179, bmi: 21.2 },
];

// ── Styrke-tiers: få stjerner, mange domestikker ──────────────────────────────
const TIERS = [
  { value: "star",       weight: 4,  statMean: 78, uci: [800, 3500], potential: [3.0, 5.0], popularity: [55, 100] },
  { value: "strong",     weight: 16, statMean: 70, uci: [150, 800],  potential: [3.0, 6.0], popularity: [25, 70] },
  { value: "average",    weight: 40, statMean: 62, uci: [20, 150],   potential: [2.0, 5.0], popularity: [5, 35] },
  { value: "domestique", weight: 40, statMean: 54, uci: [1, 25],     potential: [1.0, 4.0], popularity: [0, 15] },
];

// Default-nationalitetsvægte: afspejler prod-feltet (2026-05-31) + garanteret
// repræsentation af ikke-vestlige nationer (se GUARANTEED) for at teste hybrid-
// navnepools' svageste punkt. Vægt ≈ relativ tilstedeværelse i feltet.
const DEFAULT_NATIONALITY_WEIGHTS = [
  { value: "FR", weight: 54 }, { value: "IT", weight: 53 }, { value: "BE", weight: 50 },
  { value: "ES", weight: 37 }, { value: "NL", weight: 36 }, { value: "CO", weight: 30 },
  { value: "CN", weight: 27 }, { value: "GB", weight: 27 }, { value: "US", weight: 23 },
  { value: "DE", weight: 22 }, { value: "DK", weight: 22 }, { value: "AU", weight: 19 },
  { value: "JP", weight: 17 }, { value: "NO", weight: 15 }, { value: "PT", weight: 14 },
  { value: "PL", weight: 13 }, { value: "AR", weight: 13 }, { value: "CZ", weight: 12 },
  { value: "KR", weight: 12 }, { value: "NZ", weight: 11 }, { value: "CA", weight: 11 },
  { value: "CH", weight: 10 }, { value: "AT", weight: 10 }, { value: "SE", weight: 8 },
  { value: "SI", weight: 7 }, { value: "DZ", weight: 7 }, { value: "ER", weight: 5 },
  { value: "RW", weight: 4 }, { value: "MA", weight: 5 }, { value: "BR", weight: 6 },
];

// Nationer der ALTID skal være repræsenteret mindst én gang (RFC-default).
const GUARANTEED = ["CN", "JP", "KR", "CO", "DZ", "ER"];

function buildStats(rng, tier, role) {
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, tier.statMean, 6);
    if (role.primary.includes(key)) v += intBetween(rng, 8, 16);
    else if (role.secondary.includes(key)) v += intBetween(rng, 3, 8);
    stats[key] = Math.round(clamp(v, 40, 88));
  }
  return stats;
}

function buildDemographics(rng, tier, role, referenceYear) {
  const age = Math.round(clamp(gaussian(rng, 27, 4.5), 18, 39));
  const birthYear = referenceYear - age;
  const birthMonth = intBetween(rng, 1, 12);
  const birthDay = intBetween(rng, 1, 28);
  const birthdate = `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
  // U25 = under 25 ved referenceåret (matcher import_riders.py-logikken).
  const is_u25 = birthYear > referenceYear - 25;

  const height = Math.round(clamp(gaussian(rng, role.heightMean, 5), 165, 196));
  const weight = Math.round(role.bmi * (height / 100) ** 2);

  // Potentiale: tier-interval, løftet for unge, sænket for ældre; 0.5-trin.
  const [pLo, pHi] = tier.potential;
  let pot = pLo + rng() * (pHi - pLo);
  pot += (24 - age) * 0.05;
  pot = clamp(Math.round(pot * 2) / 2, 1.0, 6.0);

  return { birthdate, is_u25, height, weight, potentiale: pot, age };
}

function makeUniqueName(rng, cluster, usedFolded) {
  // Forsøg simple first+last; ved kollision re-sample. Efter mange forsøg
  // (lille pool ift. count) tilføj mellem-initial for at tvinge unikhed.
  for (let attempt = 0; attempt < 40; attempt++) {
    const first = pick(rng, cluster.first);
    const last = pick(rng, cluster.last);
    const folded = foldNameNordic(`${first} ${last}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname: first, lastname: last };
    }
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const first = pick(rng, cluster.first);
    const initial = pick(rng, cluster.first)[0];
    const last = pick(rng, cluster.last);
    const firstname = `${first} ${initial}.`;
    const folded = foldNameNordic(`${firstname} ${last}`);
    if (!usedFolded.has(folded)) {
      usedFolded.add(folded);
      return { firstname, lastname: last };
    }
  }
  throw new Error("Navne-pool udtømt: for mange ryttere for én nationalitets pool — udvid pools eller sænk antal.");
}

/**
 * Generér fiktive rytter-records (rør ingen DB).
 *
 * @param {object} opts
 * @param {number} opts.seed               heltal — styrer al tilfældighed deterministisk
 * @param {number} opts.count              antal ryttere
 * @param {number} opts.referenceYear      år som alder/U25 beregnes mod
 * @param {Set<string>} [opts.existingFoldedNames]  foldNameNordic af alle eksisterende DB-navne
 * @param {Array<{value,weight}>} [opts.nationalityWeights]  override af default-fordeling
 * @returns {{ riders: object[], coverage: object, seed: number }}
 */
export function generateFictionalRiders({
  seed,
  count,
  referenceYear,
  existingFoldedNames = new Set(),
  nationalityWeights = DEFAULT_NATIONALITY_WEIGHTS,
}) {
  if (!Number.isInteger(seed)) throw new Error("seed skal være et heltal");
  if (!Number.isInteger(count) || count < 1) throw new Error("count skal være et positivt heltal");
  if (!Number.isInteger(referenceYear)) throw new Error("referenceYear skal være et heltal");

  const rng = makeRng(seed);
  const usedFolded = new Set(existingFoldedNames);

  // Byg nationalitets-sekvens: garanterede nationer først, resten vægtet, så
  // deterministisk blandet, så garanterede ikke altid klumper i starten.
  const nationalities = [];
  for (const iso of GUARANTEED) {
    if (nationalities.length < count) nationalities.push(iso);
  }
  while (nationalities.length < count) {
    nationalities.push(weightedPick(rng, nationalityWeights));
  }
  // Fisher-Yates med samme rng (deterministisk).
  for (let i = nationalities.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nationalities[i], nationalities[j]] = [nationalities[j], nationalities[i]];
  }

  const riders = [];
  const coverage = { byCluster: {}, fallbackNationalities: {} };

  for (let i = 0; i < count; i++) {
    const nationality = nationalities[i];
    const clusterKey = clusterForNationality(nationality);
    const cluster = NAME_CLUSTERS[clusterKey];
    if (clusterKey === "generic") {
      coverage.fallbackNationalities[nationality] =
        (coverage.fallbackNationalities[nationality] || 0) + 1;
    }
    coverage.byCluster[clusterKey] = (coverage.byCluster[clusterKey] || 0) + 1;

    const tier = weightedPick(rng, TIERS.map((t) => ({ value: t, weight: t.weight })));
    const role = weightedPick(rng, ROLES.map((r) => ({ value: r, weight: r.weight })));

    const { firstname, lastname } = makeUniqueName(rng, cluster, usedFolded);
    const stats = buildStats(rng, tier, role);
    const demo = buildDemographics(rng, tier, role, referenceYear);
    const uci_points = intBetween(rng, tier.uci[0], tier.uci[1]);
    const popularity = intBetween(rng, tier.popularity[0], tier.popularity[1]);

    riders.push({
      pcm_id: null, // markør for "egen rytter" — aldrig sat
      firstname,
      lastname,
      nationality_code: nationality,
      birthdate: demo.birthdate,
      height: demo.height,
      weight: demo.weight,
      popularity,
      uci_points,
      is_u25: demo.is_u25,
      potentiale: demo.potentiale,
      ...stats,
      // Bevidst udeladt (DB udleder/defaulter): id, price, market_value, salary,
      // team_id, ai_team_id, pending_team_id, prize_earnings_bonus, is_retired,
      // created_at, updated_at, acquired_at.
      _meta: { tier: tier.value, role: role.value, age: demo.age, cluster: clusterKey },
    });
  }

  return { riders, coverage, seed };
}
