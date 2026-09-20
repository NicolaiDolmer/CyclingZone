// #5443 / #3353 · READ-ONLY sammenligning af flere værdi-kandidater mod hele den
// aktive population, på de fire prøver ejeren har bedt om.
//
// Baggrund: tørkørslen 20/9 viste at en omregning af formlen ALENE ikke redder
// de fald spillerne klager over. Faldene kommer fra at værdiformlens vægt-tabel
// for visse typer kun kigger på én eller to evner. Dette script måler derfor
// flere kandidater — med forskellige vægt-tabeller — side om side:
//
//   1. STYRKE-PRØVEN     — falder de stærke ryttere? (doktrin: styrke straffes aldrig)
//   2. STÅ-STILLE-PRØVEN — flytter værdien sig når rytteren udvikler sig?
//   3. PENGEMÆNGDEN      — Σ menneskehold og Σ hele populationen
//   4. FORDELINGEN       — op/ned, store fald, fordoblinger, hold
//
// Plus C3-målingen: hvor meget af de unges fald forsvinder, hvis værditypen er
// den type rytterens NUVÆRENDE evner peger på i stedet for hans caps/potentiale?
//
// SKRIVER ALDRIG. Genbruger den ægte beregningssti (recomputeRiderValue fra
// backend/lib/riderValueRefresh.js) og router hver model gennem
// applyTypeDampening(), præcis som produktionen gør.
//
//   infisical run --env=prod --silent -- node scripts/dev/v4RefitCompare5443.mjs \
//     --models=B=lib/riderValuationModelV4.candidate-5443-B.json,C1=...,C2=... \
//     --out=<mappe>
//
// Output: markdown + rå JSON i den gitignorede balance-internals-mappe (hard rule 17).

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { ABILITY_KEYS, computeRiderTypes } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../../lib/riderValuationTypeDampening.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { weightConcentration } from "../../lib/valuationWeightDerivation.js";
import { VALUATION_WEIGHTS } from "../../lib/weights/valuationWeights.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const BACKEND = join(__dirname, "../..");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};
const MODELS_ARG = arg("models", "B=lib/riderValuationModelV4.candidate-5443-B.json");
// #3353 / D-049: for de rolle-baserede kandidater er vaerdi-rollen ikke rytterens
// egen type. Kortet giver rolle pr. rider_id. En noegle med "|" er et
// (primaer|sekundaer)-par: opskriften er parrets blanding, mens OFFSET og
// evne-lofter stadig hoerer til den naturlige primaertype - derfor saettes
// valuation_type til primaeren og kun vaegttabellen byttes.
const ROLE_MAPS_ARG = arg("role-maps", "");
// Hvilken REGEL vaelger vaerdi-rollen? Noedvendig for proeve 5 og 6, som skal
// gen-anvende reglen paa aendrede evner - ikke bare slaa op i et fast kort.
//   best8 = max over alle otte rollers visnings-opskrift (D-049)
//   best2 = den bedste af rytterens to naturlige roller
//   pair  = fast blanding af de to naturlige roller (rollen skifter aldrig)
const ROLE_RULES_ARG = arg("role-rules", "");
const OUT_DIR = resolve(arg("out", join(BACKEND, "../balance-internals/2026-09-20-5443-v4-refit/sammenligning")));
const HISTORY_DAYS = Number(arg("history-days", 14));

const NAMED = [
  { id: "34727ffe-1492-43c2-ad65-6f4f10acf06a", label: "Wessel K. Mertens (knud_r_flink)" },
  "ryan cooper", "jasper verhoeven", "daniel carmona", "jihoon bae", "yuto suzuki",
  "mason marsh", "tijl coppens", "toby murphy", "romain dumas",
  "nicolo caruso", "ryan newton", "long chen",
];

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via infisical run --env=prod --silent -- ...");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

const n0 = (x) => Number(x) || 0;
const fmt = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Math.round(Number(x)).toLocaleString("da-DK"));
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

const LIVE_TABLE = Object.fromEntries(VALUATION_WEIGHTS.map((t) => [t.key,
  Object.fromEntries(Object.entries(t.weights).filter(([, w]) => w > 0))]));

