// Deterministisk generator for fiktive ryttere (#669).
//
// Producerer komplette, spilbare rytter-records UDEN at røre databasen — kaldt
// af backend/scripts/generateFictionalRiders.js. Designprincipper (se
// docs/slices/669-fictional-riders.md):
//   • Deterministisk: samme (seed, referenceYear) → identisk output. Egen
//     seeded PRNG (mulberry32), aldrig Math.random.
//   • pcm_id ALTID null → markerer "egen rytter", usynlig for PCM-resultat-import.
//   • Sætter ALDRIG generated-kolonner (market_value/salary), base_value eller id —
//     DB udleder/backfill ejer dem. Ingen team_id (fri agent).
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

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function weightedPick(rng, items) {
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

// ── Type-arketyper: sigter de 9 AFLEDTE ryttertyper direkte (#669/#677-launch) ─
// Hver arketype svarer til en type i riderTypes.js og booster de stats, der via
// abilityDerivation.js driver den types POSITIV-vægtede abilities, og dæmper off-
// type-stats (rolle-svaghed ON, ejer-beslutning). Det gør den afledte type
// pålidelig (≈ den tilsigtede) frem for at lade z-score+guards default'e alt til tt.
//   • boost: stat → +løft oven på tier-basen (signatur-stat løftes mest).
//   • damp:  stats der trækkes ned, så typen bliver skarp.
//   • minStats: hårdt gulv så type-GUARDS i riderTypes.js opfyldes ved ALLE tiers
//       (gc kræver climbing/tt/recovery samtidigt høje; mapping PCM→ability: 72→63,
//       67→49 ≥ guard-tærskler 57/43).
//   • capSprint/capSpeciality: loft så leadout (sprint<79) / rouleur (intet
//       speciale ≥79) ikke guardes ud (ability 79 ↔ PCM ~78).
const ARCHETYPES = [
  { type: "sprinter",       boost: { stat_sp: 12, stat_acc: 9, stat_fl: 6 },                                   damp: ["stat_bj", "stat_kb", "stat_udh"], heightMean: 182, bmi: 22.8 },
  { type: "leadout",        boost: { stat_sp: 7,  stat_acc: 8, stat_fl: 7,  stat_mod: 5 },                     damp: ["stat_bj", "stat_kb"],             heightMean: 181, bmi: 22.5, capSprint: 76 },
  { type: "tt",             boost: { stat_tt: 12, stat_prl: 10, stat_fl: 5 },                                  damp: ["stat_sp", "stat_bk", "stat_bj"],  heightMean: 185, bmi: 22.2 },
  { type: "climber",        boost: { stat_bj: 12, stat_kb: 8, stat_bk: 5,  stat_udh: 5 },                      damp: ["stat_sp", "stat_acc", "stat_fl"], heightMean: 173, bmi: 19.5 },
  { type: "puncheur",       boost: { stat_bk: 11, stat_kb: 8, stat_bj: 6,  stat_udh: 5 },                      damp: ["stat_tt", "stat_sp"],             heightMean: 176, bmi: 21.0 },
  { type: "brostensrytter", boost: { stat_bro: 13, stat_fl: 7, stat_udh: 5, stat_bk: 5 },                      damp: ["stat_bj", "stat_sp"],             heightMean: 184, bmi: 23.2 },
  { type: "baroudeur",      boost: { stat_ftr: 11, stat_fl: 5, stat_bk: 5,  stat_udh: 6, stat_ned: 5, stat_res: 5 }, damp: ["stat_tt"],                  heightMean: 179, bmi: 21.3 },
  { type: "rouleur",        boost: { stat_fl: 6,  stat_udh: 5, stat_res: 4 },                                  damp: [],                                 heightMean: 180, bmi: 21.6, capSpeciality: 76 },
  { type: "gc",             boost: { stat_bj: 10, stat_tt: 9, stat_res: 8, stat_kb: 7, stat_udh: 5, stat_mod: 5 }, damp: ["stat_sp"],                   heightMean: 177, bmi: 20.3, minStats: { stat_bj: 72, stat_tt: 67, stat_res: 67 } },
];
const ARCHETYPE_BY_TYPE = Object.fromEntries(ARCHETYPES.map((a) => [a.type, a]));

// Stats der tæller som "speciale" for rouleur-cap'en (matcher riderTypes.js).
const SPECIALITY_STATS = ["stat_bj", "stat_kb", "stat_bk", "stat_bro", "stat_tt", "stat_sp"];

// ── Styrke-tiers: eksakt kvote (ikke vægtet sampling) → præcis værdi-pyramide ──
// statMean = overall stat-niveau pr. tier; tier styrer hvor højt arketypens
// boostede signatur-stats lander → afledt ability-output → base_value-bånd.
// Kvote = andel af count (ejer-spec ~800: 12 super / 60 stjerner / 230 solide /
// resten domestik). uci-felterne er legacy efter #1101-cutover (økonomien kører
// på base_value via backfill); potential/popularity styrer demografi.
//
// v3-kalibrering (#1194): værdimodellen blender speciale 50/50 med SNITTET af
// alle evner (riderValuation.js), så de øvre bånd kræver BREDE profiler —
// dampScale skalerer rolle-svagheds-dæmpningen ned pr. tier (superstjerner er
// alsidige, domestikker beholder fuld rolle-svaghed). sd strammes mod toppen:
// modellens konvekse kurve (c·O²) forstørrer stat-varians eksponentielt deroppe,
// så et bredt sd ville skyde enkelte superstjerner langt over værdi-loftet
// (~25M) og tabe andre under 8M. statMean/dampScale/sd er empirisk tunet mod
// 12/60/230/500 via scripts/previewFictionalPopulation.js.
const TIERS = [
  { value: "superstar",  fraction: 12 / 800,  statMean: 70.75, dampScale: 0.35, sd: 1.5,  uci: [1800, 4000], potential: [3.0, 5.0], popularity: [70, 100] },
  { value: "star",       fraction: 60 / 800,  statMean: 67,    dampScale: 0.5,  sd: 2.5,  uci: [700, 1800],  potential: [3.0, 6.0], popularity: [45, 85] },
  { value: "solid",      fraction: 230 / 800, statMean: 63.75, dampScale: 0.75, sd: 2.75, uci: [120, 700],   potential: [2.0, 5.0], popularity: [10, 50] },
  { value: "domestique", fraction: null,      statMean: 53,   dampScale: 1,    sd: 3.5,  uci: [1, 120],     potential: [1.0, 4.0], popularity: [0, 18] }, // rest
];

// v3-værdi-udligning (#1194): værdimodellens type-offsets (riderValuationModel.json:
// sprinter +1.06 … puncheur −0.66) flytter bånd-grænserne flere O-enheder pr. type.
// Uden modvægt eksploderer sprinter-toppen (~4× en tt-profil ved samme stats) og
// puncheur/rouleur når aldrig deres tier-bånd. Justerer tier-basen (stat-point)
// pr. arketype; empirisk tunet mod preview-harnessen.
const TYPE_MEAN_ADJUST = {
  sprinter: -1.5, climber: -0.5, leadout: 0, brostensrytter: 0, baroudeur: 0.5,
  gc: 0.5, tt: -1, rouleur: 1.5, puncheur: 1.5,
};

// Tier-aware type-fordeling (vægte) — realistisk peloton: ledere (gc/klatrer/
// sprinter/tt/puncheur/brosten) i toppen, hjælpere (rouleur/leadout/baroudeur)
// i bunden. Sikrer også at GUARD-tunge typer (gc) kun lander hvor de kan opfylde
// guarden. Gulv på sjældne typer håndhæves efter sampling (ENSURE_MIN_TYPES).
const TIER_TYPE_WEIGHTS = {
  superstar:  { gc: 3, climber: 3, sprinter: 2, tt: 2, puncheur: 1, brostensrytter: 2 },
  star:       { gc: 3, climber: 4, sprinter: 3, tt: 3, puncheur: 2, brostensrytter: 2, baroudeur: 1, leadout: 1 },
  solid:      { gc: 2, climber: 4, sprinter: 2, tt: 3, puncheur: 2, brostensrytter: 2, baroudeur: 3, leadout: 2, rouleur: 2 },
  domestique: { climber: 4, sprinter: 1, tt: 2, puncheur: 2, brostensrytter: 1, baroudeur: 4, leadout: 4, rouleur: 4 },
};

// Globalt gulv på sjældne typer (ejer-spec: etape-variation kræver dybde i alle
// discipliner). Håndhæves ved at promovere de billigste over-repræsenterede typer.
const ENSURE_MIN_TYPES = { gc: 30, sprinter: 40 };

// Default-nationalitetsvægte: afspejler prod-feltet (2026-05-31) + garanteret
// repræsentation af ikke-vestlige nationer (se GUARANTEED) for at teste hybrid-
// navnepools' svageste punkt. Vægt ≈ relativ tilstedeværelse i feltet.
export const DEFAULT_NATIONALITY_WEIGHTS = [
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

// Den ægte PCM-stat-skala er HÅRDT [50,85] (verificeret mod prod 2026-06-07:
// 8.969 PCM-ryttere, alle 14 stats i præcis [50,85] — 0 udenfor). Fiktive ryttere
// SKAL holde sig på samme skala: ellers clampes deres outliers til evne-1/99 ved
// kilden i evne-systemet (#1122, abilityDerivation.js: PCM 50→spil-1, 85→spil-99).
// Skalaen er fast (empirisk om PCM), derfor hardcodet — ikke koblet til evne-
// systemets tuning-ankre (CALIBRATION), selvom de tilfældigvis er samme tal nu.
const STAT_FLOOR = 50;
const STAT_CEIL = 85;

// Kalibreret mod den ægte poolede PCM-fordeling (prod 2026-06-07): mean ~60.5,
// sd ~5.6, median 60, p99 ~75, max 85 — dvs. 85 er EKSTREMT sjældent (~1% af
// stats > 75). Modellen holder sig inden for [50,85] ved konstruktion: smalt
// tier-spænd + moderate rolle-boosts + stram gaussian (sd 4). clamp er kun et
// sikkerhedsnet for de sjældne gaussiske haler (ikke en aktiv stat-grænse, som
// det gamle [40,88] var). Specialisering bevares: rolle-primær løftes mærkbart
// over base, så sprintere ≫ klatrere i sprint osv.
function buildStats(rng, tier, archetype) {
  const stats = {};
  const base = tier.statMean + (TYPE_MEAN_ADJUST[archetype.type] ?? 0);
  const dampScale = tier.dampScale ?? 1;
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, tier.sd ?? 3.5);
    if (archetype.boost[key]) v += archetype.boost[key] + intBetween(rng, -2, 2);
    else if (archetype.damp?.includes(key)) v -= intBetween(rng, 5, 10) * dampScale;
    stats[key] = Math.round(clamp(v, STAT_FLOOR, STAT_CEIL));
  }
  // Hårdt gulv → opfyld type-GUARDS ved alle tiers (fx gc's climbing/tt/recovery).
  if (archetype.minStats) {
    for (const [key, floor] of Object.entries(archetype.minStats)) {
      if (stats[key] < floor) stats[key] = Math.round(clamp(floor, STAT_FLOOR, STAT_CEIL));
    }
  }
  // Loft → undgå at leadout/rouleur guardes ud (sprint/speciale < 79 ability ↔ PCM ~78).
  if (archetype.capSprint != null) stats.stat_sp = Math.min(stats.stat_sp, archetype.capSprint);
  if (archetype.capSpeciality != null) {
    for (const key of SPECIALITY_STATS) stats[key] = Math.min(stats[key], archetype.capSpeciality);
  }
  return stats;
}

