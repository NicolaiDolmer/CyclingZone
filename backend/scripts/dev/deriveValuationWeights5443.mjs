// #5443 / #3353 · Udled en KANDIDAT-værdivægttabel fra simuleringens eget output.
//
// "Hvilke evner tæller for en rytter af DENNE type?" besvares i dag af en
// håndtabel (`backend/lib/weights/valuationWeights.js`). Dette script svarer i
// stedet med motorens egne tal: for hver type regresseres den simulerede
// præmieproduktion på rytterens evner, med et gulv på nul (en evne må aldrig
// trække værdien ned — doktrinen "styrke straffes aldrig").
//
// INGEN DB, INGEN skrivning til prod. Læser kun sim-artefakter fra disk og
// skriver en JSON-vægttabel + en stabilitets-rapport.
//
//   node scripts/dev/deriveValuationWeights5443.mjs \
//     --sample=lib/riderProductionSample.json \
//     --sample2=<sti til et sim-output med en ANDEN seed> \
//     --out=lib/weights/valuationWeights.candidate-5443-c2.json \
//     --report=<sti til markdown-rapport>
//
// Vægttabellen er en EJER-BESLUTNING. Scriptet leverer en kandidat og tallene
// bag den; det ændrer ikke den live tabel.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { VALUATION_WEIGHTS } from "../../lib/weights/valuationWeights.js";
import { DISPLAY_RECIPES } from "../../lib/weights/displayRecipes.js";
import {
  bootstrapWeights,
  makeRng,
  normalizeWeights,
  rawWeightsFromSamples,
  weightConcentration,
} from "../../lib/valuationWeightDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, "../..");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};

const SAMPLE = resolve(join(BACKEND, String(arg("sample", "lib/riderProductionSample.json"))));
const SAMPLE2 = arg("sample2", null);
const OUT = resolve(join(BACKEND, String(arg("out", "lib/weights/valuationWeights.candidate-5443-c2.json"))));
const REPORT = arg("report", null);
const BOOTSTRAP_REPS = Number(arg("reps", 60));
const BOOTSTRAP_SEED = Number(arg("bootstrap-seed", 20260920));

// Evne-sættet der må indgå. Race-motorens 15 nøgler: præcis de evner der er
// beregnet for ALLE ryttere (verificeret mod prod 20/9) og som motoren selv
// bruger. `teamwork`/`leadership` er bevidst UDE — de findes kun på ~670 af
// 8.623 ryttere, og hard rule 30 siger at en evne først må tælle når alle har den.
const ABILITY_KEYS = RACE_ABILITY_KEYS;

const liveTable = Object.fromEntries(VALUATION_WEIGHTS.map((t) => [t.key, Object.fromEntries(
  Object.entries(t.weights).filter(([, w]) => w > 0))]));
const displayTable = Object.fromEntries(DISPLAY_RECIPES.map((t) => [t.key, { ...t.weights }]));

function loadSamples(path) {
  const a = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(a.samples)) throw new Error(`${path}: intet samples-array`);
  return a;
}

function byType(samples) {
  const m = new Map();
  for (const s of samples) {
    if (!s.primary_type) continue;
    if (!m.has(s.primary_type)) m.set(s.primary_type, []);
    m.get(s.primary_type).push(s);
  }
  return m;
}

