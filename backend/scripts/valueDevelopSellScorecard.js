#!/usr/bin/env node
// #1364 balance-gate: beviser at "udvikl-og-sælg" betaler sig + ingen runaway-inflation.
// Genererer launch-populationen (ingen DB), simulerer N sæsoner med progressions-
// motoren, og rapporterer: (1) udvikl-og-sælg-P&L for unge prospects, (2) populations-
// aggregat base_value pr. sæson (inflations-check), (3) aldrende falder (symmetri).
// Deterministisk. Ejer godkender scorecardet FØR ship.
//
//   node scripts/valueDevelopSellScorecard.js [--seasons=4]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateLaunchPopulation } from "../lib/fictionalLaunchPopulation.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { computeRiderTypes, NEUTRAL_BASELINE } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { buildCaps, developRiderSeason } from "../lib/riderProgression.js";
import { ACADEMY } from "../lib/academyFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;
const SEASONS = (() => {
  const hit = process.argv.find((a) => a.startsWith("--seasons="));
  return hit ? Math.max(1, parseInt(hit.split("=")[1], 10) || 4) : 4;
})();

const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
const bv = (type, abilities) => Math.round(predictBaseValue({ primary_type: type }, abilities, model) ?? 0);

function main() {
  const { riders } = generateLaunchPopulation();
  const pop = [];
  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    // deriveAbilities(physiology, riderRow, { asOfYear }) — riderRow har stat_* + birthdate osv.
    const abilities = deriveAbilities({}, { ...r, id: `fic-${i}` }, { asOfYear: REFERENCE_YEAR });
    // computeRiderTypes(abilities, baseline) — baseline er NEUTRAL_BASELINE, ikke en JSON-fil
    const { primary } = computeRiderTypes(abilities, NEUTRAL_BASELINE);
    const age = r._meta?.age ?? (REFERENCE_YEAR - new Date(r.birthdate).getFullYear());

    // Filtrer abilities til kun VISIBLE_ABILITIES (som developRiderSeason forventer)
    const visibleAbilities = {};
    for (const k of VISIBLE_ABILITIES) {
      if (abilities[k] != null) visibleAbilities[k] = abilities[k];
    }

    // buildCaps(baselineAbilities, primaryType, potentiale, cfg?) — cfg er optional
    const caps = buildCaps(visibleAbilities, primary.key, r.potentiale);

    pop.push({
      id: `fic-${i}`,
      type: primary.key,
      potentiale: Number(r.potentiale),
      startAge: age,
      retired: false,
      abilities: visibleAbilities,
      caps,
      bvStart: bv(primary.key, visibleAbilities),
    });
  }

  const seasonTotals = [];
  const livingBv = () => pop.filter((p) => !p.retired).map((p) => bv(p.type, p.abilities));
  seasonTotals.push(livingBv());

  for (let s = 1; s <= SEASONS; s++) {
    for (const p of pop) {
      if (p.retired) continue;
      const age = p.startAge + s;
      // developRiderSeason(rider, abilities, caps, season, cfg?, training?, options?)
      const res = developRiderSeason(
        { id: p.id, primary_type: p.type, potentiale: p.potentiale, age },
        p.abilities,
        p.caps,
        s,
      );
      p.abilities = { ...p.abilities, ...res.next };
      if (res.retirement.retire) p.retired = true;
    }
    seasonTotals.push(livingBv());
  }

  // ── (1) Udvikl-og-sælg P&L ────────────────────────────────────────────────
  const pnl = [];
  for (const p of pop) {
    if (!(p.startAge >= ACADEMY.MIN_AGE && p.startAge <= ACADEMY.MAX_AGE)) continue;
    const bvEnd = p.retired ? 0 : bv(p.type, p.abilities);
    const salaryPerSeason = ACADEMY.SALARY_RATE * p.bvStart;
    const cost = ACADEMY.SIGNING_FEE_RATE * p.bvStart
      + SEASONS * (ACADEMY.DRIFT_PER_SEASON + salaryPerSeason);
    pnl.push(bvEnd - p.bvStart - cost);
  }
  pnl.sort((a, b) => a - b);

  // ── (3) Symmetri — aldrende ryttere ───────────────────────────────────────
  const agingDelta = pop
    .filter((p) => p.startAge >= 32)
    .map((p) => (p.retired ? 0 : bv(p.type, p.abilities)) - p.bvStart)
    .sort((a, b) => a - b);

  // ── RAPPORT ────────────────────────────────────────────────────────────────
  console.log(`=== #1364 udvikl-og-sælg-scorecard (${SEASONS} sæsoner, ${pop.length} ryttere, seed 2026) ===\n`);

  console.log("── (1) Udvikl-og-sælg-P&L — akademi-alder prospects ──");
  console.log(`  Omkostnings-model: signing ${ACADEMY.SIGNING_FEE_RATE}×bv + ${SEASONS}×(drift ${fmt(ACADEMY.DRIFT_PER_SEASON)} + løn ${ACADEMY.SALARY_RATE}×bv)`);
  console.log(`  Net P&L (CZ$):  p10 ${fmt(pct(pnl, 0.1))} · median ${fmt(pct(pnl, 0.5))} · p90 ${fmt(pct(pnl, 0.9))}  (n=${pnl.length})`);
  const profitable = pnl.filter((x) => x > 0).length;
  console.log(`  Andel profitabel: ${(100 * profitable / (pnl.length || 1)).toFixed(0)}%  → ${pct(pnl, 0.5) > 0 ? "✅ median positiv" : "❌ median negativ (akademi = fælde)"}`);

  console.log("\n── (2) Populations-aggregat base_value pr. sæson (inflations-check) ──");
  for (let s = 0; s <= SEASONS; s++) {
    const arr = [...seasonTotals[s]].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    console.log(`  sæson ${s}: levende ${arr.length} · total ${fmt(sum)} · median ${fmt(pct(arr, 0.5))} · p90 ${fmt(pct(arr, 0.9))}`);
  }
  const t0 = seasonTotals[0].reduce((a, b) => a + b, 0);
  const tN = seasonTotals[SEASONS].reduce((a, b) => a + b, 0);
  console.log(`  total-ratio sæson ${SEASONS}/0 = ×${(tN / t0).toFixed(2)}  (≫ befolknings-vækst = inflations-flag)`);

  console.log("\n── (3) Symmetri — aldrende (start ≥32å) værdi-ændring ──");
  console.log(`  Δbase_value: p10 ${fmt(pct(agingDelta, 0.1))} · median ${fmt(pct(agingDelta, 0.5))} · p90 ${fmt(pct(agingDelta, 0.9))}  → ${pct(agingDelta, 0.5) < 0 ? "✅ daler" : "⚠️ stiger"}`);

  console.log("\nNote: P&L-vinduet forenkler (holdt hele sim-vinduet). Ejer vurderer om median-P&L + inflations-ratio er acceptable før flag-flip.");
}

main();
