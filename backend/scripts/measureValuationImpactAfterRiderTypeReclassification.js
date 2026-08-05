#!/usr/bin/env node
// READ-ONLY måle-harness for #3345 (blocker for #3325/#3343's merge).
//
// #3325/#3343 omklassificerer primary_type mod ability_caps (potentiale), men
// backfillen er IKKE kørt mod prod (ejer-gated). Denne fil simulerer hvad der
// sker med populationens `market_value` NÅR den backfill kører, ved at
// genberegne EN NY primary_type (samme klassifikator + caps-baseline som
// #3343 committer) for hele den aktive population og sende den gennem BEGGE
// eksisterende valuation-modeller:
//
//   V3 (backend/lib/riderValuationModel.json) — SHADOW. Bruges af
//     fictionalLaunchPopulation.test.js + enkelte admin/preview-diagnostik-
//     stier i api.js. Fittes af scripts/fitRiderValuationModel.js mod
//     riderValuationAnchors.json (navne-opslag mod `riders`).
//   V4 (backend/lib/riderValuationModelV4.json) — LIVE. #2594-cutover: dette
//     er modellen refreshChangedRiderValues (riderValueRefresh.js, kørt på
//     hver trænings-tick) rent faktisk skriver base_value/current_production_
//     value fra. `market_value` (GENERATED-kolonnen spillerne ser) = base_value
//     + prize_earnings_bonus. Fittes af scripts/fitRiderValuationV4.js mod en
//     Monte Carlo-sæson-simulering (simulateSeasonProduction.js).
//
// KENDT BLOKERING (fundet under #3345-arbejdet, ikke skabt af det): V3's
// anchor-fil matcher ANCHOR-RIDERE VED NAVN mod den levende `riders`-tabel.
// De 26 navngivne anchor-ryttere (Tadej Pogačar m.fl. — PCM-import-data) blev
// PERMANENT slettet 2026-06-27 (database/2026-06-27-purge-pcm-and-pre-
// relaunch-riders.sql, ejer-direktiv). `fitRiderValuationModel.js` kan derfor
// IKKE længere resolve nogen anchors mod prod (0/26) og har været i denne
// tilstand siden 2026-06-27 — UAFHÆNGIGT af #3325. En ægte V3-re-fit kræver
// derfor først en ejer-beslutning om hvordan anchors skal resolves (se
// PR-beskrivelsen for #3345-arbejdet). Dette script bruger derfor den
// EKSISTERENDE (u-refittede) V3-model som "FØR-og-EFTER-under-samme-
// koefficienter"-sammenligning — den isolerer PRÆCIST hvor meget offset+O
// alene flytter værdien, uden at blande en (umulig) re-fit ind.
//
// V4 er ALDRIG rørt af nogen kode i #3345-arbejdet — tallene her viser derfor
// den ÆGTE, u-mitigerede risiko for prod market_value hvis backfillen kører.
//
// Usage: cd backend && node scripts/measureValuationImpactAfterRiderTypeReclassification.js [--json=<sti>]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { computeRiderTypes, ABILITY_KEYS } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { STAR_RIDER_MARKET_VALUE } from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASELINE = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const V3_MODEL = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));
const V4_MODEL = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModelV4.json"), "utf8"));

const JSON_OUT = (() => {
  const hit = process.argv.find((a) => a.startsWith("--json="));
  return hit ? hit.slice("--json=".length) : null;
})();

// Samme tier-grænser som fictionalLaunchPopulation.js (LAUNCH_VALUE_BANDS) og
// #3343's PR-beskrivelse, så tallene er sammenlignelige med tidligere målinger.
const TIERS = [
  { key: "superstjerne", lo: STAR_RIDER_MARKET_VALUE, hi: Infinity },
  { key: "stjerne", lo: 1_000_000, hi: STAR_RIDER_MARKET_VALUE },
  { key: "solid", lo: 200_000, hi: 1_000_000 },
  { key: "domestik", lo: 0, hi: 200_000 },
];

