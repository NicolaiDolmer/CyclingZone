// #3449/#3750 · Niveau-korrektionens EJER-GATEDE ENGANGS-KØRSEL.
//
// Kør fra backend/ (dotenv/config forventer backend/.env i cwd):
//
//   node scripts/marketValueLevelCorrectionApply.js --dry-run
//   node scripts/marketValueLevelCorrectionApply.js --confirm-apply
//
// DRY-RUN (default, også uden flag) er 100% read-only: henter den seneste
// søndags-gate-måling (backend/lib/marketValueLevelCorrectionGate.js), og hvis
// den er GRØN, printer den fulde populations-delta-rapport (samlet trupværdi
// før/efter, pr. division, pr. aldersbånd, de 10 største absolutte fald) uden
// at skrive noget. Er gaten IKKE grøn, printer scriptet hvorfor og stopper.
//
// --confirm-apply er den FAKTISKE mutation. Den NÆGTER at køre hvis:
//   (1) gaten er RØD (se decideApplyAllowed) — c må ALDRIG hardkodes, den
//       læses fra gate-log'ens c_candidate ved fyrings-tidspunktet, aldrig fra
//       et argument eller en tidligere måling.
//   (2) --confirm-apply ikke er sat (dry-run "godkendelse" er selve flaget —
//       der findes bevidst ingen separat lagret "ejeren har godkendt"-tilstand,
//       fordi den ville kunne blive stående og trigge en senere kørsel uden
//       et nyt bevidst valg).
//
// Når den kører, skriver den i denne rækkefølge (bedst-mulig atomicitet —
// Supabase-JS har ingen tværtabel-transaktion; samme afvejning som
// marketValueSundaySweep.js's claim-så-skriv-så-fuldfør-mønster):
//   1. riders.base_value := round(current_value × c) for hele populationen
//   2. per-rytter-kvittering (market_value_level_correction_rider_receipts)
//   3. neutralitets-bundtet: youth-rate-override (a) + wage-A (b, no-op indtil
//      #3393 shipper — se marketValueLevelCorrectionConfig.js's kommentar)
//   4. apply-log-raekken (market_value_level_correction_apply_log)
//   5. ÉN notifikation pr. hold med mindst én ændret rytter
// Fejler et sent trin, er værdierne allerede skrevet — konsolen + Sentry gør
// fejlen højlydt, samme filosofi som resten af #3448/#3449-familien.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { RIDER_BASE_VALUE_FALLBACK } from "../lib/marketUtils.js";
import { LEVEL_CORRECTION_GATE_LOG_TABLE } from "../lib/marketValueLevelCorrectionGate.js";
import {
  computeDrainNeutralRate,
  computeWageNeutralA,
} from "../lib/marketValueLevelCorrectionNeutrality.js";
import {
  MARKET_VALUE_LEVEL_CORRECTION_YOUTH_RATE_OVERRIDE_KEY,
  MARKET_VALUE_LEVEL_CORRECTION_WAGE_ANCHOR_A_KEY,
  readWageAnchorA,
} from "../lib/marketValueLevelCorrectionConfig.js";
import { YOUTH_AUCTION_START_RATE } from "../lib/youthMarket.js";
import { notifyTeamOwner } from "../lib/notificationService.js";

export const MARKET_VALUE_LEVEL_CORRECTION_NOTIFICATION_TYPE = "market_value_level_correction";

const WRITE_CONCURRENCY = 25;
const AGE_BANDS = [
  { key: "<23", test: (a) => a < 23 },
  { key: "23-25", test: (a) => a >= 23 && a < 26 },
  { key: "26-28", test: (a) => a >= 26 && a < 29 },
  { key: "29-31", test: (a) => a >= 29 && a < 32 },
  { key: "32+", test: (a) => a >= 32 },
];

export function ageBandKey(age) {
  if (!Number.isFinite(age)) return "ukendt";
  const band = AGE_BANDS.find((b) => b.test(age));
  return band ? band.key : "ukendt";
}

/**
 * Refusér-beslutningen — ren funktion, testbar uden DB. Se filens header for
 * de to selvstændige nægtelsesgrunde.
 */
export function decideApplyAllowed({ gate, confirmApply }) {
  if (!gate || gate.gate_status !== "green") {
    return { allowed: false, reason: "gate_not_green", gateStatus: gate?.gate_status ?? null };
  }
  if (!Number.isFinite(Number(gate.c_candidate)) || Number(gate.c_candidate) <= 0) {
    return { allowed: false, reason: "no_c_candidate" };
  }
  if (!confirmApply) {
    return { allowed: false, reason: "dry_run_not_approved" };
  }
  return { allowed: true, c: Number(gate.c_candidate) };
}

