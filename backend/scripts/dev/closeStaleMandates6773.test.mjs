import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKUP_TABLE,
  OWNER_GO_TOKEN,
  approvedListHash,
  buildBackupSql,
  createReadOnlyClient,
  parseArgs,
  planStaleMandateClosure,
  renderPublicSummary,
  resolveActiveSeason,
  runApply,
  runDryRun,
} from "./closeStaleMandates6773.mjs";

// Fake med den form scriptet + closeEndedSeasonMandates bruger:
//   select().in().order().range() / select().order() (thenable)
//   update().eq().eq().lte().select()
// Skrivninger registreres i `writes`.
function createDouble(tables) {
  const writes = [];
  const from = (table) => {
    const rows = tables[table] || (tables[table] = []);
    const filters = [];
    const match = (r) => filters.every((f) => f(r));
    const read = {
      select: () => read,
      eq(col, v) { filters.push((r) => r[col] === v); return read; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return read; },
      order: () => read,
      range: async (a, b) => ({ data: rows.filter(match).slice(a, b + 1), error: null }),
      maybeSingle: async () => { tables.__onMaybeSingle?.(table); return { data: rows.filter(match)[0] ?? null, error: null }; },
      then: (resolve) => resolve({ data: rows.filter(match), error: null }),
    };
    return {
      ...read,
      select: () => read,
      update(payload) {
        writes.push({ table, op: "update", payload });
        const up = {
          eq(col, v) { filters.push((r) => r[col] === v); return up; },
          lte(col, v) { filters.push((r) => r[col] != null && Number(r[col]) <= v); return up; },
          select: async () => {
            const hit = rows.filter(match);
            hit.forEach((r) => Object.assign(r, payload));
            return { data: hit.map((r) => ({ id: r.id })), error: null };
          },
        };
        return up;
      },
      insert(payload) { writes.push({ table, op: "insert", payload }); return read; },
      delete() { writes.push({ table, op: "delete" }); return read; },
    };
  };
  return { from, rpc: async () => ({ data: null, error: null }), writes };
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SEASONS = [
  { id: "s2", number: 2, status: "completed" },
  { id: "s3", number: 3, status: "completed" },
  { id: "s4", number: 4, status: "active" },
];

function fixture() {
  return {
    seasons: SEASONS.map((s) => ({ ...s })),
    teams: [{ id: "tA", is_frozen: false }, { id: "tB", is_frozen: true }, { id: "tC", is_frozen: false }],
    board_mandates: [
      // Hold A: gammelt S3 underskrevet EFTER S4 (rod-årsagens form).
      { id: id(1), team_id: "tA", season_id: "s3", season_number: 3, status: "active", signed_at: "2026-10-03T08:00:00Z",
        goals: [{ type: "stage_wins", target: 2, source: "board" }, { type: "signature_rider", target: 1, source: "bonus_offer", bonus_offer_id: "bo-1" }] },
      { id: id(2), team_id: "tA", season_id: "s4", season_number: 4, status: "active", signed_at: "2026-09-29T08:00:00Z",
        goals: [{ type: "gc_top10", target: 1, source: "board" }] },
      // Hold B (frosset): kun et gammelt S3 + et hængende S3-forslag.
      { id: id(3), team_id: "tB", season_id: "s3", season_number: 3, status: "active", signed_at: "2026-10-01T08:00:00Z" },
      { id: id(4), team_id: "tB", season_id: "s2", season_number: 2, status: "proposed", signed_at: null },
      // Hold C: alt i orden.
      { id: id(5), team_id: "tC", season_id: "s4", season_number: 4, status: "active", signed_at: "2026-09-28T08:00:00Z" },
      { id: id(6), team_id: "tC", season_id: "s3", season_number: 3, status: "completed", signed_at: "2026-08-01T08:00:00Z" },
      // Uden season_number: uden for scope, som runtime.
      { id: id(7), team_id: "tC", season_id: "s2", season_number: null, status: "active", signed_at: null },
    ],
  };
}

test("#6773 resolveActiveSeason: præcis én aktiv sæson, ellers kast (intet gættes)", () => {
  assert.deepEqual(resolveActiveSeason(SEASONS), { id: "s4", number: 4 });
  assert.throws(() => resolveActiveSeason([{ id: "s3", number: 3, status: "completed" }]), /præcis én aktiv sæson/);
  assert.throws(() => resolveActiveSeason([...SEASONS, { id: "s5", number: 5, status: "active" }]), /præcis én aktiv sæson/);
});

test("#6773 plan: lukker kun åbne mandater for afsluttede sæsoner (active → completed, proposed → lapsed)", () => {
  const t = fixture();
  const plan = planStaleMandateClosure({ seasons: t.seasons, mandates: t.board_mandates, teams: t.teams });
  assert.equal(plan.threshold, 3);
  assert.deepEqual(plan.rows.map((r) => [r.id, r.from, r.to]), [
    [id(1), "active", "completed"],
    [id(3), "active", "completed"],
    [id(4), "proposed", "lapsed"],
  ]);
  assert.deepEqual(plan.teamIds, ["tA", "tB"]);
  assert.equal(plan.counts.total, 3);
  assert.equal(plan.counts.activeToCompleted, 2);
  assert.equal(plan.counts.proposedToLapsed, 1);
  assert.equal(plan.counts.teamsAlsoWithCurrentActive, 1, "kun hold A har også et aktivt S4-mandat");
  assert.equal(plan.counts.staleSignedAfterCurrent, 1, "hold A's S3 er underskrevet efter S4");
  assert.equal(plan.counts.frozenTeams, 1);
  assert.equal(plan.outOfScopeCount, 1);
  assert.deepEqual(plan.counts.bySeason, { S3: { active: 2, proposed: 0 }, S2: { active: 0, proposed: 1 } });
});

test("#6773 offentlig sammenfatning: kun tal, ingen id'er", () => {
  const t = fixture();
  const plan = planStaleMandateClosure({ seasons: t.seasons, mandates: t.board_mandates, teams: t.teams });
  const text = renderPublicSummary(plan, approvedListHash(plan));
  for (const row of t.board_mandates) assert.ok(!text.includes(row.id), "ingen mandat-id i konsollen");
  for (const team of t.teams) assert.ok(!text.includes(team.id), "ingen hold-id i konsollen");
  assert.match(text, /Rækker der ville blive lukket: 3/);
});

test("#6773 dry-run: skriver INTET, og read-only-klienten kaster ved et skriveforsøg", async () => {
  const double = createDouble(fixture());
  const { plan, hash } = await runDryRun({ supabase: double });
  assert.equal(plan.counts.total, 3);
  assert.equal(hash.length, 16);
  assert.equal(double.writes.length, 0);
  assert.throws(() => createReadOnlyClient(double).from("board_mandates").update({ status: "x" }), /blokeret/);
  assert.throws(() => createReadOnlyClient(double).rpc("x"), /blokeret/);
});

test("#6773 backup-SQL: idempotent og dækker præcis plan-rækkerne", () => {
  const t = fixture();
  const plan = planStaleMandateClosure({ seasons: t.seasons, mandates: t.board_mandates, teams: t.teams });
  const sql = buildBackupSql(plan);
  assert.match(sql, new RegExp(`create table if not exists public\\.${BACKUP_TABLE}`));
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /revoke all on table public\.backup_6773_board_mandates from public, anon, authenticated, service_role/);
  assert.match(sql, /grant select on table public\.backup_6773_board_mandates to service_role/, "apply læser backuppen som service_role");
  for (const r of plan.rows) assert.ok(sql.includes(r.id));
  assert.ok(sql.includes(id(2)), "modtageren af bonusmålet er med i backuppen");
  assert.ok(!sql.includes(id(5)), "urørte aktuelle mandater er ikke med");
});

