#!/usr/bin/env node
// Løn-decoupling slice A shadow-scorecard (#2428). Simulér-før-ship: kalibrerer den
// produktions-baserede løn-sats mod den ÆGTE owned-population og verificerer at
// (G1) lønbyrden pr. division bevares, (G2) unge talenter får løn < sponsor, (G4)
// ingen runaway — FØR cutover (slice B, separat migration, ejer merger).
//
// READ-ONLY mod prod (kun SELECT — skriver ALDRIG DB). Ren gate-matematik:
// ../lib/salaryDecoupling.js (node --test). Rører INGEN live-økonomi/konstant.
//
//   node scripts/salaryDecouplingScorecard.js [--model-v4=<sti>] [--tolerance=0.15] [--out=<sti>]
//
// Exit 1 hvis en HÅRD gate fejler.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { currentProductionValue, predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { riderOverall } from "../lib/riderValuation.js";
import {
  calibrateSalaryRate, projectedSalary, wageBillsByDivision,
  wageBillContinuityGate, talentFixGate, runawayGate,
} from "../lib/salaryDecoupling.js";
import { SPONSOR_INCOME_BASE } from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const argVal = (flag, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(`--${flag}=`.length) : def;
};
const MODEL_V4_PATH = argVal("model-v4") || join(__dirname, "../lib/riderValuationModelV4.json");
const TOLERANCE = Number(argVal("tolerance", "0.15"));
const OUT_PATH = argVal("out");
const OLD_RATE = 0.067;                 // nuværende SALARY_RATE (kobling til market_value)
const SPONSOR = SPONSOR_INCOME_BASE;    // 240_000 — talent-løn skal ligge under dette
const HIGH_POTENTIALE = 5;              // potentiale er 1-6 (verificeret #2428)

// ageForSeason spejler riderProgressionEngine.js (inlinet, jf. fitRiderValuationV4.js).
const LAUNCH_REFERENCE_YEAR = 2026;
function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  return Number.isFinite(birthYear) ? LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const model = JSON.parse(readFileSync(MODEL_V4_PATH, "utf8"));

  const { data: activeSeason } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = activeSeason?.number ?? 1;

  // Ægte hold (samme filter som ranglisten/UI: ikke test/frozen/bank). division fra teams.
  const teams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_test_account, is_frozen, is_bank").order("id"));
  const realTeamById = new Map(teams
    .filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank)
    .map((t) => [t.id, t]));

  // Owned ryttere MED løn (den faktiske nuværende lønbyrde). Free agents (salary null)
  // udelades — de er ikke på lønningslisten.
  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, salary, base_value, prize_earnings_bonus, potentiale, birthdate, primary_type, is_retired, is_academy")
      .not("team_id", "is", null).order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const rows = [];
  const talents = [];
  let skipped = 0;
  for (const r of riders) {
    const team = realTeamById.get(r.team_id);
    if (!team) { skipped++; continue; }               // AI/test/frozen — ikke i lønbyrde-målet
    if (r.is_retired) { skipped++; continue; }
    if (r.salary == null) { skipped++; continue; }     // ingen kontrakt → ikke på lønningslisten
    const ab = abilityByRider.get(r.id);
    if (!ab) { skipped++; continue; }
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) { skipped++; continue; }
    const npvRider = { primary_type: r.primary_type, potentiale: r.potentiale, age };
    const cpv = currentProductionValue(npvRider, ab, model);
    if (cpv == null) { skipped++; continue; }
    const value_v4 = predictBaseValueV4(npvRider, ab, model);
    rows.push({ current_production_value: cpv, current_salary: Number(r.salary), division: team.division, value_v4 });
    // Talent-udvalg til G2: ung + højt potentiale (repræsentative for det problematiske tilfælde).
    if (age <= 22 && Number(r.potentiale) >= HIGH_POTENTIALE) {
      talents.push({ id: r.id, age, overall: riderOverall(ab), current_production_value: cpv, value_v4 });
    }
  }

  if (!rows.length) {
    console.error("❌ Ingen owned-ryttere med løn fundet — kan ikke kalibrere.");
    process.exit(1);
  }

  const rate = calibrateSalaryRate(rows);
  const bills = wageBillsByDivision(rows, rate);
  const g1 = wageBillContinuityGate(bills, TOLERANCE);
  const g2 = talentFixGate(talents, rate, { sponsor: SPONSOR, oldRate: OLD_RATE });
  const g4 = runawayGate(rows, rate, SPONSOR);

  const fmt = (n) => (n / 1e6).toFixed(2) + "M";
  const lines = [];
  const say = (s = "") => { console.log(s); lines.push(s); };

  say(`# Løn-decoupling slice A — shadow-scorecard (#2428)`);
  say(``);
  say(`- Population: ${rows.length} owned-ryttere med løn (${skipped} sprunget over)`);
  say(`- **Kalibreret SALARY_RATE_PROD = ${rate.toFixed(4)}** (gammel market_value-rate: ${OLD_RATE})`);
  say(``);
  say(`## G1 · Lønbyrde-kontinuitet pr. division (±${(TOLERANCE * 100).toFixed(0)}%) — ${g1.pass ? "✅" : "❌"}`);
  say(`| Div | Nuværende | Projiceret | Drift | Ryttere |`);
  say(`|--:|--:|--:|--:|--:|`);
  for (const b of g1.rows.sort((a, c) => String(a.division).localeCompare(String(c.division)))) {
    say(`| ${b.division} | ${fmt(b.current)} | ${fmt(b.projected)} | ${(b.drift * 100).toFixed(1)}% | ${b.count} |`);
  }
  say(``);
  say(`## G2 · Talent-fix (løn < sponsor ${fmt(SPONSOR)} + lavere end market_value-kobling) — ${g2.pass ? "✅" : "❌"}`);
  say(`| Rytter | Alder | Overall | v4-værdi | Ny løn | Gl. løn (v4·0,067) |`);
  say(`|--|--:|--:|--:|--:|--:|`);
  for (const t of g2.rows.slice(0, 15)) {
    say(`| ${t.id.slice(0, 8)} | ${t.age} | ${t.overall} | ${fmt(t.value_v4)} | ${Math.round(t.newSalary).toLocaleString()} | ${Math.round(t.oldSalary).toLocaleString()} |`);
  }
  say(`(talenter i alt: ${g2.rows.length})`);
  say(``);
  say(`## G4 · Ingen runaway (maks løn ≤ ${fmt(SPONSOR)}) — ${g4.pass ? "✅" : "❌"}`);
  say(`- Højeste projicerede løn: ${Math.round(g4.maxSalary).toLocaleString()} CZ$`);
  say(``);
  const hardPass = g1.pass && g2.pass && g4.pass;
  say(`## Resultat: ${hardPass ? "✅ alle hårde gates grønne" : "❌ mindst én hård gate rød"}`);

  if (OUT_PATH) {
    writeFileSync(OUT_PATH, lines.join("\n") + "\n");
    console.log(`\n✅ Skrev audit ${OUT_PATH}`);
  }
  if (!hardPass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