/**
 * Fuld dry-run-rapport for én rytter-population — ren funktion.
 * @param {Array<{id, current_value:number, division:number|null, age:number|null}>} rows
 * @param {number} c
 */
export function buildDryRunReport(rows, c) {
  let totalBefore = 0, totalAfter = 0;
  const byDivision = new Map();
  const byAgeBand = new Map();
  const drops = [];

  for (const r of rows) {
    const before = Number(r.current_value) || 0;
    const after = Math.max(1, Math.round(before * c));
    totalBefore += before;
    totalAfter += after;

    const divKey = r.division ?? "ukendt";
    const dAcc = byDivision.get(divKey) || { n: 0, before: 0, after: 0 };
    dAcc.n += 1; dAcc.before += before; dAcc.after += after;
    byDivision.set(divKey, dAcc);

    const bandKey = ageBandKey(r.age);
    const bAcc = byAgeBand.get(bandKey) || { n: 0, before: 0, after: 0 };
    bAcc.n += 1; bAcc.before += before; bAcc.after += after;
    byAgeBand.set(bandKey, bAcc);

    drops.push({ id: r.id, before, after, delta: after - before });
  }

  drops.sort((a, b) => a.delta - b.delta); // mest negative først
  const top10Drops = drops.slice(0, 10);

  const pct = (before, after) => (before > 0 ? (after - before) / before : 0);

  return {
    c,
    populationSize: rows.length,
    totalBefore,
    totalAfter,
    totalDeltaPct: pct(totalBefore, totalAfter),
    byDivision: [...byDivision.entries()].map(([division, v]) => ({
      division, n: v.n, before: v.before, after: v.after, deltaPct: pct(v.before, v.after),
    })),
    byAgeBand: [...byAgeBand.entries()].map(([band, v]) => ({
      band, n: v.n, before: v.before, after: v.after, deltaPct: pct(v.before, v.after),
    })),
    top10Drops,
  };
}

export async function fetchLatestGate({ supabase }) {
  const { data, error } = await supabase
    .from(LEVEL_CORRECTION_GATE_LOG_TABLE)
    .select("*")
    .not("completed_at", "is", null)
    .order("measured_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fetchLatestGate: ${error.message}`);
  return data;
}

// Samme population-definition som marketValueSundaySweep.js's defaultFetchPopulation
// (ejede + AI, ikke test/frosset/bank, ikke retired/academy) — se den fils
// kommentar for hvorfor AI-hold er med.
async function fetchCorrectionPopulation({ supabase, seasonNumber }) {
  const allTeams = await fetchAllRows(() => supabase
    .from("teams").select("id, division, is_test_account, is_frozen, is_bank").order("id"));
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const realTeamIds = new Set(
    allTeams.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank).map((t) => t.id)
  );

  const allRiders = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, birthdate, base_value, market_value, is_retired, is_academy")
    .order("id"));

  return allRiders
    .filter((r) => r.team_id != null && realTeamIds.has(r.team_id) && !r.is_retired && !r.is_academy)
    .map((r) => {
      const current_value = Number(r.base_value) > 0 ? Number(r.base_value) : (Number(r.market_value) || RIDER_BASE_VALUE_FALLBACK);
      const age = r.birthdate ? ageForSeason(r.birthdate, seasonNumber) : null;
      return { id: r.id, team_id: r.team_id, division: teamById.get(r.team_id)?.division ?? null, current_value, age };
    });
}

async function fetchActiveSeasonNumber({ supabase }) {
  const { data, error } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`fetchActiveSeasonNumber: ${error.message}`);
  return data?.number ?? null;
}

/**
 * Read-only dry-run-rapport til admin-UI + CLI'ens dry-run-gren — deler ÉN
 * kilde til "gate ikke grøn ⇒ intet at vise" i stedet for at duplikere
 * beslutningen to steder. Skriver INTET, kalder aldrig writeRiderValues.
 */
export async function getDryRunReport({ supabase }) {
  const gate = await fetchLatestGate({ supabase });
  if (!gate || gate.gate_status !== "green" || !Number.isFinite(Number(gate.c_candidate))) {
    return { status: "not_green", gate };
  }
  const seasonNumber = await fetchActiveSeasonNumber({ supabase });
  const population = await fetchCorrectionPopulation({ supabase, seasonNumber });
  const report = buildDryRunReport(population, Number(gate.c_candidate));
  return { status: "ok", gate, report };
}