async function load() {
  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  const live = applyTypeDampening(JSON.parse(readFileSync(join(LIB, "riderValuationModelV4.json"), "utf8")));

  const roleRules = {};
  if (ROLE_RULES_ARG) {
    for (const spec of ROLE_RULES_ARG.split(",")) {
      const [name, rule] = spec.split("=");
      roleRules[name] = rule;
    }
  }
  const roleMaps = {};
  if (ROLE_MAPS_ARG) {
    for (const spec of ROLE_MAPS_ARG.split(",")) {
      const [name, path] = spec.split("=");
      roleMaps[name] = JSON.parse(readFileSync(resolve(join(BACKEND, path)), "utf8"));
    }
  }

  const models = [];
  for (const spec of MODELS_ARG.split(",")) {
    const [name, path] = spec.split("=");
    const raw = JSON.parse(readFileSync(resolve(join(BACKEND, path)), "utf8"));
    models.push({ name, path, raw, model: applyTypeDampening(raw), roleMap: roleMaps[name] ?? null, roleRule: roleRules[name] ?? null, pairCache: new Map() });
  }

  const { data: season, error: seasonErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`season lookup: ${seasonErr.message}`);
  let seasonNumber = season?.number ?? null;
  if (!seasonNumber) {
    const { data: lastDone } = await sb.from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = lastDone?.number ?? 1;
  }

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, is_academy, primary_type, secondary_type, valuation_type, base_value, birthdate, potentiale, archetype_draw")
    .order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);

  const teams = await fetchAllRows(() => sb.from("teams")
    .select("id, name, is_ai, is_bank, is_test_account").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const ids = new Set(riders.map((r) => r.id));
  // Race-motorens 15 nøgler: kandidat-tabellerne kan bruge `positioning`/`tactics`,
  // som IKKE er i værdimodellens 13. Uden dem i rækken ville de vægte tavst falde ud.
  const abilityCols = [...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])];
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${abilityCols.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a]));
  const capsByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a.ability_caps]));

  return { riders, teamById, abilityByRider, capsByRider, baseline, youthBaseline, live, models, seasonNumber };
}

// Loeser hvilken model + vaerdi-type en kandidat bruger for EN rytter.
// Uden rolle-kort: rytterens egen primaertype, som hidtil.
// Med rolle-kort: den kortlagte rolle. Er den et par ("a|b"), byttes KUN
// opskriften for primaertypen ud med parrets blanding - offset og evne-lofter
// foelger stadig primaeren.
// Anvend kandidatens rolle-regel paa et evne-saet. Returnerer null naar rollen
// ikke afhaenger af evnerne (pair, eller ingen regel) - saa bevares den faste rolle.
function roleForAbilities(m, rider, abilities) {
  if (m.roleRule === "best8") return bestRoleNow(abilities);
  if (m.roleRule === "best2") {
    const a = ratingFromAbilities(abilities, rider.primary_type);
    const b = rider.secondary_type && rider.secondary_type !== rider.primary_type
      ? ratingFromAbilities(abilities, rider.secondary_type) : null;
    if (b != null && (a == null || b > a)) return rider.secondary_type;
    return rider.primary_type;
  }
  return null;
}

function resolveFor(m, rider) {
  const mapped = m.roleMap?.[rider.id];
  if (!mapped) return { model: m.model, valuationType: rider.primary_type };
  if (!mapped.includes("|")) return { model: m.model, valuationType: mapped };
  const primary = mapped.split("|")[0];
  if (!m.pairCache.has(mapped)) {
    const pairTable = m.model.weights?.[mapped];
    m.pairCache.set(mapped, pairTable
      ? { ...m.model, weights: { ...m.model.weights, [primary]: pairTable } }
      : m.model);
  }
  return { model: m.pairCache.get(mapped), valuationType: primary };
}

function recompute(ctx, r, model, valuationType, abilitiesOverride) {
  const ab = abilitiesOverride || ctx.abilityByRider.get(r.id);
  if (!ab) return null;
  const row = valuationType === undefined ? r : { ...r, valuation_type: valuationType };
  return recomputeRiderValue(row, ab, ctx.baseline, model, {
    typeAbilities: ctx.capsByRider.get(r.id),
    youthBaseline: ctx.youthBaseline,
  });
}

const isHumanTeam = (ctx, r) => {
  const t = r.team_id ? ctx.teamById.get(r.team_id) : null;
  return Boolean(t && t.is_ai === false && t.is_bank !== true && t.is_test_account !== true);
};
const teamLabel = (ctx, r) => {
  const t = r.team_id ? ctx.teamById.get(r.team_id) : null;
  return t ? (t.name || t.id) : (r.team_id ? `ukendt hold ${r.team_id}` : "fri rytter");
};

// D-049's regel: bedste rolle nu = max over de otte rollers visnings-opskrift,
// beregnet med spillets egen ratingForRole (via ratingFromAbilities).
function bestRoleNow(abilities) {
  let best = null;
  let bestScore = -Infinity;
  for (const key of RIDER_TYPE_KEYS) {
    const v = ratingFromAbilities(abilities, key);
    if (v == null) continue;
    if (v > bestScore || (v === bestScore && best != null && key < best)) { bestScore = v; best = key; }
  }
  return best;
}

// ── Prøve 3+4: pengemængde og fordeling ──────────────────────────────────────
function distribution(rows, key) {
  const vals = rows.filter((x) => x.stored > 0 && x[key] != null);
  const sumB = vals.reduce((s, x) => s + x.stored, 0);
  const sumA = vals.reduce((s, x) => s + x[key], 0);
  const ratios = vals.map((x) => x[key] / x.stored);
  const pcts = ratios.map((r) => (r - 1) * 100).sort((a, b) => a - b);
  return {
    n: vals.length,
    sum_before: sumB,
    sum_after: sumA,
    sum_pct: sumB ? (sumA / sumB - 1) * 100 : null,
    up: ratios.filter((r) => r > 1.01).length,
    down: ratios.filter((r) => r < 0.99).length,
    flat: ratios.filter((r) => r >= 0.99 && r <= 1.01).length,
    median_pct: quantile(pcts, 0.5),
    p10_pct: quantile(pcts, 0.1),
    p90_pct: quantile(pcts, 0.9),
    lose_25: ratios.filter((r) => r <= 0.75).length,
    lose_50: ratios.filter((r) => r <= 0.5).length,
    more_than_double: ratios.filter((r) => r > 2).length,
  };
}

