// #6579 · Test af udvaelgelse + idempotens for engangs-refusionen af scout-missioner (#6551).
import assert from "node:assert/strict";
import test from "node:test";
import { isRiderHiddenFromReport } from "../../backend/lib/scoutReportVisibility.js";
import {
  selectAffectedMissions,
  summarize,
  teamAliases,
  isHidden,
  refundIdempotencyKey,
  originalDebitKey,
  executeRefunds,
  executeGate,
  parseArgs,
  buildNotification,
  buildFinancePayload,
  NOTIF_MESSAGE_CODE,
} from "./refund-6551-scout-missions.mjs";

const mission = (id, team, shortlist, extra = {}) => ({
  id, team_id: team, kind: "mission", status: "completed", season_id: "s1",
  completed_at: "2026-10-12T12:21:00Z", result: { shortlist }, ...extra,
});
const free = (id) => ({ id, team_id: null, pending_team_id: null, is_academy: false, owner_is_ai: false });

function fixture() {
  const missions = [
    mission("m-all-offered", "t1", ["r1", "r2"]), // alle skjulte (offered intake) -> med
    mission("m-deleted", "t2", ["r3", "gone"]), // offered + slettet -> med
    mission("m-partial", "t3", ["r1", "r4"]), // en synlig -> ikke med
    mission("m-empty", "t4", []), // reelt tom fra start -> ikke med (B fravalgt)
    mission("m-no-debit", "t5", ["r1"]), // ingen oprindelig debitering -> sprunget over
    mission("m-active", "t6", ["r1"], { status: "active" }), // ikke faerdig -> ikke med
    mission("m-target", "t7", ["r1"], { kind: "target" }), // ikke mission -> ikke med
    mission("m-ai-pending", "t1", ["r5", "r6"]), // AI-ejet + pending -> med
  ];
  const ridersById = new Map([
    ["r1", free("r1")], ["r2", free("r2")], ["r3", free("r3")], ["r4", free("r4")],
    ["r5", { ...free("r5"), team_id: "ai", owner_is_ai: true }],
    ["r6", { ...free("r6"), pending_team_id: "x" }],
  ]);
  const offeredRiderIds = new Set(["r1", "r2", "r3"]);
  const debitsByKey = new Map(
    ["m-all-offered:t1", "m-deleted:t2", "m-partial:t3", "m-empty:t4", "m-ai-pending:t1"].map((s) => {
      const [m, t] = s.split(":");
      return [originalDebitKey(t, m), { amount: -6000 }];
    }),
  );
  return { missions, ridersById, offeredRiderIds, debitsByKey, refundedKeys: new Set() };
}

test("udvaelgelse: kun faerdige missioner hvor hele shortlisten er skjult/slettet", () => {
  const { rows, skipped } = selectAffectedMissions(fixture());
  assert.deepEqual(rows.map((r) => r.assignmentId).sort(), ["m-ai-pending", "m-all-offered", "m-deleted"]);
  assert.deepEqual(skipped.map((s) => [s.assignmentId, s.reason]), [["m-no-debit", "no_original_debit"]]);
  for (const r of rows) {
    assert.equal(r.amount, 6000);
    assert.equal(r.idempotencyKey, refundIdempotencyKey(r.assignmentId));
    assert.equal(r.completedOn, "2026-10-12");
  }
  const s = summarize(rows);
  assert.equal(s.count, 3);
  assert.equal(s.teams, 2);
  assert.equal(s.total, 18000);
});

test("udvaelgelse: allerede refunderede markeres og taeller ikke som afventende", () => {
  const f = fixture();
  f.refundedKeys.add(refundIdempotencyKey("m-deleted"));
  const { rows } = selectAffectedMissions(f);
  assert.equal(rows.find((r) => r.assignmentId === "m-deleted").alreadyRefunded, true);
  const s = summarize(rows);
  assert.equal(s.total, 18000);
  assert.equal(s.pendingCount, 2);
  assert.equal(s.pendingTotal, 12000);
});

test("isHidden er enig med visningslagets isRiderHiddenFromReport", () => {
  const cases = [
    [free("a"), true], [free("a"), false],
    [{ ...free("a"), team_id: "t" }, true],
    [{ ...free("a"), is_academy: true }, true],
    [{ ...free("a"), pending_team_id: "p" }, false],
    [{ ...free("a"), owner_is_ai: true, team_id: "ai" }, false],
  ];
  for (const [r, offered] of cases) {
    const expected = isRiderHiddenFromReport({
      teamId: r.team_id, pendingTeamId: r.pending_team_id, isAcademy: r.is_academy,
      hasOpenIntakeOffer: offered, ownerIsAi: r.owner_is_ai,
    });
    assert.equal(isHidden(r, new Set(offered ? [r.id] : [])), expected, JSON.stringify({ r, offered }));
  }
  assert.equal(isHidden(undefined, new Set()), true, "slettet rytter er skjult");
});

