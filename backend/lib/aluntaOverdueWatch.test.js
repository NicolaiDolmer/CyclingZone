import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTimestamp,
  daysOverdue,
  selectOverdueInvoices,
  selectStaleEntitlements,
  formatFindings,
  fetchAllAluntaInvoices,
  runAluntaOverdueWatch,
} from "./aluntaOverdueWatch.js";

const NOW = new Date("2026-08-31T13:00:00.000Z");

// ── parseTimestamp ────────────────────────────────────────────────────────────

test("parseTimestamp: Postgres-formen fra Supabase (mellemrum, mikrosekunder, +00)", () => {
  // Praecis den vaerdi der ligger i prod. new Date() giver Invalid Date paa den,
  // hvilket ville have klassificeret raekken som ulaeselig i stedet for udloebende.
  const d = parseTimestamp("2026-08-31 21:59:59.999999+00");
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), "2026-08-31T21:59:59.999Z");
});

test("parseTimestamp: almindelig ISO med Z virker uaendret", () => {
  assert.equal(parseTimestamp("2026-08-31T21:59:59.999Z").toISOString(), "2026-08-31T21:59:59.999Z");
});

test("parseTimestamp: Date ind -> Date ud; skrald -> null", () => {
  const d = new Date("2026-01-01T00:00:00Z");
  assert.equal(parseTimestamp(d), d);
  assert.equal(parseTimestamp("skrald"), null);
  assert.equal(parseTimestamp(null), null);
});

// ── daysOverdue ───────────────────────────────────────────────────────────────

test("daysOverdue: YYYY-MM-DD forfald talt fra dagens slutning", () => {
  assert.equal(daysOverdue("2026-08-08", NOW), 22);
});

test("daysOverdue: fremtidig forfaldsdato giver negativ", () => {
  assert.ok(daysOverdue("2026-09-15", NOW) < 0);
});

test("daysOverdue: manglende eller ugyldig dato -> null (flagges, ikke laest som 0)", () => {
  assert.equal(daysOverdue(null, NOW), null);
  assert.equal(daysOverdue("ikke-en-dato", NOW), null);
});

// ── selectOverdueInvoices ─────────────────────────────────────────────────────

test("selectOverdueInvoices: betalt faktura (outstanding 0) ignoreres", () => {
  const res = selectOverdueInvoices([{ uuid: "a", number: 1, outstanding: 0, due_date: "2026-01-01" }], { now: NOW });
  assert.deepEqual(res, []);
});

test("selectOverdueInvoices: status-feltet er IKKE kriteriet - restbeloebet er", () => {
  // 'issued' daekker baade en frisk og en maaned gammel faktura. Havde vi laest
  // status som sandhed, ville begge se ens ud.
  const res = selectOverdueInvoices(
    [
      { uuid: "gammel", number: 2, outstanding: 6125, currency: "DKK", due_date: "2026-08-08", status: "issued" },
      { uuid: "frisk", number: 3, outstanding: 4900, currency: "DKK", due_date: "2026-09-30", status: "issued" },
    ],
    { now: NOW }
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].uuid, "gammel");
});

test("selectOverdueInvoices: graceDays udskyder alarmen", () => {
  const inv = [{ uuid: "a", number: 1, outstanding: 100, due_date: "2026-08-29" }];
  assert.equal(selectOverdueInvoices(inv, { now: NOW, graceDays: 0 }).length, 1);
  assert.equal(selectOverdueInvoices(inv, { now: NOW, graceDays: 5 }).length, 0);
});

test("selectOverdueInvoices: ugyldig forfaldsdato rapporteres i stedet for at blive tabt", () => {
  const res = selectOverdueInvoices([{ uuid: "a", number: 1, outstanding: 100, due_date: null }], { now: NOW });
  assert.equal(res.length, 1);
  assert.equal(res[0].reason, "unparsable_due_date");
  assert.equal(res[0].daysOverdue, null);
});

test("selectOverdueInvoices: vaerste foerst", () => {
  const res = selectOverdueInvoices(
    [
      { uuid: "ny", number: 3, outstanding: 100, due_date: "2026-08-25" },
      { uuid: "gammel", number: 1, outstanding: 100, due_date: "2026-06-01" },
    ],
    { now: NOW }
  );
  assert.equal(res[0].uuid, "gammel");
});

// ── selectStaleEntitlements ───────────────────────────────────────────────────

