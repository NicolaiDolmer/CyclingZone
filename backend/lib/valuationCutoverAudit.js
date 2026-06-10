// Audit-kerne for #1101 cutover-gaten (scripts/auditValuationCutover.js) — ren
// og testbar (#1198). Beviser formel-konsistens + domæne-invarianter på riders-
// rækker:
//   (a) aktive ryttere skal have base_value > 0
//   (b) market_value === COALESCE(base_value, fallback) + prize_earnings_bonus
//   (c) salary === max(1, round(10% af market_value))
//   (d) runtime-fallback-formlen (calculateRiderMarketValue) matcher DB'ens
//       GENERATED-formel. VIGTIGT (#1198 cut-M1): market_value STRIPPES fra
//       rækken før kaldet, så fallback-grenen faktisk udøves — med market_value
//       i rækken short-circuiter funktionen til DB-værdien, og checket var en
//       tautologi der matematisk aldrig kunne fyre.
//   (e) vacuous-truth-guard (#1198 cut-M4): 0 aktive ryttere må ALDRIG give
//       grønt — gaten køres netop midt i relaunch-kæden hvor en halvfejlet
//       swap er det mest sandsynlige katastrofescenarie.
//   (f) domæne-invariant (#1198 cut-M3): market_value skal være positiv for
//       aktive ryttere (negativ prize_earnings_bonus kan ellers give priser
//       under nul — der findes ingen DB-CHECK-constraint mod det).
//   (g) opt-in (#1198 cut-M5): expectFictional håndhæver at INGEN aktive
//       ryttere har pcm_id (post-relaunch-tilstanden, epic #1105). Default OFF,
//       da prod FØR relaunchen legitimt kører på rigtige PCM-ryttere.
//
// KENDTE huller (bevidst udeladt — kræver ejer-beslutning): fordelings-bånd
// (flad/inverteret værdi-skala består formel-konsistensen) hører til
// ejer-scorecardet #1196. Se docs/GATE_MUTATION_AUDIT.md.

import { calculateRiderMarketValue, RIDER_BASE_VALUE_FALLBACK } from "./marketUtils.js";

/**
 * @param {Array<object>} riders rækker med base_value, prize_earnings_bonus,
 *   market_value, salary, is_retired, pcm_id (+ navnefelter til rapport)
 * @param {object} [opts]
 *   expectFictional: håndhæv pcm_id IS NULL for aktive (post-relaunch)
 *   marketValueFn: injicerbar runtime-formel (test/mutation-audit)
 * @returns {{ failures: string[], active: Array<object>, counts: object }}
 */
export function auditValuationRows(riders = [], { expectFictional = false, marketValueFn = calculateRiderMarketValue } = {}) {
  const active = riders.filter((r) => !r.is_retired);
  const failures = [];

  if (active.length === 0) {
    failures.push("0 aktive ryttere — auditen er vakuøs (tom riders-tabel eller alle retired efter halvfejlet swap?)");
  }

  const badBase = active.filter((r) => !(Number(r.base_value) > 0));
  if (badBase.length > 0) {
    failures.push(`${badBase.length} aktive ryttere med base_value NULL/0 (fx ${badBase.slice(0, 3).map((r) => `${r.firstname} ${r.lastname}`).join(", ")})`);
  }

  let mvMismatch = 0, salMismatch = 0, runtimeMismatch = 0;
  for (const r of riders) {
    const base = Number(r.base_value) > 0 ? Number(r.base_value) : RIDER_BASE_VALUE_FALLBACK;
    const expectMv = base + (Number(r.prize_earnings_bonus) || 0);
    const expectSal = Math.max(1, Math.round(expectMv * 0.10));
    if (r.market_value !== expectMv) mvMismatch++;
    if (r.salary !== expectSal) salMismatch++;
    const { market_value: _stripped, ...withoutMv } = r;
    if (marketValueFn(withoutMv) !== expectMv) runtimeMismatch++;
  }
  if (mvMismatch) failures.push(`${mvMismatch} ryttere hvor market_value ≠ COALESCE(base_value,${RIDER_BASE_VALUE_FALLBACK}) + bonus (kører den gamle uci-formel stadig?)`);
  if (salMismatch) failures.push(`${salMismatch} ryttere hvor salary ≠ max(1, round(10% af market_value))`);
  if (runtimeMismatch) failures.push(`${runtimeMismatch} ryttere hvor runtime-fallback-formlen divergerer fra DB'ens GENERATED-formel`);

  const nonPositiveMv = active.filter((r) => !(Number(r.market_value) > 0));
  if (nonPositiveMv.length > 0) {
    failures.push(`${nonPositiveMv.length} aktive ryttere med market_value ≤ 0 (negativ prize_earnings_bonus? fx ${nonPositiveMv.slice(0, 3).map((r) => `${r.firstname} ${r.lastname} = ${r.market_value}`).join(", ")})`);
  }

  let realActive = 0;
  if (expectFictional) {
    const real = active.filter((r) => r.pcm_id != null);
    realActive = real.length;
    if (real.length > 0) {
      failures.push(`${real.length} aktive ryttere med pcm_id (rigtige ryttere overlevede relaunch — fx ${real.slice(0, 3).map((r) => `${r.firstname} ${r.lastname}`).join(", ")})`);
    }
  }

  return {
    failures,
    active,
    counts: {
      total: riders.length,
      active: active.length,
      badBase: badBase.length,
      mvMismatch,
      salMismatch,
      runtimeMismatch,
      nonPositiveMv: nonPositiveMv.length,
      realActive,
    },
  };
}