test("#6773 parseArgs: --apply kræver ejer-go OG godkendt hash", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: null, approvedHash: null, allowOrphanBonus: 0 });
  assert.equal(parseArgs(["--allow-orphan-bonus=2"]).allowOrphanBonus, 2);
  assert.ok(parseArgs(["--apply"]).error);
  assert.ok(parseArgs(["--apply", `--owner-go=${OWNER_GO_TOKEN}`]).error);
  assert.equal(parseArgs(["--apply", `--owner-go=${OWNER_GO_TOKEN}`, "--approved-list=abc"]).apply, true);
});

test("#6773 apply: afviger listen fra den godkendte → intet skrevet", async () => {
  const double = createDouble(fixture());
  await assert.rejects(
    () => runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: "forkert" }),
    /afviger fra den godkendte/,
  );
  assert.equal(double.writes.length, 0);
});

test("#6773 apply: mangler backuppen → intet skrevet", async () => {
  const tables = fixture();
  const double = createDouble(tables);
  const { hash } = await runDryRun({ supabase: double });
  await assert.rejects(
    () => runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash }),
    /Backuppen mangler/,
  );
  assert.equal(double.writes.length, 0);
});

test("#6773 apply: lukker via runtime-funktionen, post-verify 0, og en genkørsel finder intet (idempotent)", async () => {
  const tables = fixture();
  const double = createDouble(tables);
  const { plan, hash } = await runDryRun({ supabase: double });
  tables[BACKUP_TABLE] = [...plan.rows.map((r) => ({ id: r.id })), { id: id(2) }];

  const now = new Date("2026-10-18T10:00:00Z");
  const out = await runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash, now });
  assert.deepEqual(out.result, { completed: 2, lapsed: 1, bonusGoalsMoved: 1, skipped: [] });
  assert.equal(out.remaining, 0);

  const byId = Object.fromEntries(tables.board_mandates.map((m) => [m.id, m]));
  assert.equal(byId[id(1)].status, "completed");
  assert.equal(byId[id(3)].status, "completed");
  assert.equal(byId[id(4)].status, "lapsed");
  assert.equal(byId[id(2)].status, "active", "det aktuelle S4-mandat røres ikke");
  assert.equal(byId[id(5)].status, "active");
  assert.equal(byId[id(7)].status, "active", "uden season_number: uden for scope");
  assert.ok(double.writes.every((w) => w.table === "board_mandates"
    && ["status,updated_at", "goals,updated_at"].includes(Object.keys(w.payload).sort().join(","))),
    "kun status/goals + updated_at skrives");
  assert.ok(byId[id(2)].goals.some((g) => g.bonus_offer_id === "bo-1"), "S4-bonusmålet ligger nu på det aktuelle mandat");
  assert.equal(byId[id(2)].goals.filter((g) => g.source === "board").length, 1, "mandatets egne mål røres ikke");

  const again = await runDryRun({ supabase: double });
  assert.equal(again.plan.counts.total, 0);
});

