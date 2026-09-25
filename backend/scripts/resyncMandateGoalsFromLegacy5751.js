// #5751 · Resynk af board_mandates.goals fra den gamle 1yr-forhandling.
//
// Rod-årsag: `POST /board/sign` / `POST /board/request` (den gamle
// bestyrelsesside) skriver kun til `board_profiles.current_goals`, aldrig til
// `board_mandates.goals`. Mandat-kopien af målene blev skrevet af
// `mandateShadowRebuild3514.mjs` og er ikke fulgt med, når spilleren siden
// forhandlede et mål på den gamle side. Visningen (GET /board/room) er rettet
// i samme PR via `reconcileMandateGoalsWithLegacyBoard`; dette script retter
// den LAGREDE mandat-række, så data og visning er ens før
// `board_mandate_model_enabled` flippes til alle (#4859).
//
// Match-reglen er PRÆCIS `reconcileMandateGoalsWithLegacyBoard` (samme
// funktion som Boardroom-visningen bruger), så script og visning ikke kan
// divergere: afsluttet legacy 1yr-forhandling (negotiation_status
// 'completed') + ikke-tom current_goals → hvert mandat-mål med samme identitet
// (buildGoalIdentityKey) overtager target/label/satisfaction_bonus. Bonusmål
// (source 'bonus_offer') røres aldrig, mål kun i legacy tilføjes aldrig.
//
// Scriptet skriver KUN felterne target, label og satisfaction_bonus på de
// matchende mål i board_mandates.goals. Status, goal_states, kvitteringer,
// adjustments og alle andre kolonner røres aldrig.
//
// BESKYTTEDE mandater (springes over, listes): adjustments_used > 0 eller
// request_used = true — et årsmøde har rørt mandatet (samme predikat som
// mandateShadowRebuild3514.mjs).
//
// Idempotent: anden kørsel finder 0 ændringer, fordi et resynket mål er
// identisk med legacy-målet på de tre felter.
//
// Backup FØR skrivning: backup-tabellen backup_5751_board_mandates_goals_<dato>
// skal findes (oprettes af den der kører --apply, SQL printes hvis den
// mangler), og den skal indeholde hver mandat-række der skrives.
//
// Brug:
//   cd backend && infisical run --env=prod -- node scripts/resyncMandateGoalsFromLegacy5751.js
//       (dry-run, default — skriver intet)
//   cd backend && infisical run --env=prod -- node scripts/resyncMandateGoalsFromLegacy5751.js --apply --owner-go
//       (skriver; kræver BEGGE flag, ejer-GO pr. prod-skridt)
//
// Refs #5751 #5618 #3514 #4859.

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

import {
  LEGACY_NEGOTIATED_GOAL_FIELDS,
  reconcileMandateGoalsWithLegacyBoard,
} from "../lib/boardMandate.js";
import { parseBoardGoals } from "../lib/boardGoals.js";

const PAGE = 1000;
const ID_CHUNK = 200;

/**
 * Parser CLI-flag. --apply uden --owner-go er en fejl (ikke en stille dry-run),
 * så en halv kommando aldrig bliver misforstået som "det skete ikke noget".
 *
 * @param {string[]} argv
 * @returns {{ apply: boolean, error: string|null }}
 */
export function parseResyncArgs(argv = []) {
  const wantsApply = argv.includes("--apply");
  const hasOwnerGo = argv.includes("--owner-go");
  if (wantsApply && !hasOwnerGo) {
    return { apply: false, error: "--apply kræver også --owner-go (eksplicit ejer-GO pr. prod-skridt). Afbryder." };
  }
  return { apply: wantsApply && hasOwnerGo, error: null };
}

