#!/usr/bin/env node
// #6710 (plan-PR 1 i #5833) · DRY-RUN, READ-ONLY: hvem ville blive "afventer
// oprykning" ved saesonskiftet (25/10), hvis promotion_pending_enabled er on?
//
// Simulerer default-kaeden for maal-saesonen PR. HOLD i samme raekkefoelge som
// sweepet (grad-raekkerne oprettes i rytter-id-orden af detectGraduates):
//   plads i maal-truppen + ikke-negativ saldo → rykkes op (truppen fyldes)
//   plads + negativ saldo                    → saelges (som i dag)
//   INGEN plads                              → afventer (i dag: saelges/slippes)
// En u23 → senior-oprykning frigiver en U23-plads til en senere junior.
//
// Samme byggeklodser som produktionen: ageForSeason (riderSeasonAge.js),
// effectiveSquad + transitionForRider + SQUAD_CAPS (squads.js) og
// getTeamMarketState (seniortruppens future_count + division-cap + saldo).
// Kun menneskehold (teams.is_ai = false).
//
// Antagelser (tilnaermelse, ikke en garanti): manageren goer intet i de 7 dages
// vindue, ingen andre ryttere forlader/kommer til truppen ved skiftet, og
// kontraktudloeb/pension ved skiftet er ikke modregnet (de kan frigive plads).
//
// SKRIVER INTET. Ingen --execute findes. Output: antal + holdaliaser (Hold A, B,
// ...). Holdnavne skrives aldrig; --json giver team_id'er til egen opfoelgning.
//
// Usage:
//   node backend/scripts/dryrun-6710-promotion-pending.js                 # maal = kommende saeson
//   node backend/scripts/dryrun-6710-promotion-pending.js --season 5 --json
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, kun SELECT bruges)
// Exit: 0 = rapport skrevet, 2 = kald-/konfigurationsfejl.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ageForSeason } from "../lib/riderSeasonAge.js";
import { SQUAD_CAPS, effectiveSquad, transitionForRider } from "../lib/squads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * Ren simulering — testbar uden database.
 *
 * @param {{riders:Array<{id:string, team_id:string, birthdate:string|null, squad:string|null, is_academy:boolean}>,
 *   teams:Map<string, {seniorFuture:number, seniorCap:number, balance:number}>, seasonNumber:number}} input
 * @returns {{totals:Record<string, {promote:number, sell:number, pending:number}>, perTeam:Array<{teamId:string,
 *   juniorPending:number, u23Pending:number, juniorPromote:number, u23Promote:number}>}}
 */
export function planPromotionPending({ riders, teams, seasonNumber }) {
  const totals = {
    "junior->u23": { promote: 0, sell: 0, pending: 0 },
    "u23->senior": { promote: 0, sell: 0, pending: 0 },
  };
  const byTeam = new Map();
  for (const r of riders) {
    if (!teams.has(r.team_id)) continue; // kun menneskehold
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }

  const perTeam = [];
  for (const [teamId, list] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teams.get(teamId);
    const withSquad = list.map((r) => {
      const age = ageForSeason(r.birthdate, seasonNumber);
      const squad = effectiveSquad(r, age);
      return { r, squad, transition: transitionForRider({ squad, seasonAge: age }) };
    });
    let u23Count = withSquad.filter((x) => x.squad === "u23").length;
    let seniorFuture = team.seniorFuture;
    const row = { teamId, juniorPending: 0, u23Pending: 0, juniorPromote: 0, u23Promote: 0 };

    for (const x of [...withSquad].sort((a, b) => a.r.id.localeCompare(b.r.id))) {
      if (!x.transition) continue;
      const key = `${x.transition.from}->${x.transition.to}`;
      if (!totals[key]) continue;
      const room = x.transition.to === "u23"
        ? u23Count + 1 <= SQUAD_CAPS.u23
        : seniorFuture + 1 <= team.seniorCap;
      if (!room) {
        totals[key].pending++;
        if (x.transition.to === "u23") row.juniorPending++; else row.u23Pending++;
        continue;
      }
      if (team.balance < 0) { totals[key].sell++; continue; }
      totals[key].promote++;
      if (x.transition.to === "u23") { u23Count++; row.juniorPromote++; } else { seniorFuture++; u23Count--; row.u23Promote++; }
    }
    perTeam.push(row);
  }
  return { totals, perTeam };
}

/** "Hold A", "Hold B", ... "Hold AA" — aldrig holdnavne i output. */
export function teamAlias(index) {
  let n = index;
  let s = "";
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return `Hold ${s}`;
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  const i = argv.indexOf("--season");
  const season = i >= 0 ? Number(argv[i + 1]) : null;
  if (i >= 0 && !Number.isFinite(season)) return { error: "--season kraever et tal" };
  return { json, season };
}

async function resolveTargetSeason(supabase, explicit) {
  if (Number.isFinite(explicit)) return explicit;
  const { data: upcoming, error } = await supabase.from("seasons")
    .select("number").eq("status", "upcoming").order("number", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`seasons(upcoming): ${error.message}`);
  if (Number.isFinite(upcoming?.number)) return upcoming.number;
  const { data: active, error: activeErr } = await supabase.from("seasons")
    .select("number").eq("status", "active").maybeSingle();
  if (activeErr) throw new Error(`seasons(active): ${activeErr.message}`);
  if (!Number.isFinite(active?.number)) throw new Error("ingen aktiv eller kommende saeson");
  return active.number + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error); process.exit(2); }

  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_KEY kraeves");
    process.exit(2);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllRows } = await import("../lib/supabasePagination.js");
  const { getTeamMarketState } = await import("../lib/marketUtils.js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const seasonNumber = await resolveTargetSeason(supabase, args.season);
  const humanTeams = await fetchAllRows(() =>
    supabase.from("teams").select("id").eq("is_ai", false).order("id"));
  const riders = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, birthdate, squad, is_academy")
      .eq("is_academy", true).eq("is_retired", false)
      .not("team_id", "is", null)
      .order("id"));

  const humanIds = new Set(humanTeams.map((t) => t.id));
  const teamsWithAcademy = [...new Set(riders.map((r) => r.team_id).filter((id) => humanIds.has(id)))];
  const teams = new Map();
  for (const teamId of teamsWithAcademy) {
    const state = await getTeamMarketState(supabase, teamId);
    teams.set(teamId, {
      seniorFuture: state?.future_count ?? state?.rider_count ?? 0,
      seniorCap: state?.squad_limits?.max ?? 30,
      balance: Number(state?.balance ?? 0),
    });
  }

  const { totals, perTeam } = planPromotionPending({ riders, teams, seasonNumber });
  const affected = perTeam.filter((t) => t.juniorPending + t.u23Pending > 0);

  if (args.json) {
    console.log(JSON.stringify({ seasonNumber, totals, affected }, null, 2));
    return;
  }
  console.log(`#6710 dry-run (READ-ONLY) · maal-saeson S${seasonNumber} · ${teams.size} menneskehold med ungdomsryttere`);
  for (const [key, t] of Object.entries(totals)) {
    console.log(`  ${key}: rykkes op ${t.promote} · saelges (negativ saldo) ${t.sell} · AFVENTER ${t.pending}`);
  }
  console.log(`  Hold med mindst en afventende: ${affected.length}`);
  affected.forEach((t, i) => {
    console.log(`    ${teamAlias(i)}: juniorer afventer ${t.juniorPending} · U23 afventer ${t.u23Pending}`);
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
