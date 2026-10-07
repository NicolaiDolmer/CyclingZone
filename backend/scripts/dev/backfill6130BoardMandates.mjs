// #6130 · Aktive menneskehold uden en eneste board_mandates-raekke.
//
// Rod-aarsag: mandatet blev foerst oprettet ved DNA-valget
// (boardMembers.js::chooseDnaForTeam / boardAutoAccept.js::autoAcceptPendingPlan),
// ikke ved selve holddannelsen. Et nyt hold sidder i sin foerste forhandling i
// dagevis foer DNA vaelges, og et hold uden identitets-grundlag faar aldrig DNA
// via auto-accept. Begge stod derfor uden mandat. Fixet i samme PR kalder
// `ensureMandateForTeamFormation` fra `upsertOwnTeamProfile` (signup).
//
// Dette script reparerer de hold der ALLEREDE er foedt uden mandat. Det bruger
// PRAECIS `ensureMandateForTeamFormation`, samme funktion som holddannelsen,
// saa backfill og runtime ikke kan divergere.
//
// Dry-run (default) skriver INTET: klienten pakkes i en skrive-blokerende proxy
// der opsamler hver insert/update/upsert/delete i stedet for at sende den, og
// kaster ved rpc. Saa viser dry-run det mandat holdet VILLE faa, bygget af den
// aegte runtime-kode.
//
// Idempotent: kandidat-predikatet kraever at holdet har NUL mandater,
// `ensureRelationForTeam` roerer aldrig en eksisterende relation, og
// `proposeNextMandate` giver `already_exists` for (hold, saeson) der har et.
//
// Brug (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/backfill6130BoardMandates.mjs
//       (dry-run, default)
//   ... node scripts/dev/backfill6130BoardMandates.mjs --check
//       (vagt: exit 1 hvis et aktivt menneskehold mangler mandat)
//   ... node scripts/dev/backfill6130BoardMandates.mjs --apply --owner-go=6130-production
//       (skriver; kraever eksplicit ejer-go for netop denne koersel)

import { fileURLToPath } from "node:url";
import { ensureMandateForTeamFormation } from "../../lib/boardMandateEngine.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

export const OWNER_GO_TOKEN = "6130-production";

const TEAM_COLUMNS =
  "id, created_at, is_ai, is_bank, is_frozen, is_test_account, pending_removal_at, season_1_identity_basis, team_dna_key";

/**
 * DET ENE PREDIKAT for "aktivt menneskehold". Samme afgraensning som maalingen
 * i #6130: ikke AI, bank, test, frosset eller under nedlaeggelse.
 */
export function isActiveHumanTeam(team) {
  if (!team) return false;
  return !team.is_ai && !team.is_bank && !team.is_test_account && !team.is_frozen && !team.pending_removal_at;
}

/**
 * Vagten: aktive menneskehold uden en eneste mandat-raekke.
 *
 * @param {object[]} teams
 * @param {Set<string>} teamIdsWithMandate
 * @returns {object[]}
 */
export function findActiveHumanTeamsWithoutMandate(teams, teamIdsWithMandate) {
  return (teams || []).filter((t) => isActiveHumanTeam(t) && !teamIdsWithMandate.has(t.id));
}

