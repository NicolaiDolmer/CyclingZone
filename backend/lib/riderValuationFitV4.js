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
function fitForAlpha(samples, alpha, weights = null) {
  const X = [];
  const y = [];
  const outputs = [];
  for (const s of samples) {
    const O = blendedOutput(s.abilities, s.primary_type, alpha, weights);
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

// #3353: fit KUN type-offsets, med kurven (alpha, a, b, c) holdt fast.
//
// Hvorfor denne findes ved siden af fitProductionModel: issue #3353 beder om at
// "re-fitte offset-tabellen mod den NYE klassifikation". Et fuldt re-fit ændrer
// samtidig kurven — og kurven er det der bestemmer hvor stejlt værdien vokser med
// rytterens niveau, dvs. hele værdifordelingen og den samlede pengemængde. De to
// er forskellige beslutninger med forskellige konsekvenser, og de skal kunne
// træffes hver for sig. Offsets alene flytter kun den RELATIVE pris mellem typer,
// som er præcis det problem frysningen (#3345) efterlod.
//
// Samme to-trins-matematik som fitForAlpha, blot uden OLS-trinnet: residualerne
// måles mod den FASTE kurve, og offset[type] = snittet af dem. r2_log beregnes
// mod samme kurve, så tallet er sammenligneligt med et fuldt fit.
export function fitOffsetsForFixedCurve(samples, { alpha, a, b, c = 0, weights = null } = {}) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error(`fitOffsetsForFixedCurve: too few samples (${samples?.length ?? 0}, min 3)`);
  }
  for (const [name, v] of [["alpha", alpha], ["a", a], ["b", b], ["c", c]]) {
    if (!Number.isFinite(Number(v))) throw new Error(`fitOffsetsForFixedCurve: ${name} must be a finite number (got ${v})`);
  }
  const A = Number(a);
  const B = Number(b);
  const C = Number(c);
  const lin = (O) => A + B * O + C * O * O;

  const outputs = [];
  const y = [];
  for (const s of samples) {
    outputs.push(blendedOutput(s.abilities, s.primary_type, alpha, weights));
    y.push(Math.log(Math.max(Number(s.e_prize) || 0, FLOOR)));
  }

  const residualsByType = {};
  samples.forEach((s, i) => {
    (residualsByType[s.primary_type] ??= []).push(y[i] - lin(outputs[i]));
  });
  const offset = {};
  for (const [t, arr] of Object.entries(residualsByType)) {
    offset[t] = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  let ssRes = 0;
  let ssTot = 0;
  const mY = y.reduce((sum, v) => sum + v, 0) / y.length;
  y.forEach((yi, i) => {
    ssRes += (yi - (lin(outputs[i]) + (offset[samples[i].primary_type] ?? 0))) ** 2;
    ssTot += (yi - mY) ** 2;
  });

  return {
    alpha: Number(alpha),
    a: A,
    b: B,
    c: C,
    offset,
    r2_log: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    n_samples: samples.length,
  };
}

// Fit v4-produktionsmodellen: vælg den alpha i alphaGrid der maksimerer log-R²,
// og returnér dens fulde fit. samples: [{ primary_type, abilities, e_prize }].
export function fitProductionModel(samples, { alphaGrid = [0, 0.25, 0.5, 0.75, 1], weights = null } = {}) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error(`fitProductionModel: too few samples (${samples?.length ?? 0}, min 3)`);
  }
  if (!Array.isArray(alphaGrid) || alphaGrid.length === 0) {
    throw new Error("fitProductionModel: alphaGrid must not be empty");
  }

  let best = null;
  for (const alpha of alphaGrid) {
    const fit = fitForAlpha(samples, alpha, weights);
    if (!best || fit.r2_log > best.r2_log) best = { alpha, ...fit };
  }
  return { ...best, n_samples: samples.length };
}

// #3353: ét eksakt skalerings-skridt. `scale` ganges lineært ind i hver rytters
// værdi (base_value = level · elitePremium(scale · npv)), og medianrytteren ligger
// langt under elite-tærsklen, så medianen er proportional med scale. Den scale der
// rammer medianTarget er derfor scale · medianTarget / medianActual — ingen
// iteration nødvendig. Ugyldigt/ikke-positivt input ⇒ scale uændret (kalderen har
// intet gyldigt mål at kalibrere mod, og må ikke få en NaN-model ud).
export function rescaleToMedian({ scale, medianTarget, medianActual } = {}) {
  const s = Number(scale);
  const t = Number(medianTarget);
  const a = Number(medianActual);
  if (!Number.isFinite(s) || s <= 0) return scale;
  if (!Number.isFinite(t) || t <= 0) return s;
  if (!Number.isFinite(a) || a <= 0) return s;
  return s * (t / a);
}

// Ren prediktion af ln(e_prize_per_season) for én rytter mod et fittet objekt
// (fitProductionModel-output, eller Kontrakt 2's `fit`-underobjekt uændret).
// rider: { abilities, primary_type }. Typer UDEN samples i fittet (offset mangler)
// falder tilbage til det laveste fittede offset — samme fallback-mønster som v3
// #1231 (predictBaseValue i riderValuation.js): 0 ville ellers kunne gøre en
// anchor-løs/sample-løs type kunstigt dyrere end de fittede typer.
export function predictProductionLn({ abilities, primary_type }, fit, weights = null) {
  const O = blendedOutput(abilities, primary_type, fit.alpha, weights);
  const offsets = fit.offset
    ? Object.values(fit.offset).map(Number).filter(Number.isFinite)
    : [];
  const offsetFloor = offsets.length ? Math.min(...offsets) : 0;
  const offset = fit.offset?.[primary_type] ?? offsetFloor;
  return fit.a + fit.b * O + fit.c * O * O + offset;
}