// Fake Supabase-klient der haandhaever UNIQUE(idempotency_key) som RPC'en goer.
function fakeClient() {
  const ledger = new Map();
  const balances = new Map();
  const notifications = [];
  return {
    ledger, balances, notifications,
    async rpc(name, { p_team_id, p_delta, p_finance_payload }) {
      assert.equal(name, "increment_balance_with_audit");
      if (ledger.has(p_finance_payload.idempotency_key)) return { data: null, error: { code: "23505" } };
      ledger.set(p_finance_payload.idempotency_key, p_finance_payload);
      balances.set(p_team_id, (balances.get(p_team_id) ?? 0) + p_delta);
      return { data: balances.get(p_team_id), error: null };
    },
    from(table) {
      assert.equal(table, "notifications");
      return { insert: async (row) => { notifications.push(row); return { error: null }; } };
    },
  };
}

test("idempotens: to koersler betaler og notificerer kun een gang", async () => {
  const { rows } = selectAffectedMissions(fixture());
  const client = fakeClient();
  const userIdByTeam = new Map([["t1", "u1"], ["t2", "u2"]]);
  const notified = new Set();

  const first = await executeRefunds(client, rows, { userIdByTeam, notifiedAssignmentIds: notified });
  assert.ok(first.every((r) => r.status === "refunded" && r.notified === "notified"));
  assert.equal(client.balances.get("t1"), 12000);
  assert.equal(client.balances.get("t2"), 6000);
  assert.equal(client.notifications.length, 3);

  // Anden koersel med samme (forældede) plan: RPC'en afviser med 23505 -> skipped.
  const second = await executeRefunds(client, rows, { userIdByTeam, notifiedAssignmentIds: notified });
  assert.ok(second.every((r) => r.status === "already_refunded" && r.notified === "already_notified"));
  assert.equal(client.balances.get("t1"), 12000);
  assert.equal(client.balances.get("t2"), 6000);
  assert.equal(client.notifications.length, 3);
  assert.equal(client.ledger.size, 3);
});

test("idempotens: genkoersel indhenter en manglende notifikation uden ny betaling", async () => {
  const { rows } = selectAffectedMissions(fixture());
  const client = fakeClient();
  const one = rows.filter((r) => r.assignmentId === "m-deleted");
  await executeRefunds(client, one, { userIdByTeam: new Map(), notifiedAssignmentIds: new Set() });
  assert.equal(client.notifications.length, 0);
  const again = await executeRefunds(client, one, { userIdByTeam: new Map([["t2", "u2"]]), notifiedAssignmentIds: new Set() });
  assert.deepEqual(again, [{ assignmentId: "m-deleted", status: "already_refunded", notified: "notified" }]);
  assert.equal(client.balances.get("t2"), 6000);
});

test("payloads: ledger-noegle pr. assignment og i18n-noegler i notifikationen", () => {
  const { rows } = selectAffectedMissions(fixture());
  const row = rows[0];
  const p = buildFinancePayload(row);
  assert.equal(p.idempotency_key, `scout_refund_6551:${row.assignmentId}`);
  assert.equal(p.amount, 6000);
  assert.equal(p.type, "scout_travel");
  const n = buildNotification(row, "u1");
  assert.equal(n.related_id, row.assignmentId);
  assert.equal(n.metadata.messageCode, NOTIF_MESSAGE_CODE);
  assert.deepEqual(n.metadata.messageParams, { date: "2026-10-12", amount: 6000 });
  assert.match(n.message, /6,000 CZ\$ has been refunded/);
});

test("execute-gate: kraever OWNER_GO og matchende tal", () => {
  const summary = { count: 9, total: 54000 };
  const opts = parseArgs(["--execute", "--expect-count=9", "--expect-total=54000"]);
  assert.match(executeGate(opts, summary, {}), /OWNER_GO/);
  assert.equal(executeGate(opts, summary, { OWNER_GO: "1" }), null);
  assert.match(executeGate(opts, { count: 10, total: 60000 }, { OWNER_GO: "1" }), /matcher ikke/);
  assert.match(executeGate(parseArgs(["--execute"]), summary, { OWNER_GO: "1" }), /expect-count/);
  assert.equal(parseArgs([]).execute, false, "default er dry-run");
  assert.throws(() => parseArgs(["--execute", "--dry-run"]));
  assert.throws(() => parseArgs(["--bogus"]));
});

test("aliaser: stabile Hold A/B i forekomst-raekkefoelge", () => {
  const a = teamAliases([{ teamId: "x" }, { teamId: "y" }, { teamId: "x" }]);
  assert.equal(a.get("x"), "Hold A");
  assert.equal(a.get("y"), "Hold B");
});
