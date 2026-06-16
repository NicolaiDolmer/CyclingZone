#!/usr/bin/env node
// Kalibrerings-preview for den passive udviklings-motor (#1137) — RØRER INGEN DB.
//
// Loader ryttere + abilities (read-only), simulerer N sæsoner med kurverne i
// lib/riderProgression.js, og rapporterer konkrete karriere-baner + fordelinger så
// ejer kan justere PROGRESSION_CONFIG FØR motoren bygges (ejer-arbejdsform #1122).
//
//   node scripts/previewRiderProgression.js          # 6 sæsoner
//   node scripts/previewRiderProgression.js --seasons 8
//
// Deterministisk: samme population + samme CONFIG → samme output (seeded støj).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { RIDER_TYPES } from "../lib/riderTypes.js";
import {
  PROGRESSION_CONFIG, buildCaps, developRiderSeason, peakAgeForType,
} from "../lib/riderProgression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const SEASONS = (() => {
  const i = process.argv.indexOf("--seasons");
  return i >= 0 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 6) : 6;
})();
const AS_OF_YEAR = 2026; // start-sæsonens år (CALIBRATION.asOfYear)
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));

const WEIGHTS_BY_TYPE = Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]));
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (sortedAsc, p) => sortedAsc.length
  ? sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))] : null;

// 12 board-stat-ækvivalente signatur-evner til #813-proxy (positiv type-vægt = speciale).
function abilitySum(abilities, keys) {
  return keys.reduce((s, k) => s + (Number(abilities?.[k]) || 0), 0);
}
// Signatur-evnernes snit (det der reelt driver type-output / base_value).
function signatureAvg(abilities, type) {
  const w = WEIGHTS_BY_TYPE[type] || {};
  const sig = Object.keys(w).filter((k) => w[k] > 0);
  if (!sig.length) return null;
  return sig.reduce((s, k) => s + (Number(abilities?.[k]) || 0), 0) / sig.length;
}

