#!/usr/bin/env node
// backend/scripts/proposeNextMandateDryRun.js
// ============================================================================
// #4557 S-M2c "Årsmødet" — READ-ONLY tørkørsel af `proposeNextMandate`
// (boardMandateEngine.js) mod ALLE hold der i dag har et aktivt mandat.
//
// Spec §5.4: "Prod-tørkørsel FØR flip: proposeNextMandate dry-run mod alle
// 237 hold (scorecard: mål-antal, ejere, deadline) vist ejeren LIVE; ingen
// skrivning før go."
//
// Dette script skriver ALDRIG — det er ikke `mandateShadowRebuild3514.mjs`s
// dry-run/--apply-par, der er kun ÉN tilstand her. Det regner PRÆCIS det
// samme regnestykke som `proposeNextMandate` ville (samme
// `generateBoardGoals`/`allocateNegotiationPower`/`resolveThresholds`-kald),
// men lader være at slå næste-sæson-rækken op i `seasons` eller skrive noget
// — kaldestedet (denne fil) simulerer kun "hvad VILLE der ske", uden at
// kræve at næste sæson allerede er materialiseret i kalenderen.
//
// KØRSEL (orkestratoren, med infisical):
//   cd backend && infisical run --env=prod -- node scripts/proposeNextMandateDryRun.js
//
// Valgfrit: --team=<uuid> for kun ét hold, --json for maskinlæsbar output.
//
// Refs #4557.

import { createClient } from "@supabase/supabase-js";
import { generateBoardGoals } from "../lib/boardGoals.js";
import { allocateNegotiationPower } from "../lib/boardMandateEngine.js";
import { resolveThresholds } from "../lib/boardNegotiationThresholds.js";
import { isBoardMandateModelEnabled } from "../lib/boardMandateFlag.js";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const JSON_OUTPUT = hasFlag("json");
const TEAM_FILTER = flagValue("team");

const SUPABASE_URL = flagValue("url") || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = flagValue("key") || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod -- ...).");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (() => { try { return new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { return "ukendt"; } })();

