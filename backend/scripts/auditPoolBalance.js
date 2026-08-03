#!/usr/bin/env node
// #2557 / #2574 · Read-only audit af PULJE-STYRKE-BALANCE pr. tier.
//
// Baggrund: docs/audits/2026-08-03-team-dominance-2557.md. Hold-dominansen
// (share4PlusSameTeamTop10 rød) kommer ikke fra race-motoren men fra at
// pulje-tildelingen i economyEngine.processDivisionEnd er styrke-BLIND:
// destinationspuljen er en ren funktion af pool_index-træet (oprykning) hhv.
// round-robin (nedrykning). Målt 3/8 stod 3 af 15 puljer for 72% af alle
// bånd-brud i spillet.
//
// Scriptet MUTERER INTET. Det læser hold + ryttere + afledte evner, beregner
// skævheden pr. tier og printer hvad en styrke-balanceret snake-reseed VILLE
// flytte. Beslutningen om at udføre en reseed er ejer-gated og kræver en
// sim-harness-kørsel først (simulér-før-ship, fast politik) — dette script er
// beslutningsgrundlaget, ikke handlingen.
//
// Usage:
//   node backend/scripts/auditPoolBalance.js              # human-readable
//   node backend/scripts/auditPoolBalance.js --json       # JSON
//   node backend/scripts/auditPoolBalance.js --tier 3     # kun én tier
//   node backend/scripts/auditPoolBalance.js --threshold 8
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Exit: 1 hvis mindst én tier er over tærsklen, 0 ellers.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  teamStrength,
  poolStrengthStats,
  tierImbalanceIndex,
  evaluateTierBalance,
  DEFAULT_RESEED_THRESHOLD,
} from "../lib/poolBalance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Rytterens "peak" = max over de discipliner der afgør en etapesejr. Samme
 *  definition som audit-dokumentets tal, så tallene her kan sammenlignes 1:1. */
export function riderPeak(abilities = {}) {
  return Math.max(
    abilities.flat ?? 0,
    abilities.climbing ?? 0,
    abilities.sprint ?? 0,
    abilities.time_trial ?? 0,
    abilities.punch ?? 0,
    abilities.cobblestone ?? 0,
  );
}

/**
 * Fold rå rækker til poolBalance-lib'ens input. Ren funktion (eksporteret for
 * testbarhed) — I/O sker i main().
 *
 * @param {Array<{id, league_division_id, is_ai, is_bank, is_test_account}>} teams
 * @param {Array<{id, team_id, is_retired}>} riders
 * @param {Map<string, object>} abilitiesByRider
 * @param {Map<number, {tier:number, pool_index:number}>} poolsById
 */
export function buildTierInputs(teams, riders, abilitiesByRider, poolsById) {
  const peaksByTeam = new Map();
  for (const r of riders) {
    if (r.is_retired) continue;
    if (!r.team_id) continue;
    const ab = abilitiesByRider.get(r.id);
    if (!ab) continue;
    if (!peaksByTeam.has(r.team_id)) peaksByTeam.set(r.team_id, []);
    peaksByTeam.get(r.team_id).push(riderPeak(ab));
  }

  const byTier = new Map();
  for (const t of teams) {
    if (t.is_bank) continue;
    if (t.league_division_id == null) continue;
    const pool = poolsById.get(t.league_division_id);
    if (!pool) continue;
    const riderPeaks = peaksByTeam.get(t.id) || [];
    const entry = {
      teamId: t.id,
      teamName: t.name,
      isAi: !!t.is_ai,
      poolId: t.league_division_id,
      riderPeaks,
      strength: teamStrength(riderPeaks),
    };
    if (!byTier.has(pool.tier)) byTier.set(pool.tier, []);
    byTier.get(pool.tier).push(entry);
  }
  return byTier;
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  const tierIdx = argv.indexOf("--tier");
  const thrIdx = argv.indexOf("--threshold");
  return {
    json,
    onlyTier: tierIdx >= 0 ? Number(argv[tierIdx + 1]) : null,
    threshold: thrIdx >= 0 ? Number(argv[thrIdx + 1]) : DEFAULT_RESEED_THRESHOLD,
  };
}

