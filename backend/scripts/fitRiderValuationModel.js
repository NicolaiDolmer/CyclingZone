#!/usr/bin/env node
// Træn rider-valuation-modellen (#1101) på EJER-KALIBREREDE anchors.
//
// MODEL v2 (7/6-2026): ln(base_value) = a + b·output + offset[primary_type].
// Afløser v1 (ridge på uci-ankrede auktionssalg). Manuel re-fit (ejer-godkendt) —
// INGEN auto-læring. Skriver koefficienter + metadata til
// backend/lib/riderValuationModel.json, som committes og bruges af
// riderValuation.js + backfillRiderBaseValue.js.
//
//   node scripts/fitRiderValuationModel.js            # fit + skriv JSON
//   node scripts/fitRiderValuationModel.js --dry-run  # fit + rapportér, skriv intet
//
// Anchors (navn→mål-værdi i CZ$): backend/lib/riderValuationAnchors.json.
// Se docs/decisions/rider-valuation-model-v1.md.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { outputScore } from "../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");
const ANCHORS_PATH = join(__dirname, "../lib/riderValuationAnchors.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Accent-ufølsom navne-normalisering til anchor-matching.
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
const fmtM = (n) => (n / 1e6).toFixed(1) + "M";

async function main() {
  const fittedAt = new Date().toISOString().slice(0, 10);
  console.log(`=== Fit rider valuation model v2 ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — ${fittedAt} ===`);

  const { anchors: anchorDefs } = JSON.parse(readFileSync(ANCHORS_PATH, "utf8"));

  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, firstname, lastname, primary_type").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  // Resolve anchors → { type, output, target }.
  const anchors = [];
  for (const def of anchorDefs) {
    const key = norm(def.name);
    const r = riders.find((x) => norm(`${x.firstname} ${x.lastname}`).includes(key));
    if (!r) { console.warn(`  ⚠ anchor ikke fundet: ${def.name}`); continue; }
    const ab = abilityByRider.get(r.id);
    if (!ab) { console.warn(`  ⚠ anchor uden abilities: ${def.name}`); continue; }
    const O = outputScore(ab, r.primary_type);
    anchors.push({ name: `${r.firstname} ${r.lastname}`, type: r.primary_type, output: O, target: def.target, lnv: Math.log(def.target) });
  }
  if (anchors.length < 5) {
    console.error(`❌ For få anchors fundet (${anchors.length}). Afbryder.`);
    process.exit(1);
  }

  // --- Trin 1: OLS af ln(value) på output O ---
  const Os = anchors.map((a) => a.output);
  const Ys = anchors.map((a) => a.lnv);
  const mO = Os.reduce((s, v) => s + v, 0) / Os.length;
  const mY = Ys.reduce((s, v) => s + v, 0) / Ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < Os.length; i++) { sxy += (Os[i] - mO) * (Ys[i] - mY); sxx += (Os[i] - mO) ** 2; }
  const b = sxy / sxx;
  const a = mY - b * mO;

  // --- Trin 2: type-offset = gennemsnitlig residual pr. type (fixed effect) ---
  // Typer uden anchor får offset 0 (neutral baseline). Spil-data forfiner på sigt.
  const resByType = {};
  for (const an of anchors) {
    const resid = an.lnv - (a + b * an.output);
    (resByType[an.type] ??= []).push(resid);
  }
  const offset = {};
  for (const [t, arr] of Object.entries(resByType)) {
    offset[t] = Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(6));
  }

  const predictLog = (an) => a + b * an.output + (offset[an.type] ?? 0);

  // Fit-kvalitet (R² i log-rum).
  let ssRes = 0, ssTot = 0;
  for (const an of anchors) {
    ssRes += (an.lnv - predictLog(an)) ** 2;
    ssTot += (an.lnv - mY) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;

  const model = {
    version: 2,
    method: "log-linear: ln(value)=a+b*output+offset[primary_type] (anchor-calibrated)",
    fitted_at: fittedAt,
    n_anchor: anchors.length,
    r2_log: Number(r2.toFixed(4)),
    a: Number(a.toFixed(6)),
    b: Number(b.toFixed(6)),
    offset,
    anchors_fit: anchors
      .sort((x, y) => y.target - x.target)
      .map((an) => ({
        name: an.name, type: an.type, output: Number(an.output.toFixed(1)),
        target: an.target, predicted: Math.round(Math.exp(predictLog(an))),
      })),
    notes: "Eget data-drevet base_value. SHADOW — styrer ikke økonomi før cutover (#1101 slice 2). INGEN bund; spil-resultater forfiner på sigt (ejer-beslutning B, 7/6).",
  };

  // --- Rapport ---
  console.log(`\nAnchors: ${anchors.length}/${anchorDefs.length} · a=${a.toFixed(3)} · b=${b.toFixed(4)} · R²(log)=${r2.toFixed(3)}`);
  console.log("Type-offset (×-effekt vs neutral):");
  for (const [t, off] of Object.entries(offset).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${t.padEnd(16)} ${off >= 0 ? "+" : ""}${off.toFixed(2)}  (×${Math.exp(off).toFixed(2)})`);
  }
  console.log("\nAnchors (forudsagt vs mål):");
  for (const an of model.anchors_fit) {
    console.log(`  ${an.name.padEnd(22)} ${an.type.padEnd(15)} o${String(an.output).padEnd(5)} ${fmtM(an.predicted).padEnd(9)} (mål ${fmtM(an.target)})`);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke model-fil.");
    return;
  }
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + "\n");
  console.log(`\n✅ Skrev ${MODEL_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
