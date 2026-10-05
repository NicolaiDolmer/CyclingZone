import test from "node:test";
import assert from "node:assert/strict";

import {
  OWNER_GO_TOKEN,
  createDryRunClient,
  findActiveHumanTeamsWithoutMandate,
  isActiveHumanTeam,
  parseArgs,
  runBackfill6130,
} from "./backfill6130BoardMandates.mjs";

// Minimal read-double: from(t).select().order().range() -> { data }.
// Writes registreres i `writes`, saa testene kan bevise at dry-run ikke skriver.
function createReadDouble(tables) {
  const writes = [];
  const builder = (table) => {
    const rows = tables[table] || [];
    const b = {
      select: () => b,
      order: () => b,
      eq: () => b,
      range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
      insert: (payload) => { writes.push({ table, op: "insert", payload }); return b; },
      update: (payload) => { writes.push({ table, op: "update", payload }); return b; },
      upsert: (payload) => { writes.push({ table, op: "upsert", payload }); return b; },
      delete: () => { writes.push({ table, op: "delete" }); return b; },
      single: async () => ({ data: { id: "real" }, error: null }),
    };
    return b;
  };
  return { from: builder, rpc: async () => ({ data: null, error: null }), writes };
}

const human = (id, extra = {}) => ({
  id, created_at: `2026-10-0${id.length}T00:00:00Z`, is_ai: false, is_bank: false, is_frozen: false,
  is_test_account: false, pending_removal_at: null, season_1_identity_basis: { x: 1 }, team_dna_key: null, ...extra,
});

test("#6130 vagt: et aktivt menneskehold uden mandat bliver fanget", () => {
  const teams = [human("a"), human("bb")];
  const missing = findActiveHumanTeamsWithoutMandate(teams, new Set(["a"]));
  assert.deepEqual(missing.map((t) => t.id), ["bb"]);
});

test("#6130 vagt: AI, bank, test, frosne og hold under nedlaeggelse er ikke aktive menneskehold", () => {
  const excluded = [
    human("ai", { is_ai: true }),
    human("bank", { is_bank: true }),
    human("test", { is_test_account: true }),
    human("frozen", { is_frozen: true }),
    human("removal", { pending_removal_at: "2026-10-01T00:00:00Z" }),
  ];
  for (const t of excluded) assert.equal(isActiveHumanTeam(t), false, t.id);
  assert.deepEqual(findActiveHumanTeamsWithoutMandate(excluded, new Set()), []);
  assert.equal(isActiveHumanTeam(human("ok")), true);
});

test("#6130 parseArgs: --apply kraever det praecise owner-go-token", () => {
  assert.ok(parseArgs(["--apply"]).error);
  assert.ok(parseArgs(["--apply", "--owner-go=yes"]).error);
  assert.ok(parseArgs(["--apply", "--owner-go"]).error);
  assert.deepEqual(parseArgs(["--apply", `--owner-go=${OWNER_GO_TOKEN}`]), { apply: true, check: false });
  assert.deepEqual(parseArgs([]), { apply: false, check: false });
  assert.ok(parseArgs(["--apply", "--check", `--owner-go=${OWNER_GO_TOKEN}`]).error);
});

test("#6130 createDryRunClient: writes opsamles og naar aldrig den rigtige klient; rpc kaster", async () => {
  const base = createReadDouble({});
  const captured = [];
  const dry = createDryRunClient(base, captured);

  const { data, error } = await dry.from("board_mandates").insert({ team_id: "t1", goals: [] }).select("id").single();
  assert.equal(error, null);
  assert.equal(data.id, "dry-run-board_mandates");
  await dry.from("teams").update({ x: 1 }).eq("id", "t1");
  await dry.from("teams").upsert({ id: "t1" });
  await dry.from("teams").delete().eq("id", "t1");

  assert.deepEqual(captured.map((c) => `${c.op}:${c.table}`), [
    "insert:board_mandates", "update:teams", "upsert:teams", "delete:teams",
  ]);
  assert.equal(base.writes.length, 0, "ingen write naaede den rigtige klient");
  assert.throws(() => dry.rpc("anything"), /blokeret/);
});

test("#6130 dry-run: viser det mandat holdet ville faa og skriver intet", async () => {
  const supabase = createReadDouble({
    teams: [human("a"), human("bb"), human("ai", { is_ai: true })],
    board_mandates: [{ id: "m-a", team_id: "a" }],
    team_board_members: [],
  });
  const calls = [];
  // Stubben opfoerer sig som motoren: skriver relation + mandat gennem den klient den faar.
  const ensureMandate = async (client, { teamId }) => {
    calls.push(teamId);
    await client.from("board_relations").insert({ team_id: teamId, confidence: 50 }).select("id").single();
    const { data } = await client.from("board_mandates").insert({
      team_id: teamId, season_number: 4, status: "proposed", focus: "balanced",
      goals: [{ type: "top_n_finish" }, { type: "stage_wins" }], auto_accept_deadline: "2026-10-15T00:00:00Z",
    }).select("id").single();
    return { mandate_id: data.id, season_number: 4, goal_count: 2 };
  };

  const res = await runBackfill6130({ supabase, apply: false, ensureMandate });

  assert.equal(res.activeHumanCount, 2);
  assert.equal(res.candidateCount, 1);
  assert.deepEqual(calls, ["bb"], "kun holdet uden mandat");
  assert.equal(supabase.writes.length, 0, "dry-run skriver intet");
  const [d] = res.details;
  assert.equal(d.status, "dry_run_would_create");
  assert.equal(d.wouldCreateRelation, true);
  assert.equal(d.mandate.seasonNumber, 4);
  assert.equal(d.mandate.goalCount, 2);
  assert.deepEqual(d.mandate.goalTypes, ["top_n_finish", "stage_wins"]);
  assert.deepEqual(d.unexpectedWrites, []);
  assert.equal(res.created, 0);
});

test("#6130 dry-run: motoren springer over -> rapporteres med aarsag, ikke som oprettet", async () => {
  const supabase = createReadDouble({ teams: [human("a")], board_mandates: [], team_board_members: [] });
  const res = await runBackfill6130({ supabase, ensureMandate: async () => ({ skipped: "no_active_season" }) });
  assert.equal(res.details[0].status, "dry_run_no_mandate");
  assert.equal(res.details[0].reason, "no_active_season");
});

test("#6130 apply: klassificerer oprettet, sprunget over og fejl; hold med mandat roeres ikke", async () => {
  const supabase = createReadDouble({
    teams: [human("a"), human("bb"), human("ccc"), human("dddd")],
    board_mandates: [{ id: "m-a", team_id: "a" }],
    team_board_members: [{ id: "x", team_id: "bb" }],
  });
  const outcomes = {
    bb: { mandate_id: "m-bb", season_number: 4, goal_count: 3 },
    ccc: { skipped: "already_exists", mandate_id: "m-old" },
    dddd: { skipped: "error", reason: "boom" },
  };
  const seen = [];
  const res = await runBackfill6130({
    supabase,
    apply: true,
    ensureMandate: async (client, { teamId }) => { seen.push(teamId); assert.equal(client, supabase); return outcomes[teamId]; },
  });

  assert.deepEqual(seen.sort(), ["bb", "ccc", "dddd"]);
  assert.equal(res.created, 1);
  assert.equal(res.skipped, 1, "already_exists er idempotent no-op, ikke oprettet");
  assert.equal(res.failed, 1);
  assert.equal(res.details.find((d) => d.teamId === "bb").boardMembers, 1);
});
