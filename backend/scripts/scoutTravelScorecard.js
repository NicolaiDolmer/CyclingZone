#!/usr/bin/env node
// #2244 Talentspejder Fase 3 (Slice D) — scout-travel-cost-scorecard. MERGE-GATE for
// Slice C (jf. plan docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md).
//
// Spørgsmål: hvor stor en andel af en aktiv managers sæson-indkomst æder standard-
// spejderomkostningerne (SCOUT_JOB_CONFIG defaults i backend/lib/scoutEngine.js)?
//
// GATE: for en "aktiv manager"-profil (2 målrettede opgaver/uge alternerende niveau-
// step + 1 mission/måned, begge til plan-defaults: 15.000 × niveau-step / 60.000 flat)
// skal samlet scouting-spend pr. sæson ligge i [2%, 15%] af typisk sæson-indkomst.
//
// "Typisk sæson-indkomst" — SAMME kilde som money-supply-/inflations-scorecardene
// (#1441 mønster): SPONSOR_INCOME_BY_DIVISION (economyConstants.js, prod-SSOT) +
// PRIZE_ESTIMATE_BY_DIVISION (facilityInvestmentModel.js — repræsentativ kompetent-
// hold-præmie, ejer-reviewet proxy, samme tal som money-supply/inflation/facility-
// scorecardene). Gross (sponsor+præmie), IKKE net efter løn/upkeep: "indkomst" er
// hvad holdet modtager, ikke hvad der er tilbage efter faste omkostninger — løn/upkeep
// er ikke discretionary-budgettet spejder-spend konkurrerer med.
//
// Sæson-længde: 10-12 uger (docs/i18n/GLOSSARY.md "Season"-definition) — 11 uger
// centralt scenarie + 10/12 som sensitivitet (uger→måneder for mission-kadence:
// uger/4,345).
//
// Sektion (A) er 100% syntetisk — ingen DB-kald, ingen mutation. Læser KUN de
// eksporterede konstanter (SCOUT_JOB_CONFIG, SPONSOR_INCOME_BY_DIVISION).
//   node scripts/scoutTravelScorecard.js [--markdown] [--mission-days=N]
//
// #3853 (opfølgning på #3846, "1-dags-missionen: skævvrider den scouting-
// økonomien?"): MISSIONS_PER_MONTH herunder er en KALENDER-baseret profil-
// antagelse ("en typisk aktiv manager kører ~1 mission/måned"), UAFHÆNGIG af
// missionens varighed — den ændrer sig IKKE når mission.days ændres, og det er
// bevidst (en spiller der logger ind månedligt gør det uanset om missionen tager
// 1 eller 2 dage). Den fanger derfor ALDRIG #3846-flaget: at kortere varighed
// halverer hvor hurtigt kapacitets-loftet (1 samtidig opgave, scoutCapacity())
// frigiver et nyt missions-slot for en spiller der ALTID har en opgave i kø.
// Sektion (B) herunder tilføjer netop DEN kadence-følsomme måling — teoretisk
// spend-LOFT (øvre grænse, ikke "typisk"), som en EKSPLICIT funktion af
// mission.days (input via --mission-days, default = live config). Sektion (C)
// måler fund-rate (finder missionen overhovedet nok kandidater?) mod ægte
// free-agent-population, read-only. Ingen af de to nye sektioner ændrer
// profil-gatens (A) PASS/FAIL eller exit-kode — de er informative målinger til
// ejer-review, ikke en ny merge-gate (ingen config-ændring i denne PR).
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { SCOUT_JOB_CONFIG } from "../lib/scoutEngine.js";
import { SPONSOR_INCOME_BY_DIVISION } from "../lib/economyConstants.js";
import { PRIZE_ESTIMATE_BY_DIVISION } from "./lib/facilityInvestmentModel.js";
import { filterCandidatePool } from "../lib/scoutMission.js";
import { defaultLoadCandidates } from "../lib/scoutMissionMaturation.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// #3853-mønster (inflationScorecard.js): "--navn=værdi" eller flag-only "--navn".
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const GATE_LO = 0.02;
const GATE_HI = 0.15;
const WEEKS_PER_MONTH = 4.345; // 52/12 — mønster: uger→måned-konvertering.
const DAYS_PER_MONTH = WEEKS_PER_MONTH * 7; // #3853: ~30,42 — kadence-udledningens basis.
const SEASON_WEEKS_SCENARIOS = [10, 11, 12]; // GLOSSARY.md: "10-12 uger"; 11 = centralt.