async function main() {
  const { json, onlyTier, threshold } = parseArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (backend/.env).");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [pools, teams, riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index").order("id")),
    fetchAllRows(() => supabase.from("teams")
      .select("id, name, is_ai, is_bank, is_test_account, league_division_id").order("id")),
    fetchAllRows(() => supabase.from("riders").select("id, team_id, is_retired").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities")
      .select("rider_id, flat, climbing, sprint, time_trial, punch, cobblestone").order("rider_id")),
  ]);

  const poolsById = new Map(pools.map((p) => [p.id, p]));
  const poolLabel = new Map(pools.map((p) => [p.id, `tier ${p.tier} pulje ${String.fromCharCode(65 + p.pool_index)}`]));
  const abilitiesByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const byTier = buildTierInputs(teams, riders, abilitiesByRider, poolsById);

  const report = [];
  for (const [tier, tierTeams] of [...byTier].sort((a, b) => a[0] - b[0])) {
    if (onlyTier != null && tier !== onlyTier) continue;
    const poolIds = pools.filter((p) => p.tier === tier).map((p) => p.id).sort((a, b) => a - b);
    const evaluation = evaluateTierBalance({ teams: tierTeams, poolIds, threshold });
    const nameById = new Map(tierTeams.map((t) => [t.teamId, t.teamName]));
    report.push({
      tier,
      poolIds,
      teams: tierTeams.length,
      imbalanceIndex: evaluation.imbalance.index,
      worstPoolId: evaluation.imbalance.worstPoolId,
      worstTeam: nameById.get(evaluation.imbalance.worstTeamId) ?? null,
      needsReseed: evaluation.needsReseed,
      margins: evaluation.imbalance.margins.map((m) => ({
        ...m, team: nameById.get(m.teamId) ?? null, label: poolLabel.get(m.poolId),
      })),
      pools: poolStrengthStats(tierTeams).map((s) => ({ ...s, label: poolLabel.get(s.poolId) })),
      plannedMoves: evaluation.plan
        ? evaluation.plan.moves.map((m) => ({ ...m, team: nameById.get(m.teamId) ?? null }))
        : [],
      after: evaluation.plan
        ? { imbalanceIndex: tierImbalanceIndex(applyPlan(tierTeams, evaluation.plan)).index }
        : null,
    });
  }

  if (json) {
    console.log(JSON.stringify({ threshold, tiers: report }, null, 2));
  } else {
    console.log(`\nPULJE-STYRKE-BALANCE (read-only) · tærskel ${threshold}\n`);
    for (const t of report) {
      const flag = t.needsReseed ? "SKÆV" : "ok";
      console.log(`── Tier ${t.tier} · ${t.teams} hold · skævheds-indeks ${t.imbalanceIndex.toFixed(1)} · ${flag}`);
      for (const p of t.pools) {
        console.log(`   ${String(p.label).padEnd(22)} hold ${String(p.teamCount).padStart(2)} · top ${p.top.toFixed(1).padStart(5)} · median ${p.medianStrength.toFixed(1).padStart(5)} · forhold ${p.topRatio.toFixed(2)}`);
      }
      for (const m of t.margins.filter((x) => x.margin > 0)) {
        console.log(`   ⚠ ${m.label}: ${m.team} stakker med margin +${m.margin} (4.-bedste ${m.stackDepthPeak} mod rivalernes 10.-bedste ${m.rivalPeak})`);
      }
      if (t.needsReseed) {
        console.log(`   → en snake-reseed ville flytte ${t.plannedMoves.length} hold og bringe indekset til ${t.after.imbalanceIndex.toFixed(1)}`);
      }
      console.log("");
    }
    console.log("Ingen ændringer udført. Reseed kræver ejer-go + sim-harness (simulér-før-ship).\n");
  }

  process.exit(report.some((t) => t.needsReseed) ? 1 : 0);
}

/** Anvend en plan på en KOPI af tier-holdene (kun til after-beregningen). */
export function applyPlan(tierTeams, plan) {
  const dest = new Map(plan.assignments.map((a) => [a.teamId, a.toPoolId]));
  return tierTeams.map((t) => ({ ...t, poolId: dest.get(t.teamId) ?? t.poolId }));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("auditPoolBalance.js")) {
  main().catch((err) => {
    console.error(`auditPoolBalance fejlede: ${err.message}`);
    process.exit(2);
  });
}