async function writeRiderValues(supabase, rows, c) {
  let written = 0;
  const receipts = [];
  for (let i = 0; i < rows.length; i += WRITE_CONCURRENCY) {
    const batch = rows.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (r) => {
      const newValue = Math.max(1, Math.round(r.current_value * c));
      if (newValue === r.current_value) return { id: r.id, changed: false, error: null };
      const { error } = await supabase.from("riders").update({ base_value: newValue }).eq("id", r.id);
      return { id: r.id, changed: true, error, oldValue: r.current_value, newValue, teamId: r.team_id };
    }));
    for (const res of results) {
      if (res.error) throw new Error(`marketValueLevelCorrectionApply riders update ${res.id}: ${res.error.message}`);
      if (res.changed) { receipts.push(res); written += 1; }
    }
  }
  return { written, receipts };
}

async function writeReceipts(supabase, applyLogId, receipts, c) {
  for (let i = 0; i < receipts.length; i += WRITE_CONCURRENCY) {
    const batch = receipts.slice(i, i + WRITE_CONCURRENCY);
    const { error } = await supabase.from("market_value_level_correction_rider_receipts").insert(
      batch.map((r) => ({ apply_log_id: applyLogId, rider_id: r.id, old_value: r.oldValue, new_value: r.newValue, c }))
    );
    if (error) throw new Error(`marketValueLevelCorrectionApply receipts insert: ${error.message}`);
  }
}

/**
 * Selve engangs-kørslen. Refuserer via decideApplyAllowed() FØR nogen skrivning.
 * @param {object} args
 * @param {object} args.supabase
 * @param {boolean} args.confirmApply
 * @param {Date} [args.now]
 */
