#!/usr/bin/env node
// Fit værdimodel v4 (#2428 slice 1, shadow) på sim-produktions-output.
//
//   node scripts/fitRiderValuationV4.js                         # fit + skriv JSON
//   node scripts/fitRiderValuationV4.js --dry-run                # fit + rapportér, skriv intet
//   node scripts/fitRiderValuationV4.js --sample=<sti> --out=<sti> --discount=0.80 --beta-pt=0
//
// Læser Kontrakt 1-artefaktet (backend/lib/riderProductionSample.json, produceret
// af scripts/simulateSeasonProduction.js — endnu ikke bygget i denne slice) og
// fitter den rene kerne (lib/riderValuationFitV4.js: fitProductionModel). Skriver
// Kontrakt 2-JSON (backend/lib/riderValuationModelV4.json, version:4) — SEPARAT fra
// v3 (riderValuationModel.json). Rører ALDRIG v3-modellen eller nogen migration.
//
// READ-ONLY mod prod: kun SELECT riders.base_value (til skala-referencen). Ingen
// writes ud over model-JSON-filen. Manuel, ejer-godkendt re-fit — ingen auto-læring.
//
// SKALA-KALIBRERING (bevidst forenklet i denne slice): den fulde NPV-skala (karriere-
// horisont, survival-vægtet) beregnes af riderCareerNpv.js (separat agent/kontrakt),
// som endnu ikke er integreret her. For at undgå en cross-modul-afhængighed i
// fit-scriptet sætter vi scale=1.0 og gemmer i stedet begge halvdele af referencen
// (median af nuværende ægte base_value + median af sim-populationens RÅ
// enkelt-sæson-produktion) i scale_ref, så integrations-/scorecard-trinnet kan
// beregne den rigtige skalafaktor uden at gætte.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { fitProductionModel } from "../lib/riderValuationFitV4.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const DRY_RUN = !!arg("dry-run", false);
const SAMPLE_PATH = join(__dirname, "..", String(arg("sample", "lib/riderProductionSample.json")));
const OUT_PATH = join(__dirname, "..", String(arg("out", "lib/riderValuationModelV4.json")));
const DISCOUNT = Number(arg("discount", 0.8));
const BETA_PT = Number(arg("beta-pt", 0));
// Blødt top-loft (#2428): komprimér base_value over p{SOFT_CAP_PCT} med eksponent
// gamma ∈ (0,1). gamma=1 → slået fra. Tærsklen sættes > median → rører ikke skala-
// kontinuiteten. Ejer-tunbart ved cutover-review.
// Default 0,65 = balanceret punkt på gamma-frontieren (#2428, målt 13/7): sund
// ungdoms-ROI (~15%), kontrolleret runaway (~×1,4), fornuftig top-rytter (~2M).
// 0,50 kvæler ungdomsudvikling; 1,0 (fra) giver 9M-top + dominerende udvikl-og-sælg.
const SOFT_CAP_GAMMA = Number(arg("soft-cap-gamma", 0.65));
const SOFT_CAP_PCT = Number(arg("soft-cap-pct", 0.95));

const fmtM = (n) => (n / 1e6).toFixed(2) + "M";

// Stabil hash (djb2) over en streng-nøgle. Bruges til sim_run_id — reproducerbart
// på tværs af kørsler for samme sim-input (season_id+K+base_seed+v3_scoring), så
// scorecardet (Kontrakt 4) kan verificere determinisme uden at re-simulere.
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // >>> 0 → unsigned 32-bit, hex for kompakt/stabil visning.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Floor-index-percentil (samme konvention som backend/lib/valuationScorecard.js —
// ingen interpolation), så type_stats matcher scorecardets/preview'ets tal.
function quantile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

// LAUNCH_REFERENCE_YEAR/ageForSeason spejler riderProgressionEngine.js PRÆCIST
// (bevidst inlinet, jf. simulateSeasonProduction.js — undgår at trække den tunge
// DB-orchestrator-modulkæde ind for én formel).
const LAUNCH_REFERENCE_YEAR = 2026;
function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