async function main() {
  console.log(`=== Preview rytterudvikling — ${SEASONS} sæsoner · CONFIG headroom@5=${PROGRESSION_CONFIG.headroomByPotential[5]} · vækst=${PROGRESSION_CONFIG.growthFractionByAge.map(r => r.frac).join("/")} ===\n`);

  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, firstname, lastname, primary_type, potentiale, birthdate, base_value, is_retired, pcm_id")
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  // Byg simulerbar population: ikke-pensioneret, troværdig alder, har abilities+type+potentiale.
  const pop = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    if (!r.birthdate || r.potentiale == null || !r.primary_type) continue;
    const birthYear = new Date(r.birthdate).getFullYear();
    const startAge = AS_OF_YEAR - birthYear;
    if (!(startAge >= 17 && startAge <= 42)) continue; // luk PCM-alders-glitches ude
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (ab[k] != null) abilities[k] = Number(ab[k]);
    pop.push({
      id: r.id, name: `${r.firstname} ${r.lastname}`, type: r.primary_type,
      potentiale: Number(r.potentiale), startAge, retired: false,
      abilities, caps: buildCaps(abilities, r.primary_type, r.potentiale),
      base0: r.base_value, baseStart: r.base_value,
    });
  }
  console.log(`Simulérbar population: ${pop.length} ryttere (${riders.length} total, glitch-alder + pensionerede + manglende abilities filtreret).\n`);

  // Udvælg konkrete eksempel-baner (deterministisk): unge høj-pot specialister + en aldrende.
  const example = (pred) => pop.find(pred);
  const examples = [
    { tag: "Ung climber, høj pot", r: example((p) => p.type === "climber" && p.startAge >= 20 && p.startAge <= 22 && p.potentiale >= 4.5) },
    { tag: "Ung sprinter, høj pot", r: example((p) => p.type === "sprinter" && p.startAge >= 20 && p.startAge <= 23 && p.potentiale >= 4.5) },
    { tag: "Ung gc, top pot", r: example((p) => p.type === "gc" && p.startAge >= 21 && p.startAge <= 24 && p.potentiale >= 5) },
    { tag: "Aldrende sprinter", r: example((p) => p.type === "sprinter" && p.startAge >= 33 && p.startAge <= 35) },
    { tag: "Aldrende gc", r: example((p) => p.type === "gc" && p.startAge >= 34 && p.startAge <= 37) },
  ].filter((e) => e.r);

  // Snapshot-baner for eksemplerne (signatur-snit + base_value pr. sæson).
  const trace = new Map(examples.map((e) => [e.r.id, []]));

  // Metrics pr. sæson.
  const retiredPerSeason = [];
  let u25DeltaSamples = [];   // board #813-proxy: U25 ability-signatur-sum-delta pr. sæson
  const u25Growth = [];       // base_value-multiplikator for U25-talenter over hele sim

  // record sæson 0 (start) for eksempler
  for (const e of examples) {
    trace.get(e.r.id).push({ s: 0, age: e.r.startAge, sig: signatureAvg(e.r.abilities, e.r.type), bv: predictBaseValue({ primary_type: e.r.type }, e.r.abilities, model) });
  }

  for (let s = 1; s <= SEASONS; s++) {
    let retiredThisSeason = 0;
    // U25-signatur-sum FØR (kun U25 ved denne sæsons start).
    const u25Before = [];
    const u25Ref = [];
    for (const p of pop) {
      if (p.retired) continue;
      const age = p.startAge + (s - 1);
      if (age < 25) { u25Before.push(abilitySum(p.abilities, VISIBLE_ABILITIES)); u25Ref.push(p); }
    }

    for (const p of pop) {
      if (p.retired) continue;
      const age = p.startAge + s; // alder VED dette sæson-skifte
      const res = developRiderSeason({ id: p.id, primary_type: p.type, potentiale: p.potentiale, age }, p.abilities, p.caps, s);
      p.abilities = { ...p.abilities, ...res.next };
      if (res.retirement.retire) { p.retired = true; retiredThisSeason++; }
      if (trace.has(p.id)) {
        trace.get(p.id).push({ s, age, sig: signatureAvg(p.abilities, p.type), bv: predictBaseValue({ primary_type: p.type }, p.abilities, model), retired: p.retired });
      }
    }
    retiredPerSeason.push(retiredThisSeason);

    // U25 delta = (signatur-sum efter − før) for de samme ryttere.
    const deltas = u25Ref.map((p, i) => abilitySum(p.abilities, VISIBLE_ABILITIES) - u25Before[i]);
    if (deltas.length) u25DeltaSamples = u25DeltaSamples.concat(deltas);
  }

  // base_value-multiplikator for unge talenter (startAge ≤ 23, pot ≥ 4).
  for (const p of pop) {
    if (p.startAge <= 23 && p.potentiale >= 4 && p.baseStart > 0) {
      const bvNow = predictBaseValue({ primary_type: p.type }, p.abilities, model);
      if (bvNow) u25Growth.push(bvNow / p.baseStart);
    }
  }

  // ── RAPPORT ───────────────────────────────────────────────────────────────
  console.log("── KONKRETE KARRIERE-BANER (signatur-evne-snit → base_value) ──");
  for (const e of examples) {
    const t = trace.get(e.r.id);
    console.log(`\n${e.tag}: ${e.r.name} (${e.r.type}, start ${e.r.startAge}å, pot ${e.r.potentiale}, peak ${peakAgeForType(e.r.type)})`);
    console.log("  " + t.map((x) => `${x.age}å:${x.sig == null ? "—" : Math.round(x.sig)}${x.retired ? "⚑" : ""}`).join("  →  "));
    console.log("  base_value: " + t.map((x) => fmt(x.bv)).join(" → "));
  }

  console.log("\n── FORDELINGER ──");
  const u25s = [...u25DeltaSamples].sort((a, b) => a - b);
  console.log(`\n#813 board-proxy — U25 ability-sum-delta/sæson (16 evner):`);
  console.log(`  p10=${pct(u25s, 0.1)?.toFixed(1)}  median=${pct(u25s, 0.5)?.toFixed(1)}  p90=${pct(u25s, 0.9)?.toFixed(1)}  (target i stat-rum var ≥3 sum/sæson)`);

  console.log(`\nRetirement/sæson (af ${pop.length}): ${retiredPerSeason.join(", ")}  (snit ${(retiredPerSeason.reduce((a, b) => a + b, 0) / SEASONS).toFixed(0)}/sæson)`);

  const g = [...u25Growth].sort((a, b) => a - b);
  console.log(`\nUnge talenter (≤23å, pot≥4, n=${g.length}) — base_value ×multiplikator over ${SEASONS} sæsoner:`);
  console.log(`  p10=×${pct(g, 0.1)?.toFixed(1)}  median=×${pct(g, 0.5)?.toFixed(1)}  p90=×${pct(g, 0.9)?.toFixed(1)}`);

  // Sanity: topper feltet realistisk? (signatur-snit-fordeling efter sim)
  const sigNow = pop.filter((p) => !p.retired).map((p) => signatureAvg(p.abilities, p.type)).filter((x) => x != null).sort((a, b) => a - b);
  console.log(`\nSanity — signatur-snit efter ${SEASONS} sæsoner (levende): p50=${Math.round(pct(sigNow, 0.5))}  p90=${Math.round(pct(sigNow, 0.9))}  p99=${Math.round(pct(sigNow, 0.99))}  max=${Math.round(sigNow[sigNow.length - 1])}`);
  console.log(`  (Hvis p99/max klistrer mod 99 → headroom for høj; toppen mætter.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
