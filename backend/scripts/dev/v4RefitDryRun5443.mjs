// #5443 / #3353 · READ-ONLY tørkørsel: hvad sker der med hver enkelt rytters
// værdi, hvis værdiformlen regnes om til den ryttertype-inddeling spillet bruger
// i dag, og frysningen (#3345) fjernes?
//
// Forholdet til #5416's tørkørsel (20/9): DEN målte kun "ret typen, behold
// formlen" — og gav 557 op / 273 ned blandt de 849 tt-frosne, med fald op til
// 94 %. Faldene kunne ikke bruges, fordi formlens type-offsets var fittet mod en
// typefordeling der ikke findes mere (puncheur havde 19 observationer, i dag ~850).
// Dette script måler i stedet den OMREGNEDE formel, og viser alle tre trin side
// om side for hver rytter:
//
//   i dag        = den gemte riders.base_value (det spillerne ser lige nu)
//   kun-type     = live-modellen, men med værditype = rytterens faktiske type
//   kandidat     = den omregnede model, med værditype = rytterens faktiske type
//
// Scriptet SKRIVER ALDRIG. Det genbruger den ægte beregningssti
// (recomputeRiderValue fra backend/lib/riderValueRefresh.js — samme funktion
// søndagssweepen bruger) og router hver model gennem applyTypeDampening(),
// præcis som produktionen gør.
//
// Kør fra backend/ (100 % read-only, ingen flag der skriver):
//   infisical run --env=prod --silent -- node scripts/dev/v4RefitDryRun5443.mjs
//
// Valgfrit:
//   --model=<sti>   kandidat-model (default lib/riderValuationModelV4.candidate-5443.json)
//   --out=<mappe>   output-mappe (default balance-internals/2026-09-20-5443-v4-refit)
//
// Output: markdown-rapport + rå JSON i den gitignorede balance-internals-mappe
// (hard rule 17 — balance-tal må aldrig ligge i det offentlige repo).

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening, TYPE_DAMPENING_ENABLED } from "../../lib/riderValuationTypeDampening.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { VALUATION_WEIGHTS } from "../../lib/weights/valuationWeights.js";
import { riderOverall } from "../../lib/riderValuation.js";
import { SALARY_RATE_PRODUCTION } from "../../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};
const CANDIDATE_PATH = resolve(arg("model", join(LIB, "riderValuationModelV4.candidate-5443.json")));
const OUT_DIR = resolve(arg("out", join(__dirname, "../../../balance-internals/2026-09-20-5443-v4-refit")));

// Ryttere ejeren og spillerne allerede har set tal for (#5416-tørkørslen + Discord).
const NAMED = [
  { id: "34727ffe-1492-43c2-ad65-6f4f10acf06a", label: "Wessel K. Mertens (knud_r_flink)" },
  { name: "ryan cooper" },
  { name: "jasper verhoeven" },
  { name: "daniel carmona" },
  { name: "jihoon bae" },
  { name: "yuto suzuki" },
  { name: "mason marsh" },
  { name: "tijl coppens" },
  { name: "toby murphy" },
  { name: "romain dumas" },
];

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i miljøet.");
  console.error("   Kør via: infisical run --env=prod --silent -- node scripts/dev/v4RefitDryRun5443.mjs");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

const n0 = (x) => Number(x) || 0;
const fmt = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : Math.round(Number(x)).toLocaleString("da-DK"));
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Positivt vægtede evner pr. værditype (weights/valuationWeights.js). Det er DEM
// der bestemmer rytterens output-score — negative vægte springes over af
// outputScore, så de er i praksis uden effekt.
const POSITIVE_WEIGHTS = Object.fromEntries(
  VALUATION_WEIGHTS.map((t) => [t.key, Object.fromEntries(Object.entries(t.weights).filter(([, w]) => w > 0))])
);

function abilitySummary(ab) {
  return ABILITY_KEYS
    .map((k) => [k, Number(ab?.[k])])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
}

function typeAbilityText(type, ab) {
  const w = POSITIVE_WEIGHTS[type];
  if (!w) return "—";
  return Object.entries(w)
    .sort((a, b) => b[1] - a[1])
    .map(([k, weight]) => `${k} ${Math.round(n0(ab?.[k]))} (vægt ${weight})`)
    .join(", ");
}