const TARGETED_JOBS_PER_WEEK = 2;
// "alternerende niveau" — annen uge-jobs skifter mellem niveau-step 1 og 2 (spec-tekst,
// Slice D-brief). Gennemsnitlig cost/job = (cost(step1)+cost(step2))/2.
const TARGETED_STEP_PATTERN = [1, 2];
// Kalender-profil (uændret af #3853, se filens toppkommentar) — IKKE kadence-udledt.
const MISSIONS_PER_MONTH = 1;

function targetedJobCost(step) {
  return step * SCOUT_JOB_CONFIG.target.costPerLevel;
}

function computeSeasonSpend(weeks) {
  const avgTargetedCostPerJob =
    TARGETED_STEP_PATTERN.reduce((s, step) => s + targetedJobCost(step), 0) / TARGETED_STEP_PATTERN.length;
  const weeklyTargetedSpend = TARGETED_JOBS_PER_WEEK * avgTargetedCostPerJob;
  const targetedSpendSeason = weeklyTargetedSpend * weeks;

  const months = weeks / WEEKS_PER_MONTH;
  const missionsInSeason = MISSIONS_PER_MONTH * months;
  const missionSpendSeason = missionsInSeason * SCOUT_JOB_CONFIG.mission.cost;

  const totalSpend = targetedSpendSeason + missionSpendSeason;
  return {
    weeks,
    avgTargetedCostPerJob,
    weeklyTargetedSpend,
    targetedSpendSeason,
    months,
    missionsInSeason,
    missionSpendSeason,
    totalSpend,
  };
}

function typicalSeasonIncomeByDivision() {
  const out = {};
  for (const d of [1, 2, 3]) {
    const sponsor = SPONSOR_INCOME_BY_DIVISION[d] || 0;
    const prize = PRIZE_ESTIMATE_BY_DIVISION[d] || 0;
    out[d] = { sponsor, prize, total: sponsor + prize };
  }
  return out;
}

// ── #3853 (B) TEORETISK SPEND-LOFT — kadence-følsom ──────────────────────────
// Missioner/måned for en spiller der ALTID har en opgave i kø: spejder-
// kapacitet (default 1, scoutCapacity() i scoutEngine.js) sætter hvor mange
// missioner der kan løbe SAMTIDIG, mission.days sætter hvor hurtigt et slot
// frigives igen. missionsPerMonth = kapacitet × (dage/måned ÷ mission.days) —
// EN FUNKTION af varigheden, i modsætning til (A)'s faste kalender-profil.
export function theoreticalMissionsPerMonth(missionDays, capacity = 1) {
  const days = Number(missionDays);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`theoreticalMissionsPerMonth: ugyldig missionDays "${missionDays}"`);
  }
  return capacity * (DAYS_PER_MONTH / days);
}

export function computeTheoreticalCeiling(weeks, missionDays, capacity = 1) {
  const months = weeks / WEEKS_PER_MONTH;
  const missionsPerMonth = theoreticalMissionsPerMonth(missionDays, capacity);
  const missionsInSeason = missionsPerMonth * months;
  const missionSpendSeason = missionsInSeason * SCOUT_JOB_CONFIG.mission.cost;
  return { weeks, missionDays, capacity, missionsPerMonth, missionsInSeason, missionSpendSeason };
}

