#!/usr/bin/env node
// #5642 (epik #4592) · S4-struktur spor A2: D4 fra 8 til 4 puljer.
// Spec: docs/drafts/spec-s4-struktur-2026-09-24.md afsnit A2 + "Rækkefølgen ved
// skiftet" trin 3. Ejer 24/9: pyramide 1/2/4/4, D4 med AI fra dag ét.
//
// HVAD SCRIPTET GØR (kun med --apply --owner-go)
//   1) Flytter AI-hold fra D4 E-H (pool_index 4-7) til D4 A-D (pool_index 0-3), op
//      til 24 hold pr. pulje (UPDATE teams SET league_division_id). Flytning frem
//      for at nedlægge og nyoprette: holdene, rytterne og historikken består.
//   2) Sætter league_divisions.retired_at på E-H. Rækkerne kan ikke slettes:
//      teams, season_standings og races peger på dem med FK, også historisk.
//   3) Nedlægger overskuddet (AI-hold der ikke var plads til i A-D) med
//      retire_ai_pool_team (samme atomare nedlæggelse som pulje-sweepet, #4753).
//      Kræver ai_team_retire_enabled + ai_pool_retirement_v2_enabled.
//   4) Verificerer: E-H tomme, A-D højst 24.
//
// GATES (apply afvises ellers)
//   • --owner-go (pensioneringen er irreversibel i praksis, spec-risiko 7).
//   • Ingen sæson 'active', og mindst én 'completed' ("Afslut sæson" er kørt).
//   • Migrationen 2026-09-25-4592-d4-retire-pools.sql er applied (retired_at findes).
//   • Begge AI-pensions-flag er on.
//   • Ingen blokerende hold i E-H: menneskehold (sammenlægningen D4 → D3, spor A1,
//     skal være kørt først), frosne/test-hold eller AI-hold med en ejer.
//
// Idempotent: puljerne klassificeres på pool_index, ikke på retired_at. Et re-run
// finder A-D fulde (0 flytninger), E-H allerede pensioneret, og nedlægger kun det
// der stadig står i E-H (fx et hold der ventede på en forpligtelse).
// Rollback: snapshot-JSON + restore-SQL skrives FØR første write (backend/scripts/
// snapshots/, gitignoreret), samme mønster som compressPyramid.js.
//
// Rækkefølge ved skiftet (spec): Afslut sæson → sammenlægning D4 → D3 (A1) →
// DETTE SCRIPT → AI-reconcile alle puljer → S4-kalender (A3) → Start næste sæson.
// En AI-reconcile MELLEM A1 og dette script topper E-H op til 24 (tier 4 fyldes
// altid, #5642); scriptet nedlægger dem bagefter, men det er spildt arbejde.
//
//   node scripts/retireD4PoolsS4.js                          # dry-run (read-only)
//   node scripts/retireD4PoolsS4.js --assume-merged          # dry-run, som om A1 er kørt
//   node scripts/retireD4PoolsS4.js --json                   # dry-run som JSON
//   node scripts/retireD4PoolsS4.js --apply --owner-go       # rigtig kørsel
//   railway run --service CyclingZone -- node scripts/retireD4PoolsS4.js

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

import { MAX_DIVISION, POOL_TARGET_SIZE } from "../lib/economyConstants.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { isRealManager, withPoolRetiredColumn, POOL_RETIRED_COLUMN } from "../lib/aiTeamGenerator.js";
import { withSeniorSquadScope, onlySeniorSquadRows } from "../lib/squads.js";
import { isAiTeamRetireEnabled } from "../lib/aiTeamRetireFlag.js";
import { retireAiTeam } from "../lib/aiTeamRetirement.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Antal aktive D4-puljer i S4-formen (ejer 24/9, pyramide 1/2/4/4). */
export const D4_ACTIVE_POOL_COUNT = 4;

