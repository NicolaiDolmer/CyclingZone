#!/usr/bin/env node
// #1441 Fase 3 bølge A2 — facility-investment-scorecard. MERGE-GATE for FACILITIES_ENABLED.
// Fire gates (spec §2.3 + §2.4 + §2.1/§5):
//   (1) Anti-optimal-path: ≥3 investerings-strategier inden for ±15% af bedste (EJER-VALG
//       2026-07-05; før ±10%) langsigtede holdstyrke-proxy — pr. division, robust over
//       leverage-sensitivitet. ±15% giver staff-specialisering plads til at være en reel
//       strategisk løftestang med robuste marginer (se A4-audit).
//   (2) Kommerciel payback ≥ COMMERCIAL_MIN_PAYBACK_SEASONS (aldrig selvfinansierende
//       hurtigere) — mest gunstige kombination af tier/staff/division tæller.
//   (3) Tid-som-valuta: tier-priser i "sæsoner af repræsentativ præmie-indkomst" inden
//       for spec-forankrede bånd (T1≈0,5 D3 · T3≈1 D2 · T5≈2+ D1).
//   (4) Form-gates (§2.1-intent): pris-trappe monoton uden anomalier · upkeep er det
//       MINDRE sink · effekt strengt stigende pr. tier · staff-løn i relevant forhold
//       til staff-værdi. Tilføjet efter review af første kalibrering (8235bc46) der
//       viste at rene niveau-gates lod konstanterne degenerere i formen.
// 100% syntetisk — ingen DB, prod-konstanter UÆNDREDE af en kørsel.
//   node scripts/facilityInvestmentScorecard.js [--config=fil.json] [--seasons=10] [--markdown]
import { readFileSync } from "node:fs";
// Plan B (#1441): gate (6) verificerer den LIVE trænings-wiring mod prod-kæden selv —
// disse imports er prod-SSOT (ikke model-kopier) og påvirkes bevidst IKKE af --config.
import { dailyAbilityDelta } from "../lib/dailyTraining.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "../lib/staffTrainingBonus.js";
import { effectiveBonus } from "../lib/facilityEngine.js";
import { deriveStaffAbilities } from "../lib/staffAbilityDerivation.js";
import { EFFECT_LIVE_BY_TRACK } from "../lib/facilityConstants.js";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES, PRIZE_ESTIMATE_BY_DIVISION,
  runAntiOptimalPath, computeCommercialPayback, computePriceInSeasons, computeFormGates,
  runSpecializationBalance, SPECIALIZATION_BALANCE, RECURRING_CAP,
} from "./lib/facilityInvestmentModel.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const fseas = (n) => (Number.isFinite(n) ? n.toFixed(1) : "∞");

// --config: delvis override af constants-bundlet (kun angivne nøgler erstattes).
function resolveConstants() {
  const cfgArg = arg("config", null);
  if (!cfgArg || cfgArg === true) return { constants: DEFAULT_MODEL_CONSTANTS, overridden: false };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgArg, "utf8"));
  } catch (e) {
    throw new Error(`Kunne ikke læse --config=${cfgArg}: ${e.message}`, { cause: e });
  }
  const merged = { ...DEFAULT_MODEL_CONSTANTS };
  for (const key of ["price", "upkeep", "staffSalary", "effect", "sponsorBase", "minPaybackSeasons"]) {
    if (cfg[key] != null) {
      merged[key] = key === "effect"
        ? { ...DEFAULT_MODEL_CONSTANTS.effect, ...cfg.effect }
        : (typeof cfg[key] === "object" ? { ...DEFAULT_MODEL_CONSTANTS[key], ...cfg[key] } : cfg[key]);
    }
  }
  return { constants: merged, overridden: true, file: cfgArg };
}