const fmtW = (w) => Object.entries(w || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
const pctOf = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)} %`);

function main() {
  const art = loadSamples(SAMPLE);
  const groups = byType(art.samples);
  console.log(`Sim-artefakt: ${SAMPLE}`);
  console.log(`  season=${art.season_id} K=${art.K} seed=${art.base_seed} · ${art.samples.length} samples`);

  let groups2 = null;
  if (SAMPLE2) {
    const art2 = loadSamples(resolve(SAMPLE2));
    groups2 = byType(art2.samples);
    console.log(`Kontrol-artefakt (anden seed): seed=${art2.base_seed} · ${art2.samples.length} samples`);
  }

  const table = {};
  const rows = [];
  const rng = makeRng(BOOTSTRAP_SEED);

  for (const type of RIDER_TYPE_KEYS) {
    const samples = groups.get(type) || [];
    const { raw, n } = rawWeightsFromSamples(samples, ABILITY_KEYS);
    const norm = normalizeWeights(raw, { topWeight: 5, decimals: 1, minShare: 0.05 });
    if (!norm) {
      console.warn(`  ⚠ ${type}: ingen positive vægte (n=${n}) — beholder den live tabel for denne type.`);
      table[type] = { ...liveTable[type] };
      rows.push({ type, n, weights: table[type], fallback: true });
      continue;
    }
    table[type] = norm;

    // Stabilitet 1: bootstrap over den PRIMÆRE stikprøve.
    const boot = bootstrapWeights(samples, ABILITY_KEYS, rng, { reps: BOOTSTRAP_REPS, topWeight: 5, decimals: 1, minShare: 0.05 });
    // Stabilitet 2: samme udledning på et sim-run med en ANDEN seed.
    let seedNorm = null;
    if (groups2) {
      const s2 = groups2.get(type) || [];
      seedNorm = normalizeWeights(rawWeightsFromSamples(s2, ABILITY_KEYS).raw, { topWeight: 5, decimals: 1, minShare: 0.05 });
    }
    const maxSeedDelta = seedNorm
      ? Math.max(...ABILITY_KEYS.map((k) => Math.abs((norm[k] ?? 0) - (seedNorm[k] ?? 0))))
      : null;
    const maxSd = Math.max(...ABILITY_KEYS.map((k) => boot[k].sd));

    rows.push({ type, n, weights: norm, boot, seedNorm, maxSeedDelta, maxSd });
    console.log(`  ${type.padEnd(16)} n=${String(n).padStart(5)} · ${Object.keys(norm).length} evner · tungeste ${pctOf(weightConcentration(norm))} · max bootstrap-sd ${maxSd.toFixed(2)}${maxSeedDelta != null ? ` · max seed-afvigelse ${maxSeedDelta.toFixed(1)}` : ""}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(table, null, 2) + "\n", "utf8");
  console.log(`\n✅ Skrev vægttabel: ${OUT}`);

  if (REPORT) {
    const L = [];
    L.push("# #5443 · C2 — værdivægte udledt af motorens eget output");
    L.push("");
    L.push(`Kilde: \`${SAMPLE}\` (sæson ${art.season_id}, K=${art.K}, seed ${art.base_seed}, ${art.samples.length} samples).`);
    L.push(`Metode: pr. type regresseres ln(simuleret præmieproduktion) på rytterens ${ABILITY_KEYS.length} evner med et gulv på nul (ikke-negativ mindste-kvadrat). Vægtene normaliseres så den tungeste evne = 5; evner under 5 % af toppen smides væk som støj.`);
    L.push(`Stabilitet: ${BOOTSTRAP_REPS} bootstrap-genudtræk (seed ${BOOTSTRAP_SEED})${SAMPLE2 ? ", plus en uafhængig simulering med en anden seed" : ""}.`);
    L.push("");
    L.push("## Koncentration — hvor meget af rytteren ser formlen?");
    L.push("");
    L.push("| Type | live tabel | visnings-opskrift (C1) | C2 (udledt) |");
    L.push("|---|--:|--:|--:|");
    for (const r of rows) {
      L.push(`| ${r.type} | ${pctOf(weightConcentration(liveTable[r.type]))} (${Object.keys(liveTable[r.type]).length} evner) | ${pctOf(weightConcentration(displayTable[r.type]))} (${Object.keys(displayTable[r.type]).length}) | ${pctOf(weightConcentration(r.weights))} (${Object.keys(r.weights).length}) |`);
    }
    L.push("");
    L.push("## Vægte pr. type — alle otte, ikke kun de smalle");
    L.push("");
    for (const r of rows) {
      L.push(`### ${r.type} (n=${r.n}${r.fallback ? ", FALDT TILBAGE på den live tabel" : ""})`);
      L.push("");
      L.push(`- **live:** ${fmtW(liveTable[r.type])}`);
      L.push(`- **C1 (visnings-opskrift):** ${fmtW(displayTable[r.type])}`);
      L.push(`- **C2 (udledt):** ${fmtW(r.weights)}`);
      if (r.boot) {
        const unstable = ABILITY_KEYS.filter((k) => r.boot[k].sd > 0.5)
          .map((k) => `${k} ±${r.boot[k].sd.toFixed(2)}`);
        L.push(`- Bootstrap: max spredning ${r.maxSd.toFixed(2)} vægtpoint${unstable.length ? ` · ustabile: ${unstable.join(", ")}` : " · alle evner stabile (< 0,5)"}`);
      }
      if (r.seedNorm) {
        L.push(`- Anden seed: ${fmtW(r.seedNorm)} · største afvigelse ${r.maxSeedDelta.toFixed(1)} vægtpoint`);
      }
      L.push("");
    }
    mkdirSync(dirname(resolve(REPORT)), { recursive: true });
    writeFileSync(resolve(REPORT), L.join("\n") + "\n", "utf8");
    console.log(`✅ Skrev rapport: ${resolve(REPORT)}`);
  }
}

main();
