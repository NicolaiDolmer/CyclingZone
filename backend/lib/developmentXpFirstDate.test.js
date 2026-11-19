// #6110 ejervalg B (19/11): hvornår rytterens første XP-dato udbetaler gemt fremgang.
import test from "node:test";
import assert from "node:assert/strict";

import { loadXpFirstDatePayoutRiderIds, teamAtTime, xpStoredBarRiderIds } from "./developmentXpFirstDate.js";

const FROM = "2026-11-20";
const ROWS = [
  { rider_id: "a", ability_progress: { climbing: 2.4 } },
  { rider_id: "b", ability_progress: { climbing: 0.6, sprint: 0.99 } },
  { rider_id: "c", ability_progress: null },
  { rider_id: "d", ability_progress: { tempo: 1 } },
];

/**
 * En stedfortræder, der husker forespørgslerne. `ticks` er svaret på opslaget efter tidligere
 * XP-udvikling; `ignition` er svaret på opslaget efter kvitteringer fra startdatoen (forbehold 4).
 */
function fakeSupabase(ticks, { error = null, ignition = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, filters: [] };
      calls.push(q);
      const b = {
        select() { return b; },
        in(col, vals) { q.filters.push(["in", col, vals]); return b; },
        gte(col, v) { q.filters.push(["gte", col, v]); return b; },
        lt(col, v) { q.filters.push(["lt", col, v]); return b; },
        eq(col, v) { q.filters.push(["eq", col, v]); return b; },
        order() { return b; },
        range(from, to) {
          const rows = q.filters.some(([, col]) => col === "report->>xp_ignition_manager") ? (ignition ?? []) : ticks;
          return Promise.resolve(error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  };
}

const base = { developmentXp: {}, developmentXpIgnition: false, xpFromDate: FROM, conditionPerDate: true, developmentAllowed: true, tickDate: "2026-11-25", abilityRows: ROWS };

test("kun ryttere med en bjælke på mindst ét point er kandidater", () => {
  assert.deepEqual(xpStoredBarRiderIds(ROWS), ["a", "d"]);
  assert.deepEqual(xpStoredBarRiderIds(null), []);
});

test("rytter uden tidligere XP-udvikling efter startdatoen får udbetalingen; en med gør ikke", async () => {
  const supabase = fakeSupabase([{ rider_id: "d" }], { ignition: [{ rider_id: "a" }] });
  const ids = await loadXpFirstDatePayoutRiderIds({ ...base, supabase });
  assert.deepEqual([...ids], ["a"]);
  const q = supabase.calls[0];
  assert.equal(q.table, "training_rider_ticks");
  assert.deepEqual(q.filters, [["in", "rider_id", ["a", "d"]], ["gte", "tick_date", FROM], ["lt", "tick_date", "2026-11-25"], ["eq", "report->>xp_developed", "true"]]);
  assert.deepEqual(supabase.calls[1].filters, [["in", "rider_id", ["a"]], ["eq", "tick_date", FROM], ["eq", "report->>xp_ignition_manager", "true"]]);
});

test("forbehold 4: kun ryttere på et managerhold på startdatoen får udbetalingen", async () => {
  const none = await loadXpFirstDatePayoutRiderIds({ ...base, supabase: fakeSupabase([], { ignition: [] }) });
  assert.equal(none.size, 0, "ingen kvittering fra et managerhold på startdatoen: ingen udbetaling");
  const onlyD = await loadXpFirstDatePayoutRiderIds({ ...base, supabase: fakeSupabase([], { ignition: [{ rider_id: "d" }] }) });
  assert.deepEqual([...onlyD], ["d"]);
});

test("null (startdatoen alene gælder) uden XP, på startdatoen, uden dato-kvitteringer, for ikke-managerhold og før startdatoen", async () => {
  const supabase = fakeSupabase([]);
  for (const over of [{ developmentXp: null }, { developmentXpIgnition: true }, { conditionPerDate: false }, { developmentAllowed: false },
    { tickDate: FROM }, { tickDate: "2026-11-19" }, { xpFromDate: null }]) {
    assert.equal(await loadXpFirstDatePayoutRiderIds({ ...base, ...over, supabase }), null, JSON.stringify(over));
  }
  assert.equal(supabase.calls.length, 0, "ingen opslag, når reglen ikke gælder");
});

test("ingen kandidater = intet opslag og ingen udbetaling", async () => {
  const supabase = fakeSupabase([]);
  const ids = await loadXpFirstDatePayoutRiderIds({ ...base, abilityRows: [ROWS[1]], supabase });
  assert.equal(ids.size, 0);
  assert.equal(supabase.calls.length, 0);
});

test("en databasefejl kaster, så tick'et prøves igen i stedet for at udbetale forkert", async () => {
  const supabase = fakeSupabase([], { error: { message: "boom", code: "XX000" } });
  await assert.rejects(() => loadXpFirstDatePayoutRiderIds({ ...base, supabase }));
});

test("teamAtTime: holdet ved startdatoens slutning ud fra ejerskifterne", () => {
  const END = "2026-11-20T23:00:00.000Z";
  const ev = (from, to, at) => ({ from_team_id: from, to_team_id: to, occurred_at: at });
  assert.equal(teamAtTime([], "now", END), "now", "ingen skifte: det nuværende hold");
  assert.equal(teamAtTime([ev("A", "B", "2026-11-10T10:00:00Z")], "C", END), "B", "seneste skifte før slutningen");
  assert.equal(teamAtTime([ev("A", "B", "2026-11-25T10:00:00Z")], "B", END), "A", "første skifte efter: afsenderholdet");
  assert.equal(teamAtTime([ev(null, "B", "2026-11-25T10:00:00Z")], "B", END), null, "fri på startdatoen");
  assert.equal(teamAtTime([ev("A", "B", "2026-11-25T10:00:00Z"), ev("X", "A", "2026-11-10T10:00:00Z")], "B", END), "A", "uordnet input sorteres");
});

test("teamAtTime: et skifte præcis ved startdatoens slutning (midnat) tæller som efter tænding", () => {
  const END = "2026-11-20T23:00:00.000Z";
  assert.equal(teamAtTime([{ from_team_id: "ai", to_team_id: "mgr", occurred_at: END }], "mgr", END), "ai");
  assert.equal(teamAtTime([{ from_team_id: "ai", to_team_id: "mgr", occurred_at: "2026-11-20T22:59:59.999Z" }], "mgr", END), "mgr");
});

test("teamAtTime: ens tidsstempler afgøres af id (stabilt svar)", () => {
  const END = "2026-11-20T23:00:00.000Z";
  const at = "2026-11-10T10:00:00Z";
  const a = { id: "a", from_team_id: "X", to_team_id: "Y", occurred_at: at };
  const b = { id: "b", from_team_id: "Y", to_team_id: "Z", occurred_at: at };
  assert.equal(teamAtTime([b, a], "Z", END), "Z");
  assert.equal(teamAtTime([a, b], "Z", END), "Z");
});