async function main() {
  console.log(`=== Fit rider valuation model v4 ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — #2428 slice 1 (shadow) ===`);
  console.log(`  sample=${SAMPLE_PATH}`);
  console.log(`  out=${OUT_PATH}`);
  console.log(`  discount=${DISCOUNT} beta_pt=${BETA_PT}`);

  if (!Number.isFinite(DISCOUNT) || DISCOUNT <= 0 || DISCOUNT > 1) {
    console.error(`❌ --discount skal være i (0,1] (fik ${arg("discount", 0.8)})`);
    process.exit(1);
  }
  if (!Number.isFinite(BETA_PT)) {
    console.error(`❌ --beta-pt skal være et tal (fik ${arg("beta-pt", 0)})`);
    process.exit(1);
  }

  // --- Læs sim-artefakt (Kontrakt 1) ---
  let artefact;
  try {
    artefact = JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
  } catch (e) {
    console.error(`❌ Kunne ikke læse sim-artefakt ${SAMPLE_PATH}: ${e.message}`);
    console.error("   (Produceres af scripts/simulateSeasonProduction.js — Kontrakt 1.)");
    process.exit(1);
  }
  const samples = artefact.samples;
  if (!Array.isArray(samples) || samples.length < 3) {
    console.error(`❌ Sim-artefaktet har for få samples (${samples?.length ?? 0}, min 3).`);
    process.exit(1);
  }
  console.log(`\nSim-artefakt: season_id=${artefact.season_id} K=${artefact.K} base_seed=${artefact.base_seed} ` +
    `v3_scoring=${artefact.v3_scoring} · ${samples.length} samples · population=${JSON.stringify(artefact.population ?? {})}`);

  // --- Fit ---
  const fit = fitProductionModel(samples);

  // --- Rapport: koefficienter, valgt alpha, r2, per-type offsets, n_samples ---
  console.log(
    `\nValgt alpha=${fit.alpha} · a=${fit.a.toFixed(4)} · b=${fit.b.toFixed(6)} · c=${fit.c.toExponential(3)} · ` +
    `R²(log)=${fit.r2_log.toFixed(4)} · n_samples=${fit.n_samples}`
  );
  // Kontrakt 2 kræver offset for ALLE 8 typer i den skrevne model — nedstrøms
  // forbrugere (riderCareerNpv.js, scorecard, admin-preview) skal kunne slå
  // model.fit.offset[type] op direkte uden selv at genopfinde fallback-logikken.
  // Kernen (fitProductionModel) returnerer bevidst kun typer MED samples (se
  // riderValuationFitV4.js); her udvider vi til alle 8 med samme fallback som
  // predictProductionLn (laveste fittede offset — v3 #1231-mønster).
  const offsetsFitted = Object.values(fit.offset).map(Number).filter(Number.isFinite);
  const offsetFloor = offsetsFitted.length ? Math.min(...offsetsFitted) : 0;
  const sampledTypes = new Set(Object.keys(fit.offset));
  const unsampledTypes = RIDER_TYPE_KEYS.filter((t) => !sampledTypes.has(t));
  const fullOffset = Object.fromEntries(
    RIDER_TYPE_KEYS.map((t) => [t, fit.offset[t] ?? offsetFloor])
  );

  console.log("Type-offset (× = effekt vs. neutral; * = ingen samples i sim'et, fallback = laveste fittede offset):");
  for (const [t, off] of Object.entries(fullOffset).sort((x, y) => y[1] - x[1])) {
    const flag = unsampledTypes.includes(t) ? " *" : "";
    console.log(`  ${t.padEnd(16)} ${off >= 0 ? "+" : ""}${off.toFixed(3)}  (×${Math.exp(off).toFixed(2)})${flag}`);
  }
  if (unsampledTypes.length) {
    console.warn(`  ⚠ typer UDEN samples i sim'et (fallback-offset brugt): ${unsampledTypes.join(", ")}`);
  }

  // --- Type-økonomi-stats: målt E[produktion] pr. type (median + p90 e_prize) fra
  // sim-samples. Gemmes I modellen så admin-preview'et (Kontrakt 5) og scorecardet
  // kan vise "sort på hvidt hvor perception ≠ spil-virkelighed" uden at re-læse
  // sim-artefaktet. ---
  const prizeByType = {};
  for (const s of samples) {
    (prizeByType[s.primary_type] ??= []).push(Number(s.e_prize) || 0);
  }
  const typeStats = {};
  for (const t of RIDER_TYPE_KEYS) {
    const arr = prizeByType[t] ?? [];
    typeStats[t] = {
      n: arr.length,
      median_prize: arr.length ? Math.round(median(arr)) : null,
      p90_prize: arr.length ? Math.round(quantile(arr, 0.9)) : null,
    };
  }

  // --- sim_run_id: stabil hash over sim-input-nøglen ---
  const simRunKey = `${artefact.season_id}:${artefact.K}:${artefact.base_seed}:${artefact.v3_scoring}:fa=${!!artefact.free_agents}`;
  const simRunId = djb2(simRunKey);

  // --- Skala-kalibrering (read-only, kun SELECT) ---
  // Global faktor så median(v4 base_value) matcher median(nuværende base_value) over
  // HELE den ægte population → intet økonomi-chok ved cutover (spec §3.3, scorecard
  // gate 2). Beregnes via den ægte karriere-NPV (predictBaseValueV4) med scale=1,
  // IKKE en enkelt-sæson-proxy — det er den rigtige skala nu hvor riderCareerNpv.js
  // findes. READ-ONLY: kun SELECT (base_value + NPV-input abilities/potentiale/alder).
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: activeSeason } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = activeSeason?.number ?? artefact.season_number ?? null;

  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, base_value, potentiale, birthdate, primary_type, is_retired")
      .order("id")),
    fetchAllRows(() => supabase
      .from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const currentBaseValues = riders
    .map((r) => Number(r.base_value))
    .filter((v) => Number.isFinite(v) && v > 0);
  const medianCurrentBaseValue = median(currentBaseValues);

  // Rå NPV (scale=1) for hele populationen via den ægte v4-model.
  const modelForNpv = {
    fit: { alpha: fit.alpha, a: fit.a, b: fit.b, c: fit.c, offset: fullOffset },
    discount: DISCOUNT,
    scale: 1,
  };
  const rawNpvs = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) continue;
    const raw = predictBaseValueV4({ primary_type: r.primary_type, potentiale: r.potentiale, age }, ab, modelForNpv);
    if (Number.isFinite(raw) && raw > 0) rawNpvs.push(raw);
  }
  const medianV4RawNpv = median(rawNpvs);
  const scale = medianV4RawNpv > 0 ? medianCurrentBaseValue / medianV4RawNpv : 1;

  console.log(
    `\nSkala-kalibrering: median(ægte base_value, n=${currentBaseValues.length})=${fmtM(medianCurrentBaseValue)} · ` +
    `median(v4 rå NPV, scale=1, n=${rawNpvs.length})=${fmtM(medianV4RawNpv)} · scale=${scale.toExponential(4)}`
  );

  // Blødt top-loft: tærskel = p{SOFT_CAP_PCT} af de SKALEREDE (ukappede) v4-værdier,
  // så loftet rører kun den øverste hale (> median → skala-kontinuitet uændret).
  const scaledVals = rawNpvs.map((v) => v * scale);
  const softCapThreshold = Math.round(quantile(scaledVals, SOFT_CAP_PCT));
  const softCap = SOFT_CAP_GAMMA > 0 && SOFT_CAP_GAMMA < 1
    ? { threshold: softCapThreshold, gamma: SOFT_CAP_GAMMA, pct: SOFT_CAP_PCT }
    : null;
  console.log(
    softCap
      ? `Blødt top-loft: threshold=p${(SOFT_CAP_PCT * 100).toFixed(0)}=${fmtM(softCapThreshold)} · gamma=${SOFT_CAP_GAMMA} (komprimerer halen; median urørt)`
      : `Blødt top-loft: SLÅET FRA (gamma=${SOFT_CAP_GAMMA} ∉ (0,1))`
  );

  const model = {
    version: 4,
    method: "sim-production-npv",
    fitted_at: new Date().toISOString(),
    sim_run_id: simRunId,
    K: artefact.K,
    season_id: artefact.season_id,
    prize_per_point: artefact.prize_per_point,
    beta_pt: BETA_PT,
    discount: DISCOUNT,
    horizon_model: "survival-weighted",
    fit: {
      alpha: fit.alpha,
      a: Number(fit.a.toFixed(6)),
      b: Number(fit.b.toFixed(8)),
      c: Number(fit.c.toExponential(6)),
      offset: Object.fromEntries(Object.entries(fullOffset).map(([t, v]) => [t, Number(v.toFixed(6))])),
      r2_log: Number(fit.r2_log.toFixed(4)),
      n_samples: fit.n_samples,
    },
    type_stats: typeStats,
    scale: Number(scale.toPrecision(8)),
    scale_ref: {
      median_current_base_value: Math.round(medianCurrentBaseValue),
      median_v4_raw_npv: Math.round(medianV4RawNpv),
      n_calibration: rawNpvs.length,
    },
    soft_cap: softCap,
    notes:
      "Værdimodel v4 (#2428 slice 1, SHADOW) — fittet på simuleret sæson-produktion " +
      "(scripts/simulateSeasonProduction.js, inkl. free agents som virtuelle hold), ikke " +
      "på ejer-anchors som v3. alpha valgt via grid-search over log-R². scale = global " +
      "faktor så median(v4) matcher median(nuværende base_value). soft_cap = blødt top-loft " +
      "(potens-kompression over tærskel) der tæmmer den tunge hale uden fladt loft; ejer-tunbart. " +
      "Styrer INGEN økonomi (shadow, ingen migration).",
  };

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke model-fil.");
    return;
  }
  writeFileSync(OUT_PATH, JSON.stringify(model, null, 2) + "\n");
  console.log(`\n✅ Skrev ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
