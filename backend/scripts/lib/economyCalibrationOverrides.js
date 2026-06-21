// #1441/#1607 economy calibration overrides — CALIBRATION-ONLY parameter overrides.
//
// FORMÅL: lade kalibrerings-harnesset (prizeDistributionScorecard + economyCalibrationSweep)
// variere økonomi-knapperne UDEN at røre prod-konstanter. Prod-source of truth forbliver
// backend/lib/economyConstants.js + backend/lib/uciRacePointDefaults.js — UÆNDRET. Disse
// overrides anvendes KUN i de syntetiske scripts (ingen DB, ingen prod-impact).
//
// Tre knapper (ejer-beslutning 2026-06-21, spec §1 A–C):
//   (a) sponsorBase   — per-division stadion-indtægts-base (erstatter SPONSOR_INCOME_BY_DIVISION)
//   (b) prizePerPoint — niveau-knap (erstatter PRIZE_PER_POINT i prize = points × ppp)
//   (c) flatten       — fordelings-form: komprimér GC-toppen mod kurvens gennemsnit +
//                       omfordel vægt mod etapesejre + holdklassement (anti-divergens)
//
// Overrides læses fra (prioritet): eksplicit arg-objekt > --config=fil.json > env-vars.
//   env:  CZ_CAL_SPONSOR_D1/D2/D3, CZ_CAL_PRIZE_PER_POINT, CZ_CAL_FLATTEN
//   cfg:  { "sponsorBase": {"1":..,"2":..,"3":..}, "prizePerPoint": .., "flatten": .. }

import { readFileSync } from "node:fs";

import {
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  PRIZE_PER_POINT,
} from "../../lib/economyConstants.js";

// Result-typer der er "top-tunge" klassementer → komprimeres af flatten.
const TOP_HEAVY_RESULT_TYPES = new Set(["Klassement", "Klassiker"]);
// Result-typer der belønner bredde (etapesejre + holdklassement) → boostes af flatten.
const BREADTH_RESULT_TYPES = new Set(["Etapeplacering", "EtapelobHold", "KlassikerHold"]);
// Hvor meget breadth-typerne maksimalt boostes ved flatten=1 (×(1+BOOST)).
// Override-bar via CZ_CAL_BREADTH_BOOST / cfg.breadthBoost: empirisk viste det sig at
// breadth-boost ØGER divergens i den rige-roster-model (stærke hold vinder også etaper),
// så ren GC-kompression (boost=0) kan være at foretrække — sweep'en kan teste begge.
const DEFAULT_BREADTH_BOOST_AT_FULL = 0.6;