function main() {
  const seasons = parseInt(arg("seasons", "10"), 10);
  const markdown = !!arg("markdown", false);
  const { constants, overridden, file } = resolveConstants();

  console.log("=== #1441 FACILITY-INVESTMENT-SCORECARD (bølge A2 — merge-gate for FACILITIES_ENABLED) ===\n");
  if (overridden) console.log(`OVERRIDE AKTIV (--config=${file}) — prod-konstanter uændrede.\n`);
  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Investérbart budget    : repræsentativ præmie-indkomst D1 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[1])} / D2 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[2])} / D3 ${fmt(PRIZE_ESTIMATE_BY_DIVISION[3])} pr. sæson`);
  console.log(`                             (driften er ~break-even by design → overskuds-laget ≈ præmien; BLØDT input)`);
  console.log(`  • Leverage (BLØDT)       : training ${DEFAULT_LEVERAGE.training} · medical ${DEFAULT_LEVERAGE.medical} · scouting ${DEFAULT_LEVERAGE.scouting} · academy-slot ${fmt(DEFAULT_LEVERAGE.academySlotValue)}/sæson`);
  console.log(`  • Recurring-cap          : ${RECURRING_CAP} × budget (køb stopper før insolvens)`);
  console.log(`  • Horisont               : ${seasons} sæsoner\n`);

  // ── Gate 3: tid-som-valuta (§2.4) ──────────────────────────────────────────────
  const pis = computePriceInSeasons({ constants });
  console.log("── GATE: tid-som-valuta (§2.4) — kumulativ pris i sæsoners præmie-indkomst ──");
  console.log("  tier   pris        kumulativ    D1-sæsoner  D2-sæsoner  D3-sæsoner");
  for (const row of pis.table) {
    console.log(`  ${row.tier}      ${fmt(row.price).padStart(9)}  ${fmt(row.cumPrice).padStart(9)}    ${row.seasons[1].toFixed(1).padStart(6)}      ${row.seasons[2].toFixed(1).padStart(6)}      ${row.seasons[3].toFixed(1).padStart(6)}`);
  }
  for (const g of pis.gates) {
    console.log(`  Gate [${g.key}: ${g.value.toFixed(2)} ∈ [${g.lo}, ${g.hi}]]: ${g.pass ? "✅ PASS" : "❌ FAIL"}`);
  }
  console.log();

  // ── Gate 4: form-gates (§2.1-intent) ──────────────────────────────────────────
  const form = computeFormGates({ constants });
  console.log("── GATE: form-gates (§2.1-intent) — kurve-form, ikke kun niveauer ──");
  let lastGroup = null;
  for (const g of form.gates) {
    if (g.group !== lastGroup) { console.log(`  [${g.group}]`); lastGroup = g.group; }
    const band = Number.isFinite(g.hi) ? `∈ [${g.lo}, ${g.hi}]` : `≥ ${g.lo}`;
    const extra = g.meanAdded != null ? ` (staff-værdi ${fmt(g.meanAdded)}/sæson)` : "";
    console.log(`    ${g.key}: ${g.value.toFixed(3)} ${band}${extra}: ${g.pass ? "✅" : "❌"}`);
  }
  console.log(`  Gate [alle form-checks]: ${form.allPass ? "✅ PASS" : "❌ FAIL — konstant-formen er degenereret, rekalibrér"}\n`);

  // ── Gate 2: kommerciel payback (§2.1 anti-runaway) ────────────────────────────
  console.log("── GATE: kommerciel payback ≥ " + constants.minPaybackSeasons + " sæsoner (aldrig selvfinansierende hurtigere) ──");
  let minPaybackAll = Infinity;
  for (const d of [1, 2, 3]) {
    const r = computeCommercialPayback({ division: d, constants });
    minPaybackAll = Math.min(minPaybackAll, r.minPayback);
    const worst = r.rows.reduce((a, b) => (b.paybackSeasons < a.paybackSeasons ? b : a));
    console.log(`  D${d}: hurtigste payback ${fseas(r.minPayback)} sæsoner (tier ${worst.tier}, staff=${worst.staffMode})`);
    if (markdown) {
      for (const row of r.rows) {
        console.log(`      tier ${String(row.tier).padEnd(4)} staff=${row.staffMode.padEnd(7)} netto ${fmt(row.netDelta)}/sæson → payback ${fseas(row.paybackSeasons)}`);
      }
    }
  }
  const paybackPass = minPaybackAll >= constants.minPaybackSeasons;
  console.log(`  Gate [min payback ${fseas(minPaybackAll)} ≥ ${constants.minPaybackSeasons}]: ${paybackPass ? "✅ PASS" : "❌ FAIL — kommerciel er en pengemaskine, rekalibrér"}\n`);

  // ── Gate 1: anti-optimal-path (§2.3) — pr. division + leverage-robusthed ──────
  console.log("── GATE: anti-optimal-path (§2.3) — ≥3 strategier inden for ±15% af bedste (ejer-valg 2026-07-05) ──");
  const leverageScenarios = [
    { name: "leverage ×1,0 (baseline)", mult: 1.0 },
    { name: "leverage ×0,5", mult: 0.5 },
    { name: "leverage ×1,5", mult: 1.5 },
  ];
  let antiOptimalPass = true;
  const baselineByDiv = {};
  for (const sc of leverageScenarios) {
    const leverage = {
      training: DEFAULT_LEVERAGE.training * sc.mult,
      medical: DEFAULT_LEVERAGE.medical * sc.mult,
      scouting: DEFAULT_LEVERAGE.scouting * sc.mult,
      academySlotValue: DEFAULT_LEVERAGE.academySlotValue * sc.mult,
    };
    const isBaseline = sc.mult === 1.0;
    if (isBaseline) console.log(`  [${sc.name}]`);
    const counts = [];
    for (const d of [1, 2, 3]) {
      const r = runAntiOptimalPath({ division: d, seasons, constants, leverage });
      counts.push(r.competitiveCount);
      if (isBaseline) {
        baselineByDiv[d] = r;
        const parts = r.results
          .sort((a, b) => b.strength - a.strength)
          .map((x) => `${x.name} ${fmt(x.strength)}${x.competitive ? "✓" : ""}`);
        console.log(`    D${d}: ${parts.join(" · ")}`);
        console.log(`    D${d} konkurrencedygtige: ${r.competitiveCount}/${r.results.length} ${r.competitiveCount >= 3 ? "✅" : "❌"}`);
      }
      if (r.competitiveCount < 3) antiOptimalPass = false;
    }
    if (!isBaseline) {
      console.log(`  [${sc.name}] konkurrencedygtige pr. division: D1=${counts[0]} D2=${counts[1]} D3=${counts[2]} ${counts.every((c) => c >= 3) ? "✅" : "❌"}`);
    }
  }
  console.log(`  Gate [≥3 konkurrencedygtige i ALLE divisioner × ALLE leverage-scenarier]: ${antiOptimalPass ? "✅ PASS" : "❌ FAIL — én rækkefølge dominerer, rekalibrér effekter/priser"}\n`);

  if (markdown) {
    console.log("### Anti-optimal-path (baseline-leverage, markdown)\n");
    console.log("| Division | " + Object.keys(STRATEGIES).join(" | ") + " | konkurrencedygtige |");
    console.log("|---|" + Object.keys(STRATEGIES).map(() => "---|").join("") + "---|");
    for (const d of [1, 2, 3]) {
      const r = baselineByDiv[d];
      const cells = Object.keys(STRATEGIES).map((name) => {
        const x = r.results.find((y) => y.name === name);
        return `${fmt(x.strength)}${x.competitive ? " ✓" : ""}`;
      });
      console.log(`| D${d} | ${cells.join(" | ")} | ${r.competitiveCount}/${r.results.length} |`);
    }
    console.log();
  }

  // ── Gate 5: specialiserings-balance (#2216 A4, spec §7) ───────────────────────
  console.log("── GATE: specialiserings-balance (#2216 A4) — generalist OG specialist spilbare, ingen dominant spec ──");
  const spec = runSpecializationBalance({ constants, division: SPECIALIZATION_BALANCE.division ?? 2 });
  let lastSpecGroup = null;
  for (const c of spec.checks) {
    if (c.group !== lastSpecGroup) { console.log(`  [${c.group}]`); lastSpecGroup = c.group; }
    const band = Number.isFinite(c.hi) ? `∈ [${c.lo.toFixed(2)}, ${c.hi.toFixed(2)}]` : `≥ ${c.lo.toFixed(2)}`;
    console.log(`    ${c.key}: ${c.value.toFixed(3)} ${band}: ${c.pass ? "✅" : "❌"}`);
  }
  console.log(`  Gate [specialiserings-balance — generalist/specialist ±${(SPECIALIZATION_BALANCE.competitiveBand * 100).toFixed(0)}%, ingen dominant]: ${spec.allPass ? "✅ PASS" : "❌ FAIL — en specialisering dominerer / staff-akse skævvrider, rekalibrér spec-vægte"}\n`);

  // ── Gate 6: training-live-wiring-paritet (Plan B #1441, pre-flip) ─────────────
  // Beviser at den LIVE trænings-kæde (dailyAbilityDelta) implementerer PRÆCIS den
  // effekt harness-modellen + Klub-UI'et lover: ratio med/uden club-kontekst ==
  // (1 + effectiveBonus) × staffTrainingBonus — og PRÆCIS 1.0 uden faciliteter.
  // Kører altid mod PROD-konstanterne (uafhængig af --config): det er wiring, ikke balance.
  console.log("── GATE: training-live-wiring-paritet (Plan B) — live-kæden == harness/UI-løftet ──");
  const wiringChecks = [];
  const deltaArgs = { ability: "climbing", current: 50, cap: 90, age: 24, program: { focus: "vo2max", intensity: "normal" }, conditionMult: 1, bonus: false, noise: 1, potentiale: 4 };
  const baselineDelta = dailyAbilityDelta(deltaArgs);
  wiringChecks.push({
    key: "effectLive.training er sand (UI lover live)",
    value: EFFECT_LIVE_BY_TRACK.training ? 1 : 0, pass: EFFECT_LIVE_BY_TRACK.training === true,
  });
  const neutralDelta = dailyAbilityDelta({ ...deltaArgs, staff: null, facilityTier: 0, riderLevel: "senior" });
  wiringChecks.push({
    key: "uden club-kontekst → ratio PRÆCIS 1.0 (nul regression)",
    value: neutralDelta / baselineDelta, pass: neutralDelta === baselineDelta,
  });
  for (const tier of [1, 2, 3, 4, 5]) {
    const staffObj = deriveStaffAbilities({ role: "training", tier, name: `Wiring Probe ${tier}` });
    // Facilitet uden chef: ratio == 1 + effectiveBonus(track, tier, null) — UI-tallet ordret.
    const noStaffRatio = dailyAbilityDelta({ ...deltaArgs, staff: null, facilityTier: tier, riderLevel: "senior" }) / baselineDelta;
    const noStaffExpected = 1 + effectiveBonus("training", tier, null);
    wiringChecks.push({
      key: `t${tier} uden chef: ratio == 1+effectiveBonus (${noStaffExpected.toFixed(4)})`,
      value: noStaffRatio, pass: Math.abs(noStaffRatio - noStaffExpected) < 1e-9,
    });
    // Facilitet + chef: ratio == facilityTrainingMultiplier × staffTrainingBonus (fuld kæde).
    const withStaffRatio = dailyAbilityDelta({ ...deltaArgs, staff: staffObj, facilityTier: tier, riderLevel: "senior" }) / baselineDelta;
    const withStaffExpected = facilityTrainingMultiplier({ facilityTier: tier, staff: staffObj })
      * staffTrainingBonus({ facilityTier: tier, staff: staffObj, ability: "climbing", riderLevel: "senior" });
    wiringChecks.push({
      key: `t${tier} med chef (o${staffObj.overall}): ratio == magnitude×specialisering (${withStaffExpected.toFixed(4)})`,
      value: withStaffRatio, pass: Math.abs(withStaffRatio - withStaffExpected) < 1e-9,
    });
  }
  // Sanity-loft: selv max-kombinationen holder sig under (1 + 0.165) × spec-cap-produktet.
  const maxRatio = dailyAbilityDelta({ ...deltaArgs, staff: { overall: 99, dimensions: { physical: 99 }, levels: { senior: 99 } }, facilityTier: 5, riderLevel: "senior" }) / baselineDelta;
  wiringChecks.push({ key: "absolut loft: max-kombination ≤ 1.165 × 1.4", value: maxRatio, pass: maxRatio <= 1.165 * 1.4 + 1e-9 });
  for (const c of wiringChecks) {
    console.log(`    ${c.key}: ${c.value.toFixed(4)} ${c.pass ? "✅" : "❌"}`);
  }
  const wiringPass = wiringChecks.every((c) => c.pass);
  console.log(`  Gate [live-wiring-paritet]: ${wiringPass ? "✅ PASS" : "❌ FAIL — live-kæden matcher ikke det harness/UI lover"}\n`);

  const allPass = pis.allPass && paybackPass && antiOptimalPass && form.allPass && spec.allPass && wiringPass;
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`HEADLINE: facility-gates ${allPass ? "✅ PASS — A2/A4/Plan-B-merge-gate opfyldt" : "❌ FAIL — rekalibrér før FACILITIES_ENABLED"}`);
  console.log(`  tid-som-valuta ${pis.allPass ? "✅" : "❌"} · kommerciel payback ${paybackPass ? "✅" : "❌"} · anti-optimal-path ${antiOptimalPass ? "✅" : "❌"} · form-gates ${form.allPass ? "✅" : "❌"} · specialiserings-balance ${spec.allPass ? "✅" : "❌"} · live-wiring ${wiringPass ? "✅" : "❌"}`);
  console.log("NOTE: flag-flip er en separat EJER-beslutning — harness grøn er forudsætningen, ikke beslutningen.\n");
}

main();
