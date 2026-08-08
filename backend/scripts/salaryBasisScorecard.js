#!/usr/bin/env node
// #3360 løn-grundlag-scorecard — simulér-før-ship for mekanisme 1 (lønnens GRUNDLAG
// skifter fra current_production_value til markedsværdi).
//
// READ-ONLY mod prod (kun SELECT — skriver ALDRIG). Ren kurve-matematik i
// ../lib/salaryBasis.js (node --test). Ændrer INGEN konstant og rører ingen live-økonomi.
//
//   node scripts/salaryBasisScorecard.js                       # kør den KALIBREREDE model
//   node scripts/salaryBasisScorecard.js --sweep               # eksponent-sweep (vælg kurven)
//   node scripts/salaryBasisScorecard.js --exponent=0.55 --target-per-team=316000
//   node scripts/salaryBasisScorecard.js --anchor-salary=24000 --exponent=0.55
//   node scripts/salaryBasisScorecard.js --out=docs/audits/...md
//
// Måle-model (eksplicit, så ejeren kan sanity-tjekke):
//   • Hold-filter = samme som ranglisten/UI: user_id sat, ikke AI/bank/test/frossen.
//   • Sæson-start-posterne (sponsor, divisionsbonus, upkeep, løn, akademi-drift,
//     facilitets-upkeep, stab-løn) læses fra den SENESTE faktiske sæson-transition i
//     finance_transactions — ikke fra konstanter, så tallet er hvad hold rent faktisk fik.
//   • Løbsafhængige poster (præmie + sponsor-løbsdags-/resultatbonus) skaleres fra de
//     afviklede løbsdage til en hel sæson (28 løbsdage).
//   • Hold der er oprettet EFTER transitionen har ingen sæson-start-rækker; de får
//     divisionens gennemsnit, så de ikke fejlagtigt tæller som "gratis hold".
//
// Exit 1 hvis en HÅRD gate fejler (se GATES nederst).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  marketBasisSalary, calibrateAnchorSalary, resolveMarketBase, costMultiplierForValueMultiple,
} from "../lib/salaryBasis.js";
import { SALARY_MARKET_MODEL, SEASON_RACE_DAYS, TARGET_NET_PER_TEAM_PER_SEASON } from "../lib/economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const argVal = (flag, def = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(`--${flag}=`.length) : def;
};
const hasFlag = (flag) => process.argv.includes(`--${flag}`);

// KALIBRERINGS-ANKER (vigtigt — læs før du flytter et tal).
//
// Den nærliggende idé er at kalibrere Σ lønsum til "316.000 × antal hold", fordi
// SPONSOR_INCOME_BY_DIVISION + UPKEEP_BY_DIVISION blev kalibreret (#1441 A6) mod en
// roster-lønbyrde ≈ 316k/hold. Det ANKER VIRKER IKKE på dagens population, og det er
// målt: de 316k gjaldt en FRISK 8-rytters trup, hvor alle hold lignede hinanden. I dag
// har topdivisionen 26 ryttere og 4-25 mio. i trupværdi, mens bunden har 12 ryttere og
// ~142k. En flad total lægger derfor hele summen på toppen (D2-net −220k..−344k i hele
// eksponent-sweepet) mens bunden knap mærker det. Se --sweep.
//
// Ankeret der HOLDER er det samme designforhold udtrykt pr. hold i stedet for som en
// total: topdivisionens MEDIANHOLD skal betale samme andel af sin sponsor i løn som
// designet regnede med — 316.000 / 400.000 = 79 % (D2's sponsor dengang). Anvendt på
// den sponsor holdene FAKTISK får i dag. Topdivisionen er den bindende begrænsning;
// alt andet følger af kurven.
const DESIGN_WAGE_SHARE_OF_SPONSOR = 316_000 / 400_000;
const DESIGN_WAGE_BILL_PER_TEAM = 316_000;

const SWEEP_EXPONENTS = [1.0, 0.85, 0.75, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4];