test("#6773 plan: tæller bonusmål der flyttes, og dem uden aktuelt mandat", () => {
  const t = fixture();
  t.board_mandates.find((m) => m.id === id(3)).goals = [{ type: "x", target: 1, source: "bonus_offer", bonus_offer_id: "bo-9" }];
  const plan = planStaleMandateClosure({ seasons: t.seasons, mandates: t.board_mandates, teams: t.teams });
  assert.equal(plan.counts.bonusGoalsToMove, 1);
  assert.equal(plan.counts.bonusGoalsWithoutTarget, 1, "hold B har intet S4-mandat at flytte til");
  assert.deepEqual(plan.bonusMoves.map((m) => [m.fromId, m.toId]), [[id(1), id(2)]]);
});

test("#6773 apply: lukker kun godkendte id'er; en række der har skiftet status springes over", async () => {
  const tables = fixture();
  const double = createDouble(tables);
  const { plan, hash } = await runDryRun({ supabase: double });
  tables[BACKUP_TABLE] = [...plan.rows.map((r) => ({ id: r.id })), { id: id(2) }];
  const realFrom = double.from;
  let flipped = false;
  double.from = (table) => {
    const q = realFrom(table);
    if (table === "board_mandates" && !flipped && q.update) {
      const origUpdate = q.update;
      q.update = (payload) => {
        if (payload.status === "lapsed" && !flipped) { flipped = true; tables.board_mandates.find((m) => m.id === id(4)).status = "active"; }
        return origUpdate(payload);
      };
    }
    return q;
  };
  const out = await runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash, now: new Date("2026-10-18T10:00:00Z") });
  assert.equal(out.result.lapsed, 0);
  assert.deepEqual(out.result.skipped.map((s) => s.id), [id(4)]);
});

test("#6773 (Codex) apply: bonusmål uden modtager kræver ejerens præcise antal, ellers intet skrevet", async () => {
  const tables = fixture();
  tables.board_mandates.find((m) => m.id === id(3)).goals = [{ type: "x", target: 1, source: "bonus_offer", bonus_offer_id: "bo-9" }];
  const double = createDouble(tables);
  const { plan, hash } = await runDryRun({ supabase: double });
  assert.equal(plan.counts.bonusGoalsWithoutTarget, 1);
  tables[BACKUP_TABLE] = [...plan.rows.map((r) => ({ id: r.id })), { id: id(2) }];
  await assert.rejects(
    () => runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash }),
    /--allow-orphan-bonus=1/,
  );
  assert.equal(double.writes.length, 0);
  const out = await runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash, allowOrphanBonus: 1, now: new Date("2026-10-18T10:00:00Z") });
  assert.equal(out.result.completed, 2);
});

test("#6773 (Codex) apply: mislykkes en bonus-flytning, lukkes kilden ikke", async () => {
  const tables = fixture();
  const double = createDouble(tables);
  const { plan, hash } = await runDryRun({ supabase: double });
  tables[BACKUP_TABLE] = [...plan.rows.map((r) => ({ id: r.id })), { id: id(2) }];
  // Modtageren holder op med at være aktiv EFTER apply har læst planen
  // (mellem snapshot og flytning), dvs. midt i apply.
  tables.__onMaybeSingle = (table) => {
    if (table === "board_mandates") tables.board_mandates.find((m) => m.id === id(2)).status = "completed";
  };
  const out = await runApply({ supabase: double, ownerGo: OWNER_GO_TOKEN, approvedHash: hash, now: new Date("2026-10-18T10:00:00Z") });
  assert.equal(tables.board_mandates.find((m) => m.id === id(1)).status, "active", "kilden med bonusmålet står åben");
  assert.ok(out.result.skipped.some((s) => /kilden lukkes ikke/.test(s.reason)));
});