async function load() {
  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  const liveRaw = JSON.parse(readFileSync(join(LIB, "riderValuationModelV4.json"), "utf8"));
  const candRaw = JSON.parse(readFileSync(CANDIDATE_PATH, "utf8"));
  // Produktionen router HVER model-indlæsning gennem applyTypeDampening (se
  // riderValueRefresh.js) — tørkørslen gør præcis det samme for begge modeller.
  const liveModel = applyTypeDampening(liveRaw);
  const candModel = applyTypeDampening(candRaw);

  const { data: season, error: seasonErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`season lookup: ${seasonErr.message}`);
  let seasonNumber = season?.number ?? null;
  if (!seasonNumber) {
    const { data: lastDone } = await sb.from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = lastDone?.number ?? 1;
  }

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, is_academy, primary_type, secondary_type, valuation_type, base_value, current_production_value, birthdate, potentiale, archetype_draw")
    .order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);

  const teams = await fetchAllRows(() => sb.from("teams")
    .select("id, name, is_ai, is_bank, is_test_account, is_frozen").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const ids = new Set(riders.map((r) => r.id));
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${ABILITY_KEYS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a]));
  const capsByRider = new Map(abilities.filter((a) => ids.has(a.rider_id)).map((a) => [a.rider_id, a.ability_caps]));

  const { data: sundayLog } = await sb.from("rider_value_sunday_log")
    .select("run_date, started_at, scanned, changed, written, market_sweep_ran")
    .order("run_date", { ascending: false }).limit(1).maybeSingle();

  return {
    riders, teamById, abilityByRider, capsByRider, baseline, youthBaseline,
    liveModel, candModel, liveRaw, candRaw, seasonNumber, sundayLog,
  };
}

// Genberegning via DEN ÆGTE sti. valuationType === undefined ⇒ brug rytterens
// nuværende (frosne) valuation_type.
function recompute(ctx, r, model, valuationType) {
  const ab = ctx.abilityByRider.get(r.id);
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

// ── Kontrol: rammer live-modellen + den frosne type de gemte værdier? ─────────
function sanityCheck(ctx, rows) {
  const res = { checked: 0, match: 0, mismatch: 0, mismatch_higher: 0, mismatch_lower: 0, worst_pct: 0 };
  for (const x of rows) {
    if (x.stored == null || x.live_frozen == null) continue;
    res.checked++;
    if (x.live_frozen === x.stored) { res.match++; continue; }
    res.mismatch++;
    if (x.live_frozen > x.stored) res.mismatch_higher++; else res.mismatch_lower++;
    const p = Math.abs((x.live_frozen / x.stored - 1) * 100);
    if (p > res.worst_pct) res.worst_pct = p;
  }
  return res;
}

// ── Fordelings-statistik for et sæt rækker ───────────────────────────────────
function distribution(rows, beforeKey, afterKey) {
  const vals = rows.filter((x) => x[beforeKey] != null && x[afterKey] != null);
  const pcts = vals.map((x) => (x[beforeKey] > 0 ? (x[afterKey] / x[beforeKey] - 1) * 100 : null))
    .filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const sumBefore = vals.reduce((s, x) => s + n0(x[beforeKey]), 0);
  const sumAfter = vals.reduce((s, x) => s + n0(x[afterKey]), 0);
  const up = vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] - 1 > 0.01).length;
  const down = vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] - 1 < -0.01).length;
  return {
    n: vals.length,
    sum_before: sumBefore,
    sum_after: sumAfter,
    sum_diff: sumAfter - sumBefore,
    sum_pct: sumBefore ? (sumAfter / sumBefore - 1) * 100 : null,
    up, down, flat: vals.length - up - down,
    median_pct: quantile(pcts, 0.5),
    p10_pct: quantile(pcts, 0.1),
    p90_pct: quantile(pcts, 0.9),
    lose_25: vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] <= 0.75).length,
    lose_50: vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] <= 0.5).length,
    lose_90: vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] <= 0.1).length,
    more_than_double: vals.filter((x) => x[beforeKey] > 0 && x[afterKey] / x[beforeKey] > 2).length,
    median_before: quantile(vals.map((x) => x[beforeKey]).sort((a, b) => a - b), 0.5),
    median_after: quantile(vals.map((x) => x[afterKey]).sort((a, b) => a - b), 0.5),
    p10_before: quantile(vals.map((x) => x[beforeKey]).sort((a, b) => a - b), 0.1),
    p10_after: quantile(vals.map((x) => x[afterKey]).sort((a, b) => a - b), 0.1),
    p90_before: quantile(vals.map((x) => x[beforeKey]).sort((a, b) => a - b), 0.9),
    p90_after: quantile(vals.map((x) => x[afterKey]).sort((a, b) => a - b), 0.9),
  };
}

