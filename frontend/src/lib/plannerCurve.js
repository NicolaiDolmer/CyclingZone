// Season Planner — form-kurve-projektion (spec §3A: potentiel top vs realiseret top).
//
// Der findes INGEN persisteret historisk form-tidsserie (kun rider_condition.form
// som nuværende punkt). Kurven er derfor en ILLUSTRATIV projektion: en baseline
// (rytterens nuværende form) + et peak-bump om hvert vindue + et payback-hul efter.
// Den PÆDAGOGISKE pointe (koblingen, spec §2) er forskellen mellem to kurver:
//   potentiel top = fuldt bump (som om tq=1)
//   realiseret top = bump × trainingQuality (hvor godt optakten faktisk trænes)
// Kløften mellem dem ER den tabte form af utilstrækkelig træning, gjort synlig.
//
// Amplituderne er DISPLAY-konstanter (form-point på 0-100-aksen), ikke motorens
// score-fraktion (PEAK_MAX=0.02) — kurven fortæller historien, motoren afgør løbet.
// Rene funktioner (ingen Date/DOM), så de kan unit-testes og SVG'et blot sampler.

export const CURVE_PEAK_AMPLITUDE = 34;     // form-point ved en fuldt realiseret top
export const CURVE_PAYBACK_RATIO = 0.34;    // payback-hullets dybde relativt til bump
export const CURVE_SIGMA_DAYS = 3.2;        // bumpets bredde (dage)
export const CURVE_PAYBACK_OFFSET_DAYS = 3; // hvor payback-hullet centreres efter vindue-slut

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function gauss(distanceDays, sigma) { return Math.exp(-(distanceDays * distanceDays) / (2 * sigma * sigma)); }

/**
 * Form-delta (± point) på en given dag fra rytterens peak-vinduer.
 * @param {number} ordinal  CET-dag-ordinal at evaluere
 * @param {Array<{windowStartOrd:number, windowEndOrd:number, trainingQuality?:number|null}>} peaks
 * @param {{realized?:boolean, paybackDays?:number}} [opts]  realized=true → skalér med tq
 * @returns {number}
 */
export function formDeltaAt(ordinal, peaks, { realized = false, paybackDays = 7 } = {}) {
  let delta = 0;
  for (const p of peaks || []) {
    if (p.windowStartOrd == null || p.windowEndOrd == null) continue;
    const center = (p.windowStartOrd + p.windowEndOrd) / 2;
    const tq = p.trainingQuality == null ? 1 : clamp(Number(p.trainingQuality) || 0, 0, 1);
    const amp = CURVE_PEAK_AMPLITUDE * (realized ? tq : 1);
    delta += amp * gauss(ordinal - center, CURVE_SIGMA_DAYS);
    if (ordinal > p.windowEndOrd) {
      const pbCenter = p.windowEndOrd + Math.min(CURVE_PAYBACK_OFFSET_DAYS, paybackDays / 2);
      delta -= CURVE_PEAK_AMPLITUDE * CURVE_PAYBACK_RATIO * gauss(ordinal - pbCenter, CURVE_SIGMA_DAYS);
    }
  }
  return delta;
}

/**
 * Absolut form-værdi (0-100) på en dag = baseline + delta, klampet.
 * @param {number} ordinal
 * @param {number} baseline  nuværende form (0-100)
 * @param {Array} peaks
 * @param {object} [opts]
 * @returns {number}
 */
export function formValueAt(ordinal, baseline, peaks, opts) {
  return clamp((Number(baseline) || 0) + formDeltaAt(ordinal, peaks, opts), 0, 100);
}

/**
 * Sampl potentiel + realiseret form-kurve over et dag-interval → to y-arrays (0-100).
 * SVG'et mapper ordinal→x og y→pixel.
 * @param {{baseline:number, peaks:Array, startOrd:number, endOrd:number, samples?:number, paybackDays?:number}} args
 * @returns {{ordinals:number[], baseline:number, potential:number[], realized:number[]}}
 */
export function sampleFormCurves({ baseline, peaks, startOrd, endOrd, samples = 96, paybackDays = 7 }) {
  const ordinals = [];
  const potential = [];
  const realized = [];
  const span = endOrd - startOrd;
  for (let i = 0; i <= samples; i++) {
    const ord = startOrd + (span * i) / samples;
    ordinals.push(ord);
    potential.push(formValueAt(ord, baseline, peaks, { realized: false, paybackDays }));
    realized.push(formValueAt(ord, baseline, peaks, { realized: true, paybackDays }));
  }
  return { ordinals, baseline: clamp(Number(baseline) || 0, 0, 100), potential, realized };
}