function printTheoreticalCeilingSection(income, missionDaysInput) {
  console.log("── (B) #3853 TEORETISK SPEND-LOFT — kadence-følsom (kontinuerlig genkø, spejder-kapacitet=1) ──");
  console.log("Input: missionsvarighed (--mission-days, default = live SCOUT_JOB_CONFIG.mission.days) styrer hvor");
  console.log("hurtigt kapacitets-loftet frigiver et nyt missions-slot for en spiller der ALTID har en opgave i kø.");
  console.log("Dette er den ØVRE grænse (worst case), ikke profil-gatens \"typisk aktiv\"-antagelse ovenfor (A).\n");

  const isOverride = Number(missionDaysInput) !== SCOUT_JOB_CONFIG.mission.days;
  const central = computeTheoreticalCeiling(11, missionDaysInput);
  console.log(`  Missionsdage (input)         : ${missionDaysInput}${isOverride ? ` (OVERSTYRET — live config = ${SCOUT_JOB_CONFIG.mission.days})` : " (= live config)"}`);
  console.log(`  Missioner/måned (teoretisk)  : ${central.missionsPerMonth.toFixed(2)}`);
  console.log(`  Missioner/sæson (11 uger)    : ${central.missionsInSeason.toFixed(2)} × ${fmt(SCOUT_JOB_CONFIG.mission.cost)} = ${fmt(central.missionSpendSeason)}\n`);

  console.log("  Andel af typisk sæson-indkomst (KUN missions-spend ved kontinuerlig genkø, ingen målrettede opgaver):");
  const rows = [];
  for (const d of [1, 2, 3]) {
    const frac = central.missionSpendSeason / income[d].total;
    rows.push({ d, frac });
    console.log(`    D${d}: ${pct(frac)}`);
  }
  console.log();

  console.log("  Sammenligning: missionsvarighed FØR #3846 (2 dage) vs NU (1 dag) — samme kapacitet/cost:");
  const comparisons = [];
  for (const md of [2, 1]) {
    const c = computeTheoreticalCeiling(11, md);
    const cells = [1, 2, 3].map((d) => `D${d}=${pct(c.missionSpendSeason / income[d].total)}`);
    comparisons.push(c);
    console.log(`    ${md} dag(e): ${c.missionsPerMonth.toFixed(2)} missioner/måned → ${fmt(c.missionSpendSeason)}/sæson → ${cells.join("  ")}`);
  }
  console.log();

  return { central, rows, comparisons };
}

