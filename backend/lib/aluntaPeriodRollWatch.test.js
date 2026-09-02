import test from "node:test";
import assert from "node:assert/strict";
import {
  selectRecentPeriodRolls,
  findMissingInvoiceRolls,
  formatMissingInvoiceFindings,
  runAluntaPeriodRollWatch,
  PERIOD_ROLL_WINDOW_MS,
  INVOICE_LOOKBACK_BUFFER_MS,
} from "./aluntaPeriodRollWatch.js";

const NOW = new Date("2026-09-02T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// ── selectRecentPeriodRolls ──────────────────────────────────────────────────

test("selectRecentPeriodRolls: active/past_due med nylig updated_at inkluderes", () => {
  const rows = [
    { team_id: "a", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: iso(NOW.getTime() - 60 * 60 * 1000) },
    { team_id: "b", status: "past_due", current_period_end: iso(NOW.getTime() + 10 * 864e5), updated_at: iso(NOW.getTime() - 2 * 60 * 60 * 1000) },
  ];
  const rolls = selectRecentPeriodRolls(rows, { now: NOW });
  assert.equal(rolls.length, 2);
  assert.deepEqual(rolls.map((r) => r.teamId).sort(), ["a", "b"]);
});

test("selectRecentPeriodRolls: cancelled/inactive ekskluderes uanset updated_at", () => {
  const rows = [
    { team_id: "a", status: "cancelled", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: iso(NOW.getTime() - 60 * 1000) },
    { team_id: "b", status: "inactive", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: iso(NOW.getTime() - 60 * 1000) },
  ];
  assert.deepEqual(selectRecentPeriodRolls(rows, { now: NOW }), []);
});

test("selectRecentPeriodRolls: updated_at ud over vinduet ekskluderes", () => {
  const rows = [
    { team_id: "a", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: iso(NOW.getTime() - PERIOD_ROLL_WINDOW_MS - 1000) },
  ];
  assert.deepEqual(selectRecentPeriodRolls(rows, { now: NOW }), []);
});

test("selectRecentPeriodRolls: fremtidig updated_at (ugyldig/clock-skew) ekskluderes", () => {
  const rows = [
    { team_id: "a", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: iso(NOW.getTime() + 60 * 1000) },
  ];
  assert.deepEqual(selectRecentPeriodRolls(rows, { now: NOW }), []);
});

test("selectRecentPeriodRolls: mangler current_period_end eller updated_at -> ekskluderes", () => {
  const rows = [
    { team_id: "a", status: "active", current_period_end: null, updated_at: iso(NOW.getTime() - 1000) },
    { team_id: "b", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), updated_at: null },
  ];
  assert.deepEqual(selectRecentPeriodRolls(rows, { now: NOW }), []);
});

// ── findMissingInvoiceRolls ───────────────────────────────────────────────────

test("findMissingInvoiceRolls: faktura fundet i vinduet -> IKKE i missing-listen", async () => {
  const roll = { teamId: "a", alunta_customer_id: "cus-a", current_period_end: iso(NOW.getTime()), updated_at: iso(NOW.getTime() - 3600_000) };
  const calls = [];
  const client = {
    listInvoices: async (args) => { calls.push(args); return { data: [{ uuid: "inv-1" }] }; },
  };
  const missing = await findMissingInvoiceRolls({ client, rolls: [roll], now: NOW });
  assert.equal(missing.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customerUuid, "cus-a");
  assert.equal(calls[0].dateTo, "2026-09-02");
});

test("findMissingInvoiceRolls: ingen faktura i vinduet -> reason=no_invoice_in_window", async () => {
  const roll = { teamId: "a", alunta_customer_id: "cus-a", current_period_end: iso(NOW.getTime()), updated_at: iso(NOW.getTime() - 3600_000) };
  const client = { listInvoices: async () => ({ data: [] }) };
  const missing = await findMissingInvoiceRolls({ client, rolls: [roll], now: NOW });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reason, "no_invoice_in_window");
});

