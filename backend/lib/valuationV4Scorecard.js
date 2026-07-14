// Ren gate-kerne for Værdimodel v4 scorecardet (#2428 slice 1, shadow) — bruges af
// scripts/valuationV4Scorecard.js. Ingen I/O her (samme princip som
// valuationScorecard.js/riderValuationFit.js): kun aggregering + gate-matematik,
// testbart med node --test uden DB og uden runtime-afhængighed af
// backend/lib/riderCareerNpv.js (Kontrakt 3, bygget parallelt — se scriptet for
// den faktiske integration).
//
// Gates fra spec §5 (docs/superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md,
// mirrored i den delte kontrakt-fil, Kontrakt 4):
//   1. Type-økonomi          (RAPPORT)   2. Skala-kontinuitet   (HÅRD, ±15% median-drift)
//   3. Udvikl-og-sælg P&L    (HÅRD)      4. Symmetri            (RAPPORT, career-trajectories)
//   5. Elite ukøbelig        (HÅRD)      6. Anker-sanity        (BLØD — rapporteres, blokerer ALDRIG)
//   7. Determinisme          (HÅRD, sim_run_id sat)
//
// Hver gate-række har { name, hard, ok, detail, ... }. "hard: true" gates blokerer
// scriptets exit-kode (se allHardGatesPass); "hard: false" gates (rapport-tabeller +
// anker-sanity) rapporteres men fejler ALDRIG kørslen.

import { ACADEMY } from "./academyFlag.js";
import { percentile } from "./valuationScorecard.js";
import { buildCaps } from "./riderProgression.js";
// #2428: fremskrivnings-skridtet deles med predictBaseValueV4 (riderCareerNpv.js) —
// ren funktion, ingen DB — så udvikl-og-sælg-gaten bruger PRÆCIST samme matematik
// som v4-værdiberegningen (ingen drift). riderCareerNpv.js har ingen I/O-afhængighed.
import { expectedNextAbilities } from "./riderCareerNpv.js";

const finite = (n) => Number.isFinite(Number(n));
const fmtCZ = (n) => (finite(n) ? Math.round(n).toLocaleString("da-DK") : "—");

// ---------------------------------------------------------------------------
// Fælles aggregering
// ---------------------------------------------------------------------------

// p10/median/p90/total/n over et array af tal (usorteret input ok — sorteres
// internt, da percentile() kræver et sorteret array). Non-finite værdier kasseres
// defensivt (kald med allerede-filtrerede arrays for eksplicit kontrol).
export function populationStats(values) {
  // Filtrér null/undefined FØR Number(): Number(null)===0 er "finite" og ville
  // ellers stille smugle en falsk 0-værdi ind for manglende data.
  const vals = (values || [])
    .filter((v) => v != null)
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return { n: 0, p10: null, median: null, p90: null, total: 0 };
  return {
    n,
    p10: percentile(vals, 0.10),
    median: percentile(vals, 0.50),
    p90: percentile(vals, 0.90),
    total: vals.reduce((s, v) => s + v, 0),
  };
}

// ---------------------------------------------------------------------------
// Gate 1 — Type-økonomi-tabel (RAPPORT)
// ---------------------------------------------------------------------------

// samples: [{ primary_type, e_prize }] (Kontrakt 1: riderProductionSample.json).
// v3Offset: v3-modellens { type: number } (log-skala fixed-effect, riderValuationModel.json).
export function typeEconomyRows(samples, v3Offset = {}) {
  const byType = new Map();
  for (const s of samples || []) {
    const t = s?.primary_type;
    if (!t || !finite(s?.e_prize)) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(Number(s.e_prize));
  }
  const rows = [];
  for (const [type, vals] of byType) {
    const sorted = [...vals].sort((a, b) => a - b);
    const offset = finite(v3Offset[type]) ? Number(v3Offset[type]) : null;
    rows.push({
      type,
      n: sorted.length,
      medianEPrize: percentile(sorted, 0.5),
      p90EPrize: percentile(sorted, 0.9),
      v3Offset: offset,
      // offsets er log-skala fixed-effects; ×mult gør dem sammenlignelige "sort på
      // hvidt" mod den målte E[produktion] (spec §5.1: "vis hvor perception≠spil").
      v3OffsetMultiplier: offset != null ? Math.exp(offset) : null,
    });
  }
  rows.sort((a, b) => b.medianEPrize - a.medianEPrize);
  return rows;
}