export async function fetchSnapshot(supabase) {
  const teams = await fetchAllRows(() => supabase.from("teams").select(TEAM_COLUMNS).order("id"));
  const mandates = await fetchAllRows(() => supabase.from("board_mandates").select("id, team_id").order("id"));
  const members = await fetchAllRows(() => supabase.from("team_board_members").select("id, team_id").order("id"));
  const memberCount = new Map();
  for (const m of members) memberCount.set(m.team_id, (memberCount.get(m.team_id) || 0) + 1);
  return {
    teams,
    teamIdsWithMandate: new Set(mandates.map((m) => m.team_id)),
    memberCount,
  };
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function fakeWriteChain(table, op, payload, captured) {
  const entry = { table, op, payload };
  captured.push(entry);
  const firstRow = Array.isArray(payload) ? payload[0] : payload;
  const fakeRow = { id: `dry-run-${table}`, ...(firstRow || {}) };
  const chain = {
    then(resolve, reject) {
      return Promise.resolve({ data: chain._single ? fakeRow : [fakeRow], error: null }).then(resolve, reject);
    },
    _single: false,
  };
  for (const m of ["select", "eq", "neq", "in", "is", "match", "filter", "order", "limit"]) {
    chain[m] = () => chain;
  }
  chain.single = () => { chain._single = true; return chain; };
  chain.maybeSingle = chain.single;
  return chain;
}

/**
 * Skrive-blokerende proxy: reads gaar igennem til den rigtige klient, writes
 * opsamles i `captured` og naar aldrig databasen. rpc kaster (kan skrive).
 */
export function createDryRunClient(supabase, captured) {
  return {
    from(table) {
      const builder = supabase.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
            return (payload) => fakeWriteChain(table, prop, payload, captured);
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rpc() {
      throw new Error("dry-run: rpc er blokeret");
    },
  };
}

/**
 * Kernen. Ren nok til test: ingen console, ingen process.env.
 *
 * @param {{supabase: object, apply?: boolean, now?: Date, ensureMandate?: Function}} args
 */
export async function runBackfill6130({
  supabase,
  apply = false,
  now = new Date(),
  ensureMandate = ensureMandateForTeamFormation,
} = {}) {
  const { teams, teamIdsWithMandate, memberCount } = await fetchSnapshot(supabase);
  const candidates = findActiveHumanTeamsWithoutMandate(teams, teamIdsWithMandate)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const result = {
    activeHumanCount: teams.filter(isActiveHumanTeam).length,
    candidateCount: candidates.length,
    created: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const team of candidates) {
    const base = {
      teamId: team.id,
      createdAt: team.created_at,
      hasIdentityBasis: Boolean(team.season_1_identity_basis),
      hasDna: Boolean(team.team_dna_key),
      boardMembers: memberCount.get(team.id) || 0,
    };

    if (!apply) {
      const captured = [];
      const outcome = await ensureMandate(createDryRunClient(supabase, captured), { teamId: team.id, now });
      const mandateRow = captured.find((c) => c.table === "board_mandates" && c.op === "insert")?.payload ?? null;
      const relationRow = captured.find((c) => c.table === "board_relations" && c.op === "insert")?.payload ?? null;
      const unexpected = captured.filter((c) => !(c.op === "insert" && ["board_mandates", "board_relations"].includes(c.table)));
      result.details.push({
        ...base,
        status: mandateRow ? "dry_run_would_create" : "dry_run_no_mandate",
        reason: mandateRow ? null : (outcome === null ? "flag_off" : (outcome?.skipped ?? "unknown")),
        error: outcome?.skipped === "error" ? outcome.reason : null,
        wouldCreateRelation: Boolean(relationRow),
        mandate: mandateRow
          ? {
              seasonNumber: mandateRow.season_number,
              status: mandateRow.status,
              focus: mandateRow.focus,
              goalCount: Array.isArray(mandateRow.goals) ? mandateRow.goals.length : 0,
              goalTypes: Array.isArray(mandateRow.goals) ? mandateRow.goals.map((g) => g?.type ?? "?") : [],
              autoAcceptDeadline: mandateRow.auto_accept_deadline,
            }
          : null,
        unexpectedWrites: unexpected.map((c) => `${c.op}:${c.table}`),
      });
      continue;
    }

    // ensureMandateForTeamFormation kaster aldrig; klassificer paa svaret.
    const outcome = await ensureMandate(supabase, { teamId: team.id, now });
    if (outcome?.mandate_id && !outcome?.skipped) {
      result.created += 1;
      result.details.push({ ...base, status: "created", mandateId: outcome.mandate_id, seasonNumber: outcome.season_number, goalCount: outcome.goal_count });
    } else if (outcome?.skipped === "error") {
      result.failed += 1;
      result.details.push({ ...base, status: "failed", error: outcome.reason });
    } else {
      result.skipped += 1;
      result.details.push({ ...base, status: "skipped", reason: outcome === null ? "flag_off" : (outcome?.skipped ?? "unknown") });
    }
  }

  return result;
}

export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const check = argv.includes("--check");
  const goArg = argv.find((a) => a.startsWith("--owner-go="));
  const ownerGo = goArg ? goArg.slice("--owner-go=".length) : null;
  if (apply && ownerGo !== OWNER_GO_TOKEN) {
    return { error: `--apply kraever --owner-go=${OWNER_GO_TOKEN} (eksplicit ejer-go for netop denne koersel).` };
  }
  if (apply && check) return { error: "--apply og --check kan ikke kombineres." };
  return { apply, check };
}

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);

  if (args.check) {
    const { teams, teamIdsWithMandate } = await fetchSnapshot(supabase);
    const missing = findActiveHumanTeamsWithoutMandate(teams, teamIdsWithMandate);
    console.log(`Aktive menneskehold uden mandat: ${missing.length}`);
    for (const t of missing) console.log(`  - ${t.id} (oprettet ${t.created_at})`);
    process.exit(missing.length > 0 ? 1 : 0);
  }

  const res = await runBackfill6130({ supabase, apply: args.apply });
  console.log(`Aktive menneskehold: ${res.activeHumanCount}`);
  console.log(`Uden mandat (kandidater): ${res.candidateCount}`);
  console.log("");
  for (const d of res.details) {
    const tag = `${d.teamId} (oprettet ${d.createdAt}; grundlag=${d.hasIdentityBasis ? "ja" : "nej"}, dna=${d.hasDna ? "ja" : "nej"}, medlemmer=${d.boardMembers})`;
    if (d.status === "dry_run_would_create") {
      console.log(`DRY-RUN ${tag}`);
      console.log(`        -> ${d.wouldCreateRelation ? "ny relation + " : ""}mandat saeson ${d.mandate.seasonNumber}, status ${d.mandate.status}, fokus ${d.mandate.focus}, ${d.mandate.goalCount} maal [${d.mandate.goalTypes.join(", ")}], deadline ${d.mandate.autoAcceptDeadline}`);
      if (d.unexpectedWrites.length) console.log(`        !! uventede writes: ${d.unexpectedWrites.join(", ")}`);
    } else if (d.status === "dry_run_no_mandate") {
      console.log(`DRY-RUN ${tag} -> INTET mandat: ${d.reason}${d.error ? ` (${d.error})` : ""}`);
    } else if (d.status === "created") {
      console.log(`APPLY   ${tag} -> mandat ${d.mandateId}, saeson ${d.seasonNumber}, ${d.goalCount} maal`);
    } else if (d.status === "skipped") {
      console.log(`SKIP    ${tag} -> ${d.reason}`);
    } else if (d.status === "failed") {
      console.error(`FAIL    ${tag} -> ${d.error}`);
    }
  }

  if (args.apply) {
    const { teams, teamIdsWithMandate } = await fetchSnapshot(supabase);
    const left = findActiveHumanTeamsWithoutMandate(teams, teamIdsWithMandate);
    console.log("");
    console.log(`POST-VERIFY: oprettet ${res.created}, sprunget over ${res.skipped}, fejlet ${res.failed}; aktive menneskehold uden mandat nu: ${left.length}`);
    process.exit(res.failed > 0 || left.length > 0 ? 1 : 0);
  }
  console.log("");
  console.log(`Dry-run: intet skrevet. Anvend med --apply --owner-go=${OWNER_GO_TOKEN} (ejer-go).`);
}

if (isMain()) {
  await main();
}