export async function runMarketValueLevelCorrectionApply({
  supabase,
  confirmApply = false,
  now = new Date(),
  notify = notifyTeamOwner,
  log = console.log,
  // Injicerbare test-seams (samme mønster som marketValueSundaySweep.js) —
  // lader tests injicere simple funktioner i stedet for at skulle bygge en
  // fuld .range()-kompatibel Supabase-query-mock for fetchAllRows.
  fetchGate = fetchLatestGate,
  fetchSeasonNumber = fetchActiveSeasonNumber,
  fetchPopulation = fetchCorrectionPopulation,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const gate = await fetchGate({ supabase });
  const decision = decideApplyAllowed({ gate, confirmApply });
  if (!decision.allowed) {
    log(`market-value-level-correction-apply: NÆGTET (${decision.reason}) — gate-status=${decision.gateStatus ?? gate?.gate_status ?? "ingen måling endnu"}`);
    return { applied: false, ...decision };
  }
  const c = decision.c;

  const seasonNumber = await fetchSeasonNumber({ supabase });
  const population = await fetchPopulation({ supabase, seasonNumber });
  const report = buildDryRunReport(population, c);

  log(`market-value-level-correction-apply: c=${c} · population=${population.length} · Σ ${report.totalBefore.toLocaleString("da-DK")} → ${report.totalAfter.toLocaleString("da-DK")} (${(report.totalDeltaPct * 100).toFixed(1)}%)`);

  // ── 1. Rytter-værdier ──
  const { written, receipts } = await writeRiderValues(supabase, population, c);

  // ── 2. Neutralitets-bundtet ──
  const bankRateBefore = YOUTH_AUCTION_START_RATE;
  const bankRateAfter = computeDrainNeutralRate(bankRateBefore, c);
  const { error: rateErr } = await supabase.from("app_config")
    .update({ value: bankRateAfter }).eq("key", MARKET_VALUE_LEVEL_CORRECTION_YOUTH_RATE_OVERRIDE_KEY);
  if (rateErr) throw new Error(`marketValueLevelCorrectionApply bank-rate update: ${rateErr.message}`);

  const wageABefore = await readWageAnchorA(supabase);
  let wageAAfter = null;
  let wageLegApplied = false;
  if (wageABefore != null) {
    wageAAfter = computeWageNeutralA(wageABefore, c);
    const { error: wageErr } = await supabase.from("app_config")
      .update({ value: wageAAfter }).eq("key", MARKET_VALUE_LEVEL_CORRECTION_WAGE_ANCHOR_A_KEY);
    if (wageErr) throw new Error(`marketValueLevelCorrectionApply wage-A update: ${wageErr.message}`);
    wageLegApplied = true;
  } else {
    log("  ⚠️  løn-neutral A er en NO-OP: ingen anker-baseret løn-A-nøgle fundet (#3393 er ikke shippet endnu på denne branch).");
  }

  // ── 3. Apply-log ──
  const { data: applyLog, error: logErr } = await supabase
    .from("market_value_level_correction_apply_log")
    .insert({
      applied_at: now.toISOString(),
      c,
      gate_measured_date: gate.measured_date,
      population_size: population.length,
      riders_changed: written,
      total_value_before: report.totalBefore,
      total_value_after: report.totalAfter,
      bank_rate_before: bankRateBefore,
      bank_rate_after: bankRateAfter,
      wage_a_before: wageABefore,
      wage_a_after: wageAAfter,
      wage_leg_applied: wageLegApplied,
    })
    .select()
    .single();
  if (logErr) throw new Error(`marketValueLevelCorrectionApply apply-log insert: ${logErr.message}`);

  // ── 4. Per-rytter-kvitteringer (#3733 trin 1) ──
  await writeReceipts(supabase, applyLog.id, receipts, c);

  // ── 5. ÉN notifikation pr. hold med mindst én ændret rytter ──
  const teamsChanged = new Map();
  for (const r of receipts) {
    teamsChanged.set(r.teamId, (teamsChanged.get(r.teamId) || 0) + 1);
  }
  let notified = 0;
  for (const [teamId, count] of teamsChanged) {
    if (!teamId) continue;
    await notify({
      supabase,
      teamId,
      type: MARKET_VALUE_LEVEL_CORRECTION_NOTIFICATION_TYPE,
      title: "Sunday value update",
      message: `Sunday value update: ${count} riders moved. / Søndags-værdiopdatering: ${count} ryttere flyttede sig.`,
      metadata: { titleCode: "notifications.marketValueLevelCorrection.title", messageCode: "notifications.marketValueLevelCorrection.message", messageParams: { count } },
      now,
    });
    notified += 1;
  }

  return {
    applied: true,
    c,
    populationSize: population.length,
    ridersChanged: written,
    teamsNotified: notified,
    report,
    applyLogId: applyLog.id,
    wageLegApplied,
  };
}

const args = process.argv.slice(2);
const CONFIRM_APPLY = args.includes("--confirm-apply");

async function main() {
  console.log("=== Niveau-korrektionens engangs-kørsel (#3449/#3750) ===");
  console.log(CONFIRM_APPLY ? "MODE: --confirm-apply (SKRIVER til databasen)" : "MODE: dry-run (read-only, default)");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  if (!CONFIRM_APPLY) {
    const { status, gate, report } = await getDryRunReport({ supabase });
    if (status !== "ok") {
      console.log(`\nGate-status: ${gate?.gate_status?.toUpperCase() ?? "INGEN MÅLING ENDNU"} — ${gate?.gate_reason_text ?? "kør søndags-gate-sweepet mindst én gang."}`);
      console.log("Ingen dry-run-rapport uden en grøn måling (c_candidate findes ikke).");
      return;
    }
    console.log(`\nGate: GRØN (${gate.gate_reason_text})`);
    console.log(`c = ${report.c}`);
    console.log(`Population: ${report.populationSize}`);
    console.log(`Σ værdi FØR:  ${report.totalBefore.toLocaleString("da-DK")}`);
    console.log(`Σ værdi EFTER: ${report.totalAfter.toLocaleString("da-DK")}`);
    console.log(`Delta: ${(report.totalDeltaPct * 100).toFixed(2)}%`);
    console.log("\nPr. division:");
    for (const d of report.byDivision) console.log(`  D${d.division}: n=${d.n} ${d.before.toLocaleString("da-DK")} → ${d.after.toLocaleString("da-DK")} (${(d.deltaPct * 100).toFixed(1)}%)`);
    console.log("\nPr. aldersbånd:");
    for (const b of report.byAgeBand) console.log(`  ${b.band}: n=${b.n} ${b.before.toLocaleString("da-DK")} → ${b.after.toLocaleString("da-DK")} (${(b.deltaPct * 100).toFixed(1)}%)`);
    console.log("\n10 største absolutte fald:");
    for (const t of report.top10Drops) console.log(`  ${t.id}: ${t.before.toLocaleString("da-DK")} → ${t.after.toLocaleString("da-DK")} (${t.delta.toLocaleString("da-DK")})`);
    console.log("\n(dry-run — INTET skrevet. Kør med --confirm-apply for faktisk at anvende korrektionen.)");
    return;
  }

  const result = await runMarketValueLevelCorrectionApply({ supabase, confirmApply: true, now: new Date() });
  if (!result.applied) {
    console.error(`\nNÆGTET: ${result.reason}`);
    process.exit(1);
  }
  console.log(`\n✅ Anvendt: c=${result.c}, ${result.ridersChanged}/${result.populationSize} ryttere ændret, ${result.teamsNotified} hold notificeret, wageLegApplied=${result.wageLegApplied}.`);
}

if (process.argv[1] && process.argv[1].endsWith("marketValueLevelCorrectionApply.js")) {
  main().catch((e) => {
    console.error("FEJL:", e);
    process.exit(1);
  });
}
