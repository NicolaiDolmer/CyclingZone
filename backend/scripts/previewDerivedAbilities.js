#!/usr/bin/env node
// Evne-system v2 (#1122) — TUNING-værktøj. Deriver abilities fra prod-rytternes
// PCM-stats LOKALT og vis fordelinger + kendte ryttere ved navn. Skriver IKKE til
// DB uden --apply, så ejer kan tune CALIBRATION/formler i abilityDerivation.js i en
// implementér → vis → juster → re-deriv-løkke uden at forstyrre live-spillere.
//
//   node scripts/previewDerivedAbilities.js              # vis fordeling + kendte navne
//   node scripts/previewDerivedAbilities.js --apply      # upsert til rider_derived_abilities
//   node scripts/previewDerivedAbilities.js --names "Pogacar,Vingegaard"

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  deriveAbilities, CALIBRATION, FORMULA_VERSION, VISIBLE_ABILITIES, HIDDEN_ABILITIES,
} from "../lib/abilityDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

const APPLY = process.argv.includes("--apply");
const namesArgIdx = process.argv.indexOf("--names");
const KNOWN_DEFAULT = [
  "Pogacar", "Vingegaard", "Evenepoel", "Roglic", "Vlasov", "Mads Pedersen",
  "Mathieu van der Poel", "Jasper Philipsen", "Ganna", "Merlier", "Albert Withen",
];
const KNOWN = namesArgIdx >= 0 ? process.argv[namesArgIdx + 1].split(",").map((s) => s.trim()) : KNOWN_DEFAULT;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pct = (sortedAsc, q) => sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length))];

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length || 1;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    min: s[0], p25: pct(s, 0.25), median: pct(s, 0.5), p75: pct(s, 0.75),
    p90: pct(s, 0.90), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1],
    sd: sd.toFixed(1), ge80: values.filter((v) => v >= 80).length, ge90: values.filter((v) => v >= 90).length,
    eq99: values.filter((v) => v >= 99).length,
  };
}

function distRow(label, values) {
  const d = stats(values);
  return `${label.padEnd(16)} min ${String(d.min).padStart(2)} · p25 ${String(d.p25).padStart(2)} · med ${String(d.median).padStart(2)} · p75 ${String(d.p75).padStart(2)} · p90 ${String(d.p90).padStart(2)} · p95 ${String(d.p95).padStart(2)} · max ${String(d.max).padStart(2)} · sd ${String(d.sd).padStart(4)} · ≥80 ${String(d.ge80).padStart(4)} · ≥90 ${String(d.ge90).padStart(3)} · =99 ${String(d.eq99).padStart(3)}`;
}

async function main() {
  console.log(`=== Evne-preview (FORMULA_VERSION=${FORMULA_VERSION}) ${APPLY ? "[APPLY]" : "[READ-ONLY]"} ===`);
  console.log(`CALIBRATION: pcmFloor=${CALIBRATION.pcmFloor} → 1 · pcmCeil=${CALIBRATION.pcmCeil} → 99 · asOf=${CALIBRATION.asOfYear}\n`);

  const riders = await fetchAllRows(() => supabase
    .from("riders")
    .select(["id", "firstname", "lastname", "birthdate", "potentiale", "pcm_id", ...STAT_KEYS].join(", "))
    .order("id", { ascending: true }));
  console.log(`🔎 ${riders.length} riders\n`);

  const derived = riders.map((rider) => ({ rider, abilities: deriveAbilities({}, rider) }));

  // ── Fordelinger pr. evne ──────────────────────────────────────────────────────
  console.log(`── Fordelinger (${derived.length} ryttere) ──`);
  for (const key of [...VISIBLE_ABILITIES, ...HIDDEN_ABILITIES]) {
    console.log(distRow(key, derived.map((d) => d.abilities[key])));
  }

  // ── Kendte ryttere ved navn ───────────────────────────────────────────────────
  console.log(`\n── Kendte ryttere ──`);
  console.log("navn".padEnd(22) + VISIBLE_ABILITIES.map((k) => k.slice(0, 4).padStart(5)).join(""));
  for (const term of KNOWN) {
    const ft = fold(term);
    const hit = derived.find((d) => fold(`${d.rider.firstname} ${d.rider.lastname}`).includes(ft));
    if (!hit) { console.log(`${term.padEnd(22)}(ikke fundet)`); continue; }
    const row = VISIBLE_ABILITIES.map((k) => String(hit.abilities[k]).padStart(5)).join("");
    console.log(`${`${hit.rider.firstname} ${hit.rider.lastname}`.slice(0, 21).padEnd(22)}${row}`);
  }

  if (!APPLY) {
    console.log(`\n🔍 READ-ONLY — intet skrevet. Tun CALIBRATION/formler i abilityDerivation.js og kør igen. Kør med --apply når tallene er godkendt.`);
    return;
  }

  // ── Apply: upsert til DB (kun efter godkendelse) ──────────────────────────────
  const now = new Date().toISOString();
  const rows = derived.map((d) => ({ ...d.abilities, generated_at: now }));
  const BATCH = 500;
  console.log(`\n⬆️  Upserter ${rows.length} rækker til rider_derived_abilities...`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("rider_derived_abilities").upsert(batch, { onConflict: "rider_id" });
    if (error) throw new Error(`upsert fejlede ved ${i}: ${error.message}`);
    console.log(`  ✅ batch ${Math.floor(i / BATCH) + 1}: ${batch.length}`);
  }
  console.log(`✅ Færdig — ${rows.length} ryttere re-derived (formula_version=${FORMULA_VERSION}).`);
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
