import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboardSquadStats,
  fetchSquadCountInputs,
  getSquadLimits,
} from "./dashboardSquadStats.js";

const ME = "team-me";
const RIVAL = "team-rival";

// Chainable supabase-stub der optager filtre pr. query og resolver med en
// fast count pr. tabel. Supabase query-builders er thenables, så `await` virker.
function createSupabaseStub(countsByTable = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, select: null, filters: [] };
      queries.push(query);
      const chain = {
        select(cols, opts) {
          query.select = { cols, opts };
          return chain;
        },
        eq(col, val) {
          query.filters.push(["eq", col, val]);
          return chain;
        },
        neq(col, val) {
          query.filters.push(["neq", col, val]);
          return chain;
        },
        in(col, vals) {
          query.filters.push(["in", col, vals]);
          return chain;
        },
        or(expr) {
          query.filters.push(["or", expr]);
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve({ count: countsByTable[table] ?? 0, error: null })
            .then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test("getSquadLimits — fallback til division 3 ved ukendt division", () => {
  // Roster-floor fjernet 2026-06-05: min=0 i alle divisioner; kun max=30 håndhæves.
  assert.deepEqual(getSquadLimits(1), { min: 0, max: 30 });
  assert.deepEqual(getSquadLimits(2), { min: 0, max: 30 });
  assert.deepEqual(getSquadLimits(3), { min: 0, max: 30 });
  assert.deepEqual(getSquadLimits(undefined), { min: 0, max: 30 });
  assert.deepEqual(getSquadLimits(null), { min: 0, max: 30 });
});

test("computeDashboardSquadStats — ingen pending = ownedNow = futureRiderCount", () => {
  const riders = Array.from({ length: 9 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 9);
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — pending-incoming inkluderes (#250 hovedrapport)", () => {
  // Bug #250: køber har 6 ejede + 2 vundne auktioner i sæson 0 (pending_team_id=mig på 2 separate ryttere).
  // Tidligere var dette undertælling i nogle UI-elementer — nu skal future = 6 + 2 = 8.
  const riders = Array.from({ length: 6 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 6);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.pendingIncomingCount, 2);
  assert.equal(stats.futureRiderCount, 8);
  assert.equal(stats.warning, null, "8 ryttere i D3 = inden for cap, ingen warning");
});

test("computeDashboardSquadStats — pending-outgoing trækkes fra (#250 sæson 0 sælger-side)", () => {
  // I sæson 0 har sælger pending_team_id=køber på en rytter der venter på vindue.
  // Når vinduet lukker, sælges den. Squad-warning skal forudsige fremtidens hold.
  const riders = [
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: RIVAL }, // pending-out
    { pending_team_id: RIVAL }, // pending-out
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 2);
  assert.equal(stats.futureRiderCount, 7, "9 - 2 udgående = 7");
  // Roster-floor fjernet 2026-06-05: 7 ryttere udløser ikke længere en under-warning.
  assert.equal(stats.warning, null, "intet trup-minimum → ingen under-warning");
});

test("computeDashboardSquadStats — pending-out som peger på MIT eget hold tæller IKKE som outgoing", () => {
  // Edge: hvis pending_team_id == myTeamId (= rytteren er allerede ejet og venter på en self-finalize-flow),
  // så er det ikke udgående. Skal beholdes i ownedNow uden subtraktion.
  const riders = [
    { pending_team_id: null },
    { pending_team_id: ME }, // self-pending = ikke udgående
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 2);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 2);
});

test("computeDashboardSquadStats — pending-in + pending-out i samme hold (deadline day)", () => {
  // Klassisk deadline-day: 9 ejede inkl. 2 pending-out + 2 pending-in.
  // Fremtidens hold = 9 - 2 + 2 = 9. Inden for D3-spændet (8-30), ingen warning.
  const riders = [
    ...Array.from({ length: 7 }, () => ({ pending_team_id: null })),
    { pending_team_id: RIVAL },
    { pending_team_id: RIVAL },
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 2);
  assert.equal(stats.futureRiderCount, 9);
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — over-cap warning ved fælles cap=30", () => {
  const riders = Array.from({ length: 29 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2, // 29 + 2 = 31, over fælles max 30
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.futureRiderCount, 31);
  assert.equal(stats.warning?.type, "over");
  assert.equal(stats.warning.count, 1, "skal sælge 1 rytter");
  assert.equal(stats.warning.limit, 30);
});

test("computeDashboardSquadStats — falsk over-warning fjernes når pending-out tager holdet ned i cap", () => {
  // Før #250 fix: 31 ejede + 1 pending-out → riderCount=31, warning "over" trods at fremtidens hold er 30.
  const riders = [
    ...Array.from({ length: 30 }, () => ({ pending_team_id: null })),
    { pending_team_id: RIVAL },
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 31);
  assert.equal(stats.outgoingCount, 1);
  assert.equal(stats.futureRiderCount, 30, "= fælles max, ingen warning");
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — division 1 cap=30, ingen under-warning (floor fjernet)", () => {
  // Roster-floor fjernet 2026-06-05: 19 ryttere i D1 udløser ikke længere en under-warning.
  const riders = Array.from({ length: 19 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 1,
  });
  assert.equal(stats.futureRiderCount, 19);
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — tom riders-array (0 ryttere er tilladt, ingen warning)", () => {
  // Roster-floor fjernet 2026-06-05: et hold må have 0 ryttere → ingen under-warning.
  const stats = computeDashboardSquadStats({
    riders: [],
    pendingIncomingCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 0);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 0);
  assert.equal(stats.warning, null);
});

// ─── #1090: fetchSquadCountInputs — paritet med backend getTeamMarketState ───

test("fetchSquadCountInputs — pending-in inkluderer ryttere med team_id = NULL (#1090)", async () => {
  // Regression: `.neq("team_id", mig)` ekskluderer rækker med team_id = NULL
  // (SQL trevalent logik) — fx en fri agent vundet på auktion mens vinduet var
  // lukket (pending_team_id = mig, team_id = NULL). Filteret skal være et
  // or(is.null, neq) så de tæller med, uden at self-pending (team_id = mig)
  // dobbelt-tælles mod ownedNow.
  const stub = createSupabaseStub({ riders: 3 });
  const inputs = await fetchSquadCountInputs(stub, ME);

  const riderQuery = stub.queries.find((q) => q.table === "riders");
  assert.ok(riderQuery, "skal query'e riders");
  assert.deepEqual(
    riderQuery.filters,
    [
      ["eq", "pending_team_id", ME],
      ["eq", "is_academy", false], // #1308: akademiryttere tæller ikke mod senior-cap
      ["eq", "is_retired", false], // #2748: pensionerede optager ikke en cap-plads
      ["or", `team_id.is.null,team_id.neq.${ME}`],
    ],
    "pending-in-filteret skal inkludere NULL-team_id og ekskludere self-pending og akademiryttere"
  );
  assert.equal(inputs.pendingIncomingCount, 3);
});

test("fetchSquadCountInputs — null counts falder tilbage til 0", async () => {
  const stub = createSupabaseStub({ riders: null });
  const inputs = await fetchSquadCountInputs(stub, ME);
  assert.equal(inputs.pendingIncomingCount, 0);
});

// #1308: pending-incoming-query skal ekskludere akademiryttere
test("#1308: fetchSquadCountInputs — pending-incoming ekskluderer akademiryttere (is_academy=false)", async () => {
  const stub = createSupabaseStub({ riders: 5 });
  await fetchSquadCountInputs(stub, ME);

  const riderQuery = stub.queries.find((q) => q.table === "riders");
  assert.ok(riderQuery, "skal query'e riders");

  const academyFilter = riderQuery.filters.find(
    ([op, col, val]) => op === "eq" && col === "is_academy" && val === false
  );
  assert.ok(
    academyFilter,
    `pending-incoming query mangler is_academy=false filter (aktuelle filtre: ${JSON.stringify(riderQuery.filters)})`
  );
});
