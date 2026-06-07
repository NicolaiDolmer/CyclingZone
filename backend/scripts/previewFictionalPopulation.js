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

import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";

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

// Launch-pyramide-bånd (CZ$) — ejer-spec 2026-06-07 (~800).
const BANDS = [
  { key: "superstjerne", lo: 8_000_000, hi: Infinity, target: 12 },
  { key: "stjerne",      lo: 1_000_000, hi: 8_000_000, target: 60 },
  { key: "solid",        lo: 200_000,   hi: 1_000_000, target: 230 },
  { key: "domestik",     lo: 0,         hi: 200_000,   target: 500 },
];

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (sortedAsc, p) => sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];

function bandOf(v) {
  return BANDS.find((b) => v >= b.lo && v < b.hi)?.key ?? "domestik";
}

function main() {
  const { riders, coverage } = generateFictionalRiders({
    seed: SEED,
    count: COUNT,
    referenceYear: REFERENCE_YEAR,
  });

  const rows = riders.map((r, i) => {
    const id = `fic-${SEED}-${i}`;
    const riderRow = { ...r, id };
    const abilities = deriveAbilities({}, riderRow, { asOfYear: REFERENCE_YEAR });
    const { primary, secondary } = computeRiderTypes(abilities, baseline);
    const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
    const base_value = predictBaseValue(withType, abilities, model);
    return { ...withType, abilities, base_value, _meta: r._meta };
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

  // ── Type-fordeling ──────────────────────────────────────────────────────────
  const typeCount = {};
  for (const r of rows) typeCount[r.primary_type] = (typeCount[r.primary_type] || 0) + 1;
  console.log("\nType-fordeling (primary):");
  for (const [t, n] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(18)} ${String(n).padStart(4)}  (${(100 * n / COUNT).toFixed(1)}%)`);
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
  const ABIL = ["climbing", "time_trial", "prolog", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone"];
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
}

main();