export const TEAM_COLUMNS =
  "id, name, division, league_division_id, user_id, is_ai, is_bank, is_frozen, is_test_account, retired_at, pending_removal_at";

// Et AI-hold scriptet må flytte: aktivt, ejerløst, ikke frosset/test, ikke allerede
// reserveret til nedlæggelse (et reserveret hold nedlægges i stedet).
function isMovableAi(team) {
  return team.is_ai === true && !team.is_bank && !team.is_frozen && !team.is_test_account
    && team.user_id == null && team.retired_at == null && team.pending_removal_at == null;
}

// Et AI-hold retire_ai_pool_team kan nedlægge (samme filter som SQL-funktionen).
function isRetirableAi(team) {
  return team.is_ai === true && !team.is_bank && !team.is_frozen && !team.is_test_account
    && team.user_id == null && team.retired_at == null;
}

function countPool(teams, poolId) {
  const inPool = teams.filter((t) => t.league_division_id === poolId && !t.is_bank);
  return { total: inPool.length, ai: inPool.filter((t) => t.is_ai === true).length, nonAi: inPool.filter((t) => t.is_ai !== true).length };
}

/**
 * Ren plan (ingen I/O). Deterministisk: samme input → samme flytninger.
 *
 * @param {object} args
 * @param {Array<{id, tier, pool_index, label?, squad?, retired_at?}>} args.pools  league_divisions
 * @param {object[]} args.teams  alle hold (TEAM_COLUMNS)
 * @param {boolean} [args.assumeMerged=false]  projektion: ægte managers i D4 regnes som
 *        flyttet til D3 (spor A1). Kun til dry-run; apply afviser den.
 */