function groupBy(rows, keyFn, beforeKey, afterKey) {
  const groups = new Map();
  for (const x of rows) {
    const k = keyFn(x) ?? "(ukendt)";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  return [...groups.entries()]
    .map(([k, arr]) => ({ key: k, ...distribution(arr, beforeKey, afterKey) }))
    .sort((a, b) => b.n - a.n);
}

const ageBucket = (age) => {
  if (age == null) return "(ukendt)";
  if (age <= 20) return "≤20";
  if (age <= 23) return "21-23";
  if (age <= 26) return "24-26";
  if (age <= 29) return "27-29";
  if (age <= 32) return "30-32";
  return "33+";
};

// ── Indfasning (#5443 punkt 7) ───────────────────────────────────────────────
// Variant A: alt på én søndag. Variant B: et FALD må højst være X % pr. søndag,
// stigninger slår fuldt igennem med det samme. Antal uger for en rytter med
// samlet forhold r = efter/før < 1 er ceil(ln(r) / ln(1−X)).
function phaseIn(rows, beforeKey, afterKey, steps = [0.10, 0.15, 0.25]) {
  const falls = rows
    .filter((x) => x[beforeKey] > 0 && x[afterKey] != null && x[afterKey] / x[beforeKey] < 0.99)
    .map((x) => x[afterKey] / x[beforeKey]);
  const rises = rows.filter((x) => x[beforeKey] > 0 && x[afterKey] != null && x[afterKey] / x[beforeKey] > 1.01).length;
  const out = { n_rows: rows.length, n_falls: falls.length, n_rises: rises, variants: [] };
  for (const X of steps) {
    const weeks = falls.map((r) => Math.max(1, Math.ceil(Math.log(r) / Math.log(1 - X))));
    const maxWeeks = weeks.length ? Math.max(...weeks) : 0;
    const buckets = {};
    for (const w of weeks) buckets[w] = (buckets[w] || 0) + 1;
    out.variants.push({
      step_pct: X * 100,
      weeks_to_complete: maxWeeks,
      riders_affected_week1: falls.length,
      // Hvor mange er færdige efter 1, 2, 4 og 8 uger?
      done_after_1: weeks.filter((w) => w <= 1).length,
      done_after_2: weeks.filter((w) => w <= 2).length,
      done_after_4: weeks.filter((w) => w <= 4).length,
      done_after_8: weeks.filter((w) => w <= 8).length,
      median_weeks: weeks.length ? quantile([...weeks].sort((a, b) => a - b), 0.5) : null,
      weeks_histogram: buckets,
    });
  }
  return out;
}

// ── tt-analysen (#5443 punkt 6) ──────────────────────────────────────────────
// `tt` er den eneste værditype med KUN ÉN positivt vægtet evne (time_trial).
// Spørgsmålet: rammer det også ÆGTE enkeltstartsryttere (primary_type='tt')?
// Måles på rider_derived_ability_history: hvor mange tt-ryttere har over de
// sidste 14 dage haft fremgang i andre evner, MENS time_trial stod stille?
async function ttStandstill(ctx) {
  const ttRiders = ctx.riders.filter((r) => !r.is_retired && r.primary_type === "tt" && r.valuation_type === "tt");
  const ttIds = new Set(ttRiders.map((r) => r.id));
  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const hist = await fetchAllRows(() => sb.from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, abilities")
    .gte("snapshot_date", since)
    .order("rider_id"));
  const byRider = new Map();
  for (const h of hist) {
    if (!ttIds.has(h.rider_id)) continue;
    if (!byRider.has(h.rider_id)) byRider.set(h.rider_id, []);
    byRider.get(h.rider_id).push(h);
  }
  const res = {
    window_days: 14, since,
    tt_riders_total: ttRiders.length,
    with_history: 0,
    tt_up: 0,
    tt_flat_others_up: 0,
    tt_flat_others_flat: 0,
    tt_down: 0,
    examples: [],
    other_ability_gain_when_tt_flat: [],
  };
  for (const r of ttRiders) {
    const rows = (byRider.get(r.id) || []).sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    if (rows.length < 2) continue;
    res.with_history++;
    const first = rows[0].abilities || {};
    const last = rows[rows.length - 1].abilities || {};
    const dTT = n0(last.time_trial) - n0(first.time_trial);
    let otherGain = 0;
    for (const k of ABILITY_KEYS) {
      if (k === "time_trial") continue;
      otherGain += Math.max(0, n0(last[k]) - n0(first[k]));
    }
    if (dTT > 0) { res.tt_up++; continue; }
    if (dTT < 0) { res.tt_down++; continue; }
    if (otherGain > 0) {
      res.tt_flat_others_up++;
      res.other_ability_gain_when_tt_flat.push(otherGain);
      if (res.examples.length < 15) {
        res.examples.push({
          id: r.id,
          name: `${r.firstname} ${r.lastname}`.trim(),
          team: teamLabel(ctx, r),
          human_team: isHumanTeam(ctx, r),
          age: r.age,
          other_ability_gain: Math.round(otherGain * 100) / 100,
          time_trial: n0(last.time_trial),
          snapshots: rows.length,
        });
      }
    } else {
      res.tt_flat_others_flat++;
    }
  }
  const gains = res.other_ability_gain_when_tt_flat.sort((a, b) => a - b);
  res.other_gain_median = gains.length ? quantile(gains, 0.5) : null;
  res.other_gain_p90 = gains.length ? quantile(gains, 0.9) : null;
  delete res.other_ability_gain_when_tt_flat;
  return res;
}

function moverRow(ctx, x) {
  const ab = ctx.abilityByRider.get(x.id);
  const top = abilitySummary(ab).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ");
  return {
    ...x,
    overall: riderOverall(ab),
    top_abilities: top,
    frozen_type_abilities: typeAbilityText(x.frozen_valuation_type, ab),
    new_type_abilities: typeAbilityText(x.primary_type, ab),
  };
}

// ── Rapport ──────────────────────────────────────────────────────────────────
function distTable(title, d) {
  return `**${title}**

| Nøgletal | Værdi |
|---|---|
| Ryttere | ${fmt(d.n)} |
| Σ i dag | ${fmt(d.sum_before)} CZ$ |
| Σ med kandidat-model | ${fmt(d.sum_after)} CZ$ |
| Ændring | ${fmt(d.sum_diff)} CZ$ (${pct(d.sum_pct)}) |
| Stiger (>+1 %) | ${fmt(d.up)} |
| Falder (<−1 %) | ${fmt(d.down)} |
| Uændret (±1 %) | ${fmt(d.flat)} |
| Median %-ændring | ${pct(d.median_pct)} |
| p10 / p90 %-ændring | ${pct(d.p10_pct)} / ${pct(d.p90_pct)} |
| Median værdi i dag → kandidat | ${fmt(d.median_before)} → ${fmt(d.median_after)} |
| p10 værdi i dag → kandidat | ${fmt(d.p10_before)} → ${fmt(d.p10_after)} |
| p90 værdi i dag → kandidat | ${fmt(d.p90_before)} → ${fmt(d.p90_after)} |
| Mister ≥25 % | ${fmt(d.lose_25)} |
| Mister ≥50 % | ${fmt(d.lose_50)} |
| Mister ≥90 % | ${fmt(d.lose_90)} |
| Mere end fordobles | ${fmt(d.more_than_double)} |
`;
}

function groupTable(rows) {
  const head = "| Gruppe | n | Σ i dag | Σ kandidat | Δ | op | ned | median | p10 / p90 | ≥25 % ned | ≥50 % ned |\n|---|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|";
  const body = rows.map((g) =>
    `| ${g.key} | ${fmt(g.n)} | ${fmt(g.sum_before)} | ${fmt(g.sum_after)} | ${pct(g.sum_pct)} | ${fmt(g.up)} | ${fmt(g.down)} | ${pct(g.median_pct)} | ${pct(g.p10_pct)} / ${pct(g.p90_pct)} | ${fmt(g.lose_25)} | ${fmt(g.lose_50)} |`
  ).join("\n");
  return `${head}\n${body}`;
}

function moverTable(rows) {
  const head = "| Rytter | Hold | Alder | overall | frossen type | ny type | i dag | kun-type | kandidat | Δ vs i dag |\n|---|---|--:|--:|---|---|--:|--:|--:|--:|";
  const body = rows.map((x) =>
    `| ${x.name} | ${x.team} | ${x.age ?? "—"} | ${x.overall} | ${x.frozen_valuation_type ?? "—"} | ${x.primary_type ?? "—"} | ${fmt(x.stored)} | ${fmt(x.type_only)} | ${fmt(x.candidate)} | ${fmt(x.diff)} (${pct(x.diff_pct)}) |`
  ).join("\n");
  return `${head}\n${body}`;
}

function moverDetail(rows) {
  return rows.map((x, i) => `${i + 1}. **${x.name}** (${x.team}, ${x.age ?? "?"} år, overall ${x.overall}, potentiale ${x.potentiale ?? "?"})
   - Værdisat i dag som **${x.frozen_valuation_type ?? "—"}**, er reelt **${x.primary_type ?? "—"}** (sekundær: ${x.secondary_type ?? "—"})
   - Bedste evner: ${x.top_abilities}
   - Evner der TÆLLER i den frosne type (${x.frozen_valuation_type ?? "—"}): ${x.frozen_type_abilities}
   - Evner der TÆLLER i den rigtige type (${x.primary_type ?? "—"}): ${x.new_type_abilities}
   - i dag ${fmt(x.stored)} → kun-type ${fmt(x.type_only)} → kandidat ${fmt(x.candidate)} = ${fmt(x.diff)} (${pct(x.diff_pct)})`).join("\n\n");
}

function phaseInTable(p) {
  const head = "| Maks fald pr. søndag | Uger til alle er i mål | Berørte uge 1 | Færdige efter 1 uge | efter 2 | efter 4 | efter 8 | median uger |\n|--:|--:|--:|--:|--:|--:|--:|--:|";
  const body = p.variants.map((v) =>
    `| ${v.step_pct} % | ${v.weeks_to_complete} | ${fmt(v.riders_affected_week1)} | ${fmt(v.done_after_1)} | ${fmt(v.done_after_2)} | ${fmt(v.done_after_4)} | ${fmt(v.done_after_8)} | ${v.median_weeks} |`
  ).join("\n");
  return `${head}\n${body}`;
}

// Koncentrations-tabel: hvor stor en andel af typens samlede POSITIVE vægt ligger
// på den tungeste evne. Ren aflæsning af valuationWeights.js — ingen fortolkning.
function weightConcentrationTable() {
  const lines = ["| Værditype | antal evner der tæller | andel på den tungeste | vægte |", "|---|--:|--:|---|"];
  const rows = Object.entries(POSITIVE_WEIGHTS).map(([k, w]) => {
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    const max = Math.max(...Object.values(w));
    return { k, n: Object.keys(w).length, share: max / total, w };
  }).sort((a, b) => b.share - a.share);
  for (const r of rows) {
    lines.push(`| ${r.k} | ${r.n} | ${(r.share * 100).toFixed(0)} % | ${Object.entries(r.w).sort((a, b) => b[1] - a[1]).map(([a, x]) => `${a}:${x}`).join(" ")} |`);
  }
  return lines.join("\n");
}

function buildReport(ctx, data) {
  const { meta, sanity, all, human, byTypeHuman, byAgeHuman, byTeam, topFalls, topRises, named, phase, tt, typeOffsets } = data;
  return `# #5443 trin 1 · Tørkørsel af den OMREGNEDE værdiformel (#3353)

**Kørt:** ${meta.ran_at} (Europe/Copenhagen) · **Database:** ${meta.project_ref} · **Sæson-anker:** ${meta.season_number}
**Live model:** \`riderValuationModelV4.json\` (fittet ${meta.live_fitted_at}, sim-sæson ${meta.live_season_id}, ${meta.live_n_samples} samples)
**Kandidat:** \`${meta.candidate_path}\` (fittet ${meta.cand_fitted_at}, sim-sæson ${meta.cand_season_id}, K=${meta.cand_K}, seed ${meta.cand_seed}, ${meta.cand_n_samples} samples)
**Type-dæmpning:** TYPE_DAMPENING_ENABLED=${meta.type_dampening} — begge modeller er routet gennem \`applyTypeDampening()\`, præcis som produktionen gør.
**Metode:** \`recomputeRiderValue()\` fra \`backend/lib/riderValueRefresh.js\` — samme funktion som søndagssweepen. **Intet er skrevet til databasen.**

Tre kolonner overalt:

- **i dag** = gemt \`riders.base_value\` (det spillerne ser lige nu)
- **kun-type** = live-modellen med værditype = rytterens faktiske type (#5416's tørkørsel 20/9)
- **kandidat** = den omregnede model med værditype = rytterens faktiske type

---

## 1. Kontrol: rammer beregningsstien de gemte værdier?

Live-modellen med den FROSNE type skal reproducere \`base_value\`, fordi søndagskørslen ${meta.sunday_run} lige har skrevet dem.

| | antal |
|---|--:|
| Sammenlignet | ${fmt(sanity.checked)} |
| **Rammer præcist** | **${fmt(sanity.match)}** (${((sanity.match / Math.max(1, sanity.checked)) * 100).toFixed(2)} %) |
| Afviger | ${fmt(sanity.mismatch)} (heraf ${fmt(sanity.mismatch_higher)} højere / ${fmt(sanity.mismatch_lower)} lavere) |

Afvigelserne er daglig træning efter værdikørslen — værdier opdateres kun om søndagen (ejer-beslutning 30/8, #4419). Samme forklaring som i #5416-tørkørslen, som verificerede den mod \`training_day_runs\` og \`rider_derived_ability_history\`.

---

## 2. Formlens type-effekt: før og efter omregningen

Offset er en log-skala faktor på rytterens forventede produktion. \`n\` er antallet af observationer typen havde i den simulering formlen er fittet på.

${typeOffsets}

### 2b. Hvilke evner tæller overhovedet for hver værditype?

Rytterens output-score — det tal formlen egentlig priser — er et vægtet snit af de
POSITIVT vægtede evner for hans værditype (\`backend/lib/weights/valuationWeights.js\`;
negative vægte springes over af \`outputScore\`, så de er uden effekt). Jo mere vægten
er samlet på én evne, jo mere af rytteren er formlen blind for.

${data.weightConcentration}

### 2c. Hvor kommer bevægelsen fra: typeskiftet eller omregningen?

| Kilde | Δ på menneskehold |
|---|--:|
| Typeskiftet alene (frossen type → faktisk type, live-model) | ${fmt(data.decomposition.delta_type)} CZ$ |
| Omregningen af formlen oveni | ${fmt(data.decomposition.delta_refit)} CZ$ |
| **Samlet** | **${fmt(data.decomposition.delta_total)} CZ$** |

---

## 3. Hele den aktive population

${distTable("Alle aktive ryttere (i dag → kandidat)", all)}

${distTable("Kun ryttere på menneskehold", human)}

---

## 4. Fordelt på ryttertype (menneskehold)

${groupTable(byTypeHuman)}

## 5. Fordelt på alder (menneskehold)

${groupTable(byAgeHuman)}

---

## 6. Hold

${fmt(byTeam.total)} menneskehold · ${fmt(byTeam.losing)} taber samlet værdi · ${fmt(byTeam.gaining)} vinder · ${fmt(byTeam.flat)} uændret (±1 %).

**Top 10 vindere:**

| Hold | ryttere | Σ i dag | Σ kandidat | Δ |
|---|--:|--:|--:|--:|
${byTeam.top_winners.map((t) => `| ${t.team} | ${t.riders} | ${fmt(t.before)} | ${fmt(t.after)} | ${fmt(t.diff)} (${pct(t.pct)}) |`).join("\n")}

**Top 10 tabere:**

| Hold | ryttere | Σ i dag | Σ kandidat | Δ |
|---|--:|--:|--:|--:|
${byTeam.top_losers.map((t) => `| ${t.team} | ${t.riders} | ${fmt(t.before)} | ${fmt(t.after)} | ${fmt(t.diff)} (${pct(t.pct)}) |`).join("\n")}

---

## 7. De 10 største fald (målt i kroner, menneskehold)

${moverTable(topFalls)}

${moverDetail(topFalls)}

## 8. De 10 største stigninger (målt i kroner, menneskehold)

${moverTable(topRises)}

${moverDetail(topRises)}

---

## 9. Navngivne ryttere

${moverTable(named)}

---

## 10. Er \`tt\` også et problem for ÆGTE enkeltstartsryttere?

\`tt\` er den eneste værditype med kun ÉN positivt vægtet evne (\`time_trial\`). Målt på \`rider_derived_ability_history\` over de sidste ${tt.window_days} dage (fra ${tt.since}), kun ryttere hvor BÅDE den rigtige type og værditypen er \`tt\`:

| | antal |
|---|--:|
| Ægte tt-ryttere (primary_type = valuation_type = tt) | ${fmt(tt.tt_riders_total)} |
| heraf med mindst 2 historik-snapshots i vinduet | ${fmt(tt.with_history)} |
| enkeltstart STEG | ${fmt(tt.tt_up)} |
| enkeltstart STOD STILLE, mens andre evner steg | **${fmt(tt.tt_flat_others_up)}** |
| enkeltstart stod stille, og intet andet steg heller | ${fmt(tt.tt_flat_others_flat)} |
| enkeltstart FALDT | ${fmt(tt.tt_down)} |

Samlet evne-fremgang uden for enkeltstart, for dem der stod stille: median ${tt.other_gain_median?.toFixed(2) ?? "—"} point, p90 ${tt.other_gain_p90?.toFixed(2) ?? "—"} point.

${tt.examples.length ? `Eksempler:\n\n| Rytter | Hold | Alder | enkeltstart | fremgang i andre evner |\n|---|---|--:|--:|--:|\n${tt.examples.map((e) => `| ${e.name} | ${e.team} | ${e.age ?? "—"} | ${fmt(e.time_trial)} | ${e.other_ability_gain} |`).join("\n")}` : "_Ingen eksempler._"}

---

## 11. Indfasning

**Variant A — alt på én søndag:** ${fmt(phase.human.n_falls)} ryttere på menneskehold falder, ${fmt(phase.human.n_rises)} stiger. Hele udsvinget slår igennem på én kørsel (der er intet ugentligt loft i \`refreshChangedRiderValues\`).

**Variant B — et fald må højst være X % pr. søndag; stigninger slår fuldt igennem med det samme:**

Menneskehold:

${phaseInTable(phase.human)}

Hele populationen:

${phaseInTable(phase.all)}

---

## 12. Skitse af udrulningen (IKKE kørt)

Rækkefølgen nedenfor er en skitse til ejeren, ikke en plan der er sat i gang. Intet af det er udført.

1. **Backup FØRST.** En tabel med \`rider_id, valuation_type, base_value, current_production_value\` for hele den aktive population, så hvert skridt kan rulles 1:1 tilbage.
2. **Model-skiftet.** Kandidat-filen kopieres over \`backend/lib/riderValuationModelV4.json\` i en PR. Det er en kode-ændring, ikke en migration — den slår igennem ved næste deploy, men flytter ingen gemte værdier af sig selv.
3. **Migration: fjern frysningen.** \`valuation_type\`-kæden fjernes i \`backend/lib/riderValuation.js\` (\`predictBaseValue\`) og \`backend/lib/riderCareerNpv.js\` (\`simulateCareer\`) — begge har en \`#3345\`-markeret linje. Kolonnen \`riders.valuation_type\` droppes i en separat migration EFTER at værdierne er skrevet og verificeret, så rollback stadig er muligt.
4. **Hvornår bliver det synligt.** \`riders.market_value\` er en GENERATED-kolonne (\`COALESCE(base_value, 1000)\`, verificeret i prod-schemaet), så alt der viser "Værdi" flytter sig i samme øjeblik \`base_value\` skrives. Der er to muligheder: vente på søndagskørslen (søn 27/9 kl. 06 — samme weekend som sæsonskiftet), eller køre \`scripts/dev/valueRefreshOnce4000.mjs --apply\` som en engangs-kørsel med ejerens go.
5. **Verify-queries efter kørslen:** (a) 0 ryttere hvor \`valuation_type\` afviger fra \`primary_type\`; (b) Σ \`base_value\` for menneskehold inden for det bånd tørkørslen forudsagde; (c) antal ryttere med fald ≥50 % matcher tørkørslen; (d) ingen \`base_value\` er null eller ≤ 0.
6. **Flader der reagerer med det samme** (verificeret i #5416-tørkørslen): auktions-startpris, bestyrelsens tvangssalg, squad-håndhævelsens auto-køb/-salg, achievements, fair-play-signalet. Lønnen røres IKKE — den er frosset i \`riders.salary\` ved signering og bygger på \`current_production_value\`, ikke \`base_value\`. Men CPV flytter sig i samme kald, så NÆSTE kontrakt/forlængelse/graduering får den nye løn.
7. **Spillerbesked FØR kørslen**, ikke efter. Ca. hver tredje rytter på et menneskehold flytter sig mærkbart.

---

_Genereret af \`backend/scripts/dev/v4RefitDryRun5443.mjs\` — read-only, intet skrevet._
`;
}

async function main() {
  console.log("=== #5443 / #3353 tørkørsel: omregnet værdiformel (READ-ONLY) ===");
  console.log(`Database: ${projectRef} · kandidat: ${CANDIDATE_PATH}`);
  const ctx = await load();
  console.log(`Sæson-anker: ${ctx.seasonNumber} · ryttere: ${ctx.riders.length} · hold: ${ctx.teamById.size} · TYPE_DAMPENING_ENABLED=${TYPE_DAMPENING_ENABLED}`);

  const active = ctx.riders.filter((r) => !r.is_retired && ctx.abilityByRider.has(r.id));
  console.log(`Aktive ryttere med evner: ${active.length}`);

  const rows = [];
  for (const r of active) {
    const liveFrozen = recompute(ctx, r, ctx.liveModel);
    const typeOnly = recompute(ctx, r, ctx.liveModel, r.primary_type);
    const cand = recompute(ctx, r, ctx.candModel, r.primary_type);
    if (!cand || cand.base_value == null) continue;
    const stored = r.base_value == null ? null : Number(r.base_value);
    rows.push({
      id: r.id,
      name: `${r.firstname} ${r.lastname}`.trim(),
      team: teamLabel(ctx, r),
      team_id: r.team_id,
      human_team: isHumanTeam(ctx, r),
      academy: r.is_academy === true,
      age: r.age,
      potentiale: r.potentiale,
      primary_type: r.primary_type,
      secondary_type: r.secondary_type,
      frozen_valuation_type: r.valuation_type,
      stored,
      live_frozen: liveFrozen?.base_value ?? null,
      type_only: typeOnly?.base_value ?? null,
      candidate: cand.base_value,
      cpv_stored: r.current_production_value == null ? null : Number(r.current_production_value),
      cpv_candidate: cand.current_production_value,
      diff: stored == null ? null : cand.base_value - stored,
      diff_pct: stored ? (cand.base_value / stored - 1) * 100 : null,
    });
  }
  console.log(`Beregnet for ${rows.length} ryttere.`);

  const sanity = sanityCheck(ctx, rows);
  console.log(`Kontrol: ${sanity.match}/${sanity.checked} rammer gemt base_value præcist (${sanity.mismatch} afviger).`);

  const withStored = rows.filter((x) => x.stored != null && x.stored > 0);
  const humanRows = withStored.filter((x) => x.human_team);

  const all = distribution(withStored, "stored", "candidate");
  const human = distribution(humanRows, "stored", "candidate");
  const byTypeHuman = groupBy(humanRows, (x) => x.primary_type, "stored", "candidate");
  const byAgeHuman = groupBy(humanRows, (x) => ageBucket(x.age), "stored", "candidate")
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  // Hold-aggregat
  const teamAgg = new Map();
  for (const x of humanRows) {
    if (!teamAgg.has(x.team_id)) teamAgg.set(x.team_id, { team_id: x.team_id, team: x.team, riders: 0, before: 0, after: 0 });
    const t = teamAgg.get(x.team_id);
    t.riders++; t.before += x.stored; t.after += x.candidate;
  }
  const teamRows = [...teamAgg.values()].map((t) => ({ ...t, diff: t.after - t.before, pct: t.before ? (t.after / t.before - 1) * 100 : null }))
    .sort((a, b) => b.diff - a.diff);
  const byTeam = {
    total: teamRows.length,
    losing: teamRows.filter((t) => t.pct != null && t.pct < -1).length,
    gaining: teamRows.filter((t) => t.pct != null && t.pct > 1).length,
    flat: teamRows.filter((t) => t.pct != null && Math.abs(t.pct) <= 1).length,
    top_winners: teamRows.slice(0, 10),
    top_losers: teamRows.slice(-10).reverse(),
    rows: teamRows,
  };

  const byDiff = [...humanRows].sort((a, b) => a.diff - b.diff);
  const topFalls = byDiff.slice(0, 10).map((x) => moverRow(ctx, x));
  const topRises = [...byDiff].reverse().slice(0, 10).map((x) => moverRow(ctx, x));

  const named = [];
  for (const spec of NAMED) {
    const hit = rows.find((x) => (spec.id ? x.id === spec.id : norm(x.name) === norm(spec.name)));
    if (hit) named.push(moverRow(ctx, hit));
    else named.push({ name: spec.label || spec.name, team: "IKKE FUNDET", overall: "—" });
  }

  const phase = {
    human: phaseIn(humanRows, "stored", "candidate"),
    all: phaseIn(withStored, "stored", "candidate"),
  };

  console.log("→ tt-historik…");
  const tt = await ttStandstill(ctx);
  console.log(`  ægte tt-ryttere: ${tt.tt_riders_total} · med historik: ${tt.with_history} · stod stille mens andet steg: ${tt.tt_flat_others_up}`);

  // Type-offset-tabel (live vs kandidat, både rå og dæmpet)
  const types = Object.keys(ctx.candRaw.fit.offset);
  const offLines = ["| Type | n (live fit) | offset live (rå) | ×mult | n (kandidat) | offset kandidat (rå) | ×mult | ×mult dæmpet (kandidat) |", "|---|--:|--:|--:|--:|--:|--:|--:|"];
  for (const t of types.sort()) {
    const lr = ctx.liveRaw.fit.offset[t];
    const ln = ctx.liveRaw.type_stats?.[t]?.n;
    const cr = ctx.candRaw.fit.offset[t];
    const cn = ctx.candRaw.type_stats?.[t]?.n;
    const cd = ctx.candModel.fit.offset[t];
    offLines.push(`| ${t} | ${fmt(ln)} | ${lr.toFixed(3)} | ×${Math.exp(lr).toFixed(2)} | ${fmt(cn)} | ${cr.toFixed(3)} | ×${Math.exp(cr).toFixed(2)} | ×${Math.exp(cd).toFixed(2)} |`);
  }
  const rawSpread = Math.exp(Math.max(...types.map((t) => ctx.candRaw.fit.offset[t])) - Math.min(...types.map((t) => ctx.candRaw.fit.offset[t])));
  const liveSpread = Math.exp(Math.max(...types.map((t) => ctx.liveRaw.fit.offset[t])) - Math.min(...types.map((t) => ctx.liveRaw.fit.offset[t])));
  offLines.push("");
  offLines.push(`Spænd fra billigste til dyreste type (rå offsets): live ×${liveSpread.toFixed(2)} → kandidat ×${rawSpread.toFixed(2)}.`);

  const meta = {
    ran_at: new Date().toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }),
    project_ref: projectRef,
    season_number: ctx.seasonNumber,
    type_dampening: TYPE_DAMPENING_ENABLED,
    candidate_path: CANDIDATE_PATH,
    live_fitted_at: ctx.liveRaw.fitted_at,
    live_season_id: ctx.liveRaw.season_id,
    live_n_samples: ctx.liveRaw.fit.n_samples,
    cand_fitted_at: ctx.candRaw.fitted_at,
    cand_season_id: ctx.candRaw.season_id,
    cand_K: ctx.candRaw.K,
    cand_seed: 2026,
    cand_n_samples: ctx.candRaw.fit.n_samples,
    salary_rate_production: SALARY_RATE_PRODUCTION,
    sunday_run: ctx.sundayLog ? `${ctx.sundayLog.run_date} (${ctx.sundayLog.started_at})` : "ukendt",
  };

  // Hvor meget af bevægelsen skyldes typeskiftet, og hvor meget omregningen?
  let deltaType = 0;
  let deltaRefit = 0;
  for (const x of humanRows) {
    if (x.type_only == null) continue;
    deltaType += x.type_only - x.stored;
    deltaRefit += x.candidate - x.type_only;
  }
  const decomposition = { delta_type: deltaType, delta_refit: deltaRefit, delta_total: deltaType + deltaRefit };
  console.log(`Kilde til bevægelsen (menneskehold): typeskift ${fmt(deltaType)} · omregning ${fmt(deltaRefit)}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const json = { meta, sanity, all, human, byTypeHuman, byAgeHuman, byTeam, topFalls, topRises, named, phase, tt, decomposition, rows };
  writeFileSync(join(OUT_DIR, "dryrun-5443.json"), JSON.stringify(json, null, 2), "utf8");
  writeFileSync(join(OUT_DIR, "RAPPORT.md"), buildReport(ctx, {
    ...json,
    typeOffsets: offLines.join("\n"),
    weightConcentration: weightConcentrationTable(),
  }), "utf8");

  console.log(`\nHele populationen: Σ ${fmt(all.sum_before)} → ${fmt(all.sum_after)} (${pct(all.sum_pct)}) · op ${all.up} / ned ${all.down} / flad ${all.flat} · median ${pct(all.median_pct)}`);
  console.log(`Menneskehold:      Σ ${fmt(human.sum_before)} → ${fmt(human.sum_after)} (${pct(human.sum_pct)}) · op ${human.up} / ned ${human.down} / flad ${human.flat} · median ${pct(human.median_pct)}`);
  console.log(`Mister ≥25 %: ${human.lose_25} · ≥50 %: ${human.lose_50} · mere end fordobles: ${human.more_than_double}`);
  console.log(`\n✅ Skrevet: ${join(OUT_DIR, "RAPPORT.md")}`);
  console.log(`✅ Skrevet: ${join(OUT_DIR, "dryrun-5443.json")}`);
  console.log("\nINTET er skrevet til databasen.");
}

main().catch((err) => {
  console.error("❌", err.message);
  console.error(err.stack);
  process.exit(1);
});
