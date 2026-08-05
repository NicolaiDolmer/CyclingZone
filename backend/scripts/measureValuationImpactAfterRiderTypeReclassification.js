#!/usr/bin/env node
// READ-ONLY måle-harness for #3345 (oprindeligt en blocker-rapport for
// #3325/#3343's merge — se PR #3348. UDVIDET her med FROZEN-sektionen, som
// beviser at #3345's løsning — riders.valuation_type (frosset værdisætnings-type,
// database/proposals/2026-08-04-3345-frozen-valuation-type.sql) — faktisk holder
// populationens samlede market_value uændret).
//
// #3325/#3343 omklassificerer primary_type mod ability_caps (potentiale), men
// backfillen er IKKE kørt mod prod endnu (ejer-gated, ships sammen med #3345).
// Denne fil simulerer hvad der sker med populationens `market_value` NÅR den
// backfill kører, ved at genberegne EN NY primary_type (samme klassifikator +
// caps-baseline som #3343 committer) for hele den aktive population og sende
// den gennem BEGGE eksisterende valuation-modeller:
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
// V4 er ALDRIG rørt af nogen kode i #3345-arbejdet — V3/V4-tabellerne nedenfor
// viser derfor stadig den ÆGTE, u-mitigerede risiko HVIS reklassificeringen
// havde ramt værdien direkte (den historiske blocker-måling fra PR #3348).
//
// FROZEN-sektionen (ny) beviser løsningen: samme population, samme NYE
// primary_type, men nu sendt gennem V4 med `valuation_type: oldType` sat (den
// FROSNE type — se riders.valuation_type-kolonnen + riderValuation.js's
// #3345-fallback-kæde `rider.valuation_type ?? rider.primary_type`). Da V4 nu
// læser valuation_type FØR primary_type, skal FROZEN-totalen matche FØR-totalen
// præcist (kun afrundings-støj), UANSET at primary_type er reklassificeret.
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

  const v3Old = [], v3New = [], v4Old = [], v4New = [], v4Frozen = [];
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
    // #3345 FIX-BEVIS: samme rytter, NY primary_type (reklassificeret, som
    // ville blive persisteret af #3343's backfill), men valuation_type sat til
    // den GAMLE type (= riders.valuation_type efter #3345-backfillet). predictBaseValue
    // læser valuation_type FØR primary_type — denne værdi skal derfor være
    // IDENTISK med bvV4Old, selvom primary_type er reklassificeret.
    const bvV4Frozen = predictBaseValue({ ...r, primary_type: newType, valuation_type: oldType, age }, ab, V4_MODEL);

    if (bvV3Old == null || bvV3New == null || bvV4Old == null || bvV4New == null || bvV4Frozen == null) continue;

    const mvV3Old = bvV3Old + prizeBonus, mvV3New = bvV3New + prizeBonus;
    const mvV4Old = bvV4Old + prizeBonus, mvV4New = bvV4New + prizeBonus;
    const mvV4Frozen = bvV4Frozen + prizeBonus;

    v3Old.push(mvV3Old); v3New.push(mvV3New);
    v4Old.push(mvV4Old); v4New.push(mvV4New);
    v4Frozen.push(mvV4Frozen);

    perRider.push({
      id: r.id, name: `${r.firstname} ${r.lastname}`, oldType, newType,
      mvV3Old, mvV3New, mvV4Old, mvV4New, mvV4Frozen,
    });

    if (r.team_id) {
      const team = teamById.get(r.team_id);
      if (team && !team.is_test_account && !team.is_frozen && !team.is_bank) {
        const acc = teamSquadDelta.get(r.team_id) || { oldSum: 0, newSum: 0, frozenSum: 0, count: 0, division: team.division };
        acc.oldSum += mvV4Old; acc.newSum += mvV4New; acc.frozenSum += mvV4Frozen; acc.count++;
        teamSquadDelta.set(r.team_id, acc);
      }
    }
  }

  console.log(`Værdisat: ${v3Old.length}/${active.length} (${missingAbilities} uden abilities sprunget over)`);
  console.log(`Type-skift (ny klassifikation ≠ nuværende persisteret): ${typeChanges}/${active.length} (${(100 * typeChanges / active.length).toFixed(1)}%)\n`);

  const sumV3Old = summarize(v3Old), sumV3New = summarize(v3New);
  const sumV4Old = summarize(v4Old), sumV4New = summarize(v4New);
  const sumV4Frozen = summarize(v4Frozen);

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

  // ── HOVEDBEVIS (#3345-fix): V4 med valuation_type frosset ────────────────
  console.log("=== HOVEDBEVIS: V4 MED #3345-FRYSNING (valuation_type = gammel type, primary_type = ny type) ===");
  printTable("V4 FROZEN (LIVE, riders.valuation_type i brug — dette er hvad der rent faktisk sker ved merge)", sumV4Old, sumV4Frozen);
  const frozenDeltaAbs = Math.abs(sumV4Frozen.total - sumV4Old.total);
  console.log(frozenDeltaAbs === 0
    ? "✅ Total market_value (V4) er BYTE-IDENTISK FØR/EFTER med frysningen aktiv.\n"
    : `❌ Total market_value (V4) AFVIGER ${fmtM(frozenDeltaAbs)} selv med frysningen aktiv — en kaldsvej er overset, undersøg FØR du forklarer det væk.\n`);

  // ── Historisk kontekst: hvad #3345 forhindrer (u-frosset, PR #3348's oprindelige måling) ──
  console.log("=== HISTORISK RISIKO (uden #3345-frysning — hvad der ville være sket) ===");
  printTable("V3 (SHADOW, riderValuationModel.json — u-refittet, se header)", sumV3Old, sumV3New);
  printTable("V4 (LIVE, riderValuationModelV4.json — #2594-cutover, IKKE rørt) UDEN frysning", sumV4Old, sumV4New);

  // ── Side-effekter (V4 FROZEN — det der rent faktisk ships) ────────────────
  console.log("--- Star Signing (#2261): market_value >= " + fmtM(STAR_RIDER_MARKET_VALUE) + " (V4 FROZEN) ---");
  console.log(`  FØR ${sumV4Old.tiers.superstjerne} → EFTER (frosset) ${sumV4Frozen.tiers.superstjerne} kvalificerende ryttere\n`);

  console.log("--- Udvikl-og-sælg (#2670): akademi-ryttere (V4 FROZEN) ---");
  const academyIds = new Set(active.filter((r) => r.is_academy).map((r) => r.id));
  const acadOld = perRider.filter((p) => academyIds.has(p.id)).map((p) => p.mvV4Old);
  const acadFrozen = perRider.filter((p) => academyIds.has(p.id)).map((p) => p.mvV4Frozen);
  const acadSumOld = summarize(acadOld), acadSumFrozen = summarize(acadFrozen);
  console.log(`  n=${acadSumOld.n} · Total FØR ${fmtM(acadSumOld.total)} → EFTER (frosset) ${fmtM(acadSumFrozen.total)} (${(100 * (acadSumFrozen.total - acadSumOld.total) / acadSumOld.total).toFixed(2)}%)`);
  console.log(`  Median FØR ${fmt(acadSumOld.median)} → EFTER (frosset) ${fmt(acadSumFrozen.median)}\n`);

  console.log("--- Gældsloft (#2815): hold-squads (real teams, V4 FROZEN) ---");
  const teamRows = [...teamSquadDelta.entries()].map(([teamId, v]) => ({
    teamId, ...v, deltaPct: 100 * (v.frozenSum - v.oldSum) / (v.oldSum || 1),
  }));
  teamRows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  console.log(`  ${teamRows.length} rigtige hold med ≥1 værdisat rytter. Top 5 største squad-værdi-skift (frosset):`);
  for (const t of teamRows.slice(0, 5)) {
    console.log(`    hold ${t.teamId} (div ${t.division}, ${t.count} ryttere): ${fmtM(t.oldSum)} → ${fmtM(t.frozenSum)} (${t.deltaPct >= 0 ? "+" : ""}${t.deltaPct.toFixed(1)}%)`);
  }
  const bigMovers = teamRows.filter((t) => Math.abs(t.deltaPct) >= 10);
  console.log(`  Hold med ≥10% squad-værdi-skift (frosset): ${bigMovers.length}/${teamRows.length} — sammenlign med #3345-issuets oprindelige 239/367 (u-frosset)\n`);

  const result = {
    measured_at: new Date().toISOString(),
    population: { total: riders.length, active: active.length, valued: v3Old.length, missingAbilities },
    typeChanges,
    // #3345 hovedbevis: skal være total_delta_abs=0 (byte-identisk) — dette er
    // tallet PR'ens Brugerverifikation-sektion citerer.
    v4_frozen: { before: sumV4Old, after: sumV4Frozen, total_delta_abs: frozenDeltaAbs },
    v3_unfrozen_historical: { before: sumV3Old, after: sumV3New },
    v4_unfrozen_historical: { before: sumV4Old, after: sumV4New },
    academy_frozen: { before: acadSumOld, after: acadSumFrozen },
    teams_frozen: { n: teamRows.length, bigMovers10pct: bigMovers.length, top5: teamRows.slice(0, 5) },
  };
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
    console.log(`✅ Skrev ${JSON_OUT}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
