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
import { curveTermSd, fitProductionModel, fitOffsetsForFixedCurve, matchCurveSpread, rescaleToMedian } from "../lib/riderValuationFitV4.js";
import { fittingOutput as blendedOutput } from "../lib/riderValuationFitV4.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../lib/riderValuationTypeDampening.js";
import { riderOverall } from "../lib/riderValuation.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

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
// Elite-præmie (#2428, ejer-retning 14/7): de enormt gode ryttere skal være
// ukøbelige i UNBUYABLE_SEASONS sæsoner. Kalibreres mod den faktiske hold-økonomi:
// råd-loft = rigeste holds saldo + N sæsoners max-opsparing (sponsor × SAVE_HEADROOM,
// generøst for præmier + fuld opsparing). Top-stjernen sættes ELITE_TOP_MULT × loftet
// (stor margin → ukøbelig langt ud over N sæsoner). Præmien rammer kun overall >
// ELITE_O_THRESHOLD (bulk urørt). Alt ejer-tunbart.
const ELITE_O_THRESHOLD = Number(arg("elite-overall-threshold", 45));
const UNBUYABLE_SEASONS = Number(arg("unbuyable-seasons", 4));
const ELITE_TOP_MULT = Number(arg("elite-top-mult", 20));
const SAVE_HEADROOM = Number(arg("save-headroom", 3));
// Elite-gulv: ryttere med overall ≥ ELITE_FLOOR_OVERALL er GARANTERET ukøbelige
// (mindst FLOOR_MULT × råd-loftet), uanset produktion.
const ELITE_FLOOR_OVERALL = Number(arg("elite-floor-overall", 58));
const FLOOR_MULT = Number(arg("elite-floor-mult", 2));
// #3353 SKALA-KALIBRERING, to tilstande (default = uændret adfærd):
//
//   --calibrate=raw       (default) Som hidtil: scale = median(gemt base_value over
//                         ALLE rytter-rækker) / median(RÅ NPV over de værdisatte).
//   --calibrate=shipping  Kalibrér mod den kæde produktionen FAKTISK bruger:
//                         applyTypeDampening() + level_correction, og mod SAMME
//                         population i tæller og nævner.
//
// Hvorfor tilstand 2 findes: `scale` har ét erklæret formål — at holde det samlede
// værdi-niveau stabilt ved en model-udskiftning (spec §3.3, scorecard gate 2).
// `raw` måler ikke det, fordi to multiplikative lag ligger EFTER den i produktionen
// (type-dæmpningens normalisering og niveau-korrektionen), og fordi tælleren løb
// over en anden population end nævneren. Ved den oprindelige fit var forskellen
// lille; ved et re-fit mod en ny typeinddeling er den ikke. Medianrytteren ligger
// langt under elite-tærsklen, så elite-præmien påvirker ikke medianen — justeringen
// er derfor ét eksakt skridt, og elite-præmien løses bagefter mod den endelige scale.
const CALIBRATE = String(arg("calibrate", "raw")).toLowerCase();
if (!["raw", "shipping"].includes(CALIBRATE)) {
  console.error(`❌ --calibrate skal være "raw" eller "shipping" (fik "${CALIBRATE}").`);
  process.exit(1);
}
// Niveau-korrektionen (#3449) er IKKE en fit-størrelse — den er en ejer-gated
// markedsmåling der ganges på den færdige base_value. Fit-scriptet har aldrig
// skrevet den; flaget findes så en kandidat kan produceres ship-klar i ét hug i
// stedet for at blive håndredigeret. Udeladt ⇒ feltet skrives ikke (faktor 1).
// #3353: hold kurven (alpha, a, b, c) fast fra en eksisterende model og fit KUN
// type-offsets. Issue #3353 beder eksplicit om at re-fitte OFFSET-TABELLEN mod
// den nye klassifikation; et fuldt re-fit ændrer samtidig kurvens stejlhed, som
// er en helt anden beslutning (den flytter hele værdifordelingen og dermed
// pengemængden). Med dette flag isoleres ændringen til det #3353 handler om.
const FIX_CURVE_FROM = arg("fix-curve-from", null);
// #3353: KANDIDAT-vaegttabel (JSON: { <type>: { <evne>: vaegt, ... } }). Tabellen
// bestemmer hvilke evner der overhovedet taeller for en type - dvs. hvor meget af
// rytteren formlen kan se. Den er en EJER-BESLUTNING; flaget findes for at kunne
// MAALE et alternativ mod hele populationen, ikke for at indfoere det. Udeladt =>
// den committede tabel (weights/valuationWeights.js), bit-identisk med foer.
// Tabellen skrives MED i model-JSON'en som `weights`, saa scorecard og
// toerkoersel automatisk bruger praecis den tabel modellen er fittet paa.
const WEIGHTS_PATH = arg("weights", null);
if (WEIGHTS_PATH || process.argv.some(x => /^--(role-map|value-role|live-npv-rates|weights-source|type-source)/.test(x))) {
  throw new Error("Experimental runtime tables are not shipped in this split. Use bestRoleRefitReport5443.mjs for the best-role candidate.");
}
// #3353: begraens alpha-grid'et. Skifter vaegttabellen, skifter OUTPUT-SKALAEN
// ogsaa - en bredere opskrift giver et snit taettere paa gennemsnittet, dvs. et
// mindre spaend i O. Kurven (a, b, c) er kalibreret mod den GAMLE skala og kan
// ikke genbruges raat; den skal forankres i den nye. Med --alpha-grid=1 fittes
// kurven om PAA SAMME alsidigheds-blanding som den live model (alpha=1), saa det
// eneste der aendrer sig er forankringen - ikke modellens form.
const ALPHA_GRID = String(arg("alpha-grid", "")).trim();
const ALPHA_GRID_VALUES = ALPHA_GRID
  ? ALPHA_GRID.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
  : null;