test("findMissingInvoiceRolls: intet alunta_customer_id -> reason=no_customer_id, INGEN Alunta-kald", async () => {
  const roll = { teamId: "a", alunta_customer_id: null, current_period_end: iso(NOW.getTime()), updated_at: iso(NOW.getTime()) };
  let called = false;
  const client = { listInvoices: async () => { called = true; return { data: [] }; } };
  const missing = await findMissingInvoiceRolls({ client, rolls: [roll], now: NOW });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reason, "no_customer_id");
  assert.equal(called, false);
});

test("findMissingInvoiceRolls: Alunta-opslag fejler -> reason=fetch_failed, andre rolls fortsætter", async () => {
  const rolls = [
    { teamId: "a", alunta_customer_id: "cus-a", current_period_end: iso(NOW.getTime()), updated_at: iso(NOW.getTime()) },
    { teamId: "b", alunta_customer_id: "cus-b", current_period_end: iso(NOW.getTime()), updated_at: iso(NOW.getTime()) },
  ];
  const client = {
    listInvoices: async ({ customerUuid }) => {
      if (customerUuid === "cus-a") throw new Error("network error");
      return { data: [{ uuid: "inv-b" }] };
    },
  };
  const missing = await findMissingInvoiceRolls({ client, rolls, now: NOW });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].teamId, "a");
  assert.equal(missing[0].reason, "fetch_failed");
});

test("findMissingInvoiceRolls: date_from bruger INVOICE_LOOKBACK_BUFFER_MS bagud fra updated_at", async () => {
  const updatedAt = "2026-09-01T10:00:00Z";
  const roll = { teamId: "a", alunta_customer_id: "cus-a", current_period_end: iso(NOW.getTime()), updated_at: updatedAt };
  const calls = [];
  const client = { listInvoices: async (args) => { calls.push(args); return { data: [] }; } };
  await findMissingInvoiceRolls({ client, rolls: [roll], now: NOW });
  const expectedFrom = new Date(Date.parse(updatedAt) - INVOICE_LOOKBACK_BUFFER_MS).toISOString().slice(0, 10);
  assert.equal(calls[0].dateFrom, expectedFrom);
});

// ── formatMissingInvoiceFindings ─────────────────────────────────────────────

test("formatMissingInvoiceFindings: aldrig navn/e-mail, kun team-id + tidspunkt + årsag", () => {
  const lines = formatMissingInvoiceFindings([
    { teamId: "t1", current_period_end: "2026-09-02T00:00:00Z", reason: "no_invoice_in_window" },
    { teamId: "t2", current_period_end: "2026-09-02T00:00:00Z", reason: "no_customer_id" },
    { teamId: "t3", current_period_end: "2026-09-02T00:00:00Z", reason: "fetch_failed", error: "timeout" },
  ]);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.doesNotMatch(line, /@|navn|name/i);
  assert.match(lines[0], /t1/);
  assert.match(lines[1], /intet alunta_customer_id/);
  assert.match(lines[2], /timeout/);
});

// ── runAluntaPeriodRollWatch (integration mod fakes) ─────────────────────────

function makeFakeSupabase({ subscriptionRows = [], alertState = null } = {}) {
  const opsUpserts = [];
  let currentAlertState = alertState;
  return {
    opsUpserts,
    _alertState: () => currentAlertState,
    from(table) {
      if (table === "subscriptions") {
        return { select: () => Promise.resolve({ data: subscriptionRows, error: null }) };
      }
      if (table === "ops_alert_state") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: currentAlertState, error: null }) }),
          }),
          upsert: (row) => {
            opsUpserts.push({ ...row });
            currentAlertState = { signature: row.signature };
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("runAluntaPeriodRollWatch: ingen rulninger -> alerted=false, ingen Alunta-kald", async () => {
  const supabase = makeFakeSupabase({ subscriptionRows: [] });
  let clientCalled = false;
  const client = { listInvoices: async () => { clientCalled = true; return { data: [] }; } };
  const result = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: () => {} });
  assert.equal(result.alerted, false);
  assert.equal(result.rolls, 0);
  assert.equal(clientCalled, false);
});

