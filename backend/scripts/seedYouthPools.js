#!/usr/bin/env node
// #5646 (Y3, del af #2492/#4620) · Seed af ungdomsgrupperne (u23 + junior) og
// holdenes teams.u23_/junior_league_division_id.
//
// FORM (ejer 24/9, spec docs/drafts/spec-ungdomslob-2026-09-24.md "Ejer-valg"):
// S4 = én række grupper à 24 pr. trup, alle på tier 1, pool_index 0..N-1. N
// beregnes her (så få grupper som muligt, ingen over 24), derfor ligger
// gruppe-INSERT'en i dette script og ikke i en migration. Kolonnerne
// teams.u23_/junior_league_division_id findes allerede (A2,
// database/2026-09-24-5517-squad-leagues-races-teams.sql). Fordelingen er
// backend/lib/youthPoolAssignment.js (ren, unit-testet).
//
// TO TILSTANDE PR. TRUP
//   fresh   ingen hold har en gruppe i trup'en endnu → planYouthGroups:
//           managers snake efter senior-Global Rank, AI-hold fylder op.
//   top-up  mindst ét hold har en gruppe → planYouthTopUp: rører ALDRIG en
//           eksisterende placering; nye managers overtager en AI-plads, AI-hold
//           uden gruppe (fx efter A6) fylder op. Genkørsel uden ændringer = 0
//           skrivninger (idempotent).
//
// DEFAULT = DRY-RUN (read-only). Skriver:
//   docs/snapshots/4620/youth-pools-dry-run-<dato>.json + .md  (kun tal, ingen
//       holdnavne/id'er: repoet er offentligt, hard rule 17)
//   balance-internals/4620/youth-pools-plan-<dato>.json         (fuld plan med
//       team-id'er, gitignoreret)
//
// --apply --owner-go (EJER-GATED, køres ikke af Claude):
//   1) opretter manglende grupper i league_divisions (squad, tier 1, pool_index, label)
//   2) skriver en restore-fil med holdenes nuværende ungdoms-FK i balance-internals/4620/
//   3) sætter teams.<trup>_league_division_id pr. gruppe
//   4) læser tilbage og verificerer
// FORUDSÆTNING for --apply: de seed-blokerende pulje-læsere (#5536 + economyEngine-
// delen) er merget. Seed-gaten i backend/lib/squadSeniorReaders.test.js vogter kun
// migrationer; dette script er gaten for script-seedet, derfor ejer-go.
//
//   node scripts/seedYouthPools.js                      # dry-run, begge trupper
//   node scripts/seedYouthPools.js --squad=u23          # kun U23
//   node scripts/seedYouthPools.js --apply --owner-go   # EJER-GATED

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import {
  YOUTH_GROUP_SIZE,
  YOUTH_GROUP_TIER,
  YOUTH_POOL_SQUADS,
  isEligibleAiTeam,
  isEligibleManagerTeam,
  planYouthGroups,
  planYouthTopUp,
  youthGroupLabel,
} from "../lib/youthPoolAssignment.js";
import { MIN_RACE_ENTRIES } from "../lib/raceAutopick.js";
import {
  loadParkingInputs,
  selectActiveSubscriptionTeamIds,
  selectTeamsToPark,
  selectTeamsToUnpark,
} from "../lib/managerParking.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

export const ISSUE = 4620;
export const PUBLIC_SNAPSHOT_DIR = join("docs", "snapshots", String(ISSUE));
export const INTERNALS_DIR = join("balance-internals", String(ISSUE));

/** FK-kolonnen på teams pr. ungdomstrup. */
export function fkColumn(squad) {
  if (!YOUTH_POOL_SQUADS.includes(squad)) throw new Error(`ukendt ungdomstrup '${squad}'`);
  return `${squad}_league_division_id`;
}

// ── Argumenter ───────────────────────────────────────────────────────────────
/**
 * @param {string[]} argv
 * @returns {{ squads: string[], apply: boolean, ownerGo: boolean, groupSize: number }}
 * @throws {Error} ved ugyldige argumenter
 */