export function planD4PoolRetirement({ pools = [], teams = [], assumeMerged = false } = {}) {
  const d4 = onlySeniorSquadRows(pools)
    .filter((p) => p.tier === MAX_DIVISION)
    .sort((a, b) => a.pool_index - b.pool_index);
  if (d4.length <= D4_ACTIVE_POOL_COUNT) {
    throw new Error(`planD4PoolRetirement: forventede mere end ${D4_ACTIVE_POOL_COUNT} D4-puljer, fandt ${d4.length}`);
  }
  const keep = d4.slice(0, D4_ACTIVE_POOL_COUNT);
  const retire = d4.slice(D4_ACTIVE_POOL_COUNT);
  const keepIds = new Set(keep.map((p) => p.id));
  const retireIds = new Set(retire.map((p) => p.id));
  const mergedAway = (t) => assumeMerged && isRealManager(t);
  const d4Teams = teams.filter((t) => (keepIds.has(t.league_division_id) || retireIds.has(t.league_division_id))
    && !t.is_bank && !mergedAway(t));

  const remaining = new Map(keep.map((p) => [p.id,
    Math.max(0, POOL_TARGET_SIZE - d4Teams.filter((t) => t.league_division_id === p.id).length)]));

  // Kilde-puljernes flytbare AI, flettet (E1, F1, G1, H1, E2, …), så hver A-D-pulje
  // får en blanding fra alle fire puljer i stedet for én hel pulje.
  const bySource = retire.map((p) => d4Teams
    .filter((t) => t.league_division_id === p.id && isMovableAi(t))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const movable = [];
  for (let i = 0; bySource.some((list) => i < list.length); i++) {
    for (const list of bySource) if (i < list.length) movable.push(list[i]);
  }

  const moves = [];
  const leftover = [];
  for (const team of movable) {
    let target = null;
    for (const p of keep) {
      const left = remaining.get(p.id);
      if (left > 0 && (target == null || left > remaining.get(target.id))) target = p;
    }
    if (!target) { leftover.push(team); continue; }
    remaining.set(target.id, remaining.get(target.id) - 1);
    moves.push({ teamId: team.id, fromPoolId: team.league_division_id, toPoolId: target.id });
  }

  const retireTeams = [
    ...leftover,
    ...d4Teams.filter((t) => retireIds.has(t.league_division_id) && isRetirableAi(t) && !isMovableAi(t)),
  ].map((t) => ({ teamId: t.id, poolId: t.league_division_id }));
  const blockers = d4Teams
    .filter((t) => retireIds.has(t.league_division_id) && !isRetirableAi(t))
    .map((t) => ({
      teamId: t.id,
      poolId: t.league_division_id,
      kind: isRealManager(t) ? "manager" : t.is_ai === true ? "ai_not_retirable" : "frozen_or_test",
    }));

  const after = d4Teams.map((t) => {
    const move = moves.find((m) => m.teamId === t.id);
    if (move) return { ...t, league_division_id: move.toPoolId };
    if (retireTeams.some((r) => r.teamId === t.id)) return { ...t, league_division_id: null };
    return t;
  });
  const poolRows = d4.map((p) => ({
    poolId: p.id,
    label: p.label ?? `D4 pool ${p.pool_index}`,
    poolIndex: p.pool_index,
    role: keepIds.has(p.id) ? "keep" : "retire",
    alreadyRetired: p[POOL_RETIRED_COLUMN] != null,
    before: countPool(d4Teams, p.id),
    after: countPool(after, p.id),
  }));

  return { keep, retire, moves, retireTeams, blockers, pools: poolRows, assumeMerged };
}

// ── I/O ────────────────────────────────────────────────────────────────────────

export async function loadState(supabase) {
  const { data: pools, error } = await withPoolRetiredColumn((retiredCol) =>
    withSeniorSquadScope((senior) => senior(supabase
      .from("league_divisions")
      .select(`id, tier, pool_index, label${retiredCol}`))
      .order("id")));
  if (error) throw new Error(`league_divisions: ${error.message}`);
  const retiredColumnPresent = (pools || []).some((p) => Object.prototype.hasOwnProperty.call(p, POOL_RETIRED_COLUMN));
  const teams = await fetchAllRows(() => supabase.from("teams").select(TEAM_COLUMNS).order("id"));
  const { data: seasons, error: seasonErr } = await supabase.from("seasons").select("id, number, status");
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  return { pools: pools || [], teams: teams || [], seasons: seasons || [], retiredColumnPresent };
}

/** Sæson-gaten: ingen aktiv sæson, og mindst én afsluttet. */
export function seasonGate(seasons = []) {
  const active = seasons.filter((s) => s.status === "active");
  if (active.length) return { ok: false, reason: `sæson #${active.map((s) => s.number).join(", #")} er stadig 'active' ("Afslut sæson" først)` };
  if (!seasons.some((s) => s.status === "completed")) return { ok: false, reason: "ingen sæson er 'completed'" };
  return { ok: true, reason: null };
}

const sqlText = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

/** Restore-SQL fra snapshottet (ren, testbar). */
export function buildRestoreSql(snapshot) {
  const lines = [];
  for (const t of snapshot.teams) {
    lines.push(`update teams set division=${t.division ?? "null"}, league_division_id=${t.league_division_id ?? "null"}, `
      + `retired_at=${sqlText(t.retired_at)}, pending_removal_at=${sqlText(t.pending_removal_at)} where id=${sqlText(t.id)};`);
  }
  for (const r of snapshot.riders) {
    lines.push(`update riders set team_id=${sqlText(r.team_id)}, is_retired=${r.is_retired ? "true" : "false"}, `
      + `pending_team_id=${sqlText(r.pending_team_id)} where id=${sqlText(r.id)};`);
  }
  for (const p of snapshot.pools) {
    lines.push(`update league_divisions set retired_at=${sqlText(p.retired_at)} where id=${p.id};`);
  }
  return `-- #5642 rollback: D4-puljer som FØR retireD4PoolsS4 (${snapshot.taken_at}).\n`
    + "-- Watchlist-rækker slettet ved nedlæggelsen genskabes ikke (notifikationen er sendt).\n"
    + `begin;\n${lines.join("\n")}\ncommit;\n`;
}

async function writeSnapshot({ supabase, plan, pools, teams, snapshotDir, now }) {
  const d4Ids = new Set(plan.pools.map((p) => p.poolId));
  const teamRows = teams.filter((t) => d4Ids.has(t.league_division_id))
    .map((t) => ({ id: t.id, division: t.division, league_division_id: t.league_division_id,
      retired_at: t.retired_at, pending_removal_at: t.pending_removal_at }));
  const retireIds = plan.retireTeams.map((r) => r.teamId);
  const riders = retireIds.length
    ? await fetchAllRowsChunkedIn(retireIds, (chunk) => supabase.from("riders")
      .select("id, team_id, is_retired, pending_team_id").in("team_id", chunk).order("id"))
    : [];
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapshot = {
    issue: 5642,
    taken_at: now.toISOString(),
    teams: teamRows,
    riders: riders || [],
    pools: pools.filter((p) => d4Ids.has(p.id)).map((p) => ({ id: p.id, retired_at: p[POOL_RETIRED_COLUMN] ?? null })),
    plan: { moves: plan.moves, retireTeams: plan.retireTeams },
  };
  mkdirSync(snapshotDir, { recursive: true });
  const jsonPath = join(snapshotDir, `retire-d4-pools-s4-${stamp}.json`);
  const sqlPath = join(snapshotDir, `retire-d4-pools-s4-${stamp}-restore.sql`);
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));
  writeFileSync(sqlPath, buildRestoreSql(snapshot));
  return { jsonPath, sqlPath };
}