export function formatTypeEconomyTable(rows = []) {
  const L = [];
  L.push("| Type | n | Median E[prize] | p90 E[prize] | v3 offset (log) | v3 offset ×mult |");
  L.push("|---|--:|--:|--:|--:|--:|");
  for (const r of rows) {
    L.push(
      `| ${r.type} | ${r.n} | ${fmtCZ(r.medianEPrize)} | ${fmtCZ(r.p90EPrize)} | ${r.v3Offset != null ? r.v3Offset.toFixed(3) : "—"} | ${r.v3OffsetMultiplier != null ? `×${r.v3OffsetMultiplier.toFixed(2)}` : "—"} |`
    );
  }
  return L;
}

// ---------------------------------------------------------------------------
// Gate 2 — Skala-kontinuitet (HÅRD)
// ---------------------------------------------------------------------------

export function scaleContinuityGate(v3Values, v4Values, { maxDriftPct = 0.15 } = {}) {
  const v3 = populationStats(v3Values);
  const v4 = populationStats(v4Values);
  const haveData = v3.n > 0 && v4.n > 0 && finite(v3.median) && v3.median !== 0;
  const driftPct = haveData ? (v4.median - v3.median) / v3.median : null;
  const ok = haveData && Math.abs(driftPct) <= maxDriftPct;
  return {
    name: "Skala-kontinuitet: median-drift v3→v4",
    hard: true,
    ok,
    detail: haveData
      ? `p10/median/p90 v3=${fmtCZ(v3.p10)}/${fmtCZ(v3.median)}/${fmtCZ(v3.p90)} · v4=${fmtCZ(v4.p10)}/${fmtCZ(v4.median)}/${fmtCZ(v4.p90)} · drift=${(driftPct * 100).toFixed(1)}% (grænse ±${(maxDriftPct * 100).toFixed(0)}%)`
      : `utilstrækkelig data (v3 n=${v3.n}, v4 n=${v4.n})`,
    stats: { v3, v4, driftPct, maxDriftPct },
  };
}

// ---------------------------------------------------------------------------
// Gate 5 — Elite ukøbelig (HÅRD) — afløser den tidligere runaway-gate
// ---------------------------------------------------------------------------
// Ejer-retning 14/7: de ENORMT gode ryttere skal være ukøbelige i 3-4 sæsoner.
// Runaway-gaten (total ≤ ×2) er derfor forældet — ejeren VIL have en tung top.
// Ny hård gate: hver rytter med overall ≥ ELITE_CHECK_OVERALL skal koste MERE end
// råd-loftet (rigeste holds saldo + N sæsoners max-opsparing, fra model.elite_premium),
// dvs. bogstaveligt uden for rækkevidde. Tunbar tærskel.
export const ELITE_CHECK_OVERALL = 55;

export function eliteUnbuyableGate(riders = [], { ceiling, eliteOverall = ELITE_CHECK_OVERALL } = {}) {
  const haveCeiling = Number.isFinite(Number(ceiling)) && Number(ceiling) > 0;
  const elite = riders.filter((r) => Number(r.overall) >= eliteOverall && Number.isFinite(Number(r.v4Value)));
  const minElite = elite.length ? Math.min(...elite.map((r) => Number(r.v4Value))) : null;
  const maxV4 = riders.length ? Math.max(...riders.map((r) => Number(r.v4Value) || 0)) : null;
  const ok = haveCeiling && elite.length > 0 && minElite > Number(ceiling);
  return {
    name: `Elite ukøbelig: alle overall≥${eliteOverall} > råd-loft`,
    hard: true,
    ok,
    detail: !haveCeiling
      ? "intet råd-loft i modellen (elite_premium mangler)"
      : elite.length === 0
        ? `ingen ryttere med overall≥${eliteOverall} i populationen`
        : `${elite.length} elite-ryttere · billigste=${fmtCZ(minElite)} vs råd-loft=${fmtCZ(ceiling)} · dyreste=${fmtCZ(maxV4)}`,
    stats: { nElite: elite.length, minElite, ceiling: Number(ceiling) || null, maxV4 },
  };
}