if (ALPHA_GRID && (!ALPHA_GRID_VALUES || !ALPHA_GRID_VALUES.length)) {
  console.error(`❌ --alpha-grid skal vaere en kommasepareret liste af tal (fik "${ALPHA_GRID}").`);
  process.exit(1);
}
// #3353: FORDELINGS-FORANKRING. Naar vaegttabellen aendres, aendres ogsaa
// spaendet i output-scoren O - en bredere opskrift traekker snittet mod
// rytterens gennemsnit. Vaerdien er eksponentiel i O, saa den samme kurve paa et
// smallere spaend klemmer toppen sammen: medianen kan holdes af skalafaktoren,
// men de staerkeste ryttere kollapser. Med --match-spread-from=<model> skaleres
// kurven saa spredningen af kurveleddet over den AEGTE population matcher den
// models. Vaerdi-FORDELINGEN bliver dermed som i dag; kun raekkefoelgen aendrer
// sig, og det er praecis hvad en ny vaegttabel skal goere.
// #3353: overskriv alsidigheds-blandingen alpha naar kurven holdes fast.
// alpha=1 betyder at KUN de evner der taeller for rytterens type overhovedet
// indgaar i vaerdien - faar han den forkerte type-label, er formlen blind for
// resten af ham. alpha<1 lader en andel af vaerdien komme fra rytterens samlede
// evne-niveau, uafhaengigt af typen. Det er en ejer-beslutning; flaget findes
// for at kunne maale den.
const ALPHA_OVERRIDE_ARG = arg("alpha", null);
const ALPHA_OVERRIDE = ALPHA_OVERRIDE_ARG == null ? null : Number(ALPHA_OVERRIDE_ARG);
if (ALPHA_OVERRIDE != null && (!Number.isFinite(ALPHA_OVERRIDE) || ALPHA_OVERRIDE < 0 || ALPHA_OVERRIDE > 1)) {
  console.error(`❌ --alpha skal vaere et tal i [0,1] (fik "${ALPHA_OVERRIDE_ARG}").`);
  process.exit(1);
}
// #3353: kort fra rider_id til den ROLLE vaerdien maales i, naar den ikke er
// rytterens egen type (D-049's bedste-rolle-nu, eller en primaer/sekundaer-
// blanding). Bruges KUN af fordelings-forankringen, som ellers ville maale
// spaendet paa den forkerte opskrift.
const VALUE_ROLE_MAP_PATH = arg("value-role-map", null);
// #3353: to midlertidige frysninger der nedlaegges med den permanente model.
//   --no-dampening     modellen erklaerer type_dampening: "off"
//   --live-npv-rates   modellen erklaerer npv_rates: "live" (den frosne
//                      vaekstrate-tabel fra 16/8 bruges ikke laengere)
const NO_DAMPENING = process.argv.includes("--no-dampening");
const LIVE_NPV_RATES = process.argv.includes("--live-npv-rates");
const MATCH_SPREAD_FROM = arg("match-spread-from", null);
const LEVEL_CORRECTION_ARG = arg("level-correction", null);
const LEVEL_CORRECTION = LEVEL_CORRECTION_ARG == null ? null : Number(LEVEL_CORRECTION_ARG);
if (LEVEL_CORRECTION != null && (!Number.isFinite(LEVEL_CORRECTION) || LEVEL_CORRECTION <= 0)) {
  console.error(`❌ --level-correction skal være et positivt tal (fik "${LEVEL_CORRECTION_ARG}").`);
  process.exit(1);
}

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

  // --- Kandidat-vaegttabel (valgfri) ---
  let candidateWeights = null;
  if (WEIGHTS_PATH) {
    const wp = join(__dirname, "..", String(WEIGHTS_PATH));
    try {
      candidateWeights = JSON.parse(readFileSync(wp, "utf8"));
    } catch (e) {
      console.error(`❌ Kunne ikke læse vægttabellen ${wp}: ${e.message}`);
      process.exit(1);
    }
    const missing = RIDER_TYPE_KEYS.filter((t) => !candidateWeights[t] || Object.keys(candidateWeights[t]).length === 0);
    if (missing.length) {
      console.error(`❌ Vægttabellen mangler vægte for: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log(`\nKANDIDAT-VÆGTTABEL: ${WEIGHTS_PATH}`);
    for (const t of RIDER_TYPE_KEYS) {
      const w = candidateWeights[t];
      const tot = Object.values(w).reduce((a, b) => a + Number(b), 0);
      const mx = Math.max(...Object.values(w).map(Number));
      console.log(`  ${t.padEnd(16)} ${Object.keys(w).length} evner · tungeste ${((mx / tot) * 100).toFixed(0)} %`);
    }
  }

  // --- Fit ---
  let fit;
  let fixedCurveRef = null;
  if (FIX_CURVE_FROM) {
    const curvePath = join(__dirname, "..", String(FIX_CURVE_FROM));
    let curveModel;
    try {
      curveModel = JSON.parse(readFileSync(curvePath, "utf8"));
    } catch (e) {
      console.error(`❌ Kunne ikke læse kurve-modellen ${curvePath}: ${e.message}`);
      process.exit(1);
    }
    const src = curveModel?.fit;
    if (!src || !Number.isFinite(Number(src.a)) || !Number.isFinite(Number(src.b))) {
      console.error(`❌ ${curvePath} har ingen brugbar fit-kurve (mangler fit.a/fit.b).`);
      process.exit(1);
    }
    fit = fitOffsetsForFixedCurve(samples, {
      alpha: ALPHA_OVERRIDE ?? src.alpha ?? 1,
      a: src.a, b: src.b, c: src.c ?? 0, weights: candidateWeights,
    });
    fixedCurveRef = { from: FIX_CURVE_FROM, fitted_at: curveModel.fitted_at ?? null, sim_run_id: curveModel.sim_run_id ?? null };
    console.log(`\nKurve HOLDT FAST fra ${FIX_CURVE_FROM} (alpha=${fit.alpha}, a=${fit.a}, b=${fit.b}, c=${fit.c}) — kun type-offsets fittes.`);
  } else {
    fit = fitProductionModel(samples, {
      weights: candidateWeights,
      ...(ALPHA_GRID_VALUES ? { alphaGrid: ALPHA_GRID_VALUES } : {}),
    });
  }

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
      .select("id, base_value, potentiale, birthdate, primary_type, is_retired, is_academy")
      .order("id")),
    fetchAllRows(() => supabase
      .from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  // --- #3353 fordelings-forankring (valgfri, se MATCH_SPREAD_FROM) ---
  let spreadRef = null;
  if (MATCH_SPREAD_FROM) {
    const refPath = join(__dirname, "..", String(MATCH_SPREAD_FROM));
    let refModel;
    try {
      refModel = JSON.parse(readFileSync(refPath, "utf8"));
    } catch (e) {
      console.error(`❌ Kunne ikke læse referencemodellen ${refPath}: ${e.message}`);
      process.exit(1);
    }
    const refFit = refModel?.fit;
    if (!refFit || !Number.isFinite(Number(refFit.b))) {
      console.error(`❌ ${refPath} har ingen brugbar kurve (mangler fit.b).`);
      process.exit(1);
    }
    // Samme population som skala-kalibreringen: aktive, ikke-akademi, med evner.
    const pop = riders.filter((r) => !r.is_retired && !r.is_academy && abilityByRider.has(r.id));
    const refOutputs = pop.map((r) =>
      blendedOutput(abilityByRider.get(r.id), r.primary_type, refFit.alpha ?? 1, refModel.weights ?? null));
    let valueRoleMap = null;
    if (VALUE_ROLE_MAP_PATH) {
      try {
        valueRoleMap = JSON.parse(readFileSync(join(__dirname, "..", String(VALUE_ROLE_MAP_PATH)), "utf8"));
      } catch (e) {
        console.error(`❌ Kunne ikke laese rolle-kortet ${VALUE_ROLE_MAP_PATH}: ${e.message}`);
        process.exit(1);
      }
    }
    const candOutputs = pop.map((r) =>
      blendedOutput(abilityByRider.get(r.id), valueRoleMap?.[r.id] ?? r.primary_type, fit.alpha, candidateWeights));
    const targetSd = curveTermSd({ b: refFit.b, c: refFit.c ?? 0, outputs: refOutputs });
    const matched = matchCurveSpread({ b: fit.b, c: fit.c, outputs: candOutputs, targetSd });
    spreadRef = {
      from: MATCH_SPREAD_FROM,
      n: pop.length,
      target_sd: targetSd,
      sd_before: matched.sdBefore,
      sd_after: matched.sdAfter,
      k: matched.k,
      b_before: fit.b,
      c_before: fit.c,
    };
    console.log(
      `\nFordelings-forankring mod ${MATCH_SPREAD_FROM} (n=${pop.length}): ` +
      `sd(kurveled) ${matched.sdBefore?.toFixed(3)} → ${matched.sdAfter?.toFixed(3)} (mål ${targetSd?.toFixed(3)}) · ` +
      `k=${matched.k.toFixed(4)} · b ${fit.b.toExponential(4)} → ${matched.b.toExponential(4)}`
    );
    fit = { ...fit, b: matched.b, c: matched.c };
  }

  const currentBaseValues = riders
    .map((r) => Number(r.base_value))
    .filter((v) => Number.isFinite(v) && v > 0);
  const medianCurrentBaseValue = median(currentBaseValues);

  // Rå NPV (scale=1) for hele populationen via den ægte v4-model.
  const modelForNpv = {
    ...(NO_DAMPENING ? { type_dampening: "off" } : {}),
    ...(LIVE_NPV_RATES ? { npv_rates: "live" } : {}),
    fit: { alpha: fit.alpha, a: fit.a, b: fit.b, c: fit.c, offset: fullOffset },
    ...(candidateWeights ? { weights: candidateWeights } : {}),
    discount: DISCOUNT,
    scale: 1,
  };
  const rawNpvs = [];
  const rawByRider = []; // { overall, raw } — til elite-præmie-kalibrering
  // #3353: samme ryttere i tæller og nævner (kun --calibrate=shipping bruger den).
  const calibrationRows = []; // { rider, abilities, age, stored }
  for (const r of riders) {
    if (r.is_retired || r.is_academy) continue;
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) continue;
    const raw = predictBaseValueV4({ primary_type: r.primary_type, potentiale: r.potentiale, age }, ab, modelForNpv);
    if (Number.isFinite(raw) && raw > 0) {
      rawNpvs.push(raw);
      rawByRider.push({ overall: riderOverall(ab), raw });
      const stored = Number(r.base_value);
      if (Number.isFinite(stored) && stored > 0) {
        calibrationRows.push({ rider: { primary_type: r.primary_type, potentiale: r.potentiale, age }, abilities: ab, stored });
      }
    }
  }
  const medianV4RawNpv = median(rawNpvs);
  let scale = medianV4RawNpv > 0 ? medianCurrentBaseValue / medianV4RawNpv : 1;

  console.log(
    `\nSkala-kalibrering (rå): median(ægte base_value, n=${currentBaseValues.length})=${fmtM(medianCurrentBaseValue)} · ` +
    `median(v4 rå NPV, scale=1, n=${rawNpvs.length})=${fmtM(medianV4RawNpv)} · scale=${scale.toExponential(4)}`
  );

  let shippingCalibration = null;
  if (CALIBRATE === "shipping") {
    // Mål medianen gennem PRÆCIS den kæde produktionen bruger: type-dæmpning
    // (riderValueRefresh.js router hver model-indlæsning igennem den) + niveau-
    // korrektion. Elite-præmien udelades bevidst — den rammer kun overall over
    // tærsklen og kan pr. konstruktion ikke flytte medianen; den løses bagefter
    // mod den FÆRDIGE scale, så elite-målet stadig holder.
    const shippingModel = applyTypeDampening({
      ...(NO_DAMPENING ? { type_dampening: "off" } : {}),
      ...(LIVE_NPV_RATES ? { npv_rates: "live" } : {}),
      fit: { alpha: fit.alpha, a: fit.a, b: fit.b, c: fit.c, offset: fullOffset },
      type_stats: typeStats,
      ...(candidateWeights ? { weights: candidateWeights } : {}),
      discount: DISCOUNT,
      scale,
      ...(LEVEL_CORRECTION != null ? { level_correction: LEVEL_CORRECTION } : {}),
    });
    const shippingValues = [];
    const storedValues = [];
    for (const row of calibrationRows) {
      const v = predictBaseValueV4(row.rider, row.abilities, shippingModel);
      if (Number.isFinite(v) && v > 0) { shippingValues.push(v); storedValues.push(row.stored); }
    }
    const medianShipping = median(shippingValues);
    const medianStoredSamePop = median(storedValues);
    const before = scale;
    scale = rescaleToMedian({ scale, medianTarget: medianStoredSamePop, medianActual: medianShipping });
    shippingCalibration = {
      n: shippingValues.length,
      median_stored_same_population: Math.round(medianStoredSamePop),
      median_shipping_before: Math.round(medianShipping),
      scale_before: Number(before.toPrecision(8)),
      type_dampening_enabled: TYPE_DAMPENING_ENABLED,
      level_correction_applied: LEVEL_CORRECTION,
    };
    console.log(
      `Skala-kalibrering (shipping): n=${shippingValues.length} · median(gemt, samme population)=${fmtM(medianStoredSamePop)} · ` +
      `median(kæde før justering)=${fmtM(medianShipping)} · scale ${before.toExponential(4)} → ${scale.toExponential(4)}`
    );
  }

  // Elite-præmie: kalibrér mod den ægte hold-økonomi så de enormt gode ryttere er
  // ukøbelige i UNBUYABLE_SEASONS sæsoner (ejer-retning 14/7). READ-ONLY.
  const teamsEcon = await fetchAllRows(() => supabase
    .from("teams").select("balance, sponsor_income, is_test_account, is_frozen, is_bank").order("id"));
  const realTeams = teamsEcon.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank);
  const maxBalance = Math.max(0, ...realTeams.map((t) => Number(t.balance) || 0));
  const maxSponsor = Math.max(0, ...realTeams.map((t) => Number(t.sponsor_income) || 0));
  // Råd-loft = rigeste saldo + N sæsoners max-opsparing (sponsor × SAVE_HEADROOM,
  // generøst for præmier + at spare ALT op). Top-stjerne-mål = ELITE_TOP_MULT × loftet.
  const affordabilityCeiling = maxBalance + UNBUYABLE_SEASONS * maxSponsor * SAVE_HEADROOM;
  const targetTop = affordabilityCeiling * ELITE_TOP_MULT;
  // Anker på den højeste-overall rytter: løs k så hans skalerede rå-værdi × præmie = targetTop.
  const topRider = rawByRider.reduce((best, x) => (x.overall > (best?.overall ?? -Infinity) ? x : best), null);
  let elitePremium = null;
  if (topRider && topRider.overall > ELITE_O_THRESHOLD) {
    const vTop = topRider.raw * scale;
    const k = Math.max(0, Math.log(targetTop / vTop) / (topRider.overall - ELITE_O_THRESHOLD));
    elitePremium = {
      overall_threshold: ELITE_O_THRESHOLD,
      k: Number(k.toPrecision(6)),
      floor_overall: ELITE_FLOOR_OVERALL,
      floor: Math.round(affordabilityCeiling * FLOOR_MULT),
      affordability_ceiling: Math.round(affordabilityCeiling),
      unbuyable_seasons: UNBUYABLE_SEASONS,
      target_top: Math.round(targetTop),
    };
  }
  console.log(
    elitePremium
      ? `Elite-præmie: overall>${ELITE_O_THRESHOLD} · k=${elitePremium.k} · gulv(overall≥${ELITE_FLOOR_OVERALL})=${fmtM(elitePremium.floor)} · råd-loft(${UNBUYABLE_SEASONS} sæs)=${fmtM(affordabilityCeiling)} · top-mål=${fmtM(targetTop)} (top overall ${topRider.overall})`
      : `Elite-præmie: SLÅET FRA (ingen rytter over overall ${ELITE_O_THRESHOLD})`
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
    ...(NO_DAMPENING ? { type_dampening: "off" } : {}),
    ...(LIVE_NPV_RATES ? { npv_rates: "live" } : {}),
    ...(candidateWeights ? { weights: candidateWeights, weights_ref: WEIGHTS_PATH } : {}),
    ...(fixedCurveRef ? { fixed_curve_ref: fixedCurveRef } : {}),
    ...(spreadRef ? { spread_match_ref: spreadRef } : {}),
    scale: Number(scale.toPrecision(8)),
    ...(LEVEL_CORRECTION != null ? { level_correction: LEVEL_CORRECTION } : {}),
    scale_ref: {
      calibrate: CALIBRATE,
      median_current_base_value: Math.round(medianCurrentBaseValue),
      median_v4_raw_npv: Math.round(medianV4RawNpv),
      n_calibration: rawNpvs.length,
      ...(shippingCalibration ? { shipping: shippingCalibration } : {}),
    },
    elite_premium: elitePremium,
    notes:
      "Værdimodel v4 (#2428, SHADOW) — fittet på simuleret sæson-produktion " +
      "(scripts/simulateSeasonProduction.js, inkl. free agents som virtuelle hold), ikke " +
      "på ejer-anchors som v3. alpha valgt via grid-search over log-R². scale = global " +
      "faktor så median(v4) matcher median(nuværende base_value). elite_premium = stejl " +
      "konveks præmie over overall-tærskel så de enormt gode ryttere er ukøbelige i " +
      "unbuyable_seasons sæsoner (kalibreret mod rigeste holds råd-loft); ejer-tunbart. " +
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