/**
 * Hele kørslen. Dry-run (default) skriver intet. Apply kræver ownerGo + alle gates.
 * Returnerer en rapport; kaster ALDRIG midt i apply uden at have skrevet snapshot først.
 */
export async function runRetireD4Pools({
  supabase, apply = false, ownerGo = false, assumeMerged = false, now = new Date(),
  snapshotDir = join(__dirname, "snapshots"), retire = retireAiTeam, retireEnabled = isAiTeamRetireEnabled,
} = {}) {
  const state = await loadState(supabase);
  const plan = planD4PoolRetirement({ pools: state.pools, teams: state.teams, assumeMerged });
  const season = seasonGate(state.seasons);
  const flagsOn = await retireEnabled(supabase);
  const refusals = [];
  if (!state.retiredColumnPresent) refusals.push("migrationen 2026-09-25-4592-d4-retire-pools.sql er ikke applied (league_divisions.retired_at mangler)");
  if (!season.ok) refusals.push(season.reason);
  if (!flagsOn) refusals.push("ai_team_retire_enabled + ai_pool_retirement_v2_enabled skal begge være on");
  if (plan.blockers.length) refusals.push(`${plan.blockers.length} hold i E-H kan ikke flyttes/nedlægges (${[...new Set(plan.blockers.map((b) => b.kind))].join(", ")}) - kør sammenlægningen D4 → D3 først`);
  if (apply && assumeMerged) refusals.push("--assume-merged er kun en dry-run-projektion");
  if (apply && !ownerGo) refusals.push("--apply kræver --owner-go");

  const report = { mode: apply ? "apply" : "dry-run", plan, season, flagsOn, refusals, applied: null };
  if (!apply) return report;
  if (refusals.length) return report;

  const snapshot = await writeSnapshot({ supabase, plan, pools: state.pools, teams: state.teams, snapshotDir, now });

  let moved = 0;
  for (const m of plan.moves) {
    const { data, error } = await supabase.from("teams")
      .update({ league_division_id: m.toPoolId, division: MAX_DIVISION })
      .eq("id", m.teamId).eq("league_division_id", m.fromPoolId).select("id");
    if (error) throw new Error(`flyt ${m.teamId}: ${error.message} (snapshot: ${snapshot.jsonPath})`);
    moved += (data || []).length;
  }

  const retireIds = plan.retire.map((p) => p.id);
  const { error: poolErr } = await supabase.from("league_divisions")
    .update({ [POOL_RETIRED_COLUMN]: now.toISOString() }).in("id", retireIds).is(POOL_RETIRED_COLUMN, null);
  if (poolErr) throw new Error(`retired_at: ${poolErr.message} (snapshot: ${snapshot.jsonPath})`);

  const retired = [];
  const deferred = [];
  for (const r of plan.retireTeams) {
    const result = await retire(supabase, r.teamId, { now });
    if (result.retired) retired.push(r.teamId);
    else deferred.push({ teamId: r.teamId, reason: result.reason });
  }

  const verify = await loadState(supabase);
  const leftInRetired = verify.teams.filter((t) => retireIds.includes(t.league_division_id) && !t.is_bank).length;
  const overfull = plan.keep
    .map((p) => ({ poolId: p.id, total: countPool(verify.teams, p.id).total }))
    .filter((p) => p.total > POOL_TARGET_SIZE);
  report.applied = { snapshot, moved, retired: retired.length, deferred, leftInRetired, overfull };
  return report;
}

