// Fit-kerne for værdimodel v4 (#2428 slice 1, shadow) — ren og testbar; ingen DB/fs.
// Bruges af scripts/fitRiderValuationV4.js.
//
//   ln(e_prize_per_season) = a + b·O + c·O² + offset[primary_type]
//   O = blendedOutput(abilities, primary_type, alpha)  (riderValuation.js)
//
// Til forskel fra v3 (backend/lib/riderValuationFit.js — ejer-kalibrerede anchors)
// er v4 fittet PÅ SIM-OUTPUT: forventet præmieindtjening pr. sæson pr. rytter,
// produceret af backend/scripts/simulateSeasonProduction.js (Kontrakt 1,
// backend/lib/riderProductionSample.json). alpha (alsidigheds-blend) er her ikke
// ejer-tunet, men valgt via en lille grid-search over log-R² — sim-outputtet ER
// "sandheden" i denne slice, så alpha vælges empirisk i stedet.
//
// To-trins-fit (samme princip som v3's fitValuationModel, se riderValuationFit.js):
// (1) OLS af ln(e_prize) på [1, O, O²] via olsSolve; (2) per-type offset = snit
// af residualerne for de typer der HAR samples i sim'et. Typer uden samples får
// ingen offset her — scoring-siden (predictProductionLn / riderCareerNpv.js)
// falder tilbage til det laveste fittede offset (samme mønster som v3 #1231).
//
// FLOOR: e_prize kan være 0 for ryttere der aldrig placerer sig i pengene over K
// simulerede sæson-runs (svage/uheldige profiler). ln(0) = -Infinity ville gøre
// OLS ubrugelig, så vi floor'er til FLOOR=1 (mindste CZ$-enhed) FØR log. Praktisk
// konsekvens: disse ryttere fittes som "næsten intet værd" — korrekt retning,
// ikke en artefakt der forvrider resten af kurven (log-skalaen dæmper udslaget).

import { olsSolve } from "./riderValuationFit.js";
import { blendedOutput } from "./riderValuation.js";

export const FLOOR = 1;

// Fit modellen for ÉN fast alpha. samples: [{primary_type, abilities, e_prize}].
// Returnerer { a, b, c, offset, r2_log } — offset kun for typer MED ≥1 sample.
function fitForAlpha(samples, alpha) {
  const X = [];
  const y = [];
  const outputs = [];
  for (const s of samples) {
    const O = blendedOutput(s.abilities, s.primary_type, alpha);
    outputs.push(O);
    X.push([1, O, O * O]);
    y.push(Math.log(Math.max(Number(s.e_prize) || 0, FLOOR)));
  }
  const [a, b, c] = olsSolve(X, y);
  const lin = (O) => a + b * O + c * O * O;

  // Per-type offset = snit af residualerne (fixed effect), kun for typer med samples.
  const residualsByType = {};
  samples.forEach((s, i) => {
    (residualsByType[s.primary_type] ??= []).push(y[i] - lin(outputs[i]));
  });
  const offset = {};
  for (const [t, arr] of Object.entries(residualsByType)) {
    offset[t] = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  const predictLn = (i) => lin(outputs[i]) + (offset[samples[i].primary_type] ?? 0);
  let ssRes = 0;
  let ssTot = 0;
  const mY = y.reduce((sum, v) => sum + v, 0) / y.length;
  y.forEach((yi, i) => {
    ssRes += (yi - predictLn(i)) ** 2;
    ssTot += (yi - mY) ** 2;
  });
  const r2_log = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { a, b, c, offset, r2_log };
}

// Fit v4-produktionsmodellen: vælg den alpha i alphaGrid der maksimerer log-R²,
// og returnér dens fulde fit. samples: [{ primary_type, abilities, e_prize }].
export function fitProductionModel(samples, { alphaGrid = [0, 0.25, 0.5, 0.75, 1] } = {}) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error(`fitProductionModel: too few samples (${samples?.length ?? 0}, min 3)`);
  }
  if (!Array.isArray(alphaGrid) || alphaGrid.length === 0) {
    throw new Error("fitProductionModel: alphaGrid must not be empty");
  }

  let best = null;
  for (const alpha of alphaGrid) {
    const fit = fitForAlpha(samples, alpha);
    if (!best || fit.r2_log > best.r2_log) best = { alpha, ...fit };
  }
  return { ...best, n_samples: samples.length };
}

// Ren prediktion af ln(e_prize_per_season) for én rytter mod et fittet objekt
// (fitProductionModel-output, eller Kontrakt 2's `fit`-underobjekt uændret).
// rider: { abilities, primary_type }. Typer UDEN samples i fittet (offset mangler)
// falder tilbage til det laveste fittede offset — samme fallback-mønster som v3
// #1231 (predictBaseValue i riderValuation.js): 0 ville ellers kunne gøre en
// anchor-løs/sample-løs type kunstigt dyrere end de fittede typer.
export function predictProductionLn({ abilities, primary_type }, fit) {
  const O = blendedOutput(abilities, primary_type, fit.alpha);
  const offsets = fit.offset
    ? Object.values(fit.offset).map(Number).filter(Number.isFinite)
    : [];
  const offsetFloor = offsets.length ? Math.min(...offsets) : 0;
  const offset = fit.offset?.[primary_type] ?? offsetFloor;
  return fit.a + fit.b * O + fit.c * O * O + offset;
}