test("runAluntaPeriodRollWatch: manglende faktura -> alerted=true, ops_alert_state opdateres", async () => {
  const supabase = makeFakeSupabase({
    subscriptionRows: [
      { team_id: "t1", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), alunta_customer_id: "cus-1", updated_at: iso(NOW.getTime() - 3600_000) },
    ],
  });
  const client = { listInvoices: async () => ({ data: [] }) };
  const captured = [];
  const result = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });
  assert.equal(result.alerted, true);
  assert.equal(result.missing, 1);
  assert.equal(supabase.opsUpserts.length, 1);
  assert.equal(supabase.opsUpserts[0].signature, "t1");
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /periode-rulning uden fundet faktura/);
});

test("runAluntaPeriodRollWatch: uændret fund-sæt anden kørsel -> INGEN re-alarm (edge-triggered dedup)", async () => {
  const rows = [
    { team_id: "t1", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), alunta_customer_id: "cus-1", updated_at: iso(NOW.getTime() - 3600_000) },
  ];
  const supabase = makeFakeSupabase({ subscriptionRows: rows });
  const client = { listInvoices: async () => ({ data: [] }) };
  const captured = [];
  const cap = (err, ctx) => captured.push({ err, ctx });

  const first = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: cap });
  assert.equal(first.alerted, true);

  const second = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: cap });
  assert.equal(second.alerted, false); // samme fund-sæt — ingen ny alarm
  assert.equal(captured.length, 1); // stadig kun ÉN capture total
});

test("runAluntaPeriodRollWatch: fundet forsvinder -> signaturen ryddes (klar til ny alarm ved gentagelse)", async () => {
  const rows = [
    { team_id: "t1", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), alunta_customer_id: "cus-1", updated_at: iso(NOW.getTime() - 3600_000) },
  ];
  const supabase = makeFakeSupabase({ subscriptionRows: rows });
  let hasInvoice = false;
  const client = { listInvoices: async () => ({ data: hasInvoice ? [{ uuid: "inv-1" }] : [] }) };
  const captured = [];
  const cap = (err, ctx) => captured.push({ err, ctx });

  const first = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: cap });
  assert.equal(first.alerted, true);

  hasInvoice = true;
  const second = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: cap });
  assert.equal(second.alerted, false);
  assert.equal(second.missing, 0);
  assert.equal(supabase.opsUpserts.at(-1).signature, "");
});

test("runAluntaPeriodRollWatch: subscriptions-opslag fejler -> capture + stille exit", async () => {
  const supabase = {
    from: (table) => {
      assert.equal(table, "subscriptions");
      return { select: () => Promise.resolve({ data: null, error: { message: "db nede" } }) };
    },
  };
  const captured = [];
  const result = await runAluntaPeriodRollWatch({ supabase, client: {}, now: NOW, captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });
  assert.equal(result.alerted, false);
  assert.equal(captured.length, 1);
});

test("runAluntaPeriodRollWatch: ops_alert_state-læsning fejler -> fail-safe stille, ingen alarm", async () => {
  const rows = [
    { team_id: "t1", status: "active", current_period_end: iso(NOW.getTime() + 30 * 864e5), alunta_customer_id: "cus-1", updated_at: iso(NOW.getTime() - 3600_000) },
  ];
  const supabase = {
    from: (table) => {
      if (table === "subscriptions") return { select: () => Promise.resolve({ data: rows, error: null }) };
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "state nede" } }) }) }) };
    },
  };
  const client = { listInvoices: async () => ({ data: [] }) };
  const captured = [];
  const result = await runAluntaPeriodRollWatch({ supabase, client, now: NOW, captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });
  assert.equal(result.alerted, false);
  assert.equal(captured.length, 1); // kun ops_alert_state-fejlen — ingen periode-rul-alarm oveni
});