// ---------------------------------------------------------------------------
// Gate 3 — Udvikl-og-sælg P&L (HÅRD)
// ---------------------------------------------------------------------------
// #1364 §5-kriterierne findes ikke som en selvstændig, genbrugelig eksport i repoet
// (grep 13/7: kun scripts/valueDevelopSellScorecard.js implementerer P&L-beregningen
// direkte i sit script-body, linje 89-98). Vi GENBRUGER dén omkostningsmodel (signing-fee
// + N sæsoners drift+løn mod bvStart, ACADEMY-konstanterne fra academyFlag.js) og
// tilføjer selv "ikke dominant"-kriteriet fra v4-specs §5.3, da det ikke fandtes
// nogen steder i kode:
//   (a) NET-POSITIV: bvAtHorizon − bvStart − omkostninger > 0.
//   (b) IKKE DOMINANT: AFKASTET (ROI = pnl / investeret) er begrænset. VIGTIGT
//       (#2428, rettet 13/7 efter shadow-kørsler): "dominans" måles på ØKONOMIEN,
//       ikke på en værdi-sammenligning. Tidligere versioner testede top-ung-værdi
//       mod veteran (forkert — NPV SKAL prise unge over veteraner) og derefter mod
//       en peak-stjerne (også forkert — den sammenligner en FREMTIDIG projekteret
//       værdi mod en NUTIDIG, så en top-prospect fejler altid; det er hele pointen
//       med at udvikle talent at det overgår nuværende ryttere). Den korrekte test:
//       udvikl-og-sælg må ikke give et så højt garanteret afkast at det bliver den
//       dominerende strategi. ROI ≤ maxRoi (default 50% over hele vinduet) = sundt
//       incitament til ungdom uden at dominere. Ejer-tunbar.
export const MAX_DEVELOP_SELL_ROI = 0.5;

export function developAndSellPnl({ bvStart, bvAtHorizon, seasons, academy = ACADEMY } = {}) {
  if (![bvStart, bvAtHorizon, seasons].every(finite)) return null;
  const salaryPerSeason = academy.SALARY_RATE * bvStart;
  const cost = academy.SIGNING_FEE_RATE * bvStart + seasons * (academy.DRIFT_PER_SEASON + salaryPerSeason);
  return { pnl: bvAtHorizon - bvStart - cost, cost };
}

export function developAndSellGate({
  bvStart,
  bvAtHorizon,
  seasons,
  maxRoi = MAX_DEVELOP_SELL_ROI,
  academy = ACADEMY,
} = {}) {
  const calc = developAndSellPnl({ bvStart, bvAtHorizon, seasons, academy });
  const netPositive = calc != null && calc.pnl > 0;
  const invested = calc != null ? bvStart + calc.cost : null;
  const roi = calc != null && invested > 0 ? calc.pnl / invested : null;
  const notDominant = roi == null || roi <= maxRoi;
  const ok = calc != null && netPositive && notDominant;
  const parts = [
    calc != null
      ? `pnl=${fmtCZ(calc.pnl)} CZ$ (bvStart=${fmtCZ(bvStart)}→bvHorisont=${fmtCZ(bvAtHorizon)}, cost=${fmtCZ(calc.cost)}, ${seasons} sæsoner)`
      : "utilstrækkelig data til P&L",
    `net-positiv=${netPositive}`,
    roi != null
      ? `ikke-dominant=${notDominant} (ROI ${(roi * 100).toFixed(0)}% vs loft ${(maxRoi * 100).toFixed(0)}%)`
      : "ikke-dominant=ubekræftet (manglende P&L)",
  ];
  return {
    name: "Udvikl-og-sælg P&L: ung prospect net-positiv, ikke dominant (ROI-begrænset)",
    hard: true,
    ok,
    detail: parts.join(" · "),
    pnl: calc?.pnl ?? null,
    roi,
  };
}