export function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? true : hit.slice(eq + 1);
  };
  const squadRaw = get("squad");
  let squads = [...YOUTH_POOL_SQUADS];
  if (squadRaw !== undefined && squadRaw !== "all") {
    if (!YOUTH_POOL_SQUADS.includes(squadRaw)) throw new Error(`--squad skal være u23, junior eller all (fik ${JSON.stringify(squadRaw)})`);
    squads = [squadRaw];
  }
  const apply = get("apply") === true;
  const ownerGo = get("owner-go") === true;
  if (apply && !ownerGo) throw new Error("--apply kræver OGSÅ --owner-go. Kør dry-run først og få ejerens go på netop de tal.");
  const sizeRaw = get("group-size");
  const groupSize = sizeRaw === undefined ? YOUTH_GROUP_SIZE : Number(sizeRaw);
  if (!Number.isInteger(groupSize) || groupSize < MIN_RACE_ENTRIES) {
    throw new Error(`--group-size skal være et helt tal ≥ ${MIN_RACE_ENTRIES} (fik ${JSON.stringify(sizeRaw)})`);
  }
  return { squads, apply, ownerGo, groupSize };
}

// ── Rene hjælpere (testes i seedYouthPools.test.js) ─────────────────────────

/** Antal aktive ryttere pr. hold i trup'en. */
export function youthRidersByTeam(riders, squad) {
  const out = new Map();
  for (const r of riders || []) {
    if (!r?.team_id || r.squad !== squad || r.is_retired === true) continue;
    out.set(r.team_id, (out.get(r.team_id) || 0) + 1);
  }
  return out;
}

/** Nuværende grupper for trup'en, bygget ud fra holdenes FK. */
export function currentGroups({ pools, teams, squad }) {
  const col = fkColumn(squad);
  const squadPools = (pools || []).filter((p) => p.squad === squad).sort((a, b) => a.pool_index - b.pool_index);
  const byPoolId = new Map(squadPools.map((p) => [p.id, { poolId: p.id, poolIndex: p.pool_index, managerTeamIds: [], aiTeamIds: [] }]));
  for (const t of teams || []) {
    const g = t[col] != null ? byPoolId.get(t[col]) : null;
    if (!g) continue;
    (t.is_ai === true ? g.aiTeamIds : g.managerTeamIds).push(t.id);
  }
  return [...byPoolId.values()];
}

/**
 * Plan for én trup: vælger fresh/top-up, og omsætter planen til konkrete
 * skrivninger (grupper der skal oprettes + FK-opdateringer pr. hold).
 */
export function buildSquadPlan({ squad, pools, teams, globalRanks, riders, groupSize = YOUTH_GROUP_SIZE }) {
  const col = fkColumn(squad);
  const counts = youthRidersByTeam(riders, squad);
  const withCount = (t) => ({ ...t, youthRiders: counts.get(t.id) || 0 });
  const managers = (teams || []).filter((t) => t.is_ai !== true).map(withCount);
  // AI-hold uden seniorpulje er rester (samme krav som A6's loadActiveAiTeams).
  const aiTeams = (teams || []).filter((t) => t.is_ai === true && t.league_division_id != null).map(withCount);

  const existing = currentGroups({ pools, teams, squad });
  const assignedCount = existing.reduce((n, g) => n + g.managerTeamIds.length + g.aiTeamIds.length, 0);
  const mode = assignedCount === 0 ? "fresh" : "top-up";

  const plan = mode === "fresh"
    ? planYouthGroups({ teams: managers, aiTeams, globalRanks, squad, groupSize })
    : planYouthTopUp({ groups: existing, teams: managers, aiTeams, globalRanks, squad, groupSize });

  const existingIndexes = new Set((pools || []).filter((p) => p.squad === squad).map((p) => p.pool_index));
  const poolsToCreate = plan.groups
    .filter((g) => !existingIndexes.has(g.poolIndex))
    .map((g) => ({ squad, tier: YOUTH_GROUP_TIER, pool_index: g.poolIndex, label: youthGroupLabel(squad, g.poolIndex) }));
  const unusedPools = [...existingIndexes].filter((i) => !plan.groups.some((g) => g.poolIndex === i)).sort((a, b) => a - b);

  const updates = [];
  if (mode === "fresh") {
    for (const g of plan.groups) {
      for (const id of [...g.managerTeamIds, ...g.aiTeamIds]) updates.push({ teamId: id, column: col, poolIndex: g.poolIndex });
    }
  } else {
    for (const m of plan.moves) updates.push({ teamId: m.teamId, column: col, poolIndex: m.poolIndex });
    const moved = new Set(plan.moves.map((m) => m.teamId));
    for (const d of plan.displacedAi) if (!moved.has(d.teamId)) updates.push({ teamId: d.teamId, column: col, poolIndex: null });
  }

  return { squad, mode, plan, poolsToCreate, unusedPools, updates };
}