// ── #3853 (C) LIVE READ-ONLY — fund-rate mod ægte free-agent-population ──────
// Genbruger den FAKTISKE prod-kandidat-loader (scoutMissionMaturation.
// defaultLoadCandidates) og den FAKTISKE filter-funktion (scoutMission.
// filterCandidatePool) — ingen reimplementering, ingen model-drift. Report-
// pattern (samme som relegationParachuteScorecard.js): springes gracefully
// over uden creds. Denne funktion kalder KUN .select()/.eq() (aldrig .insert/
// .update/.delete/.upsert) — ingen mutation, uanset hvilken nøgle der bruges.
//
// #3853-fund: den delte .codex.local/supabase-readonly.env-nøgle (mønsteret i
// relegationParachuteScorecard.js) fejler HER med "permission denied for
// function is_offered_intake_rider" — readonly-rollen mangler EXECUTE på den
// RLS-policy-funktion `riders`-tabellens "Public read riders"-policy kalder
// (scoutMissionMaturation.js's egen kommentar navngiver den samme funktion).
// Verificeret 2026-09-03, ikke rettet her (grant-ændring er ude af scope for
// en audit-PR) — se docs/audits/scout-cadence-2026-09-03.md. Falder derfor
// tilbage til worktree'ets backend/.env (SUPABASE_SERVICE_KEY, jf. opgave-
// briefen) for netop DENNE sektion — stadig kun SELECT, aldrig skriv.
async function printFundRateSection() {
  console.log("── (C) #3853 LIVE READ-ONLY — fund-rate mod ægte free-agent-population ──");
  dotenv.config({
    path: path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env"),
    quiet: true,
  });
  const readonlyUrl = process.env.SUPABASE_URL;
  const readonlyKey = process.env.SUPABASE_READONLY_KEY;

  // Samme opslag som scoutMissionMaturation's (ueksporterede) resolveSeasonNumber
  // (aktiv sæson, intet seasonId at forankre til her) — uden en sæson giver
  // ageForSeason null tilbage for ALLE ryttere, og u23-scopet ville fejlagtigt
  // se ud som en tom pool (0 kandidater) uanset den faktiske aldersfordeling.
  async function resolveActiveSeasonNumber(supabase) {
    const { data, error } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
    if (error) throw new Error(`aktiv sæson-opslag fejlede: ${error.message}`);
    return data?.number ?? null;
  }

  let candidates = null;
  let keySource = null;
  let lastError = null;

  if (readonlyUrl && readonlyKey) {
    try {
      const supabase = createClient(readonlyUrl, readonlyKey);
      const seasonNumber = await resolveActiveSeasonNumber(supabase);
      candidates = await defaultLoadCandidates(supabase, "free_agents", seasonNumber);
      keySource = ".codex.local/supabase-readonly.env (SUPABASE_READONLY_KEY)";
    } catch (e) {
      lastError = e;
      console.log(`  .codex.local/supabase-readonly.env FEJLEDE: ${e.message}`);
      console.log("  → falder tilbage til backend/.env (SUPABASE_SERVICE_KEY, kun SELECT-kald i dette script)…");
    }
  }

  if (!candidates) {
    dotenv.config({ path: path.resolve(SCRIPT_DIR, "../.env"), quiet: true });
    const envUrl = process.env.SUPABASE_URL;
    const envKey = process.env.SUPABASE_SERVICE_KEY;
    if (!envUrl || !envKey) {
      if (!readonlyUrl || !readonlyKey) {
        console.log("  SPRUNGET OVER (mangler SUPABASE_URL + SUPABASE_READONLY_KEY/SUPABASE_SERVICE_KEY).\n");
      } else {
        console.log(`  SPRUNGET OVER (readonly-nøglen fejlede, og backend/.env mangler SUPABASE_URL/SUPABASE_SERVICE_KEY): ${lastError?.message}\n`);
      }
      return null;
    }
    try {
      const supabase = createClient(envUrl, envKey);
      const seasonNumber = await resolveActiveSeasonNumber(supabase);
      candidates = await defaultLoadCandidates(supabase, "free_agents", seasonNumber);
      keySource = "backend/.env (SUPABASE_SERVICE_KEY, kun SELECT-kald i dette script)";
    } catch (e) {
      console.log(`  FEJLEDE (læses ikke som et gate-fail — ejer-review): ${e.message}\n`);
      return null;
    }
  }
  console.log(`  Nøgle: ${keySource}`);

  const shortlistMin = SCOUT_JOB_CONFIG.mission.shortlistMin;
  const shortlistMax = SCOUT_JOB_CONFIG.mission.shortlistMax;
  console.log(`  Free-agent-pool (samme query som prod defaultLoadCandidates): ${candidates.length} ryttere\n`);

  const rows = [];
  for (const type of RIDER_TYPE_KEYS) {
    const pool = filterCandidatePool(candidates, { scope: "type", value: type });
    rows.push({ scope: `type=${type}`, size: pool.length });
  }
  const u23Pool = filterCandidatePool(candidates, { scope: "u23", value: null });
  rows.push({ scope: "u23", size: u23Pool.length });

  // Top-5 nationaliteter efter faktisk population (repræsentative country/nm-scopes
  // — der er ingen fast liste af "gyldige" lande, missionen accepterer enhver
  // nationality_code der findes i poolen).
  const countryCounts = new Map();
  for (const r of candidates) {
    if (!r.country) continue;
    countryCounts.set(r.country, (countryCounts.get(r.country) || 0) + 1);
  }
  const topCountries = [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  for (const country of topCountries) {
    const countryPool = filterCandidatePool(candidates, { scope: "country", value: country });
    rows.push({ scope: `country=${country}`, size: countryPool.length });
    const nmPool = filterCandidatePool(candidates, { scope: "nm", value: country });
    rows.push({ scope: `nm=${country}`, size: nmPool.length });
  }

  console.log(`  Scope-værdi              Pool-størrelse   Finder shortlist (≥${shortlistMin} kandidater)?`);
  for (const r of rows) {
    const ok = r.size >= shortlistMin;
    console.log(`  ${r.scope.padEnd(25)} ${String(r.size).padEnd(16)} ${ok ? "✅ ja" : "❌ nej (for smal)"}`);
  }

  const fundRate = rows.filter((r) => r.size >= shortlistMin).length / rows.length;
  console.log(`\n  Fund-rate (andel af testede scope-værdier med ≥${shortlistMin} kandidater lige nu): ${pct(fundRate)}\n`);

  const nonEmpty = rows.filter((r) => r.size > 0);
  let depletion = null;
  if (nonEmpty.length) {
    const narrowest = nonEmpty.reduce((a, b) => (a.size < b.size ? a : b));
    // #4058: hver mission ekskluderer permanent op til shortlistMax ryttere for
    // DET hold — et hold der spammer PRÆCIS samme scope udtømmer poolen efter
    // ca. size/shortlistMax missioner (gulv shortlistMin, hvorunder shortlisten
    // aldrig kan fyldes, mission returnerer tom).
    const missionsBeforeDepletion = Math.max(1, Math.ceil((narrowest.size - shortlistMin + 1) / shortlistMax));
    console.log(`  Smalleste testede scope: ${narrowest.scope} (${narrowest.size} kandidater lige nu).`);
    console.log(`  Ét hold der spammer PRÆCIS denne scope (samme kriterie hver gang) udtømmer poolen under`);
    console.log(`  shortlistMin efter ca. ${missionsBeforeDepletion} missioner (#4058-eksklusion, ${shortlistMax} fjernet/mission).`);
    for (const md of [2, 1]) {
      const seasonMissions = computeTheoreticalCeiling(11, md).missionsInSeason;
      const depletesInSeason = missionsBeforeDepletion < seasonMissions;
      console.log(`    Ved ${md}-dags kadence: ${seasonMissions.toFixed(1)} missioner/sæson teoretisk muligt → udtømning ${depletesInSeason ? "SKER inden sæson-slut" : "sker IKKE inden sæson-slut"}.`);
    }
    depletion = { narrowest, missionsBeforeDepletion };
  }
  console.log();

  return { candidatesCount: candidates.length, rows, fundRate, depletion };
}

async function main() {
  const markdown = process.argv.includes("--markdown");
  const missionDaysInput = Number(arg("mission-days", SCOUT_JOB_CONFIG.mission.days));

  console.log("=== #2244 SCOUT-TRAVEL-COST-SCORECARD (Slice D — merge-gate FØR Slice C) — (A) PROFIL-GATE ===\n");
  console.log("Aktiv-manager-profil (plan-defaults, docs/superpowers/plans/2026-07-10-talentspejder-fase-3.md):");
  console.log(`  • Målrettede opgaver : ${TARGETED_JOBS_PER_WEEK}/uge, alternerende niveau-step [${TARGETED_STEP_PATTERN.join(",")}] à ${fmt(SCOUT_JOB_CONFIG.target.costPerLevel)}/step`);
  console.log(`  • Missioner          : ${MISSIONS_PER_MONTH}/måned à ${fmt(SCOUT_JOB_CONFIG.mission.cost)} (flat)`);
  console.log(`  • Sæson-længde       : ${SEASON_WEEKS_SCENARIOS.join("-")} uger (docs/i18n/GLOSSARY.md), 11 = centralt scenarie\n`);

  console.log("Antagelser (eksplicitte — ejer sanity-tjekker):");
  console.log(`  • Typisk sæson-indkomst = sponsor + præmie-estimat (GROSS, ikke net efter løn/upkeep)`);
  console.log(`  • Præmie-estimat (BLØDT, samme proxy som money-supply-/inflations-/facility-scorecardene):`);
  const income = typicalSeasonIncomeByDivision();
  for (const d of [1, 2, 3]) {
    console.log(`      D${d}: sponsor ${fmt(income[d].sponsor)} + præmie ${fmt(income[d].prize)} = ${fmt(income[d].total)}/sæson`);
  }
  console.log();

  console.log("── Sæson-spend (centralt scenarie: 11 uger) ──");
  const central = computeSeasonSpend(11);
  console.log(`  Målrettede opgaver : ${fmt(central.avgTargetedCostPerJob)}/job (gnsn.) × ${TARGETED_JOBS_PER_WEEK}/uge × ${central.weeks} uger = ${fmt(central.targetedSpendSeason)}`);
  console.log(`  Missioner          : ${central.missionsInSeason.toFixed(2)} missioner (${central.months.toFixed(2)} måneder × 1/måned) × ${fmt(SCOUT_JOB_CONFIG.mission.cost)} = ${fmt(central.missionSpendSeason)}`);
  console.log(`  Total spend/sæson  : ${fmt(central.totalSpend)}\n`);

  console.log("── GATE: scouting-spend ∈ [2%, 15%] af typisk sæson-indkomst — pr. division ──");
  let allPass = true;
  const rows = [];
  for (const d of [1, 2, 3]) {
    const frac = central.totalSpend / income[d].total;
    const gatePass = frac >= GATE_LO && frac <= GATE_HI;
    if (!gatePass) allPass = false;
    rows.push({ d, frac, gatePass });
    console.log(`  D${d}: spend ${fmt(central.totalSpend)} / indkomst ${fmt(income[d].total)} = ${pct(frac)} ${gatePass ? "✅ PASS" : "❌ FAIL"} (mål [${pct(GATE_LO)}, ${pct(GATE_HI)}])`);
  }
  console.log(`  Gate [alle divisioner ∈ bånd]: ${allPass ? "✅ PASS" : "❌ FAIL — spend-defaults for høje/lave relativt til indkomst"}\n`);

  console.log("── Sensitivitet — sæson-længde (10/11/12 uger) ──");
  for (const weeks of SEASON_WEEKS_SCENARIOS) {
    const s = computeSeasonSpend(weeks);
    const cells = [1, 2, 3].map((d) => `D${d}=${pct(s.totalSpend / income[d].total)}`);
    console.log(`  ${weeks} uger: total ${fmt(s.totalSpend)} → ${cells.join("  ")}`);
  }
  console.log();

  if (!allPass) {
    console.log("── FORSLAG (kun til ejer-review — landes IKKE her) ──");
    console.log("  Defaults uændrede (plan-instruks: gate-fail ⇒ dokumentér, ikke rekalibrér).");
    console.log("  Kandidat-justeringer (illustrative, vælg ÉN retning ved review):");
    // Find det multiplum af nuværende defaults der ville centre D2 (mid-tier-reference)
    // midt i båndet (~8,5%).
    const targetFrac = (GATE_LO + GATE_HI) / 2;
    const targetSpendD2 = income[2].total * targetFrac;
    const scaleFactor = targetSpendD2 / central.totalSpend;
    console.log(`    • Skalér BEGGE costs med ×${scaleFactor.toFixed(2)} (target ${fmt(SCOUT_JOB_CONFIG.target.costPerLevel * scaleFactor)}/step, mission ${fmt(SCOUT_JOB_CONFIG.mission.cost * scaleFactor)}) → D2-spend centreres ~${pct(targetFrac)}`);
    console.log(`    • ELLER reducér frekvens-antagelsen (denne er en model-profil, ikke en hård cap — spillere kan spende mindre)`);
    console.log(`    • ELLER accepter som top-of-range for en MEGET aktiv manager (båndet er til "typisk", ikke "max")\n`);
  }

  console.log("──────────────────────────────────────────────────────────────────────\n");

  // #3853: (B) og (C) er informative målinger — de ændrer IKKE allPass/exit-koden
  // ovenfor (ingen config-ændring i denne PR, se filens toppkommentar).
  const theoretical = printTheoreticalCeilingSection(income, missionDaysInput);
  const fundRateResult = await printFundRateSection();

  console.log("──────────────────────────────────────────────────────────────────────");
  console.log(`HEADLINE: scout-travel-cost-gate ${allPass ? "✅ PASS — Slice-D-krav opfyldt" : "❌ FAIL — se FORSLAG ovenfor, ejer-review krævet"}`);
  console.log("NOTE: dette er en model-profil (BLØDT input, aftalt i Slice-D-briefen) — ikke en hård spend-cap i spillet.\n");
  // #2854 (backwards-check): headline-verdicten skal også nå exit-koden — ellers
  // ser en caller/CI succes på en kørsel der printede FAIL.
  process.exitCode = allPass ? 0 : 1;

  if (markdown) {
    console.log("### Markdown-summary\n");
    console.log("| Division | Indkomst | Spend | Andel | Gate |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| D${r.d} | ${fmt(income[r.d].total)} | ${fmt(central.totalSpend)} | ${pct(r.frac)} | ${r.gatePass ? "PASS" : "FAIL"} |`);
    }
    console.log();
  }

  return { allPass, central, income, rows, theoretical, fundRateResult };
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
