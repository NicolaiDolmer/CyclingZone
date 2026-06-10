#!/usr/bin/env node
// Træn rider-valuation-modellen (#1101) på EJER-KALIBREREDE anchors.
//
// MODEL v3 (9/6-2026): ln(base_value) = a + b·O + c·O² + offset[primary_type],
//   O = ALPHA·speciale-output + (1−ALPHA)·snit af alle evner (alsidigheds-blend).
// Afløser v2 (ren speciale-output, lineær): den kunne ikke se alsidighed og satte
// MvdP over Pogačar. Manuel re-fit (ejer-godkendt) — INGEN auto-læring. Skriver
// koefficienter + metadata til backend/lib/riderValuationModel.json (committes og
// bruges af riderValuation.js + alle forbrugere af predictBaseValue).
//
//   node scripts/fitRiderValuationModel.js            # fit + skriv JSON
//   node scripts/fitRiderValuationModel.js --dry-run  # fit + rapportér, skriv intet
//
// ORDENS-GUARD: anchors med mål ≥15M og >30% målafstand SKAL forudsiges i ejerens
// rækkefølge — ellers fejler fittet højt (exit 1). Bløde brud (<15M) rapporteres kun.
// Anchors: backend/lib/riderValuationAnchors.json. Se docs/decisions/rider-valuation-model-v1.md.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { blendedOutput } from "../lib/riderValuation.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { fitValuationModel, checkAnchorOrdering, evaluateFitGuards } from "../lib/riderValuationFit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");
const ANCHORS_PATH = join(__dirname, "../lib/riderValuationAnchors.json");

// Alsidigheds-blend (ejer-kalibreret 9/6: bedste R² + korrekt top-orden i eksperiment).
const ALPHA = 0.5;

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
  console.log(`=== Fit rider valuation model v3 ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — ${fittedAt} ===`);

  const { anchors: anchorDefs } = JSON.parse(readFileSync(ANCHORS_PATH, "utf8"));

  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, firstname, lastname, primary_type").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  // Resolve anchors → { name, type, output (blendet), target }.
  const anchors = [];
  for (const def of anchorDefs) {
    const key = norm(def.name);
    const r = riders.find((x) => norm(`${x.firstname} ${x.lastname}`).includes(key));
    if (!r) { console.warn(`  ⚠ anchor ikke fundet: ${def.name}`); continue; }
    const ab = abilityByRider.get(r.id);
    if (!ab) { console.warn(`  ⚠ anchor uden abilities: ${def.name}`); continue; }
    anchors.push({
      name: `${r.firstname} ${r.lastname}`, type: r.primary_type,
      output: blendedOutput(ab, r.primary_type, ALPHA), target: def.target,
    });
  }
  if (anchors.length < 5) {
    console.error(`❌ For få anchors fundet (${anchors.length}). Afbryder.`);
    process.exit(1);
  }

  const fit = fitValuationModel(anchors, { quadratic: true });
  const predict = (an) => Math.exp(fit.predictLn(an));
  const { hard, soft } = checkAnchorOrdering(anchors, predict);

  // Gate-integritets-guards (#1198): monotoni på HELE [0,99] (begge fortegns-
  // kombinationer, ikke kun konkav-med-toppunkt) + hård-båndet skal være befolket
  // (ellers er ordens-guarden de facto slukket). Se riderValuationFit.js.
  const guardFailures = evaluateFitGuards(anchors, fit);
  if (guardFailures.length) {
    console.error("❌ Fit-guards fejlede — fittet afvises:");
    for (const f of guardFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  // --- Rapport ---
  console.log(
    `\nAnchors: ${anchors.length}/${anchorDefs.length} · alpha=${ALPHA} · a=${fit.a.toFixed(3)} · ` +
    `b=${fit.b.toFixed(4)} · c=${fit.c.toExponential(3)} · R²(log)=${fit.r2.toFixed(3)}`
  );
  console.log("Type-offset (×-effekt vs neutral):");
  for (const [t, off] of Object.entries(fit.offset).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${t.padEnd(16)} ${off >= 0 ? "+" : ""}${off.toFixed(2)}  (×${Math.exp(off).toFixed(2)})`);
  }
  // #1198 VM-M5: typer uden anchor får offset 0 (neutral) — det kan fejlprise en
  // HEL rytterklasse relativt til de kalibrerede typer. Rapporteres (blokerer ikke;
  // fix = ejer tilføjer anchor for typen i riderValuationAnchors.json).
  const anchoredTypes = new Set(anchors.map((an) => an.type));
  const unanchored = RIDER_TYPE_KEYS.filter((t) => !anchoredTypes.has(t));
  if (unanchored.length) {
    console.warn(`  ⚠ typer UDEN anchor (offset=0 → hele typen potentielt fejlprist): ${unanchored.join(", ")}`);
  }
  console.log("\nAnchors (forudsagt vs mål):");
  for (const an of [...anchors].sort((x, y) => y.target - x.target)) {
    console.log(`  ${an.name.padEnd(22)} ${an.type.padEnd(15)} o${an.output.toFixed(1).padEnd(5)} ${fmtM(predict(an)).padEnd(9)} (mål ${fmtM(an.target)})`);
  }
  if (soft.length) {
    console.log(`\nBløde ordensbrud (<15M-bånd, ${soft.length} — rapporteres, blokerer ikke):`);
    for (const v of soft) console.log(`  ${v.high} (${fmtM(v.predHigh)}) ≤ ${v.low} (${fmtM(v.predLow)})`);
  }
  if (hard.length) {
    console.error("\n❌ HÅRDE ordensbrud (mål ≥15M) — fittet afvises:");
    for (const v of hard) console.error(`  ${v.high} (${fmtM(v.predHigh)}) ≤ ${v.low} (${fmtM(v.predLow)})`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke model-fil.");
    return;
  }
  const model = {
    version: 3,
    method: "log-linear: ln(value)=a+b*O+c*O^2+offset[primary_type], O=alpha*speciale+(1-alpha)*snit (anchor-calibrated)",
    fitted_at: fittedAt,
    n_anchor: anchors.length,
    r2_log: Number(fit.r2.toFixed(4)),
    alpha: ALPHA,
    // Ekstrapolations-guard: predictBaseValue klamper output OPAD til den højeste
    // anchors output — kurven er udokumenteret derover (Harry Ward-fundet, 10/6).
    output_max: Number(Math.max(...anchors.map((an) => an.output)).toFixed(1)),
    a: Number(fit.a.toFixed(6)),
    b: Number(fit.b.toFixed(6)),
    c: Number(fit.c.toExponential(6)),
    offset: Object.fromEntries(Object.entries(fit.offset).map(([t, v]) => [t, Number(v.toFixed(6))])),
    anchors_fit: [...anchors].sort((x, y) => y.target - x.target).map((an) => ({
      name: an.name, type: an.type, output: Number(an.output.toFixed(1)),
      target: an.target, predicted: Math.round(predict(an)),
    })),
    notes: "Eget data-drevet base_value, v3 (alsidigheds-blend + krumning, 9/6). SHADOW — styrer ikke økonomi før cutover (#1101 slice 2). INGEN bund. Fase 2: simulations-drevet (efter #1102). Fase 3: markeds-glidning.",
  };
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + "\n");
  console.log(`\n✅ Skrev ${MODEL_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
