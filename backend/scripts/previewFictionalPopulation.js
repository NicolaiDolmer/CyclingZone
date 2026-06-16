#!/usr/bin/env node
// Preview/kalibrerings-harness for den fiktive launch-population (#669/#677).
//
// Genererer N fiktive ryttere (ingen DB) og kører dem gennem HELE den ægte
// værdi-kæde — præcis som prod-backfillsne gør:
//   generateFictionalRiders → deriveAbilities → computeRiderTypes(prod-baseline)
//     → predictBaseValue(prod-model)
// og rapporterer base_value-pyramide-bånd + type-fordeling + nationalitet + alder,
// plus en repræsentativ sample. Rør INTET i prod; læser kun de committede
// baseline-/model-JSON-filer. Grundlag for at tune generatoren mod launch-spec.
//
//   node scripts/previewFictionalPopulation.js [--count=800] [--seed=2026] [--sample=15]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAUNCH_POPULATION, LAUNCH_VALUE_BANDS, checkLaunchTypeMix } from "../lib/fictionalLaunchPopulation.js";
import { buildFictionalPopulationPreview } from "../lib/fictionalPopulationPreview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}

const COUNT = parseInt(arg("count", "800"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const SAMPLE = parseInt(arg("sample", "15"), 10);
const REFERENCE_YEAR = 2026;

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

// Launch-pyramide-bånd (CZ$) — ejer-spec 2026-06-07. Delt definition i
// fictionalLaunchPopulation.js: superstjerne-grænsen er STAR_RIDER_MARKET_VALUE,
// så bånd og spil-diskriminator (force-sale/achievement) ikke kan drifte (#1198).
const BANDS = LAUNCH_VALUE_BANDS;

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (sortedAsc, p) => sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];

function bandOf(v) {
  return BANDS.find((b) => v >= b.lo && v < b.hi)?.key ?? "domestik";
}

function main() {
  const { riders: rows, coverage } = buildFictionalPopulationPreview({
    count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR, baseline, model,
  });

  const values = rows.map((r) => r.base_value).sort((a, b) => a - b);

  console.log(`=== Fiktiv launch-population — preview (seed ${SEED}, count ${COUNT}) ===`);
  console.log(`Model v${model.version} ${model.fitted_at} · baseline n=${baseline.n}\n`);

  // ── base_value-fordeling ────────────────────────────────────────────────────
  console.log("base_value (CZ$):  min        p10        median       p90          max");
  console.log(`  ${fmt(values[0]).padStart(10)} ${fmt(pct(values, 0.1)).padStart(10)} ${fmt(pct(values, 0.5)).padStart(10)} ${fmt(pct(values, 0.9)).padStart(10)} ${fmt(values[values.length - 1]).padStart(10)}\n`);

  // ── Pyramide-bånd vs target ─────────────────────────────────────────────────
  const bandCount = Object.fromEntries(BANDS.map((b) => [b.key, 0]));
  for (const r of rows) bandCount[bandOf(r.base_value)]++;
  console.log("Pyramide-bånd          faktisk   target   interval");
  for (const b of BANDS) {
    const range = b.hi === Infinity ? `≥${fmt(b.lo)}` : `${fmt(b.lo)}–${fmt(b.hi)}`;
    console.log(`  ${b.key.padEnd(18)} ${String(bandCount[b.key]).padStart(7)}  ${String(b.target).padStart(7)}   ${range}`);
  }

  // ── Tier × bånd-krydstabel (hvor lækker tiers hen?) ────────────────────────
  const tierOrder = ["superstar", "star", "solid", "domestique"];
  const cross = Object.fromEntries(tierOrder.map((t) => [t, Object.fromEntries(BANDS.map((b) => [b.key, 0]))]));
  for (const r of rows) cross[r._meta.tier][bandOf(r.base_value)]++;
  console.log("\nTier × bånd (rækker=tier, kolonner=bånd):");
  console.log(`  ${"".padEnd(12)} ${BANDS.map((b) => b.key.slice(0, 8).padStart(9)).join("")}`);
  for (const t of tierOrder) {
    console.log(`  ${t.padEnd(12)} ${BANDS.map((b) => String(cross[t][b.key]).padStart(9)).join("")}`);
  }

  // ── Type-fordeling ──────────────────────────────────────────────────────────
  const typeCount = {};
  for (const r of rows) typeCount[r.primary_type] = (typeCount[r.primary_type] || 0) + 1;
  console.log("\nType-fordeling (primary):");
  for (const [t, n] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(18)} ${String(n).padStart(4)}  (${(100 * n / COUNT).toFixed(1)}%)`);
  }

  // ── Type-mix-oracle (#1198 pop-MUT-6) — håndhævet ved launch-skala ─────────
  // Ejer-gulve (alle 8 typer + gc≥30/sprinter≥40) gælder den certificerede
  // launch-population (count=800). Ved andre counts rapporteres kun.
  // Pyramide-bånd-afvigelser er fortsat rapport-only: tolerance pr. bånd er en
  // ejer-beslutning (dokumenteret i docs/GATE_MUTATION_AUDIT.md, mutant pop-MUT-1).
  const oracleFailures = [];
  if (COUNT === LAUNCH_POPULATION.count) {
    oracleFailures.push(...checkLaunchTypeMix(typeCount));
    if (oracleFailures.length) {
      console.log("\n❌ TYPE-MIX-ORACLE FEJLEDE (launch-gulve, ejer-spec 2026-06-07):");
      for (const f of oracleFailures) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("\n✅ Type-mix-oracle: alle 8 typer repræsenteret, ejer-gulve (gc≥30, sprinter≥40) holder.");
    }
  } else {
    console.log(`\n(type-mix-oracle springes over: count=${COUNT} ≠ launch-count ${LAUNCH_POPULATION.count})`);
  }

  // ── Alder + nationalitet ────────────────────────────────────────────────────
  const ages = rows.map((r) => r._meta.age).sort((a, b) => a - b);
  console.log(`\nAlder: min ${ages[0]} · median ${pct(ages, 0.5)} · max ${ages[ages.length - 1]}`);
  const natCount = {};
  for (const r of rows) natCount[r.nationality_code] = (natCount[r.nationality_code] || 0) + 1;
  const topNat = Object.entries(natCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`Nationaliteter: ${Object.keys(natCount).length} · top: ${topNat.map(([c, n]) => `${c}:${n}`).join(" ")}`);
  if (Object.keys(coverage.fallbackNationalities).length) {
    console.log(`⚠️ generisk navne-fallback: ${JSON.stringify(coverage.fallbackNationalities)}`);
  }

  // ── Sample: top, mid, bund ──────────────────────────────────────────────────
  const byValue = [...rows].sort((a, b) => b.base_value - a.base_value);
  const samples = [
    ...byValue.slice(0, Math.ceil(SAMPLE / 3)),
    ...byValue.slice(Math.floor(byValue.length / 2), Math.floor(byValue.length / 2) + Math.ceil(SAMPLE / 3)),
    ...byValue.slice(-Math.ceil(SAMPLE / 3)),
  ];
  console.log("\nSample (top / mid / bund):");
  console.log("  navn                      nat  alder  type            2.type        base_value");
  for (const r of samples) {
    const name = `${r.firstname} ${r.lastname}`.slice(0, 24).padEnd(24);
    console.log(`  ${name}  ${r.nationality_code.padEnd(3)}  ${String(r._meta.age).padStart(4)}   ${r.primary_type.padEnd(14)}  ${r.secondary_type.padEnd(12)}  ${fmt(r.base_value).padStart(11)}`);
  }

  // ── Per-type showcase: median-værdi-rytter pr. afledt type + top-3 abilities ──
  const ABIL = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone"];
  console.log("\nPer-type showcase (median-værdi-rytter pr. type — er typen realistisk?):");
  console.log("  type            navn                   base_value   top-3 abilities");
  const byType = {};
  for (const r of rows) (byType[r.primary_type] ??= []).push(r);
  for (const t of Object.keys(byType).sort((a, b) => byType[b].length - byType[a].length)) {
    const grp = byType[t].sort((a, b) => a.base_value - b.base_value);
    const r = grp[Math.floor(grp.length / 2)]; // median-værdi
    const top3 = ABIL.map((k) => [k, r.abilities[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${v}`).join(", ");
    const name = `${r.firstname} ${r.lastname}`.slice(0, 21).padEnd(21);
    console.log(`  ${t.padEnd(14)}  ${name}  ${fmt(r.base_value).padStart(11)}   ${top3}`);
  }

  console.log(`\nExit-kontrakt: ${process.exitCode === 1 ? "❌ exit 1 (type-mix-oracle brudt)" : "✅ exit 0"} · pyramide-bånd er rapport-only (bånd-tolerance = ejer-beslutning, #1198).`);
}

main();