/**
 * Prognose for holdene EFTER sæsonskiftets parkerings-sweep: hold sweepen ville
 * parkere får parked_at, parkerede hold der har tilmeldt sig igen får det fjernet.
 * Ren; udvælgelsen er managerParking.js' egne funktioner (se main).
 */
export function applyParkingForecast(teams, { toPark = [], toUnpark = [] } = {}) {
  const park = new Set(toPark);
  const unpark = new Set(toUnpark);
  return (teams || []).map((t) => {
    if (park.has(t.id)) return { ...t, parked_at: "forecast" };
    if (unpark.has(t.id)) return { ...t, parked_at: null };
    return t;
  });
}

/** Kort tal-udgave af en trup-plan (prognose-tabellen). */
export function squadNumbers({ squad, plan }) {
  const { managers, aiTeams, groupCount, largestGroup, smallestGroup } = plan.summary;
  return { squad, managers, aiTeams, groupCount, largestGroup, smallestGroup };
}

/**
 * Tal uden holdnavne/id'er, til den committede snapshot (offentligt repo).
 * forecast (valgfri) = { parked, unparked, squads: [squadNumbers] } efter parkerings-sweepen.
 */
export function publicSummary(squadPlans, { generatedAt, eligibleManagers, eligibleAi, globalRankRows, forecast = null }) {
  return {
    issue: ISSUE,
    generated_at: generatedAt,
    mode: "dry-run",
    input: { eligibleManagers, eligibleAi, globalRankRows },
    forecastAfterParking: forecast,
    squads: squadPlans.map(({ squad, mode, plan, poolsToCreate, unusedPools, updates }) => ({
      squad,
      mode,
      groupSize: plan.groupSize,
      managers: plan.summary.managers,
      aiTeams: plan.summary.aiTeams,
      groupCount: plan.summary.groupCount,
      largestGroup: plan.summary.largestGroup,
      smallestGroup: plan.summary.smallestGroup,
      groupsBelowMinStarters: plan.summary.groupsBelowMinStarters.length,
      minRaceEntries: MIN_RACE_ENTRIES,
      managersWithoutGlobalRank: (plan.managers || []).filter((m) => m.missingGlobalRank).length,
      excludedManagers: plan.excluded?.managers.length ?? null,
      aiOverflow: plan.aiOverflow.length,
      poolsToCreate: poolsToCreate.length,
      unusedPools: unusedPools.length,
      teamUpdates: updates.length,
      groups: plan.groups.map((g) => ({
        poolIndex: g.poolIndex,
        label: g.label,
        managers: g.managerTeamIds.length,
        aiTeams: g.aiTeamIds.length,
        size: g.size,
        startersNow: g.starters,
      })),
    })),
  };
}

export function renderMarkdown(summary) {
  const lines = [
    `# Ungdomsgrupper, dry-run (#5646, del af #${ISSUE})`,
    "",
    `Genereret ${summary.generated_at}. Kun tal; den fulde plan med hold ligger i \`${INTERNALS_DIR.replace(/\\/g, "/")}/\` (gitignoreret).`,
    "",
    `Input: ${summary.input.eligibleManagers} berettigede managers, ${summary.input.eligibleAi} aktive AI-hold, ${summary.input.globalRankRows} Global Rank-rækker.`,
    "",
  ];
  const fc = summary.forecastAfterParking;
  if (fc) {
    lines.push(
      "## Prognose efter sæsonskiftets parkering",
      "",
      `Parkerings-sweepen (managerParking.js, 30 dage uden login) ville parkere ${fc.parked} managers og genindplacere ${fc.unparked}. Grupperne seedes efter transitionen, så det er disse tal der gælder; kør dry-run igen der.`,
      "",
      "| Trup | Managers | AI-hold | Grupper | Største | Mindste |",
      "|---|---:|---:|---:|---:|---:|",
      ...fc.squads.map((s) => `| ${s.squad === "u23" ? "U23" : "Junior"} | ${s.managers} | ${s.aiTeams} | ${s.groupCount} | ${s.largestGroup} | ${s.smallestGroup} |`),
      "",
      "## Plan i dag (før parkering)",
      "",
    );
  }
  for (const s of summary.squads) {
    lines.push(
      `## ${s.squad === "u23" ? "U23" : "Junior"} (${s.mode})`,
      "",
      `- Managers: ${s.managers} · AI-hold: ${s.aiTeams} · grupper: ${s.groupCount} (à højst ${s.groupSize})`,
      `- Største gruppe: ${s.largestGroup} · mindste: ${s.smallestGroup}`,
      `- Managers uden Global Rank (lagt sidst): ${s.managersWithoutGlobalRank}`,
      `- Grupper under ${s.minRaceEntries} startklare hold i dag: ${s.groupsBelowMinStarters} (AI-holdene har ingen ungdomsryttere før A6)`,
      `- AI-hold uden plads: ${s.aiOverflow} · grupper der oprettes: ${s.poolsToCreate} · FK-opdateringer: ${s.teamUpdates}`,
      "",
      "| Gruppe | Managers | AI | I alt | Startklare nu |",
      "|---|---:|---:|---:|---:|",
      ...s.groups.map((g) => `| ${g.label} | ${g.managers} | ${g.aiTeams} | ${g.size} | ${g.startersNow} |`),
      "",
    );
  }
  return lines.join("\n");
}