// ---------------------------------------------------------------------------
// Gate 3-støtte — fremskriv abilities N sæsoner (FORVENTNING, noise=0)
// ---------------------------------------------------------------------------
// Fremskriver evnerne `seasons` sæsoner (FORVENTNING, noise=0) ved at kalde det
// DELTE ét-sæson-skridt expectedNextAbilities fra riderCareerNpv.js — så gaten
// fremskriver med PRÆCIST samme matematik som predictBaseValueV4 selv (ingen drift).
// Bruges KUN til at finde "bvAtHorizon" til udvikl-og-sælg-gaten (spejler
// #1364-mønstret: bvEnd = bv(developedAbilities), men v4-analogen kræver evnerne
// fremskrevet FØR predictBaseValueV4 kaldes igen på den nye alder). caps bygges ÉN
// gang fra start-evnerne (uforanderligt loft), præcis som i simulateCareer.
export function projectAbilitiesForward(abilities, { primaryType, potentiale, startAge } = {}, seasons = 0) {
  const caps = buildCaps(abilities, primaryType, potentiale);
  let ab = { ...abilities };
  for (let s = 0; s < seasons; s++) {
    ab = expectedNextAbilities(ab, caps, { primary_type: primaryType, potentiale, age: startAge + s });
  }
  return { abilities: ab, ageAtHorizon: startAge + seasons };
}

// ---------------------------------------------------------------------------
// Gate 6 — Anker-sanity (BLØD — rapporteres, blokerer ALDRIG exit 1)
// ---------------------------------------------------------------------------

// orderingResult = checkAnchorOrdering(...)-output ({hard, soft}) fra
// riderValuationFit.js — scriptet kalder den med v4-predikerede værdier for de
// navne-matchede anchors. hard: false uanset udfald (spec §5.6: "spillets data").
export function anchorSanityRow(orderingResult = { hard: [], soft: [] }) {
  const hard = orderingResult?.hard ?? [];
  const soft = orderingResult?.soft ?? [];
  const clean = hard.length === 0 && soft.length === 0;
  return {
    name: "Anker-sanity: top-anchor-rangorden (≥15M) — blød, rapporteres kun",
    hard: false,
    ok: clean,
    detail: clean
      ? "ingen afvigelser fra ejer-anchor-rækkefølgen"
      : `${hard.length + soft.length} afvigelser (${hard.length} i det hårde bånd) — rapporteres som "spillets data", blokerer ikke`,
    hardBreaks: hard,
    softBreaks: soft,
  };
}

// ---------------------------------------------------------------------------
// Gate 7 — Determinisme (HÅRD)
// ---------------------------------------------------------------------------

export function determinismGate({ simRunId } = {}) {
  const ok = typeof simRunId === "string" && simRunId.length > 0;
  return {
    name: "Determinisme: model.sim_run_id sat",
    hard: true,
    ok,
    detail: ok ? `sim_run_id=${simRunId}` : "model.sim_run_id mangler/tom — fit-kørslen er ikke sporbar",
  };
}

// ---------------------------------------------------------------------------
// Gate 4 — Symmetri (RAPPORT): trajectory-formattering
// ---------------------------------------------------------------------------

// rows: careerTrajectory(...)-output fra riderCareerNpv.js:
//   [{ s, age, O, prod, survival, discounted }, ...]
// Ren markdown-formattering — ingen afhængighed af riderCareerNpv.js selv (scriptet
// leverer allerede-beregnede rows).
export function formatTrajectoryTable(archetypeLabel, rows = []) {
  const L = [];
  L.push(`**${archetypeLabel}**`);
  L.push("");
  L.push("| Alder | Output O | E[produktion] sæson (CZ$) | Survival | Diskonteret bidrag (CZ$) |");
  L.push("|--:|--:|--:|--:|--:|");
  for (const r of rows) {
    const survivalPct = finite(r.survival) ? `${(r.survival * 100).toFixed(0)}%` : "—";
    L.push(`| ${r.age ?? "?"} | ${finite(r.O) ? r.O.toFixed(1) : "—"} | ${fmtCZ(r.prod)} | ${survivalPct} | ${fmtCZ(r.discounted)} |`);
  }
  return L;
}

export function symmetryReportRow(archetypeCount) {
  const ok = Number(archetypeCount) > 0;
  return {
    name: "Symmetri: career-trajectories genereret",
    hard: false,
    ok,
    detail: ok ? `${archetypeCount} arketyper` : "ingen trajectories tilgængelige (careerTrajectory returnerede tomt/ugyldigt)",
  };
}

// ---------------------------------------------------------------------------
// Exit-kode
// ---------------------------------------------------------------------------

export function allHardGatesPass(gates = []) {
  return gates.filter((g) => g.hard).every((g) => g.ok);
}