function printReport(report) {
  const { plan } = report;
  console.log(`\nS4 D4-PULJER 8 → 4 (#5642) ${report.mode === "apply" ? "APPLY" : "DRY-RUN (read-only)"}${plan.assumeMerged ? " · projektion: sammenlægningen D4 → D3 er kørt" : ""}`);
  console.log("Pulje            rolle    før (AI/øvrige)   efter (AI/øvrige)");
  for (const p of plan.pools) {
    const label = String(p.label).padEnd(16);
    const role = (p.role === "keep" ? "behold" : `pension${p.alreadyRetired ? "*" : ""}`).padEnd(8);
    console.log(`${label} ${role} ${String(p.before.ai).padStart(3)} / ${String(p.before.nonAi).padEnd(10)} ${String(p.after.ai).padStart(3)} / ${p.after.nonAi}`);
  }
  console.log(`Flytninger E-H → A-D: ${plan.moves.length} · nedlægges: ${plan.retireTeams.length} · blokerende hold i E-H: ${plan.blockers.length}`);
  console.log(`Sæson-gate: ${report.season.ok ? "ok" : report.season.reason} · pensions-flag: ${report.flagsOn ? "on" : "OFF"}`);
  if (report.refusals.length) {
    console.log(`\n${report.mode === "apply" ? "AFVIST" : "Apply ville blive afvist"}:`);
    for (const r of report.refusals) console.log(`  - ${r}`);
  }
  if (report.applied) {
    const a = report.applied;
    console.log(`\nSnapshot: ${a.snapshot.jsonPath}\nRestore-SQL: ${a.snapshot.sqlPath}`);
    console.log(`Flyttet: ${a.moved} · nedlagt: ${a.retired} · udskudt: ${a.deferred.length} · hold tilbage i E-H: ${a.leftInRetired} · A-D over 24: ${a.overfull.length}`);
    for (const d of a.deferred) console.log(`  udskudt ${d.teamId}: ${d.reason} (kør scriptet igen, når forpligtelsen er afsluttet)`);
    console.log("Næste trin: AI-reconcile alle puljer, derefter S4-kalenderen.");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const { createClient } = await import("@supabase/supabase-js");
  const args = process.argv.slice(2);
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via `railway run` eller backend/.env).");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const report = await runRetireD4Pools({
      supabase,
      apply: args.includes("--apply"),
      ownerGo: args.includes("--owner-go"),
      assumeMerged: args.includes("--assume-merged"),
    });
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    const failed = report.mode === "apply" && (report.refusals.length > 0
      || report.applied?.leftInRetired > 0 || report.applied?.overfull.length > 0);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}