function teamStats(rows, key) {
  const agg = new Map();
  for (const x of rows) {
    if (!x.human_team || !(x.stored > 0) || x[key] == null) continue;
    if (!agg.has(x.team_id)) agg.set(x.team_id, { team: x.team, before: 0, after: 0, riders: 0 });
    const t = agg.get(x.team_id);
    t.before += x.stored; t.after += x[key]; t.riders++;
  }
  const list = [...agg.values()].map((t) => ({ ...t, pct: t.before ? (t.after / t.before - 1) * 100 : null }));
  return {
    total: list.length,
    losing_10: list.filter((t) => t.pct <= -10).length,
    losing_25: list.filter((t) => t.pct <= -25).length,
    gaining_10: list.filter((t) => t.pct >= 10).length,
    worst: list.sort((a, b) => a.pct - b.pct).slice(0, 5),
  };
}

// Rang-korrelation (Spearman) mellem to talsæt. Bruges til DEN egentlige
// doktrin-test: belønner formlen styrke? Et fald i kroner for en enkelt rytter
// kan skyldes at hans NUVÆRENDE værdi er forkert; men hvis værdien systematisk
// følger spillets egen rating, straffer formlen ikke styrke.
function spearman(pairs) {
  const rows = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (rows.length < 3) return null;
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(vals.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(rows.map((p) => p[0]));
  const rb = rank(rows.map((p) => p[1]));
  const n = rows.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

// ── Prøve 1: styrke-prøven ───────────────────────────────────────────────────
// Bruger spillets EGEN rating (ratingFromAbilities → weights/displayRecipes.js,
// det tal spilleren ser på rytterkortet), ikke et selvopfundet styrke-mål.
function strengthTest(rows, key) {
  const strong = rows.filter((x) => x.strongTop20 && x.stored > 0 && x[key] != null);
  const talent = rows.filter((x) => x.talentTop20 && x.stored > 0 && x[key] != null);
  const count = (arr, t) => arr.filter((x) => x[key] / x.stored <= t).length;
  return {
    strong_n: strong.length,
    strong_fall_25: count(strong, 0.75),
    strong_fall_50: count(strong, 0.5),
    talent_n: talent.length,
    talent_fall_25: count(talent, 0.75),
    talent_fall_50: count(talent, 0.5),
    strong_fall_50_list: strong.filter((x) => x[key] / x.stored <= 0.5)
      .sort((a, b) => a[key] / a.stored - b[key] / b.stored).slice(0, 25),
    talent_fall_50_list: talent.filter((x) => x[key] / x.stored <= 0.5)
      .sort((a, b) => a[key] / a.stored - b[key] / b.stored).slice(0, 25),
  };
}

async function main() {
  console.log("=== #5443 · sammenligning af værdi-kandidater (READ-ONLY) ===");
  const ctx = await load();
  console.log(`Database: ${projectRef} · sæson ${ctx.seasonNumber} · modeller: ${ctx.models.map((m) => m.name).join(", ")} · TYPE_DAMPENING_ENABLED=${TYPE_DAMPENING_ENABLED}`);

  const active = ctx.riders.filter((r) => !r.is_retired && ctx.abilityByRider.has(r.id));
  console.log(`Aktive ryttere med evner: ${active.length}`);

  // ── Byg rækker: værdi i dag + pr. kandidat + C3 ────────────────────────────
  const rows = [];
  for (const r of active) {
    const ab = ctx.abilityByRider.get(r.id);
    const stored = r.base_value == null ? null : Number(r.base_value);
    // Spillets egen rating for rytterens faktiske type.
    const rating = ratingFromAbilities(ab, r.primary_type);
    const row = {
      id: r.id,
      name: `${r.firstname} ${r.lastname}`.trim(),
      team: teamLabel(ctx, r),
      team_id: r.team_id,
      human_team: isHumanTeam(ctx, r),
      age: r.age,
      potentiale: r.potentiale == null ? null : Number(r.potentiale),
      rating,
      primary_type: r.primary_type,
      frozen_valuation_type: r.valuation_type,
      stored,
    };
    for (const m of ctx.models) {
      const { model, valuationType } = resolveFor(m, r);
      const res = recompute(ctx, r, model, valuationType);
      row[m.name] = res?.base_value ?? null;
      row[`${m.name}_role`] = valuationType;
    }
    // C3: værditypen er den type rytterens NUVÆRENDE evner peger på (samme
    // klassifikator, samme baseline-valg — kun kilden er skiftet fra caps til
    // dagens evner). archetype_draw springes bevidst over her: pointen er at
    // måle afstanden mellem "hvad han er anlagt til" og "hvad han er i dag".
    const typeModel = selectTypesBaseline(r.age, ctx.baseline, ctx.youthBaseline);
    const nowType = computeRiderTypes(ab, typeModel)?.primary?.key ?? r.primary_type;
    row.now_type = nowType;
    for (const m of ctx.models) {
      const res = recompute(ctx, r, m.model, nowType);
      row[`${m.name}_C3`] = res?.base_value ?? null;
    }
    rows.push(row);
  }

  // Styrke-kohorter: top 20 % efter spillets egen rating, og top 20 % potentiale
  // blandt ryttere ≤23 år.
  const ratings = rows.map((x) => x.rating).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const ratingCut = quantile(ratings, 0.8);
  const young = rows.filter((x) => x.age != null && x.age <= 23 && x.potentiale != null);
  const pots = young.map((x) => x.potentiale).sort((a, b) => a - b);
  const potCut = quantile(pots, 0.8);
  for (const x of rows) {
    x.strongTop20 = Number.isFinite(x.rating) && x.rating >= ratingCut;
    x.talentTop20 = x.age != null && x.age <= 23 && x.potentiale != null && x.potentiale >= potCut;
  }
  console.log(`Styrke-grænse (spillets rating, p80): ${ratingCut} · talent-grænse (potentiale p80 blandt ≤23 år): ${potCut}`);

  const humanRows = rows.filter((x) => x.human_team);

  // ── Prøve 2: stå-stille-prøven ────────────────────────────────────────────
  console.log("→ stå-stille-prøven (evne-historik)…");
  const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const hist = await fetchAllRows(() => sb.from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, abilities").gte("snapshot_date", since).order("rider_id"));
  const histByRider = new Map();
  for (const h of hist) {
    if (!histByRider.has(h.rider_id)) histByRider.set(h.rider_id, []);
    histByRider.get(h.rider_id).push(h);
  }
  const riderById = new Map(active.map((r) => [r.id, r]));
  const standstill = { window_days: HISTORY_DAYS, since, improved: 0, byModel: {}, byType: {} };
  const modelNames = ["i dag", ...ctx.models.map((m) => m.name)];
  for (const name of modelNames) standstill.byModel[name] = { moved: 0, still: 0 };

  for (const [riderId, list] of histByRider) {
    const r = riderById.get(riderId);
    if (!r) continue;
    const ab = ctx.abilityByRider.get(riderId);
    if (!ab) continue;
    const sorted = list.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    if (sorted.length < 2) continue;
    const firstAb = sorted[0].abilities || {};
    // Steg rytteren overhovedet? (summen af positive evne-ændringer > 0)
    let gain = 0;
    for (const k of ABILITY_KEYS) gain += Math.max(0, n0(ab[k]) - n0(firstAb[k]));
    if (gain <= 0) continue;
    standstill.improved++;
    // Evne-rækken "før" = historikkens første snapshot, udfyldt med dagens
    // værdier for de nøgler historikken ikke bærer (så kun det der faktisk
    // ændrede sig, ændrer sig).
    const beforeAb = { ...ab };
    for (const k of Object.keys(firstAb)) if (k in beforeAb) beforeAb[k] = firstAb[k];

    const t = r.primary_type ?? "(ukendt)";
    standstill.byType[t] ??= { improved: 0, byModel: Object.fromEntries(modelNames.map((n) => [n, 0])) };
    standstill.byType[t].improved++;

    // "i dag" = live-modellen med den FROSNE type (præcis som prod regner nu).
    const pairs = [["i dag", ctx.live, r.valuation_type],
      ...ctx.models.map((m) => { const q = resolveFor(m, r); return [m.name, q.model, q.valuationType]; })];
    for (const [name, model, vt] of pairs) {
      const before = recompute(ctx, r, model, vt, beforeAb)?.base_value ?? null;
      const after = recompute(ctx, r, model, vt)?.base_value ?? null;
      const moved = before != null && after != null && before > 0 && Math.abs(after / before - 1) > 0.005;
      if (moved) { standstill.byModel[name].moved++; standstill.byType[t].byModel[name]++; }
      else standstill.byModel[name].still++;
    }
  }
  console.log(`  ${standstill.improved} ryttere udviklede sig i vinduet.`);
  for (const name of modelNames) {
    const s = standstill.byModel[name];
    console.log(`    ${name.padEnd(6)} værdien flyttede sig for ${s.moved}/${s.moved + s.still} (${((s.moved / Math.max(1, s.moved + s.still)) * 100).toFixed(1)} %)`);
  }

  // -- Prove 5: skifter vaerdi-rollen fra uge til uge? --
  // Et rolle-skift maa ikke give et vaerdihop. Maalt paa evne-historikken: hvor
  // ofte ville bedste-rolle-nu skifte, og hvor stort et spring ville et skift
  // give, hvis alt andet stod stille?
  console.log("-> prove 5: rolle-stabilitet...");
  const stability = {};
  const roleModels = ctx.models.filter((m) => m.roleRule === "best8" || m.roleRule === "best2");
  for (const m of roleModels) {
    stability[m.name] = { rule: m.roleRule, riders_checked: 0, role_changes: 0, riders_with_change: 0, max_jump_pct: 0, jumps: [], examples: [] };
  }
  for (const [riderId, list] of histByRider) {
    const r = riderById.get(riderId);
    if (!r) continue;
    const ab = ctx.abilityByRider.get(riderId);
    if (!ab) continue;
    const sorted = list.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    if (sorted.length < 2) continue;
    const snaps = [...sorted.map((x) => x.abilities || {}), ab];
    for (const m of roleModels) {
      const st = stability[m.name];
      st.riders_checked++;
      let prevRole = null;
      let changed = false;
      for (const snap of snaps) {
        const filled = { ...ab };
        for (const k of Object.keys(snap)) if (k in filled) filled[k] = snap[k];
        const role = roleForAbilities(m, r, filled);
        if (prevRole && role && role !== prevRole) {
          st.role_changes++;
          changed = true;
          // Hvad ville skiftet give, hvis evnerne ellers stod helt stille?
          const before = recompute(ctx, r, m.model, prevRole, filled)?.base_value ?? null;
          const after = recompute(ctx, r, m.model, role, filled)?.base_value ?? null;
          if (before > 0 && after > 0) {
            const jumpPct = Math.abs((after / before - 1) * 100);
            st.jumps.push(jumpPct);
            if (jumpPct > st.max_jump_pct) st.max_jump_pct = jumpPct;
            if (st.examples.length < 8) {
              st.examples.push({ name: `${r.firstname} ${r.lastname}`.trim(), from: prevRole, to: role, before, after, jump_pct: jumpPct });
            }
          }
        }
        if (role) prevRole = role;
      }
      if (changed) st.riders_with_change++;
    }
  }
  for (const m of roleModels) {
    const st = stability[m.name];
    st.jumps.sort((a, b) => a - b);
    st.median_jump_pct = quantile(st.jumps, 0.5);
    st.p90_jump_pct = quantile(st.jumps, 0.9);
    console.log(`  ${m.name} (${st.rule}): ${st.riders_with_change}/${st.riders_checked} ryttere ville skifte rolle - ${st.role_changes} skift - median hop ${st.median_jump_pct?.toFixed(1) ?? "-"} % - max ${st.max_jump_pct.toFixed(1)} %`);
  }

  // Rolle-spaend pr. kandidat: hvor meget dyrere er den dyreste rolle end den
  // billigste? Det er loftet over hvad et rolle-skift overhovedet kan flytte.
  for (const m of ctx.models) {
    const offs = Object.entries(m.model.fit.offset).filter(([k]) => !k.includes("|")).map(([, v]) => Number(v));
    m.typeSpread = Math.exp(Math.max(...offs) - Math.min(...offs));
  }

  // -- Prove 6: kan vaerdien pumpes med en smal evne? --
  // For hver rolle: hvor meget stiger vaerdien af ET traenings-point, og hvilken
  // evne giver mest? Maalt paa medianrytteren i rollen.
  console.log("-> prove 6: misbrugs-proven...");
  const abuse = {};
  const allAbilityKeys = [...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])];
  for (const m of ctx.models) {
    abuse[m.name] = {};
    for (const role of RIDER_TYPE_KEYS) {
      const cohort = active.filter((r) => r.primary_type === role && ctx.abilityByRider.has(r.id));
      if (!cohort.length) continue;
      const mid = cohort[Math.floor(cohort.length / 2)];
      const ab = ctx.abilityByRider.get(mid.id);
      const q = resolveFor(m, mid);
      const base = recompute(ctx, mid, q.model, q.valuationType)?.base_value ?? null;
      if (!base) continue;
      let bestKey = null;
      let bestGain = 0;
      for (const k of allAbilityKeys) {
        if (!Number.isFinite(Number(ab[k]))) continue;
        const bumped = { ...ab, [k]: Number(ab[k]) + 1 };
        // Under en bedste-rolle-model kan +1 ogsaa SKIFTE rollen; det skal med.
        const vt = roleForAbilities(m, mid, bumped) ?? q.valuationType;
        const v = recompute(ctx, mid, q.model, vt, bumped)?.base_value ?? null;
        if (v == null) continue;
        const gain = (v / base - 1) * 100;
        if (gain > bestGain) { bestGain = gain; bestKey = k; }
      }
      abuse[m.name][role] = { ability: bestKey, gain_pct: bestGain };
    }
  }

  // ── Saml resultater pr. kandidat ──────────────────────────────────────────
  const ratingCorrToday = spearman(humanRows.map((x) => [x.rating, x.stored]));
  const ratingCorrTodayByType = Object.fromEntries(
    [...new Set(humanRows.map((x) => x.primary_type))].filter(Boolean).map((t) => [
      t,
      spearman(humanRows.filter((x) => x.primary_type === t).map((x) => [x.rating, x.stored])),
    ])
  );
  console.log(`
Rang-korrelation rating <-> vaerdi (menneskehold) i dag: ${ratingCorrToday?.toFixed(3)}`);

  const results = [];
  for (const m of ctx.models) {
    const r = {
      name: m.name,
      path: m.path,
      weights: m.raw.weights ?? null,
      all: distribution(rows, m.name),
      human: distribution(humanRows, m.name),
      teams: teamStats(rows, m.name),
      strength: strengthTest(rows, m.name),
      // Doktrin-test: foelger vaerdien spillets egen rating? Maalt BAADE samlet og
      // inden for hver type (paa tvaers af typer blandes typernes prisniveauer ind).
      rating_corr: spearman(humanRows.map((x) => [x.rating, x[m.name]])),
      rating_corr_by_type: Object.fromEntries(
        [...new Set(humanRows.map((x) => x.primary_type))].filter(Boolean).map((t) => [
          t,
          spearman(humanRows.filter((x) => x.primary_type === t).map((x) => [x.rating, x[m.name]])),
        ])
      ),
      strengthHuman: strengthTest(humanRows, m.name),
      c3_human: distribution(humanRows, `${m.name}_C3`),
      c3_strength: strengthTest(rows, `${m.name}_C3`),
    };
    results.push(r);
    console.log(`\n${m.name}: Σ alle ${pct(r.all.sum_pct)} · Σ menneskehold ${pct(r.human.sum_pct)} · stærke der falder ≥25 %: ${r.strength.strong_fall_25}/${r.strength.strong_n} · ≥50 %: ${r.strength.strong_fall_50}`);
  }

  // C3 på unge specifikt
  const youngHuman = humanRows.filter((x) => x.age != null && x.age <= 23 && x.stored > 0);
  const c3Young = {};
  for (const m of ctx.models) {
    const base = distribution(youngHuman, m.name);
    const c3 = distribution(youngHuman, `${m.name}_C3`);
    c3Young[m.name] = { base, c3 };
  }

  const named = [];
  for (const spec of NAMED) {
    const id = typeof spec === "object" ? spec.id : null;
    const nm = typeof spec === "object" ? null : spec;
    const hit = rows.find((x) => (id ? x.id === id : norm(x.name) === norm(nm)));
    named.push(hit || { name: typeof spec === "object" ? spec.label : spec, team: "IKKE FUNDET" });
  }

  const meta = {
    ran_at: new Date().toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }),
    project_ref: projectRef,
    season_number: ctx.seasonNumber,
    rating_cut_p80: ratingCut,
    potentiale_cut_p80: potCut,
    type_dampening: TYPE_DAMPENING_ENABLED,
    models: ctx.models.map((m) => ({ name: m.name, path: m.path, weights_ref: m.raw.weights_ref ?? null })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const typeSpreads = Object.fromEntries(ctx.models.map((m) => [m.name, m.typeSpread]));
  const json = { meta, results, standstill, c3Young, named, ratingCorrToday, ratingCorrTodayByType, stability, abuse, typeSpreads, rows };
  writeFileSync(join(OUT_DIR, "sammenligning.json"), JSON.stringify(json, null, 2), "utf8");
  writeFileSync(join(OUT_DIR, "RAPPORT.md"), buildReport(ctx, { meta, results, standstill, c3Young, named, modelNames, ratingCorrToday, ratingCorrTodayByType, stability, abuse, typeSpreads }), "utf8");
  console.log(`\n✅ Skrevet: ${join(OUT_DIR, "RAPPORT.md")}`);
  console.log("\nINTET er skrevet til databasen.");
}

function weightRow(name, table) {
  if (!table) return `| ${name} | (den live tabel) | — |`;
  return Object.entries(table).map(([t, w]) =>
    `| ${t} | ${Object.entries(w).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")} | ${((weightConcentration(w) ?? 0) * 100).toFixed(0)} % |`).join("\n");
}

function buildReport(ctx, { meta, results, standstill, c3Young, named, modelNames, ratingCorrToday, ratingCorrTodayByType, stability, abuse, typeSpreads }) {
  const cols = results.map((r) => r.name);
  const head = () => `| Prøve | ${cols.join(" | ")} |\n|---|${cols.map(() => "--:").join("|")}|`;

  const test1 = [
    head(),
    `| Stærke (top 20 % på spillets rating, n=${results[0].strength.strong_n}) falder ≥25 % | ${results.map((r) => r.strength.strong_fall_25).join(" | ")} |`,
    `| — heraf ≥50 % | ${results.map((r) => r.strength.strong_fall_50).join(" | ")} |`,
    `| Talenter (≤23 år, top 20 % potentiale, n=${results[0].strength.talent_n}) falder ≥25 % | ${results.map((r) => r.strength.talent_fall_25).join(" | ")} |`,
    `| — heraf ≥50 % | ${results.map((r) => r.strength.talent_fall_50).join(" | ")} |`,
  ].join("\n");

  const ss = (name) => {
    const s = standstill.byModel[name];
    const tot = s.moved + s.still;
    return `${s.moved}/${tot} (${((s.moved / Math.max(1, tot)) * 100).toFixed(1)} %)`;
  };
  const test2 = [
    `| Model | Værdien flyttede sig (>0,5 %) for ryttere der udviklede sig |`,
    `|---|--:|`,
    ...modelNames.map((n) => `| ${n} | ${ss(n)} |`),
  ].join("\n");

  const test2ByType = [
    `| Type | udviklede sig | ${modelNames.join(" | ")} |`,
    `|---|--:|${modelNames.map(() => "--:").join("|")}|`,
    ...Object.entries(standstill.byType).sort((a, b) => b[1].improved - a[1].improved).map(([t, v]) =>
      `| ${t} | ${v.improved} | ${modelNames.map((n) => `${v.byModel[n]} (${((v.byModel[n] / Math.max(1, v.improved)) * 100).toFixed(0)} %)`).join(" | ")} |`),
  ].join("\n");

  const test3 = [
    head(),
    `| Σ hele populationen | ${results.map((r) => pct(r.all.sum_pct)).join(" | ")} |`,
    `| Σ menneskehold | ${results.map((r) => pct(r.human.sum_pct)).join(" | ")} |`,
    `| Median-ændring (menneskehold) | ${results.map((r) => pct(r.human.median_pct)).join(" | ")} |`,
    `| p10 / p90 (menneskehold) | ${results.map((r) => `${pct(r.human.p10_pct)} / ${pct(r.human.p90_pct)}`).join(" | ")} |`,
  ].join("\n");

  const test4 = [
    head(),
    `| Stiger | ${results.map((r) => fmt(r.human.up)).join(" | ")} |`,
    `| Falder | ${results.map((r) => fmt(r.human.down)).join(" | ")} |`,
    `| Uændret (±1 %) | ${results.map((r) => fmt(r.human.flat)).join(" | ")} |`,
    `| Mister ≥25 % | ${results.map((r) => fmt(r.human.lose_25)).join(" | ")} |`,
    `| Mister ≥50 % | ${results.map((r) => fmt(r.human.lose_50)).join(" | ")} |`,
    `| Mere end fordobles | ${results.map((r) => fmt(r.human.more_than_double)).join(" | ")} |`,
    `| Hold der taber ≥10 % | ${results.map((r) => fmt(r.teams.losing_10)).join(" | ")} |`,
    `| Hold der taber ≥25 % | ${results.map((r) => fmt(r.teams.losing_25)).join(" | ")} |`,
    `| Hold der vinder ≥10 % | ${results.map((r) => fmt(r.teams.gaining_10)).join(" | ")} |`,
  ].join("\n");

  const namedTable = [
    `| Rytter | Alder | rating | frossen type | ny type | i dag | ${cols.join(" | ")} |`,
    `|---|--:|--:|---|---|--:|${cols.map(() => "--:").join("|")}|`,
    ...named.map((x) => x.team === "IKKE FUNDET"
      ? `| ${x.name} | — | — | — | — | — | ${cols.map(() => "—").join(" | ")} |`
      : `| ${x.name} | ${x.age ?? "—"} | ${x.rating ?? "—"} | ${x.frozen_valuation_type ?? "—"} | ${x.primary_type ?? "—"} | ${fmt(x.stored)} | ${cols.map((c) => `${fmt(x[c])} (${pct(x.stored ? (x[c] / x.stored - 1) * 100 : null)})`).join(" | ")} |`),
  ].join("\n");

  const c3Table = [
    `| Kandidat | ≤23 år, Σ med caps-type | Σ med nuværende-evne-type (C3) | Mister ≥50 %: caps → C3 |`,
    `|---|--:|--:|--:|`,
    ...results.map((r) => {
      const y = c3Young[r.name];
      return `| ${r.name} | ${pct(y.base.sum_pct)} | ${pct(y.c3.sum_pct)} | ${y.base.lose_50} → ${y.c3.lose_50} |`;
    }),
  ].join("\n");

  const fallLists = results.map((r) => {
    const list = r.strength.strong_fall_50_list;
    if (!list.length) return `**${r.name}:** ingen af de stærkeste ryttere falder ≥50 %.`;
    return `**${r.name}:** ${list.length} af de stærkeste falder ≥50 %.\n\n| Rytter | Hold | Alder | rating | frossen type | ny type | i dag | ${r.name} |\n|---|---|--:|--:|---|---|--:|--:|\n${list.map((x) => `| ${x.name} | ${x.team} | ${x.age ?? "—"} | ${x.rating ?? "—"} | ${x.frozen_valuation_type ?? "—"} | ${x.primary_type ?? "—"} | ${fmt(x.stored)} | ${fmt(x[r.name])} (${pct((x[r.name] / x.stored - 1) * 100)}) |`).join("\n")}`;
  }).join("\n\n");

  return `# #5443 trin 1 · De fire prøver — kandidat B, C1 og C2

**Kørt:** ${meta.ran_at} (Europe/Copenhagen) · **Database:** ${meta.project_ref} · **Sæson:** ${meta.season_number}
**Type-dæmpning:** TYPE_DAMPENING_ENABLED=${meta.type_dampening} — alle modeller routes gennem \`applyTypeDampening()\`, som produktionen gør.
**Metode:** \`recomputeRiderValue()\` fra \`backend/lib/riderValueRefresh.js\`. **Intet skrevet til databasen.**

Kandidater:

${results.map((r) => `- **${r.name}** — \`${r.path}\`${r.weights ? " (egen vægttabel)" : " (den live vægttabel)"}`).join("\n")}