function buildDemographics(rng, tier, archetype, referenceYear) {
  const age = Math.round(clamp(gaussian(rng, 27, 4.5), 18, 39));
  const birthYear = referenceYear - age;
  const birthMonth = intBetween(rng, 1, 12);
  const birthDay = intBetween(rng, 1, 28);
  const birthdate = `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
  // U25 = under 25 ved referenceåret (matcher import_riders.py-logikken).
  const is_u25 = birthYear > referenceYear - 25;

  const height = Math.round(clamp(gaussian(rng, archetype.heightMean, 5), 165, 196));
  const weight = Math.round(archetype.bmi * (height / 100) ** 2);

  // Potentiale: tier-interval, løftet for unge, sænket for ældre; 0.5-trin.
  const [pLo, pHi] = tier.potential;
  let pot = pLo + rng() * (pHi - pLo);
  pot += (24 - age) * 0.05;
  pot = clamp(Math.round(pot * 2) / 2, 1.0, 6.0);

  return { birthdate, is_u25, height, weight, potentiale: pot, age };
}

export function makeUniqueName(rng, cluster, usedFolded) {
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

  // ── Tier-sekvens via eksakt kvote (ikke Poisson-sampling) ───────────────────
  const tierSeq = [];
  const domestiqueTier = TIERS.find((t) => t.fraction == null);
  for (const t of TIERS) {
    if (t.fraction == null) continue;
    const n = Math.min(Math.round(t.fraction * count), count - tierSeq.length);
    for (let k = 0; k < n; k++) tierSeq.push(t);
  }
  while (tierSeq.length < count) tierSeq.push(domestiqueTier);
  tierSeq.length = count;
  for (let i = tierSeq.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tierSeq[i], tierSeq[j]] = [tierSeq[j], tierSeq[i]];
  }

  // ── Type-sekvens: tier-aware vægtet pick + gulv på sjældne typer ─────────────
  const typeSeq = tierSeq.map((t) => {
    const weights = TIER_TYPE_WEIGHTS[t.value];
    return weightedPick(rng, Object.entries(weights).map(([value, weight]) => ({ value, weight })));
  });
  for (const [type, min] of Object.entries(ENSURE_MIN_TYPES)) {
    let have = typeSeq.filter((x) => x === type).length;
    for (let i = 0; i < typeSeq.length && have < min; i++) {
      if (TIER_TYPE_WEIGHTS[tierSeq[i].value][type] == null) continue; // tier tillader ikke typen
      if (typeSeq[i] === type || ENSURE_MIN_TYPES[typeSeq[i]]) continue; // stjæl ikke fra andet gulv
      typeSeq[i] = type;
      have++;
    }
  }

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

    const tier = tierSeq[i];
    const archetype = ARCHETYPE_BY_TYPE[typeSeq[i]];

    const { firstname, lastname } = makeUniqueName(rng, cluster, usedFolded);
    const stats = buildStats(rng, tier, archetype);
    const demo = buildDemographics(rng, tier, archetype, referenceYear);
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
      // Bevidst udeladt (DB udleder/defaulter, backfill ejer base_value): id, base_value, market_value, salary,
      // team_id, ai_team_id, pending_team_id, prize_earnings_bonus, is_retired,
      // created_at, updated_at, acquired_at.
      _meta: { tier: tier.value, archetype: archetype.type, age: demo.age, cluster: clusterKey },
    });
  }

  return { riders, coverage, seed };
}