test("selectStaleEntitlements: udloebet periode med adgangsgivende status fanges", () => {
  const res = selectStaleEntitlements(
    [{ team_id: "t1", status: "active", current_period_end: "2026-08-30T00:00:00Z" }],
    { now: NOW }
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].state, "expired");
});

test("selectStaleEntitlements: past_due taeller som adgangsgivende (respitperiode)", () => {
  const res = selectStaleEntitlements(
    [{ team_id: "t1", status: "past_due", current_period_end: "2026-08-01T00:00:00Z" }],
    { now: NOW }
  );
  assert.equal(res.length, 1);
});

test("selectStaleEntitlements: inactive giver ingen adgang og ignoreres", () => {
  const res = selectStaleEntitlements(
    [{ team_id: "t1", status: "inactive", current_period_end: "2026-01-01T00:00:00Z" }],
    { now: NOW }
  );
  assert.deepEqual(res, []);
});

test("selectStaleEntitlements: udloeber snart varsles inden det sker", () => {
  const res = selectStaleEntitlements(
    [{ team_id: "t1", status: "active", current_period_end: "2026-08-31T21:59:59.999Z" }],
    { now: NOW, warnDays: 2 }
  );
  assert.equal(res[0].state, "expiring_soon");
});

test("selectStaleEntitlements: manglende current_period_end fanges (praecis #2736-tilstanden)", () => {
  const res = selectStaleEntitlements([{ team_id: "t1", status: "active", current_period_end: null }], { now: NOW });
  assert.equal(res[0].state, "missing_period_end");
});

// ── formatFindings ────────────────────────────────────────────────────────────

test("formatFindings: laekker aldrig navn, e-mail eller pay_url", () => {
  const lines = formatFindings({
    overdue: [
      {
        uuid: "a",
        number: 2,
        customerUuid: "cus-1",
        outstanding: 6125,
        currency: "DKK",
        daysOverdue: 23,
        // Felter der IKKE maa naa logstroemmen, selvom de findes paa objektet:
        name: "Rasmus Juel Friis",
        email: "rasmus@example.com",
        pay_url: "https://app.alunta.com/pay-invoice/hemmelig",
      },
    ],
  });
  const joined = lines.join("\n");
  assert.ok(joined.includes("#2"));
  assert.ok(joined.includes("cus-1"));
  assert.ok(!joined.includes("Rasmus"));
  assert.ok(!joined.includes("@example.com"));
  assert.ok(!joined.includes("pay-invoice"));
});

// ── fetchAllAluntaInvoices ────────────────────────────────────────────────────

test("fetchAllAluntaInvoices: foelger paginering til last_page", async () => {
  const pages = {
    1: { data: [{ uuid: "a" }], meta: { last_page: 2 } },
    2: { data: [{ uuid: "b" }], meta: { last_page: 2 } },
  };
  const client = { listInvoices: async ({ page }) => pages[page] };
  const all = await fetchAllAluntaInvoices(client);
  assert.deepEqual(all.map((i) => i.uuid), ["a", "b"]);
});

test("fetchAllAluntaInvoices: tom side stopper loopet", async () => {
  const client = { listInvoices: async () => ({ data: [], meta: { last_page: 99 } }) };
  assert.deepEqual(await fetchAllAluntaInvoices(client), []);
});

// ── runAluntaOverdueWatch ─────────────────────────────────────────────────────

function fakeSupabase(rows, error = null) {
  return { from: () => ({ select: async () => ({ data: rows, error }) }) };
}

test("runAluntaOverdueWatch: ren tilstand alarmerer ikke", async () => {
  const client = { listInvoices: async () => ({ data: [{ uuid: "a", outstanding: 0 }], meta: { last_page: 1 } }) };
  const captured = [];
  const res = await runAluntaOverdueWatch({
    client,
    supabase: fakeSupabase([{ team_id: "t1", status: "active", current_period_end: "2027-01-01T00:00:00Z" }]),
    now: NOW,
    captureExceptionFn: (e) => captured.push(e),
    logger: { warn: () => {} },
  });
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
});

test("runAluntaOverdueWatch: DB-fejl skjuler ikke et faktura-fund", async () => {
  const client = {
    listInvoices: async () => ({ data: [{ uuid: "a", number: 2, outstanding: 6125, due_date: "2026-08-08" }], meta: { last_page: 1 } }),
  };
  const captured = [];
  const res = await runAluntaOverdueWatch({
    client,
    supabase: fakeSupabase(null, { message: "boom" }),
    now: NOW,
    captureExceptionFn: (e) => captured.push(e),
    logger: { warn: () => {} },
  });
  assert.equal(res.overdue.length, 1, "fakturaen skal stadig rapporteres");
  assert.ok(captured.some((e) => /subscriptions-opslag fejlede/.test(e.message)));
  assert.ok(captured.some((e) => /ubetalt/.test(e.message)));
});