Alle tre har SAMME kurve som den live model (kun type-offsets er fittet om) og samme niveau-kalibrering. Forskellen mellem dem er udelukkende **hvilke evner der tæller for hver type**.

---

## Prøve 1 — styrke-prøven

Styrke måles med spillets EGEN rating (\`ratingFromAbilities\` → \`weights/displayRecipes.js\` — det tal spilleren ser på rytterkortet). Grænse: rating ≥ ${meta.rating_cut_p80} (p80). Talent: ≤23 år og potentiale ≥ ${meta.potentiale_cut_p80} (p80 i den aldersgruppe).

${test1}

${fallLists}

### Doktrin-testen bag tallene: foelger vaerdien styrken?

Et fald i kroner for en enkelt rytter kan skyldes at hans NUVAERENDE vaerdi er
forkert - ikke at formlen straffer styrke. Den direkte test er om vaerdien
foelger spillets egen rating. Rang-korrelation (1,00 = perfekt rangorden):

| | i dag | ${results.map((r) => r.name).join(" | ")} |
|---|--:|${results.map(() => "--:").join("|")}|
| Alle ryttere paa menneskehold | ${ratingCorrToday?.toFixed(3) ?? "—"} | ${results.map((r) => r.rating_corr?.toFixed(3) ?? "—").join(" | ")} |
${Object.keys(ratingCorrTodayByType).sort().map((t) => `| inden for ${t} | ${ratingCorrTodayByType[t]?.toFixed(3) ?? "—"} | ${results.map((r) => r.rating_corr_by_type[t]?.toFixed(3) ?? "—").join(" | ")} |`).join("\n")}

---

## Prøve 2 — stå-stille-prøven

${standstill.improved} ryttere fik mindst én evne op i de sidste ${standstill.window_days} dage (fra ${standstill.since}). For hvor mange ville værdien også flytte sig mere end 0,5 %?

${test2}

Pr. type:

${test2ByType}

---

## Prøve 3 — pengemængden

${test3}

## Prøve 4 — fordelingen (menneskehold)

${test4}

---

## Prove 5 - skifter vaerdi-rollen fra uge til uge?

Maalt paa evne-historikken, med hver kandidats EGEN rolle-regel anvendt paa de aendrede evner. Et rolle-skift maa ikke i sig selv give et vaerdihop.

| Kandidat | regel | ryttere der ville skifte | skift i alt | median hop | p90 | maks |
|---|---|--:|--:|--:|--:|--:|
${Object.entries(stability).map(([n, st]) => `| ${n} | ${st.rule} | ${st.riders_with_change}/${st.riders_checked} | ${st.role_changes} | ${st.median_jump_pct?.toFixed(1) ?? "\u2014"} % | ${st.p90_jump_pct?.toFixed(1) ?? "\u2014"} % | **${st.max_jump_pct.toFixed(1)} %** |`).join("\n")}

Kandidater uden en evne-afhaengig rolle (fast naturlig rolle eller fast blanding) kan pr. konstruktion ikke skifte rolle og staar derfor ikke i tabellen.

Spaend fra billigste til dyreste rolle - loftet over hvad et rolle-skift kan flytte:

| Kandidat | ${Object.keys(typeSpreads).join(" | ")} |
|---|${Object.keys(typeSpreads).map(() => "--:").join("|")}|
| Rolle-spaend | ${Object.values(typeSpreads).map((v) => `×${v?.toFixed(2) ?? "—"}`).join(" | ")} |

${Object.entries(stability).filter(([, st]) => st.examples.length).map(([n, st]) => `**${n}:**\n\n| Rytter | fra | til | foer | efter | hop |\n|---|---|---|--:|--:|--:|\n${st.examples.map((e) => `| ${e.name} | ${e.from} | ${e.to} | ${fmt(e.before)} | ${fmt(e.after)} | ${e.jump_pct.toFixed(1)} % |`).join("\n")}`).join("\n\n") || "_Ingen skift._"}

## Prove 6 - kan vaerdien pumpes med en smal evne?

Stoerste vaerdistigning af ET traenings-point, maalt paa medianrytteren i hver rolle:

| Rolle | ${Object.keys(abuse).join(" | ")} |
|---|${Object.keys(abuse).map(() => "---").join("|")}|
${[...new Set(Object.values(abuse).flatMap((a) => Object.keys(a)))].sort().map((role) => `| ${role} | ${Object.keys(abuse).map((n) => abuse[n][role] ? `${abuse[n][role].ability} ${abuse[n][role].gain_pct.toFixed(2)} %` : "—").join(" | ")} |`).join("\n")}

---

## C3 — hvad nu hvis værditypen fulgte rytterens NUVÆRENDE evner?

Typen klassificeres i dag på \`ability_caps\` (potentiale), mens værdien beregnes på dagens evner. For en 18-årig er de to langt fra hinanden. C3 måler det samme som kandidaten, men med værditypen sat til den type rytterens nuværende evner peger på (samme klassifikator, samme baseline-valg).

${c3Table}

---

## Vægttabellerne

**Live (i dag):**

| Type | vægte | andel på tungeste |
|---|---|--:|
${weightRow("live", LIVE_TABLE)}

${results.filter((r) => r.weights).map((r) => `**${r.name}:**\n\n| Type | vægte | andel på tungeste |\n|---|---|--:|\n${weightRow(r.name, r.weights)}`).join("\n\n")}

---

## Navngivne ryttere

${namedTable}

---

_Genereret af \`backend/scripts/dev/v4RefitCompare5443.mjs\` — read-only, intet skrevet._
`;
}

main().catch((err) => {
  console.error("❌", err.message);
  console.error(err.stack);
  process.exit(1);
});
