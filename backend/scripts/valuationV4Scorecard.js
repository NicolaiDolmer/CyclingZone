#!/usr/bin/env node
// Værdimodel v4 — slice 1 shadow-scorecard (#2428). Simulér-før-ship: sammenligner
// v3 (perception, riderValuationModel.json) mod v4 (produktions-NPV,
// riderValuationModelV4.json) over den ÆGTE prod-population, FØR ejer godkender
// cutover (slice 2 — separat migration, ALDRIG denne fil). Harness-standard jf.
// #1144, samme mønster som scripts/valuationScorecard.js (v3).
//
// READ-ONLY mod prod (kun SELECT — skriver ALDRIG). Gates fra spec §5
// (docs/superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md):
//   1. Type-økonomi (rapport)      2. Skala-kontinuitet (hård, ±15% median-drift)
//   3. Udvikl-og-sælg P&L (hård)   4. Symmetri (rapport, career-trajectories)
//   5. Elite ukøbelig (hård)         6. Anker-sanity (blød — rapporteres, blokerer aldrig)
//   7. Determinisme (hård, sim_run_id sat)
//
// Ren gate-matematik: ../lib/valuationV4Scorecard.js (node --test, ingen DB-afhængighed).
//
//   node scripts/valuationV4Scorecard.js [--sample=<sti>] [--model-v4=<sti>] [--out=<sti>]
//                                        [--baseline=v3|stored] [--apply-dampening]
//
// #3353 (re-fit mod ny typeinddeling): kør med
//   --baseline=stored --apply-dampening
// for at måle en KANDIDAT-model mod det spillerne ser i dag, gennem præcis den
// kæde produktionen bruger. Uden flagene er adfærden identisk med den
// oprindelige cutover-kørsel (v3 som baseline, rå fit-offsets).
//
// Exit 1 hvis en HÅRD gate fejler. Rapport-/bløde gates fejler aldrig kørslen.
//
// FORUDSÆTNING (ikke opfyldt endnu 13/7): riderProductionSample.json (Kontrakt 1,
// scripts/simulateSeasonProduction.js) og riderValuationModelV4.json (Kontrakt 2,
// scripts/fitRiderValuationV4.js) skal eksistere. Kør IKKE dette script mod prod
// før begge artefakter er genereret af arkitekten ved integration.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { predictBaseValue, riderOverall } from "../lib/riderValuation.js";
// Kontrakt 3 (backend/lib/riderCareerNpv.js) — bygget parallelt, landet 13/7:
//   predictBaseValueV4(rider, abilities, model) → number|null
//   careerTrajectory(rider, abilities, model) → [{ s, age, O, prod, survival, discounted }]
import { careerTrajectory, currentProductionValue, predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { checkAnchorOrdering } from "../lib/riderValuationFit.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../lib/riderValuationTypeDampening.js";
// #3353: SÆSON-alder, ikke wall-clock. Se loadRealPopulation for hvorfor.
import { ageForSeason } from "../lib/riderSeasonAge.js";
import {
  allHardGatesPass,
  anchorSanityRow,
  determinismGate,
  developAndSellGate,
  formatTrajectoryTable,
  formatTypeEconomyTable,
  projectAbilitiesForward,
  eliteUnbuyableGate,
  scaleContinuityGate,
  symmetryReportRow,
  typeEconomyRows,
} from "../lib/valuationV4Scorecard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const argVal = (flag) => {
  const prefix = `--${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};
const SAMPLE_PATH = argVal("sample") || join(__dirname, "../lib/riderProductionSample.json");
const MODEL_V4_PATH = argVal("model-v4") || join(__dirname, "../lib/riderValuationModelV4.json");
const OUT_PATH = argVal("out");
// #3353 RE-FIT-TILSTAND (begge defaulter til den oprindelige cutover-adfærd):
//
//   --baseline=stored    Gate 2 måler mod de værdier der står i prod NU
//                        (riders.base_value), ikke mod v3. Ved et re-fit af v4 er
//                        v3 et dødt shadow-artefakt fra før #2594-cutoveren, og
//                        "ingen økonomi-chok" betyder afstand til DEN værdi
//                        spillerne ser i dag.
//   --apply-dampening    Kør modellen gennem applyTypeDampening() — dvs. præcis den
//                        kæde produktionen bruger (riderValueRefresh.js). Uden
//                        flaget scores de RÅ fit-offsets, som ingen kaldevej i
//                        prod bruger.
const BASELINE = (argVal("baseline") || "v3").toLowerCase();
if (!["v3", "stored"].includes(BASELINE)) {
  console.error(`❌ --baseline skal være "v3" eller "stored" (fik "${BASELINE}").`);
  process.exit(1);
}
const APPLY_DAMPENING = process.argv.includes("--apply-dampening");
// Udvikl-og-sælg-vinduet (sæsoner en akademi-prospect holdes før "salg") — samme
// horisont som #1364's eget scorecard (valueDevelopSellScorecard.js default 4).
const DEVELOP_SELL_SEASONS = 4;
// riders.potentiale er på en 1-6-skala (numeric, kontinuert — verificeret mod prod
// 13/7: min 1, max 6, avg 2,73; progressions-motoren clamper til [1,6]). "Højt
// potentiale" = øverste tier. IKKE 0-99 (tidligere fejl-antagelse #2428).
const HIGH_POTENTIALE = 5;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`❌ Kunne ikke læse ${label} (${path}): ${err.message}`);
    process.exit(1);
  }
}

const v3Model = readJson(join(__dirname, "../lib/riderValuationModel.json"), "v3-model");
const sample = readJson(SAMPLE_PATH, "sim-artefakt (Kontrakt 1)");
const v4ModelRaw = readJson(MODEL_V4_PATH, "v4-model (Kontrakt 2)");
const v4Model = APPLY_DAMPENING ? applyTypeDampening(v4ModelRaw) : v4ModelRaw;

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

// Ægte population-prædikat (kontrakt-note, #2428): teams eksklud.
// is_test_account/is_frozen/is_bank; AI-hold (is_ai=true) MED (de kører løb).
// riders: is_academy=false AND is_retired=false AND team_id not null.
//
// #3353 ALDERS-RETTELSE: scorecardet brugte `riderAge(birthdate)` — WALL-CLOCK.
// Hele værdi-kæden i produktionen (riderValueRefresh.js, riderProgressionEngine.js,
// fitRiderValuationV4.js) bruger SÆSON-alder (ageForSeason), og riderSeasonAge.js's
// egen topkommentar dokumenterer to tidligere bugs (#3071, #3081) af præcis denne
// klasse. Forskellen var 0 i sæson 1 (hvor scorecardet blev skrevet) og vokser med
// ét år pr. sæson: i sæson 3 værdisatte scorecardet hele populationen som TO ÅR
// YNGRE end produktionen gør — længere restkarriere, højere NPV — så gate 2's
// median-drift blev målt mod tal ingen spiller kan se. Rettet her; ingen anden
// adfærd ændret.
async function loadRealPopulation() {
  const { data: activeSeason, error: seasonErr } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  let seasonNumber = activeSeason?.number ?? null;
  if (!seasonNumber) {
    const { data: lastDone } = await supabase
      .from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = lastDone?.number ?? 1;
  }
  const [allTeams, allRiders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("teams").select("id, is_ai, is_bank, is_test_account, is_frozen").order("id")),
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, firstname, lastname, primary_type, potentiale, birthdate, team_id, is_academy, is_retired, base_value")
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const teamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  // #2428 (14/7): INKLUDÉR free agents (team_id NULL) — de enormt gode ryttere er
  // usignerede, og elite-ukøbelig-gaten skal netop verificere DEM. Ekskludér kun
  // ryttere på test-/frost-/bank-hold. (Bulk-gates er robuste mod de ~11% free agents.)
  const riders = allRiders.filter(
    (r) => r.is_academy === false && r.is_retired === false && (r.team_id == null || teamIds.has(r.team_id))
  );
  return {
    seasonNumber,
    population: riders.map((r) => ({
      ...r,
      age: ageForSeason(r.birthdate, seasonNumber),
      abilities: abilityByRider.get(r.id) || null,
    })),
  };
}

async function main() {
  const { population, seasonNumber } = await loadRealPopulation();
  const valued = population.filter((r) => r.abilities != null);

  // --- v3 vs v4 pr. rytter ---
  const rows = valued
    .map((r) => ({
      ...r,
      overall: riderOverall(r.abilities),
      v3Value: predictBaseValue(r, r.abilities, v3Model),
      v4Value: predictBaseValueV4({ primary_type: r.primary_type, potentiale: r.potentiale, age: r.age }, r.abilities, v4Model),
    }))
    .filter((r) => r.v3Value != null && r.v4Value != null);

  const v3Values = rows.map((r) => r.v3Value);
  const v4Values = rows.map((r) => r.v4Value);

  // --- Gate 1: type-økonomi ---
  const typeRows = typeEconomyRows(sample.samples || [], v3Model.offset || {});

  // --- Gate 2: skala-kontinuitet ---
  // #3353: ved --baseline=stored måles mod de gemte base_value'er (hvad spillerne
  // ser i dag). Kun ryttere MED en gemt værdi tæller med — en null-værdi er
  // "aldrig værdisat", ikke "værd 0".
  const baselineValues = BASELINE === "stored"
    ? rows.map((r) => r.base_value).filter((v) => v != null)
    : v3Values;
  const gScale = scaleContinuityGate(baselineValues, v4Values, {
    baselineLabel: BASELINE === "stored" ? "gemt base_value" : "v3",
  });

  // --- Gate 5: elite ukøbelig ---
  const gEliteUnbuyable = eliteUnbuyableGate(rows, {
    ceiling: v4Model.elite_premium?.affordability_ceiling,
    eliteOverall: v4Model.elite_premium?.floor_overall,
  });

  // --- Gate 3: udvikl-og-sælg P&L ---
  // Repræsentativ ung prospect: højt potentiale (≥HIGH_POTENTIALE på 1-6-skalaen
  // riders.potentiale bruger), akademi-alder (≤21). bvStart = deres v4-værdi NU
  // (fuld resterende-karriere-NPV). bvAtHorizon = v4-værdi EFTER at have fremskrevet
  // deres abilities DEVELOP_SELL_SEASONS sæsoner frem (projectAbilitiesForward —
  // samme matematik som riderCareerNpv.js's interne fremskrivning, se lib-filens kommentar).
  const prospects = rows.filter((r) => r.age != null && r.age <= 21 && Number(r.potentiale) >= HIGH_POTENTIALE);
  const bestProspect = prospects.reduce((best, r) => (r.v4Value > (best?.v4Value ?? -Infinity) ? r : best), null);
  // Peak-stjerne (25-29å, top v4-værdi) — kun til symmetri-arketypen nedenfor.
  // Dominans MÅLES nu på ROI i developAndSellGate (ikke en værdi-sammenligning).
  const peakStars = rows.filter((r) => r.age != null && r.age >= 25 && r.age <= 29);
  const dominanceCeiling = peakStars.length ? Math.max(...peakStars.map((r) => r.v4Value)) : null;

  let gPnl;
  if (bestProspect) {
    const { abilities: projectedAbilities, ageAtHorizon } = projectAbilitiesForward(
      bestProspect.abilities,
      { primaryType: bestProspect.primary_type, potentiale: bestProspect.potentiale, startAge: bestProspect.age },
      DEVELOP_SELL_SEASONS
    );
    const bvAtHorizon = predictBaseValueV4(
      { primary_type: bestProspect.primary_type, potentiale: bestProspect.potentiale, age: ageAtHorizon },
      projectedAbilities,
      v4Model
    );
    // #2594: løn-leddet i cost-modellen bruger den ÆGTE nye løn-base (cpv ved
    // signering, frossen) — ikke den gamle værdi-koblede sats.
    const cpvStart = currentProductionValue(
      { primary_type: bestProspect.primary_type, potentiale: bestProspect.potentiale, age: bestProspect.age },
      bestProspect.abilities,
      v4Model
    );
    gPnl = developAndSellGate({
      bvStart: bestProspect.v4Value,
      cpvStart,
      bvAtHorizon: bvAtHorizon ?? bestProspect.v4Value,
      seasons: DEVELOP_SELL_SEASONS,
    });
  } else {
    gPnl = {
      name: "Udvikl-og-sælg P&L: ung prospect net-positiv, ikke dominant",
      hard: true,
      ok: false,
      detail: `ingen repræsentativ ung prospect (alder ≤21, potentiale ≥${HIGH_POTENTIALE} på 1-6-skalaen) fundet i den ægte population`,
    };
  }

  // --- Gate 7: determinisme ---
  const gDeterminism = determinismGate({ simRunId: v4Model.sim_run_id });

  // --- Gate 6: anker-sanity (blød) — navne-match anchors mod v4-værdisatte ryttere,
  // genbruger checkAnchorOrdering (riderValuationFit.js) med v4Value som predict().
  const anchorRows = (v3Model.anchors_fit || [])
    .map((an) => {
      const hit = rows.find((r) => norm(`${r.firstname} ${r.lastname}`).includes(norm(an.name)));
      return hit ? { name: an.name, target: an.target, v4Value: hit.v4Value } : null;
    })
    .filter(Boolean);
  const orderingResult = checkAnchorOrdering(anchorRows, (a) => a.v4Value);
  const gAnchor = anchorSanityRow(orderingResult);

  // --- Gate 4: symmetri (rapport) — careerTrajectory for 2-3 arketyper ---
  const archetypes = [];
  const pickArchetype = (label, predicate) => {
    const r = rows.find(predicate);
    if (!r) return;
    const traj = careerTrajectory(
      { primary_type: r.primary_type, potentiale: r.potentiale, age: r.age },
      r.abilities,
      v4Model
    );
    if (traj?.length) archetypes.push({ label, traj });
  };
  pickArchetype(`Ung talent (≤21å, potentiale ≥${HIGH_POTENTIALE})`, (r) => r.age <= 21 && Number(r.potentiale) >= HIGH_POTENTIALE);
  pickArchetype("Peak-stjerne (25-29å, top v4-værdi)", (r) => r.age >= 25 && r.age <= 29 && r.v4Value === dominanceCeiling);
  pickArchetype("Veteran (≥33å)", (r) => r.age >= 33);
  const gSymmetry = symmetryReportRow(archetypes.length);

  const gates = [
    { name: "Type-økonomi-tabel", hard: false, ok: typeRows.length > 0, detail: `${typeRows.length} type(r) med sim-data` },
    gScale,
    gPnl,
    gSymmetry,
    gEliteUnbuyable,
    gAnchor,
    gDeterminism,
  ];

  // --- Markdown ---
  const L = [];
  L.push("# Værdimodel v4 — shadow-scorecard (slice 1, #2428)");
  L.push("");
  L.push(`> Genereret ${today} af \`node backend/scripts/valuationV4Scorecard.js\` (READ-ONLY mod prod) · simulér-før-ship, ejer-gate FØR cutover (slice 2)`);
  L.push(`> v4-model: ${MODEL_V4_PATH} · fittet ${v4Model.fitted_at ?? "?"} · sim_run_id ${v4Model.sim_run_id ?? "?"} · K=${v4Model.K ?? "?"} · discount=${v4Model.discount ?? "?"}`);
  L.push(`> Baseline for gate 2: ${BASELINE === "stored" ? "gemt `riders.base_value` (hvad spillerne ser i dag)" : "v3-modellen"} · type-dæmpning i scoringen: ${APPLY_DAMPENING ? `PÅ (TYPE_DAMPENING_ENABLED=${TYPE_DAMPENING_ENABLED})` : "FRA (rå fit-offsets)"}`);
  L.push(`> Population: ${population.length} ægte ryttere (ekskl. akademi/pensioneret/uden hold/test-/frost-/bank-hold) · ${rows.length} med v3+v4-værdi · sæson-alder forankret i sæson ${seasonNumber}`);
  L.push("");

  L.push("## Gates");
  L.push("");
  L.push("| # | Gate | Type | Status | Detalje |");
  L.push("|--:|---|:--:|:--:|---|");
  gates.forEach((g, i) => L.push(`| ${i + 1} | ${g.name} | ${g.hard ? "hård" : "blød/rapport"} | ${g.ok ? "✅" : "❌"} | ${g.detail} |`));
  L.push("");

  L.push("## 1. Type-økonomi — målt E[produktion] (sim) vs v3-offset");
  L.push("");
  L.push(...formatTypeEconomyTable(typeRows));
  L.push("");

  L.push("## 4. Symmetri — career-trajectories (alder → E[produktion]/survival)");
  L.push("");
  if (archetypes.length) {
    for (const a of archetypes) {
      L.push(...formatTrajectoryTable(a.label, a.traj));
      L.push("");
    }
  } else {
    L.push("_Ingen trajectories — ingen matchende arketype fundet i populationen, eller careerTrajectory returnerede tomt._");
    L.push("");
  }

  L.push("## Ejer-beslutning");
  L.push("");
  L.push("**Godkend v4 shadow → planlæg cutover (slice 2)? (ja/nej)**");
  L.push("");
  L.push("- **Ja** → v4 er verificeret mod den ægte population; slice 2 (migration + `predictBaseValue`-swap) kan planlægges. Migrationen anvendes ALDRIG automatisk — ejer merger.");
  L.push("- **Nej** → gates ovenfor ER fejl-rapporten: justér `discount`/`beta_pt`/horisont i fit-scriptet (`scripts/fitRiderValuationV4.js`) eller sim-parametrene (`scripts/simulateSeasonProduction.js`) og kør dette scorecard igen.");
  L.push("");

  const md = L.join("\n") + "\n";

  // --- Output ---
  if (OUT_PATH) {
    writeFileSync(OUT_PATH, md);
    console.log(`✅ Skrev rapport: ${OUT_PATH}`);
  } else {
    console.log(md);
  }
  console.log(`Scorecard: ${rows.length} ryttere · gates: ${gates.filter((g) => g.ok).length}/${gates.length} grønne (${gates.filter((g) => g.hard).length} hårde)`);
  for (const g of gates) console.log(`  ${g.ok ? "✅" : "❌"} [${g.hard ? "hård" : "blød"}] ${g.name} — ${g.detail}`);

  if (!allHardGatesPass(gates)) {
    console.error("\n❌ SCORECARD: mindst én hård gate fejlede (se ovenfor).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