async function fetchAllRows(table, select, filter) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    let query = sb.from(table).select(select).range(from, from + PAGE - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  const flagState = await isBoardMandateModelEnabled(sb, { isBetaTester: true });
  console.log(`\nMål: ${projectRef}   Kill-switch (beta-viewer): ${flagState ? "on/beta" : "off"}   Tilstand: DRY-RUN (skriver intet)\n`);

  const { data: activeSeason, error: seasonError } = await sb
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonError) throw new Error(`seasons lookup failed: ${seasonError.message}`);
  if (!activeSeason) {
    console.error("Ingen aktiv sæson fundet — kan ikke beregne næste sæsons mandat.");
    process.exit(1);
  }
  const nextSeasonNumber = activeSeason.number + 1;

  const { data: nextSeasonRow } = await sb
    .from("seasons").select("id, number").eq("number", nextSeasonNumber).maybeSingle();

  let mandateQuery = sb.from("board_mandates")
    .select("id, team_id, focus, goals, season_number")
    .eq("status", "active");
  if (TEAM_FILTER) mandateQuery = mandateQuery.eq("team_id", TEAM_FILTER);
  const { data: activeMandates, error: mandatesError } = await mandateQuery;
  if (mandatesError) throw new Error(`board_mandates fetch failed: ${mandatesError.message}`);

  if (!activeMandates?.length) {
    console.log("Ingen aktive mandater fundet — intet at simulere.");
    return;
  }

  const teamIds = [...new Set(activeMandates.map((m) => m.team_id))];
  const relationRows = await fetchAllRows("board_relations", "team_id, confidence", (q) => q.in("team_id", teamIds));
  const confidenceByTeam = new Map(relationRows.map((r) => [r.team_id, r.confidence]));

  const memberRows = await fetchAllRows(
    "team_board_members", "team_id, archetype_key, is_chairman", (q) => q.in("team_id", teamIds)
  );
  const membersByTeam = new Map();
  for (const row of memberRows) {
    if (!membersByTeam.has(row.team_id)) membersByTeam.set(row.team_id, []);
    membersByTeam.get(row.team_id).push(row);
  }

  const teamRows = await fetchAllRows(
    "teams", "id, user_id, balance, sponsor_income, division", (q) => q.in("id", teamIds)
  );
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const userIds = teamRows.map((t) => t.user_id).filter(Boolean);
  const userRows = userIds.length
    ? await fetchAllRows("users", "id, last_seen", (q) => q.in("id", userIds))
    : [];
  const lastSeenByUser = new Map(userRows.map((u) => [u.id, u.last_seen]));

  const now = new Date();
  const scorecard = [];
  let goalCountOutOfRange = 0;
  let noShadowRelation = 0;
  let noAssignedMembers = 0;

  for (const mandate of activeMandates) {
    const confidence = confidenceByTeam.get(mandate.team_id);
    if (confidence == null) noShadowRelation += 1;

    const assignedMembers = membersByTeam.get(mandate.team_id) || [];
    if (!assignedMembers.length) noAssignedMembers += 1;

    const team = teamById.get(mandate.team_id) || null;
    const goals = generateBoardGoals({
      focus: mandate.focus || "balanced",
      planType: "1yr",
      team,
      riders: [],
      standing: null,
      assignedMembers: assignedMembers.length ? assignedMembers : null,
    });
    if (goals.length < 3 || goals.length > 5) goalCountOutOfRange += 1;

    const negotiationPower = allocateNegotiationPower(confidence ?? 50);
    const thresholds = resolveThresholds({ last_seen: lastSeenByUser.get(team?.user_id) ?? null }, now);
    const stampedOwners = goals.filter((g) => g.owner_archetype_key).length;

    scorecard.push({
      team_id: mandate.team_id,
      current_focus: mandate.focus,
      next_season_number: nextSeasonNumber,
      next_season_materialized: Boolean(nextSeasonRow?.id),
      confidence: confidence ?? "MANGLER (no_shadow_relation)",
      trust_tier: negotiationPower.trust_tier,
      adjustments_allowed: negotiationPower.adjustments_allowed,
      goal_count: goals.length,
      goals_with_owner: stampedOwners,
      auto_accept_deadline_days: thresholds.AUTO_ACCEPT,
    });
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ next_season_number: nextSeasonNumber, next_season_materialized: Boolean(nextSeasonRow?.id), scorecard }, null, 2));
  } else {
    console.log(`Næste sæson: ${nextSeasonNumber} (${nextSeasonRow?.id ? "findes allerede i kalenderen" : "IKKE materialiseret endnu — proposeNextMandate ville skippe ALLE disse hold i dag"})\n`);
    console.log(`Hold simuleret: ${scorecard.length}`);
    console.log(`  Uden skyggerelation (confidence mangler → fallback 50): ${noShadowRelation}`);
    console.log(`  Uden assignedMembers (owner_archetype_key stemples IKKE): ${noAssignedMembers}`);
    console.log(`  Mål-antal uden for 3-5-reglen: ${goalCountOutOfRange}`);
    console.log("");
    for (const row of scorecard.slice(0, 20)) {
      console.log(
        `  team=${row.team_id}  focus=${row.current_focus}  confidence=${row.confidence}  `
        + `tier=${row.trust_tier}  adjustments=${row.adjustments_allowed}  `
        + `goals=${row.goal_count} (${row.goals_with_owner} m. ejer)  `
        + `deadline=+${row.auto_accept_deadline_days}d`
      );
    }
    if (scorecard.length > 20) console.log(`  … og ${scorecard.length - 20} flere (brug --json for fuld liste)`);
  }
}

main().catch((err) => {
  console.error("Tørkørsel fejlede:", err.message);
  process.exit(1);
});