export function backupTableName(now = new Date()) {
  return `backup_5751_board_mandates_goals_${now.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export function isProtectedMandate(mandate) {
  return Number(mandate?.adjustments_used || 0) > 0 || mandate?.request_used === true;
}

/**
 * Ren funktion: hvilke mål i ét mandat skal ændres, og hvordan ser den nye
 * goals-liste ud. Kun LEGACY_NEGOTIATED_GOAL_FIELDS (samme liste som
 * Boardroom-visningen) kopieres fra reconcile-resultatet; alle
 * andre felter på målet bevares præcis som i mandatet.
 *
 * @returns {{ goals: object[], changes: Array<{index:number,type:string,from:object,to:object}> }}
 */
export function planMandateGoalResync({ mandateGoals, legacyBoard }) {
  const goals = Array.isArray(mandateGoals) ? mandateGoals : [];
  const reconciled = reconcileMandateGoalsWithLegacyBoard({
    mandateGoals: goals,
    legacyGoals: parseBoardGoals(legacyBoard?.current_goals),
    legacyNegotiationStatus: legacyBoard?.negotiation_status ?? null,
    legacyNegotiatedAt: legacyBoard?.negotiated_at ?? null,
  });

  const changes = [];
  const nextGoals = goals.map((goal, index) => {
    const source = reconciled[index];
    if (!source || source === goal) return goal;
    const patch = {};
    for (const field of LEGACY_NEGOTIATED_GOAL_FIELDS) {
      if (source[field] !== undefined && source[field] !== goal[field]) patch[field] = source[field];
    }
    if (!Object.keys(patch).length) return goal;
    const from = {};
    for (const field of Object.keys(patch)) from[field] = goal[field] ?? null;
    changes.push({ index, type: goal.type, from, to: patch });
    return { ...goal, ...patch };
  });

  return { goals: nextGoals, changes };
}

async function fetchAll(supabase, table, columns, applyFilters = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyFilters(supabase.from(table).select(columns))
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Kernen: dry-run eller apply over ÉT snapshot. Ingen console.log, ingen
 * process.env — testbar med en falsk Supabase.
 */
export async function runResyncMandateGoalsFromLegacy({
  supabase,
  apply = false,
  now = new Date(),
} = {}) {
  const [mandates, boards, teams] = await Promise.all([
    fetchAll(supabase, "board_mandates", "id, team_id, status, goals, adjustments_used, request_used",
      (q) => q.eq("status", "active")),
    fetchAll(supabase, "board_profiles", "id, team_id, plan_type, current_goals, negotiation_status, negotiated_at",
      (q) => q.eq("plan_type", "1yr")),
    fetchAll(supabase, "teams", "id, name, is_ai, retired_at, parked_at"),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const boardByTeam = new Map(boards.map((b) => [b.team_id, b]));

  const result = {
    mandatesScanned: 0,
    planned: [], // { mandateId, teamId, teamName, changes, goals }
    protected: [], // { mandateId, teamId, teamName, changes }
    written: [],
    conflicts: [], // apply: mandatet ændret siden snapshottet, IKKE skrevet
    backupTable: null,
    error: null,
  };

  for (const mandate of mandates) {
    const team = teamById.get(mandate.team_id);
    if (!team || team.is_ai || team.retired_at || team.parked_at) continue;
    result.mandatesScanned += 1;

    const { goals, changes } = planMandateGoalResync({
      mandateGoals: mandate.goals,
      legacyBoard: boardByTeam.get(mandate.team_id) ?? null,
    });
    if (!changes.length) continue;

    const entry = { mandateId: mandate.id, teamId: mandate.team_id, teamName: team.name, changes };
    if (isProtectedMandate(mandate)) {
      result.protected.push(entry);
      continue;
    }
    result.planned.push({ ...entry, goals, snapshotGoalsJson: JSON.stringify(mandate.goals) });
  }

  if (!apply || !result.planned.length) return result;

  // Backup-port: tabellen skal findes og rumme hver række der skrives.
  const backupTable = backupTableName(now);
  result.backupTable = backupTable;
  // CodeRabbit-fund: .in() over mange id'er kan trunkeres stille af
  // PostgREST-rækkeloftet, så backup-tjekket køres i små bidder.
  const plannedIds = result.planned.map((p) => p.mandateId);
  const backedUpIds = new Set();
  for (let i = 0; i < plannedIds.length; i += ID_CHUNK) {
    const chunk = plannedIds.slice(i, i + ID_CHUNK);
    const { data: backedUp, error: backupError } = await supabase
      .from(backupTable).select("id").in("id", chunk);
    if (backupError) {
      result.error = `backup_missing: ${backupError.message}`;
      return result;
    }
    for (const row of backedUp || []) backedUpIds.add(row.id);
  }
  const missing = plannedIds.filter((id) => !backedUpIds.has(id));
  if (missing.length) {
    result.error = `backup_incomplete: ${missing.length} mandat-rækker mangler i ${backupTable}`;
    return result;
  }

  for (const plan of result.planned) {
    // CodeRabbit-fund: mandatet kan være ændret siden snapshottet (årsmøde,
    // bonustilbud). Genlæs og skriv KUN hvis rækken er præcis som planlagt.
    const { data: fresh, error: freshError } = await supabase.from("board_mandates")
      .select("id, status, goals, adjustments_used, request_used")
      .eq("id", plan.mandateId)
      .maybeSingle();
    if (freshError) throw new Error(`board_mandates genlæsning (${plan.mandateId}): ${freshError.message}`);
    if (!fresh || fresh.status !== "active" || isProtectedMandate(fresh)
      || JSON.stringify(fresh.goals) !== plan.snapshotGoalsJson) {
      result.conflicts.push(plan.mandateId);
      continue;
    }
    const { error } = await supabase.from("board_mandates")
      .update({ goals: plan.goals })
      .eq("id", plan.mandateId)
      .eq("status", "active");
    if (error) throw new Error(`board_mandates update (${plan.mandateId}): ${error.message}`);
    result.written.push(plan.mandateId);
  }
  return result;
}

function formatChange(change) {
  const parts = Object.keys(change.to).map((field) =>
    `${field}: ${JSON.stringify(change.from[field])} -> ${JSON.stringify(change.to[field])}`);
  return `${change.type} (${parts.join(", ")})`;
}

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  const { apply, error: argError } = parseResyncArgs(process.argv.slice(2));
  if (argError) {
    console.error(argError);
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod -- ...).");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const projectRef = (() => { try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return "ukendt"; } })();
  console.log(`Mål: ${projectRef}   Tilstand: ${apply ? "APPLY (skriver, beskyttede undtaget)" : "DRY-RUN (skriver intet)"}\n`);

  const res = await runResyncMandateGoalsFromLegacy({ supabase, apply });

  console.log(`Aktive mandater (menneskehold) scannet: ${res.mandatesScanned}`);
  console.log(`Hold med mål der ${apply ? "resynkes" : "ville blive resynket"}: ${res.planned.length} (${res.planned.reduce((n, p) => n + p.changes.length, 0)} mål)`);
  console.log(`Beskyttede hold (årsmøde har rørt mandatet, springes over): ${res.protected.length}\n`);

  for (const p of res.planned) {
    for (const c of p.changes) console.log(`${apply ? "APPLY  " : "DRY-RUN"} ${p.teamName}: ${formatChange(c)}`);
  }
  for (const p of res.protected) {
    for (const c of p.changes) console.log(`BESKYTTET ${p.teamName}: ${formatChange(c)}`);
  }

  if (res.error) {
    const table = res.backupTable;
    console.error(`\nSTOP (${res.error}). Opret backup-tabellen først:`);
    console.error(`  create table public.${table} as select id, team_id, goals, updated_at from public.board_mandates where status = 'active';`);
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry-run — intet skrevet. --apply --owner-go kræver ejer-GO på netop denne liste.");
    return;
  }

  console.log(`\nSkrevet: ${res.written.length} mandater (backup: ${res.backupTable ?? "ingen skrivning"}).`);
  const post = await runResyncMandateGoalsFromLegacy({ supabase, apply: false });
  console.log(`POST-VERIFY: ${post.planned.length} ubeskyttede hold med forskel tilbage (forventet 0), ${post.protected.length} beskyttede.`);
  if (post.planned.length) process.exit(1);
}

if (isMain()) {
  await main();
}