function tierOf(v) {
  for (const t of TIERS) if (v >= t.lo && v < t.hi) return t.key;
  return "domestik";
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function quantile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const fmt = (n) => Math.round(n).toLocaleString("da-DK");
const fmtM = (n) => (n / 1e6).toFixed(2) + "M";

function summarize(values) {
  const tiers = Object.fromEntries(TIERS.map((t) => [t.key, 0]));
  let total = 0;
  for (const v of values) {
    tiers[tierOf(v)]++;
    total += v;
  }
  return {
    n: values.length,
    total: Math.round(total),
    median: Math.round(median(values)),
    p90: Math.round(quantile(values, 0.9)),
    tiers,
  };
}

async function main() {
  console.log("=== Måling: valuation-impact af #3325-reklassificering (READ-ONLY, ingen writes) ===\n");

  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`season lookup: ${seasonErr.message}`);
  const seasonNumber = season?.number ?? 1;

  const [riders, abilities, teams] = await Promise.all([
    fetchAllRows(() => supabase.from("riders")
      .select("id, firstname, lastname, primary_type, secondary_type, birthdate, potentiale, prize_earnings_bonus, base_value, is_academy, is_retired, team_id")
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities")
      .select(`rider_id, ability_caps, ${ABILITY_KEYS.join(", ")}`).order("rider_id")),
    fetchAllRows(() => supabase.from("teams")
      .select("id, division, balance, is_test_account, is_frozen, is_bank").order("id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const active = riders.filter((r) => !r.is_retired);
  console.log(`Population: ${riders.length} total · ${active.length} aktive (ikke pensioneret)\n`);

  const v3Old = [], v3New = [], v4Old = [], v4New = [];
  const perRider = [];
  let typeChanges = 0;
  let missingAbilities = 0;
  const teamSquadDelta = new Map(); // team_id -> { oldSum, newSum, count }

  for (const r of active) {
    const ab = abilityByRider.get(r.id);
    if (!ab) { missingAbilities++; continue; }

    const oldType = r.primary_type;
    const { primary } = computeRiderTypes(ab.ability_caps || {}, BASELINE);
    const newType = primary.key;
    if (newType !== oldType) typeChanges++;

    const age = ageForSeason(r.birthdate, seasonNumber);
    const prizeBonus = Number(r.prize_earnings_bonus) || 0;

    const bvV3Old = predictBaseValue({ ...r, primary_type: oldType }, ab, V3_MODEL);
    const bvV3New = predictBaseValue({ ...r, primary_type: newType }, ab, V3_MODEL);
    const bvV4Old = predictBaseValue({ ...r, primary_type: oldType, age }, ab, V4_MODEL);
    const bvV4New = predictBaseValue({ ...r, primary_type: newType, age }, ab, V4_MODEL);

    if (bvV3Old == null || bvV3New == null || bvV4Old == null || bvV4New == null) continue;

    const mvV3Old = bvV3Old + prizeBonus, mvV3New = bvV3New + prizeBonus;
    const mvV4Old = bvV4Old + prizeBonus, mvV4New = bvV4New + prizeBonus;

    v3Old.push(mvV3Old); v3New.push(mvV3New);
    v4Old.push(mvV4Old); v4New.push(mvV4New);

    perRider.push({
      id: r.id, name: `${r.firstname} ${r.lastname}`, oldType, newType,
      mvV3Old, mvV3New, mvV4Old, mvV4New,
    });

    if (r.team_id) {
      const team = teamById.get(r.team_id);
      if (team && !team.is_test_account && !team.is_frozen && !team.is_bank) {
        const acc = teamSquadDelta.get(r.team_id) || { oldSum: 0, newSum: 0, count: 0, division: team.division };
        acc.oldSum += mvV4Old; acc.newSum += mvV4New; acc.count++;
        teamSquadDelta.set(r.team_id, acc);
      }
    }
  }

  console.log(`Værdisat: ${v3Old.length}/${active.length} (${missingAbilities} uden abilities sprunget over)`);
  console.log(`Type-skift (ny klassifikation ≠ nuværende persisteret): ${typeChanges}/${active.length} (${(100 * typeChanges / active.length).toFixed(1)}%)\n`);

  const sumV3Old = summarize(v3Old), sumV3New = summarize(v3New);
  const sumV4Old = summarize(v4Old), sumV4New = summarize(v4New);

  function printTable(label, before, after) {
    const deltaPct = (100 * (after.total - before.total) / before.total).toFixed(2);
    console.log(`--- ${label} ---`);
    console.log(`  Total market_value: FØR ${fmtM(before.total)} → EFTER ${fmtM(after.total)}  (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`);
    console.log(`  Median: FØR ${fmt(before.median)} → EFTER ${fmt(after.median)}`);
    console.log(`  P90:    FØR ${fmt(before.p90)} → EFTER ${fmt(after.p90)}`);
    console.log("  Tiers:");
    for (const t of TIERS) {
      console.log(`    ${t.key.padEnd(13)} FØR ${String(before.tiers[t.key]).padStart(5)} → EFTER ${String(after.tiers[t.key]).padStart(5)}`);
    }
    console.log();
  }

  printTable("V3 (SHADOW, riderValuationModel.json — u-refittet, se header)", sumV3Old, sumV3New);
  printTable("V4 (LIVE, riderValuationModelV4.json — #2594-cutover, IKKE rørt)", sumV4Old, sumV4New);

  // ── Side-effekter ──────────────────────────────────────────────────────
  console.log("--- Star Signing (#2261): market_value >= " + fmtM(STAR_RIDER_MARKET_VALUE) + " (V4) ---");
  console.log(`  FØR ${sumV4Old.tiers.superstjerne} → EFTER ${sumV4New.tiers.superstjerne} kvalificerende ryttere\n`);

  console.log("--- Udvikl-og-sælg (#2670): akademi-ryttere (V4) ---");
  const academyIds = new Set(active.filter((r) => r.is_academy).map((r) => r.id));
  const acadOld = perRider.filter((p) => academyIds.has(p.id)).map((p) => p.mvV4Old);
  const acadNew = perRider.filter((p) => academyIds.has(p.id)).map((p) => p.mvV4New);
  const acadSumOld = summarize(acadOld), acadSumNew = summarize(acadNew);
  console.log(`  n=${acadSumOld.n} · Total FØR ${fmtM(acadSumOld.total)} → EFTER ${fmtM(acadSumNew.total)} (${(100 * (acadSumNew.total - acadSumOld.total) / acadSumOld.total).toFixed(2)}%)`);
  console.log(`  Median FØR ${fmt(acadSumOld.median)} → EFTER ${fmt(acadSumNew.median)}\n`);

  console.log("--- Gældsloft (#2815): hold-squads (real teams, V4) ---");
  const teamRows = [...teamSquadDelta.entries()].map(([teamId, v]) => ({
    teamId, ...v, deltaPct: 100 * (v.newSum - v.oldSum) / (v.oldSum || 1),
  }));
  teamRows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  console.log(`  ${teamRows.length} rigtige hold med ≥1 værdisat rytter. Top 5 største squad-værdi-skift:`);
  for (const t of teamRows.slice(0, 5)) {
    console.log(`    hold ${t.teamId} (div ${t.division}, ${t.count} ryttere): ${fmtM(t.oldSum)} → ${fmtM(t.newSum)} (${t.deltaPct >= 0 ? "+" : ""}${t.deltaPct.toFixed(1)}%)`);
  }
  const bigMovers = teamRows.filter((t) => Math.abs(t.deltaPct) >= 10);
  console.log(`  Hold med ≥10% squad-værdi-skift: ${bigMovers.length}/${teamRows.length}\n`);

  const result = {
    measured_at: new Date().toISOString(),
    population: { total: riders.length, active: active.length, valued: v3Old.length, missingAbilities },
    typeChanges,
    v3: { before: sumV3Old, after: sumV3New },
    v4: { before: sumV4Old, after: sumV4New },
    academy: { before: acadSumOld, after: acadSumNew },
    teams: { n: teamRows.length, bigMovers10pct: bigMovers.length, top5: teamRows.slice(0, 5) },
  };
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
    console.log(`✅ Skrev ${JSON_OUT}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
