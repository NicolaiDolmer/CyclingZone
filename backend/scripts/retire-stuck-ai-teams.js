#!/usr/bin/env node
// #4753 · Reparation: nedlæg de AI-hold der holder puljer over 24.
//
// BAGGRUND: 4 af 15 puljer stod på 25 hold 4/9, og 13 AI-hold var permanent
// utrimbare fordi de var blokeret af DØDE transfer_offers-rækker (withdrawn/
// accepted/rejected). Døde rækker forsvinder aldrig af sig selv, så hård-slet-stien
// kunne aldrig komme videre. Nedlæggelse (aiTeamRetirement.retireAiTeam) sletter
// intet og kan derfor ikke blokeres af noget FK.
//
// Scriptet bruger PRÆCIS samme udvælgelse som selve trimmen — samme deterministiske
// id-orden som removeAiTeams, samme pr.-pulje-budget (aiCount - targetAi) som #2407's
// guard, samme guards (#2074 inflight / #2389 uudbetalte præmier / #4753 levende
// tilbud). Ingen egen politik, ingen "vælg det pæneste hold": hvis dette script og
// motoren nogensinde er uenige, er det en bug i den ene af dem.
//
// Usage:
//   node backend/scripts/retire-stuck-ai-teams.js --dry-run        # default, READ-ONLY
//   node backend/scripts/retire-stuck-ai-teams.js --dry-run --json
//   node backend/scripts/retire-stuck-ai-teams.js --apply --owner-go   # KRÆVER EJER-GO
//
// --apply skriver mod prod og er bevidst gated bag BEGGE flag. Uden --owner-go
// afviser scriptet at køre, uanset hvad. Kør ALDRIG --apply uden et eksplicit go på
// netop de hold dry-run'en har vist ejeren (feedback_explicit_go_per_prod_step).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = ok (0 kandidater eller apply lykkedes), 1 = kandidater fundet i dry-run,
//       2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  getInflightRaceIds,
  targetAiCountForPool,
  isRealManager,
  teamRemovalBlockReason,
} from "../lib/aiTeamGenerator.js";
import { retireAiTeam } from "../lib/aiTeamRetirement.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const TEAM_COLUMNS = "id, name, is_ai, is_bank, is_frozen, is_test_account, league_division_id, pending_removal_at, created_at";

/**
 * REN planlægning (DB injiceres) — hvilke hold ville blive nedlagt, pr. pulje?
 * Ingen writes. Testbar uden createClient.
 *
 * @param {{ supabase: object, blockReason?: Function }} args
 * @returns {Promise<{generated_at:string, pools:object[], total_candidates:number, total_blocked:number}>}
 */