test("runAluntaOverdueWatch: vagten skriver aldrig - hverken i Alunta eller DB", async () => {
  // En vagt der kan mutere tilstand kan goere skade naar den tager fejl.
  const calls = [];
  const client = new Proxy(
    { listInvoices: async () => ({ data: [], meta: { last_page: 1 } }) },
    { get: (t, p) => { calls.push(p); return t[p]; } }
  );
  const supabaseCalls = [];
  const supabase = { from: (t) => { supabaseCalls.push(t); return { select: async () => ({ data: [], error: null }) }; } };
  await runAluntaOverdueWatch({ client, supabase, now: NOW, captureExceptionFn: () => {}, logger: { warn: () => {} } });
  assert.deepEqual(calls.filter((c) => typeof c === "string" && c !== "listInvoices"), []);
  assert.deepEqual(supabaseCalls, ["subscriptions"]);
});

// ── Regressionstest for selve haendelsen ──────────────────────────────────────

test("REGRESSION #4514: den faktiske 31/8-tilstand ville have udloest alarm", async () => {
  // Raa data som maalt mod Alunta og Supabase 2026-08-31. Denne test er hele
  // grunden til at filen findes: praecis denne tilstand laa 23 dage uopdaget.
  const client = {
    listInvoices: async () => ({
      data: [
        {
          uuid: "a0eaec83-87a5-4b9e-a5cb-940971079b69",
          number: 2,
          due_date: "2026-08-08",
          currency: "DKK",
          total_with_vat: 6125,
          status: "issued",
          outstanding: 6125,
          paid_at: null,
          pay_url: "https://app.alunta.com/pay-invoice/a44f7401",
          customer: { uuid: "dd3372d2-bf50-44c4-9c0d-97ac47821ca4", name: "Rasmus Juel Friis" },
        },
        {
          uuid: "4189a7ba-41ec-4442-a36e-a73d408ea3b6",
          number: 1,
          due_date: "2026-08-01",
          currency: "DKK",
          status: "paid",
          outstanding: 0,
          paid_at: "2026-07-25T15:45:10.000000Z",
          customer: { uuid: "dd3372d2-bf50-44c4-9c0d-97ac47821ca4", name: "Rasmus Juel Friis" },
        },
      ],
      meta: { last_page: 1 },
    }),
  };
  const captured = [];
  const logged = [];
  const res = await runAluntaOverdueWatch({
    client,
    supabase: fakeSupabase([
      { team_id: "8073fb4a-aee0-4d87-a90d-9472bd72c9fc", status: "active", current_period_end: "2026-08-31T21:59:59.999999+00" },
    ]),
    now: NOW,
    captureExceptionFn: (e) => captured.push(e),
    logger: { warn: (l) => logged.push(l) },
  });

  assert.equal(res.alerted, true, "tilstanden SKAL udloese alarm");
  assert.equal(res.overdue.length, 1, "kun den ubetalte, ikke den betalte");
  assert.equal(res.overdue[0].number, 2);
  assert.equal(res.overdue[0].daysOverdue, 22);
  assert.equal(res.stale.length, 1, "entitlementet udloeber samme aften");
  assert.equal(res.stale[0].state, "expiring_soon");
  assert.equal(captured.length, 1);
  assert.ok(!logged.join("\n").includes("Rasmus"), "ingen PII i logstroemmen");
  assert.ok(!logged.join("\n").includes("pay-invoice"), "ingen betalingslink i logstroemmen");
});

test("NEGATIV PROEVE: vagten kan faktisk gaa roed - en groen vagt uden faejlesti er ingen vagt", async () => {
  // Jf. #4463-laeringen: en vagt der ikke kan fejle beviser ingenting.
  const client = {
    listInvoices: async () => ({ data: [{ uuid: "x", number: 9, outstanding: 1, due_date: "2020-01-01" }], meta: { last_page: 1 } }),
  };
  const captured = [];
  const res = await runAluntaOverdueWatch({
    client,
    supabase: null,
    now: NOW,
    captureExceptionFn: (e) => captured.push(e),
    logger: { warn: () => {} },
  });
  assert.equal(res.alerted, true);
  assert.equal(captured.length, 1);
});