// ── I/O ──────────────────────────────────────────────────────────────────────
async function loadState(supabase) {
  // schema-columns-ok: league_divisions.squad, teams.u23_/junior_league_division_id,
  // teams.parked_at/retired_at og riders.squad findes i prod (A2 #5517, #4619).
  const [teams, pools, globalRanks, riders] = await Promise.all([
    fetchAllRows(() => supabase.from("teams")
      .select("id, name, is_ai, is_bank, is_frozen, is_test_account, parked_at, retired_at, pending_removal_at, division, league_division_id, u23_league_division_id, junior_league_division_id")
      .order("id")),
    fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index, label, squad").order("id")),
    fetchAllRows(() => supabase.from("global_rank_mv")
      .select("team_id, global_points, global_rank, active_recent")
      .order("team_id")),
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, squad, is_retired")
      .in("squad", YOUTH_POOL_SQUADS)
      .order("id")),
  ]);
  return { teams, pools, globalRanks, riders };
}

async function applySquadPlan(supabase, squadPlan, { internalsDir, stamp }) {
  const { squad, poolsToCreate, updates } = squadPlan;
  const col = fkColumn(squad);

  if (poolsToCreate.length) {
    const { error } = await supabase.from("league_divisions")
      .upsert(poolsToCreate, { onConflict: "squad,tier,pool_index", ignoreDuplicates: true });
    if (error) throw new Error(`league_divisions insert (${squad}): ${error.message}`);
  }
  const { data: pools, error: poolErr } = await supabase.from("league_divisions")
    .select("id, pool_index, squad").eq("squad", squad).eq("tier", YOUTH_GROUP_TIER);
  if (poolErr) throw new Error(`league_divisions (${squad}): ${poolErr.message}`);
  const poolIdByIndex = new Map(pools.map((p) => [p.pool_index, p.id]));

  const ids = updates.map((u) => u.teamId);
  const before = ids.length
    ? await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("teams").select(`id, ${col}`).in("id", chunk).order("id"))
    : [];
  const restorePath = join(internalsDir, `youth-pools-restore-${squad}-${stamp}.json`);
  writeFileSync(restorePath, JSON.stringify({ squad, column: col, teams: before }, null, 2));
  console.log(`  restore-fil: ${relative(REPO_ROOT, restorePath)}`);

  const byTarget = new Map();
  for (const u of updates) {
    const target = u.poolIndex == null ? null : poolIdByIndex.get(u.poolIndex);
    if (u.poolIndex != null && target == null) throw new Error(`gruppe ${squad}#${u.poolIndex} findes ikke efter insert`);
    const key = target == null ? "null" : String(target);
    if (!byTarget.has(key)) byTarget.set(key, { target, ids: [] });
    byTarget.get(key).ids.push(u.teamId);
  }
  for (const { target, ids: teamIds } of byTarget.values()) {
    const { error } = await supabase.from("teams").update({ [col]: target }).in("id", teamIds);
    if (error) throw new Error(`teams.${col} update: ${error.message}`);
  }

  const after = ids.length
    ? await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("teams").select(`id, ${col}`).in("id", chunk).order("id"))
    : [];
  const afterById = new Map(after.map((t) => [t.id, t[col]]));
  const wrong = updates.filter((u) => afterById.get(u.teamId) !== (u.poolIndex == null ? null : poolIdByIndex.get(u.poolIndex)));
  return { written: updates.length, wrong: wrong.length };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via railway run eller backend/.env).");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`UNGDOMSGRUPPER (#5646) ${args.apply ? "APPLY (skriver til prod)" : "DRY-RUN (read-only)"} · trupper: ${args.squads.join(", ")}`);
  const state = await loadState(supabase);
  const squadPlans = args.squads.map((squad) => buildSquadPlan({ squad, groupSize: args.groupSize, ...state }));

  // Prognose: samme plan efter parkerings-sweepen ved sæsonskiftet (read-only;
  // udvælgelsen er managerParking.js' egne rene funktioner, ingen kopi).
  const now = new Date();
  const parking = await loadParkingInputs({ supabase });
  const activeSubscriptionTeamIds = selectActiveSubscriptionTeamIds(parking.subscriptions, now);
  const toPark = selectTeamsToPark({ teams: parking.teams, users: parking.users, now, activeSubscriptionTeamIds }).map((t) => t.id);
  const toUnpark = selectTeamsToUnpark({ teams: parking.teams }).map((t) => t.id);
  const forecastTeams = applyParkingForecast(state.teams, { toPark, toUnpark });
  const forecast = {
    parked: toPark.length,
    unparked: toUnpark.length,
    squads: args.squads.map((squad) => squadNumbers(buildSquadPlan({ squad, groupSize: args.groupSize, ...state, teams: forecastTeams }))),
  };

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10);
  const summary = publicSummary(squadPlans, {
    generatedAt,
    eligibleManagers: state.teams.filter(isEligibleManagerTeam).length,
    eligibleAi: state.teams.filter((t) => isEligibleAiTeam(t) && t.league_division_id != null).length,
    globalRankRows: state.globalRanks.length,
    forecast,
  });

  const publicDir = join(REPO_ROOT, PUBLIC_SNAPSHOT_DIR);
  const internalsDir = join(REPO_ROOT, INTERNALS_DIR);
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(internalsDir, { recursive: true });
  const jsonPath = join(publicDir, `youth-pools-dry-run-${date}.json`);
  const mdPath = join(publicDir, `youth-pools-dry-run-${date}.md`);
  const fullPath = join(internalsDir, `youth-pools-plan-${date}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(mdPath, `${renderMarkdown(summary)}\n`);
  writeFileSync(fullPath, JSON.stringify({ generated_at: generatedAt, squadPlans }, null, 2));

  for (const s of summary.squads) {
    console.log(`  ${s.squad} (${s.mode}): ${s.managers} managers + ${s.aiTeams} AI → ${s.groupCount} grupper, størst ${s.largestGroup}, mindst ${s.smallestGroup}, ${s.groupsBelowMinStarters} under ${s.minRaceEntries} startklare, ${s.teamUpdates} FK-opdateringer`);
  }
  console.log(`  prognose efter parkering (${forecast.parked} parkeres, ${forecast.unparked} genindplaceres): ${forecast.squads.map((s) => `${s.squad} ${s.managers}+${s.aiTeams} → ${s.groupCount} grupper (${s.smallestGroup}-${s.largestGroup})`).join(" · ")}`);
  console.log(`  snapshot: ${relative(REPO_ROOT, jsonPath)} + .md · fuld plan: ${relative(REPO_ROOT, fullPath)}`);

  if (!args.apply) return 0;

  const stamp = generatedAt.replace(/[:.]/g, "-");
  let failed = 0;
  for (const sp of squadPlans) {
    console.log(`APPLY ${sp.squad} (${sp.mode}): ${sp.poolsToCreate.length} grupper oprettes, ${sp.updates.length} hold opdateres`);
    const { written, wrong } = await applySquadPlan(supabase, sp, { internalsDir, stamp });
    console.log(`  skrevet ${written}, forkerte efter tilbagelæsning: ${wrong}`);
    failed += wrong;
  }
  return failed > 0 ? 1 : 0;
}

// Kun når filen køres direkte — testen importerer de rene funktioner.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