export async function planRetirements({ supabase, blockReason = teamRemovalBlockReason }) {
  const [pools, teams] = await Promise.all([
    fetchAllRows(() => supabase
      .from("league_divisions").select("id, tier, pool_index, label").order("id", { ascending: true })),
    fetchAllRows(() => supabase
      .from("teams").select(TEAM_COLUMNS).order("id", { ascending: true })),
  ]);

  const inflightRaceIds = await getInflightRaceIds(supabase);

  const sortedPools = [...pools].sort((a, b) => a.tier - b.tier || a.pool_index - b.pool_index);
  const result = [];
  let totalCandidates = 0;
  let totalBlocked = 0;

  for (const pool of sortedPools) {
    const inPool = teams.filter((t) => t.league_division_id === pool.id);
    const realManagers = inPool.filter(isRealManager);
    // Samme id-orden som removeAiTeams: kandidat-udvælgelsen SKAL være identisk,
    // ellers nedlægger scriptet et andet hold end motoren ville have gjort.
    const aiTeams = inPool
      .filter((t) => t.is_ai === true)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const targetAi = targetAiCountForPool(pool.tier, realManagers.length);
    const deficit = aiTeams.length - targetAi;

    if (deficit <= 0) {
      result.push({
        pool_id: pool.id, label: pool.label, tier: pool.tier,
        teams_now: inPool.length, ai_now: aiTeams.length, real_managers: realManagers.length,
        target_ai: targetAi, to_retire: 0, teams_after: inPool.length, candidates: [], blocked: [],
      });
      continue;
    }

    const candidates = [];
    const blocked = [];
    for (const team of aiTeams) {
      if (candidates.length >= deficit) break;
      const reason = await blockReason(supabase, team.id, inflightRaceIds, { retire: true });
      if (reason) {
        blocked.push({ id: team.id, name: team.name, reason });
        continue;
      }
      candidates.push({
        id: team.id,
        name: team.name,
        pending_removal_at: team.pending_removal_at,
        created_at: team.created_at,
      });
    }

    totalCandidates += candidates.length;
    totalBlocked += blocked.length;
    result.push({
      pool_id: pool.id, label: pool.label, tier: pool.tier,
      teams_now: inPool.length, ai_now: aiTeams.length, real_managers: realManagers.length,
      target_ai: targetAi, to_retire: candidates.length,
      teams_after: inPool.length - candidates.length,
      candidates, blocked,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    pools: result,
    total_candidates: totalCandidates,
    total_blocked: totalBlocked,
  };
}

function printHuman(plan, { apply }) {
  console.log(`#4753 AI-hold-nedlæggelse — ${apply ? "APPLY" : "DRY-RUN (read-only)"} — ${plan.generated_at}\n`);
  for (const p of plan.pools) {
    if (p.to_retire === 0 && p.blocked.length === 0) continue;
    console.log(`  ${p.label} (pulje ${p.pool_id}, tier ${p.tier})`);
    console.log(`    hold nu: ${p.teams_now}  ·  AI: ${p.ai_now}  ·  ægte managere: ${p.real_managers}  ·  AI-target: ${p.target_ai}`);
    console.log(`    → nedlægges: ${p.to_retire}   → hold efter: ${p.teams_after}`);
    for (const c of p.candidates) {
      const pend = c.pending_removal_at ? ` [pending siden ${String(c.pending_removal_at).slice(0, 10)}]` : "";
      console.log(`       - ${c.name} (${c.id})${pend}`);
    }
    const byReason = new Map();
    for (const b of p.blocked) byReason.set(b.reason, (byReason.get(b.reason) || 0) + 1);
    for (const [reason, n] of byReason) {
      const sample = p.blocked.filter((b) => b.reason === reason).slice(0, 3).map((b) => b.name).join(", ");
      console.log(`       ⏳ udskudt · ${reason}: ${n} hold (fx ${sample})`);
    }
    console.log();
  }
  console.log(`Total: ${plan.total_candidates} hold ville blive nedlagt, ${plan.total_blocked} udskudt.`);
  if (!apply) {
    console.log("\nIngen skrivning foretaget. Kør med --apply --owner-go EFTER eksplicit ejer-go.");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");
  const APPLY = args.includes("--apply");
  const OWNER_GO = args.includes("--owner-go");

  if (APPLY && !OWNER_GO) {
    console.error("--apply kræver også --owner-go. Kør dry-run, vis ejeren listen, og få et eksplicit go først.");
    process.exit(2);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const plan = await planRetirements({ supabase });

    if (APPLY) {
      let retired = 0;
      for (const pool of plan.pools) {
        for (const c of pool.candidates) {
          const res = await retireAiTeam(supabase, c.id);
          retired += 1;
          console.log(`  🏁 nedlagt: ${c.name} (${c.id}) — ${res.ridersRetired} ryttere pensioneret`);
        }
      }
      console.log(`\n${retired} hold nedlagt. Kør backend/scripts/audit-league-size-invariant.js for post-verify.`);
      process.exit(0);
    }

    if (JSON_OUT) console.log(JSON.stringify(plan, null, 2));
    else printHuman(plan, { apply: false });
    process.exit(plan.total_candidates > 0 ? 1 : 0);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(2);
  }
}