const fmt = (n) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(2)} %` : "—");
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const quantile = (arr, q) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};

const LAUNCH_REFERENCE_YEAR = 2026;
function ageOf(birthdate) {
  if (!birthdate) return null;
  const y = new Date(birthdate).getFullYear();
  return Number.isFinite(y) ? LAUNCH_REFERENCE_YEAR - y : null;
}
function ageBucket(age) {
  if (age == null) return "ukendt";
  if (age <= 21) return "≤21";
  if (age <= 25) return "22-25";
  if (age <= 29) return "26-29";
  if (age <= 33) return "30-33";
  return "34+";
}

const SEASON_START_TYPES = {
  sponsor: "sponsor",
  bonus: "bonus",
  upkeep: "upkeep",
  salary: "salary",
  academy_drift: "academy_drift",
  facility_upkeep: "facility_upkeep",
  staff_salary: "staff_salary",
};
const IN_SEASON_TYPES = ["prize", "sponsor_race_day_bonus", "sponsor_result_bonus"];

async function loadPopulation(supabase) {
  const teams = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, division, user_id, is_ai, is_bank, is_test_account, is_frozen")
    .order("id"));
  const realTeams = teams.filter((t) =>
    t.user_id && !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen);
  const realIds = new Set(realTeams.map((t) => t.id));

  const riders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, salary, market_value, base_value, current_production_value, is_academy, is_retired, birthdate")
    .not("team_id", "is", null)
    .order("id"));

  const owned = riders.filter((r) => realIds.has(r.team_id) && !r.is_retired);
  return { realTeams, owned };
}

// Seneste faktiske sæson-transition: den dag hvor flest hold fik en 'sponsor'-postering.
async function findTransitionDate(supabase) {
  const rows = await fetchAllRows(() => supabase
    .from("finance_transactions")
    .select("created_at, type")
    .eq("type", "sponsor")
    .order("created_at", { ascending: false })
    .limit(4000));
  const byDay = new Map();
  for (const r of rows) {
    const d = String(r.created_at).slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [d, n] of byDay) if (n > bestN) { best = d; bestN = n; }
  return { date: best, teamsPaid: bestN };
}

async function loadEconomics(supabase, realTeams, transitionDate) {
  const ids = new Set(realTeams.map((t) => t.id));
  const rows = await fetchAllRows(() => supabase
    .from("finance_transactions")
    .select("team_id, type, amount, created_at")
    .gte("created_at", `${transitionDate}T00:00:00Z`)
    .order("id", { ascending: true }));

  const perTeam = new Map();
  const blank = () => ({ seasonStart: {}, inSeason: {} });
  for (const t of realTeams) perTeam.set(t.id, blank());

  for (const r of rows) {
    if (!ids.has(r.team_id)) continue;
    const bucket = perTeam.get(r.team_id);
    const onTransitionDay = String(r.created_at).slice(0, 10) === transitionDate;
    if (onTransitionDay && SEASON_START_TYPES[r.type]) {
      bucket.seasonStart[r.type] = (bucket.seasonStart[r.type] || 0) + Number(r.amount || 0);
    } else if (!onTransitionDay && IN_SEASON_TYPES.includes(r.type)) {
      bucket.inSeason[r.type] = (bucket.inSeason[r.type] || 0) + Number(r.amount || 0);
    }
  }
  return perTeam;
}

async function elapsedRaceDays(supabase, transitionDate) {
  const { data: season } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (!season) return SEASON_RACE_DAYS;
  const races = await fetchAllRows(() => supabase
    .from("races").select("scheduled_for").eq("season_id", season.id).order("id"));
  const today = new Date().toISOString().slice(0, 10);
  const days = new Set(races
    .map((r) => String(r.scheduled_for || "").slice(0, 10))
    .filter((d) => d && d > transitionDate && d <= today));
  return Math.max(1, days.size);
}

function buildTeamRows({ realTeams, owned, economics, scale }) {
  const ridersByTeam = new Map();
  for (const r of owned) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(r);
  }

  const raw = realTeams.map((t) => {
    const rs = ridersByTeam.get(t.id) || [];
    const e = economics.get(t.id) || { seasonStart: {}, inSeason: {} };
    const ss = e.seasonStart;
    const hadTransition = Object.keys(ss).length > 0;
    const inSeasonTotal = IN_SEASON_TYPES.reduce((s, k) => s + (e.inSeason[k] || 0), 0);
    return {
      id: t.id,
      division: t.division,
      riders: rs,
      riderCount: rs.length,
      squadValue: rs.reduce((s, r) => s + resolveMarketBase(r).base, 0),
      wageBefore: rs.reduce((s, r) => s + (Number(r.salary) || 0), 0),
      hadTransition,
      sponsor: ss.sponsor || 0,
      divisionBonus: ss.bonus || 0,
      fixedCosts: -((ss.upkeep || 0) + (ss.academy_drift || 0) + (ss.facility_upkeep || 0) + (ss.staff_salary || 0)),
      variableIncome: inSeasonTotal * scale,
    };
  });

  // Hold uden en sæson-transition (oprettet efter) får divisionens gennemsnit for de
  // faste poster, så de ikke tælles som gratis hold i net-regnskabet.
  const byDiv = new Map();
  for (const t of raw) {
    if (!t.hadTransition) continue;
    if (!byDiv.has(t.division)) byDiv.set(t.division, []);
    byDiv.get(t.division).push(t);
  }
  const avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : 0);
  for (const t of raw) {
    if (t.hadTransition) continue;
    const peers = byDiv.get(t.division) || [];
    t.sponsor = avg(peers, "sponsor");
    t.divisionBonus = avg(peers, "divisionBonus");
    t.fixedCosts = avg(peers, "fixedCosts");
    t.imputed = true;
  }
  for (const t of raw) {
    t.income = t.sponsor + t.divisionBonus + t.variableIncome;
    t.netBefore = t.income - t.fixedCosts - t.wageBefore;
  }
  return raw;
}

function applyModel(teamRows, model) {
  for (const t of teamRows) {
    t.wageAfter = t.riders.reduce((s, r) => s + marketBasisSalary(resolveMarketBase(r).base, model), 0);
    t.netAfter = t.income - t.fixedCosts - t.wageAfter;
  }
}

// Topdivisionen = den laveste division der faktisk har hold (D1 er tom i dag).
function topDivision(teamRows) {
  return Math.min(...teamRows.map((t) => t.division));
}

// Kalibrér anchorSalary så medianholdet i topdivisionen rammer `targetWage`.
// Bisection, fordi floor/ceiling gør funktionen ikke-lineær i anchorSalary.
function calibrateToTopDivisionMedian(teamRows, base, targetWage) {
  const top = topDivision(teamRows);
  const at = (anchorSalary) => {
    const model = { ...base, anchorSalary };
    return median(teamRows
      .filter((t) => t.division === top)
      .map((t) => t.riders.reduce((s, r) => s + marketBasisSalary(resolveMarketBase(r).base, model), 0)));
  };
  let lo = 1, hi = 5_000_000;
  if (at(hi) < targetWage) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < targetWage) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function divisionTable(teamRows) {
  const divs = [...new Set(teamRows.map((t) => t.division))].sort((a, b) => a - b);
  return divs.map((d) => {
    const ts = teamRows.filter((t) => t.division === d);
    return {
      division: d,
      teams: ts.length,
      riders: ts.reduce((s, t) => s + t.riderCount, 0) / ts.length,
      squadValue: ts.reduce((s, t) => s + t.squadValue, 0) / ts.length,
      wageBefore: ts.reduce((s, t) => s + t.wageBefore, 0) / ts.length,
      wageAfter: ts.reduce((s, t) => s + t.wageAfter, 0) / ts.length,
      medianWageAfter: median(ts.map((t) => t.wageAfter)),
      netBefore: ts.reduce((s, t) => s + t.netBefore, 0) / ts.length,
      netAfter: ts.reduce((s, t) => s + t.netAfter, 0) / ts.length,
      medianNetAfter: median(ts.map((t) => t.netAfter)),
      negativeAfter: ts.filter((t) => t.netAfter < 0).length,
      negativeBefore: ts.filter((t) => t.netBefore < 0).length,
    };
  });
}

function ageTable(owned, model) {
  const buckets = new Map();
  for (const r of owned) {
    const k = ageBucket(ageOf(r.birthdate));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const order = ["≤21", "22-25", "26-29", "30-33", "34+", "ukendt"];
  return order.filter((k) => buckets.has(k)).map((k) => {
    const rs = buckets.get(k);
    const mv = rs.reduce((s, r) => s + resolveMarketBase(r).base, 0);
    const before = rs.reduce((s, r) => s + (Number(r.salary) || 0), 0);
    const after = rs.reduce((s, r) => s + marketBasisSalary(resolveMarketBase(r).base, model), 0);
    return {
      bucket: k,
      riders: rs.length,
      avgMarketValue: mv / rs.length,
      avgCpv: rs.reduce((s, r) => s + (Number(r.current_production_value) || 0), 0) / rs.length,
      avgSalaryBefore: before / rs.length,
      avgSalaryAfter: after / rs.length,
      shareOfValueBefore: before / mv,
      shareOfValueAfter: after / mv,
    };
  });
}

function renderModel(model) {
  return [
    `  anchorValue   = ${fmt(model.anchorValue)} CZ$   (referenceværdi kurven forankres i)`,
    `  anchorSalary  = ${fmt(model.anchorSalary)} CZ$   (hvad en rytter til præcis anchorValue koster/sæson)`,
    `  exponent      = ${model.exponent}   (dobbelt værdi ⇒ ×${costMultiplierForValueMultiple(2, model.exponent).toFixed(2)} løn · 10× værdi ⇒ ×${costMultiplierForValueMultiple(10, model.exponent).toFixed(2)} · 100× værdi ⇒ ×${costMultiplierForValueMultiple(100, model.exponent).toFixed(1)})`,
    `  floor         = ${fmt(model.floor)} CZ$`,
    `  ceiling       = ${model.ceiling ? `${fmt(model.ceiling)} CZ$` : "ingen"}`,
  ].join("\n");
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { realTeams, owned } = await loadPopulation(supabase);
  const { date: transitionDate, teamsPaid } = await findTransitionDate(supabase);
  const economics = await loadEconomics(supabase, realTeams, transitionDate);
  const raceDays = await elapsedRaceDays(supabase, transitionDate);
  const scale = SEASON_RACE_DAYS / raceDays;

  const teamRows = buildTeamRows({ realTeams, owned, economics, scale });
  const values = owned.map((r) => resolveMarketBase(r).base);
  const fallbackCount = owned.filter((r) => resolveMarketBase(r).source === "fallback").length;

  const out = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  say("=== #3360 løn-grundlag-scorecard — markedsværdi som lønbasis ===");
  say("");
  say(`Population : ${realTeams.length} rigtige hold · ${owned.length} ejede ryttere (ikke pensionerede)`);
  say(`Transition : ${transitionDate} (${teamsPaid} hold fik sponsor) · ${raceDays}/${SEASON_RACE_DAYS} løbsdage afviklet → skalafaktor ×${scale.toFixed(2)}`);
  say(`Værdibasis : market_value (GENERATED = COALESCE(base_value,1000)) · ${fallbackCount} ryttere uden læsbar værdi`);
  say("");

  const sumSalary = owned.reduce((s, r) => s + (Number(r.salary) || 0), 0);
  const sumCpv = owned.reduce((s, r) => s + (Number(r.current_production_value) || 0), 0);
  const sumMv = values.reduce((a, b) => a + b, 0);
  say("── Baseline (før) ─────────────────────────────────────────────────────────");
  say(`  Σ løn                    ${fmt(sumSalary)} CZ$   (${fmt(sumSalary / realTeams.length)} pr. hold)`);
  say(`  Σ current_production_val ${fmt(sumCpv)} CZ$   → løn = ${pct(sumSalary, sumCpv)} af cpv`);
  say(`  Σ markedsværdi           ${fmt(sumMv)} CZ$   → løn = ${pct(sumSalary, sumMv)} af markedsværdi`);
  say(`  Garanteret net           ${fmt(teamRows.reduce((s, t) => s + t.netBefore, 0) / teamRows.length)} CZ$ pr. hold pr. sæson (mål ${fmt(TARGET_NET_PER_TEAM_PER_SEASON)})`);
  say("");

  const top = topDivision(teamRows);
  const topSponsor = median(teamRows.filter((t) => t.division === top).map((t) => t.sponsor));
  const targetTopWage = Number(argVal("target-top-wage", String(Math.round(topSponsor * DESIGN_WAGE_SHARE_OF_SPONSOR))));

  if (hasFlag("sweep")) {
    const flatTarget = hasFlag("flat-anchor");
    const targetPerTeam = Number(argVal("target-per-team", String(DESIGN_WAGE_BILL_PER_TEAM)));
    say(flatTarget
      ? `── Eksponent-sweep · FLAD total (Σ lønsum = ${fmt(targetPerTeam)} × ${realTeams.length} hold) — vist for at dokumentere hvorfor det anker ikke holder ──`
      : `── Eksponent-sweep · anker = D${top}-medianholdets lønbyrde ${fmt(targetTopWage)} CZ$ (${(DESIGN_WAGE_SHARE_OF_SPONSOR * 100).toFixed(0)} % af dets sponsor ${fmt(topSponsor)}) ──`);
    say("");
    say(`  exp   anchor    D${top} løn      D3 løn      D4 løn   D${top} net      D3 net   hold i minus   dyreste rytter   Σ lønsum`);
    for (const exponent of SWEEP_EXPONENTS) {
      const base = { anchorValue: SALARY_MARKET_MODEL.anchorValue, exponent, floor: SALARY_MARKET_MODEL.floor, ceiling: SALARY_MARKET_MODEL.ceiling };
      const anchorSalary = flatTarget
        ? calibrateAnchorSalary(values, { ...base, targetTotal: targetPerTeam * realTeams.length })
        : calibrateToTopDivisionMedian(teamRows, base, targetTopWage);
      if (anchorSalary == null) { say(`  ${exponent.toFixed(2)}  — målet uopnåeligt inden for loftet`); continue; }
      const model = { ...base, anchorSalary };
      applyModel(teamRows, model);
      const tbl = divisionTable(teamRows);
      const d = (n) => tbl.find((x) => x.division === n);
      const maxRider = Math.max(...values.map((v) => marketBasisSalary(v, model)));
      const total = teamRows.reduce((s, t) => s + t.wageAfter, 0);
      say(`  ${exponent.toFixed(2)}  ${String(fmt(anchorSalary)).padStart(7)}  ${String(fmt(d(top)?.medianWageAfter)).padStart(9)}  ${String(fmt(d(3)?.medianWageAfter)).padStart(9)}  ${String(fmt(d(4)?.medianWageAfter)).padStart(9)}  ${String(fmt(d(top)?.medianNetAfter)).padStart(9)}  ${String(fmt(d(3)?.medianNetAfter)).padStart(9)}  ${String(teamRows.filter((t) => t.netAfter < 0).length).padStart(6)}/${teamRows.length}  ${String(fmt(maxRider)).padStart(12)}  ${String(fmt(total)).padStart(11)}`);
    }
    say("");
    say("  Læsning: exp=1.00 er en LINEÆR andel af markedsværdien. Den koncentrerer");
    say("  hele byrden i toppen (truppernes værdi spænder ~400×, indtægten ~1,25×) og");
    say("  gør de dyreste enkeltryttere absurd dyre. Lavere eksponent flytter byrden");
    say("  nedad — men under ~0,45 bliver mekanismen reelt en hovedskat pr. rytter i");
    say("  stedet for en pris på værdi, fordi billige ryttere begynder at dominere.");
    return;
  }

  const exponent = Number(argVal("exponent", String(SALARY_MARKET_MODEL.exponent)));
  const explicitAnchor = argVal("anchor-salary");
  const base = { anchorValue: SALARY_MARKET_MODEL.anchorValue, exponent, floor: SALARY_MARKET_MODEL.floor, ceiling: SALARY_MARKET_MODEL.ceiling };
  const anchorSalary = explicitAnchor != null
    ? Number(explicitAnchor)
    : (hasFlag("recalibrate")
      ? calibrateToTopDivisionMedian(teamRows, base, targetTopWage)
      : SALARY_MARKET_MODEL.anchorSalary);
  const model = { ...base, anchorSalary };
  applyModel(teamRows, model);

  say("── Model ──────────────────────────────────────────────────────────────────");
  say(renderModel(model));
  say(explicitAnchor != null
    ? "  (anchorSalary sat eksplicit via --anchor-salary)"
    : hasFlag("recalibrate")
      ? `  (anchorSalary GENKALIBRERET så D${top}-medianholdet betaler ${fmt(targetTopWage)} CZ$ = ${(DESIGN_WAGE_SHARE_OF_SPONSOR * 100).toFixed(0)} % af sin sponsor)`
      : "  (anchorSalary fra economyConstants.SALARY_MARKET_MODEL — kør --recalibrate for at genkalibrere mod dagens population)");
  say("");

  const totalAfter = teamRows.reduce((s, t) => s + t.wageAfter, 0);
  say("── Lønsum ─────────────────────────────────────────────────────────────────");
  say(`  Før  ${fmt(sumSalary)} CZ$ (${fmt(sumSalary / realTeams.length)}/hold) = ${pct(sumSalary, sumMv)} af markedsværdi`);
  say(`  Efter ${fmt(totalAfter)} CZ$ (${fmt(totalAfter / realTeams.length)}/hold) = ${pct(totalAfter, sumMv)} af markedsværdi   → ×${(totalAfter / sumSalary).toFixed(1)}`);
  say("");

  say("── Pr. division (gennemsnit pr. hold) ──────────────────────────────────────");
  say("  Div  hold  ryttere   trupværdi     løn før    løn efter    net før    net efter  minus");
  for (const d of divisionTable(teamRows)) {
    say(`  D${d.division}   ${String(d.teams).padStart(4)}  ${d.riders.toFixed(1).padStart(7)}  ${String(fmt(d.squadValue)).padStart(10)}  ${String(fmt(d.wageBefore)).padStart(10)}  ${String(fmt(d.wageAfter)).padStart(10)}  ${String(fmt(d.netBefore)).padStart(10)}  ${String(fmt(d.netAfter)).padStart(10)}  ${d.negativeBefore}→${d.negativeAfter}`);
  }
  say("");

  say("── Pr. aldersgruppe (gennemsnit pr. rytter) ────────────────────────────────");
  say("  Alder  ryttere   markedsværdi      cpv    løn før   løn efter   andel før  andel efter");
  for (const a of ageTable(owned, model)) {
    say(`  ${a.bucket.padEnd(6)} ${String(a.riders).padStart(7)}  ${String(fmt(a.avgMarketValue)).padStart(12)}  ${String(fmt(a.avgCpv)).padStart(7)}  ${String(fmt(a.avgSalaryBefore)).padStart(9)}  ${String(fmt(a.avgSalaryAfter)).padStart(10)}  ${(a.shareOfValueBefore * 100).toFixed(2).padStart(8)} %  ${(a.shareOfValueAfter * 100).toFixed(2).padStart(9)} %`);
  }
  say("");
  say("  Inversionen er væk når 'løn efter' vokser monotont med markedsværdien —");
  say("  i dag koster en 34-årig til ~20k MERE end et talent til ~180k.");
  say("");

  const nets = teamRows.map((t) => t.netAfter);
  const negative = teamRows.filter((t) => t.netAfter < 0);
  say("── Fordeling af net efter (alle hold) ──────────────────────────────────────");
  say(`  p10 ${fmt(quantile(nets, 0.1))} · median ${fmt(median(nets))} · p90 ${fmt(quantile(nets, 0.9))} · min ${fmt(Math.min(...nets))} · max ${fmt(Math.max(...nets))}`);
  say(`  Hold i minus: ${negative.length}/${teamRows.length} (før: ${teamRows.filter((t) => t.netBefore < 0).length})`);
  const worst = [...teamRows].sort((a, b) => a.netAfter - b.netAfter).slice(0, 5);
  say("  Hårdest ramt (top 5):");
  for (const t of worst) {
    say(`    D${t.division}  ${String(t.riderCount).padStart(2)} ryttere · trupværdi ${String(fmt(t.squadValue)).padStart(11)} · løn ${fmt(t.wageBefore)} → ${fmt(t.wageAfter)} · net ${fmt(t.netBefore)} → ${fmt(t.netAfter)}`);
  }
  say("");

  const maxRiderSalary = Math.max(...values.map((v) => marketBasisSalary(v, model)));
  const avgNetAfter = teamRows.reduce((s, t) => s + t.netAfter, 0) / teamRows.length;
  const ages = ageTable(owned, model);
  const young = ages.find((a) => a.bucket === "≤21");
  const veteran = ages.find((a) => a.bucket === "34+");
  const divs = divisionTable(teamRows);
  const gates = [
    {
      // Den konkrete fejl #3360 handler om: i dag koster en 34-årig til ~20k MERE end
      // et talent til ~180k. Gaten er hård fordi den ER mekanismens formål.
      name: "G1 inversionen er væk — det dyre aktiv koster mest",
      pass: !young || !veteran || young.avgSalaryAfter > veteran.avgSalaryAfter,
      detail: young && veteran
        ? `≤21 (værdi ${fmt(young.avgMarketValue)}) betaler ${fmt(young.avgSalaryAfter)} · 34+ (værdi ${fmt(veteran.avgMarketValue)}) betaler ${fmt(veteran.avgSalaryAfter)} · før: ${fmt(young.avgSalaryBefore)} vs ${fmt(veteran.avgSalaryBefore)}`
        : "aldersgrupper mangler",
    },
    {
      // Den bløde bund må ikke knækkes: et medianhold i hver division skal stadig
      // kunne drive holdet uden at sælge.
      name: "G2 ingen divisions medianhold i minus",
      pass: divs.every((d) => d.medianNetAfter >= 0),
      detail: divs.map((d) => `D${d.division}=${fmt(d.medianNetAfter)}`).join(" · "),
    },
    {
      // Mekanisme 1 af 9. Overskyder den alene, er der intet tilbage til de otte
      // andre og økonomien vipper negativ når de lander.
      name: "G3 mekanisme 1 alene rammer IKKE net-målet (den skal levne plads til de 8 andre)",
      pass: avgNetAfter > TARGET_NET_PER_TEAM_PER_SEASON,
      detail: `net efter ${fmt(avgNetAfter)} pr. hold pr. sæson · mål ${fmt(TARGET_NET_PER_TEAM_PER_SEASON)} · mekanisme 1 lukker ${(((teamRows.reduce((s, t) => s + t.netBefore, 0) / teamRows.length) - avgNetAfter) / ((teamRows.reduce((s, t) => s + t.netBefore, 0) / teamRows.length) - TARGET_NET_PER_TEAM_PER_SEASON) * 100).toFixed(0)} % af hullet`,
    },
    {
      // Runaway-guard: én rytter må ikke koste mere end topdivisionens medianhold
      // får i sponsor. Over det er lønnen ikke længere en driftsomkostning.
      name: "G4 ingen enkeltløn over topdivisionens median-sponsor",
      pass: maxRiderSalary <= topSponsor,
      detail: `dyreste enkeltløn ${fmt(maxRiderSalary)} (${pct(maxRiderSalary, topSponsor)} af sponsor ${fmt(topSponsor)}) · eksplicit loft: ${model.ceiling ? fmt(model.ceiling) : "ingen"}`,
    },
  ];
  say("── Gates ──────────────────────────────────────────────────────────────────");
  for (const g of gates) say(`  ${g.pass ? "✅" : "❌"} ${g.name}\n       ${g.detail}`);
  say("");
  const allPass = gates.every((g) => g.pass);
  say(`HEADLINE: ${allPass ? "✅ alle gates grønne" : "❌ mindst én gate fejler"} — ejeren godkender kurven FØR merge.`);

  const outPath = argVal("out");
  if (outPath) {
    writeFileSync(outPath, out.join("\n") + "\n");
    console.log(`\n📝 skrevet til ${outPath}`);
  }
  if (!allPass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