function num(v, def) {
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Læs --config=fil.json hvis givet.
function readConfigArg(argv) {
  const hit = argv.find((a) => a.startsWith("--config="));
  if (!hit) return {};
  const file = hit.split("=").slice(1).join("=");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Kunne ikke læse --config=${file}: ${e.message}`, { cause: e });
  }
}

// Saml det effektive override-sæt. explicit > config-fil > env > prod-default.
export function resolveOverrides(explicit = {}, argv = process.argv, env = process.env) {
  const cfg = readConfigArg(argv);

  const sponsorBase = { ...SPONSOR_INCOME_BY_DIVISION };
  for (const d of [1, 2, 3]) {
    const fromExplicit = explicit.sponsorBase?.[d];
    const fromCfg = cfg.sponsorBase?.[d] ?? cfg.sponsorBase?.[String(d)];
    const fromEnv = env[`CZ_CAL_SPONSOR_D${d}`];
    sponsorBase[d] = num(fromExplicit, num(fromCfg, num(fromEnv, SPONSOR_INCOME_BY_DIVISION[d])));
  }

  const upkeep = { ...UPKEEP_BY_DIVISION };
  for (const d of [1, 2, 3]) {
    const fromExplicit = explicit.upkeep?.[d];
    const fromCfg = cfg.upkeep?.[d] ?? cfg.upkeep?.[String(d)];
    const fromEnv = env[`CZ_CAL_UPKEEP_D${d}`];
    upkeep[d] = num(fromExplicit, num(fromCfg, num(fromEnv, UPKEEP_BY_DIVISION[d])));
  }

  const prizePerPoint = num(
    explicit.prizePerPoint,
    num(cfg.prizePerPoint, num(env.CZ_CAL_PRIZE_PER_POINT, PRIZE_PER_POINT))
  );

  // flatten ∈ [0,1]; 0 = uændret prod-kurve, 1 = maksimal komprimering.
  let flatten = num(explicit.flatten, num(cfg.flatten, num(env.CZ_CAL_FLATTEN, 0)));
  flatten = Math.max(0, Math.min(1, flatten));

  // breadthBoost ≥ 0: hvor meget etape/hold-typer skaleres ved flatten=1.
  const breadthBoost = Math.max(
    0,
    num(explicit.breadthBoost, num(cfg.breadthBoost, num(env.CZ_CAL_BREADTH_BOOST, DEFAULT_BREADTH_BOOST_AT_FULL)))
  );

  return { sponsorBase, upkeep, prizePerPoint, flatten, breadthBoost };
}

// Komprimér én skala (array af point pr. rank, desc) mod dens gennemsnit med faktor f.
// f=0 → uændret; f=1 → alle ranks = gennemsnit (helt flad). Bevarer total-summen
// (ren omfordeling inden for skalaen) så niveau-knappen (prizePerPoint) forbliver
// den eneste der ændrer NIVEAUET; flatten ændrer kun FORMEN.
function compressTowardMean(points, f) {
  if (!points.length || f <= 0) return points;
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  return points.map((p) => p + (mean - p) * f);
}

// Reshape de rå UCI-point-rows efter flatten-faktoren:
//   • top-tunge klassementer (Klassement/Klassiker) komprimeres mod deres egen middel
//     (summen bevaret) → mindre forskel mellem stærke og svage hold (lavere divergens)
//   • breadth-typer (etapeplacering + holdklassement) skaleres ×(1+f·BOOST) → vægt
//     flyttes mod etapesejre + holdklassement (ejer-direktiv C)
// Prod-rows leveres af buildUciMenRacePointRows() og er UÆNDREDE på disk; vi
// transformerer KUN den in-memory kopi som scorecardet bruger.
export function applyFlattenToPointRows(rows, flatten, breadthBoost = DEFAULT_BREADTH_BOOST_AT_FULL) {
  if (!flatten || flatten <= 0) return rows.map((r) => ({ ...r }));

  // Grupper top-tunge skalaer pr. (race_class, result_type) for sum-bevarende kompression.
  const groups = new Map();
  for (const r of rows) {
    if (!TOP_HEAVY_RESULT_TYPES.has(r.result_type)) continue;
    const key = `${r.race_class}__${r.result_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const compressed = new Map(); // key → Map(rank → newPoints)
  for (const [key, grp] of groups) {
    const sorted = [...grp].sort((a, b) => a.rank - b.rank);
    const newPts = compressTowardMean(sorted.map((r) => r.points), flatten);
    const rankMap = new Map();
    sorted.forEach((r, i) => rankMap.set(r.rank, newPts[i]));
    compressed.set(key, rankMap);
  }

  return rows.map((r) => {
    const out = { ...r };
    const key = `${r.race_class}__${r.result_type}`;
    if (compressed.has(key)) {
      out.points = Math.round(compressed.get(key).get(r.rank));
    } else if (breadthBoost > 0 && BREADTH_RESULT_TYPES.has(r.result_type)) {
      out.points = Math.round(r.points * (1 + flatten * breadthBoost));
    }
    return out;
  });
}

export function describeOverrides(ov) {
  return (
    `sponsor D1=${ov.sponsorBase[1]} D2=${ov.sponsorBase[2]} D3=${ov.sponsorBase[3]} · ` +
    `upkeep D1=${ov.upkeep[1]} D2=${ov.upkeep[2]} D3=${ov.upkeep[3]} · ` +
    `prizePerPoint=${ov.prizePerPoint} · flatten=${ov.flatten} · breadthBoost=${ov.breadthBoost}`
  );
}
