import test from "node:test";
import assert from "node:assert/strict";
import { createProRiderHistoryHandler, compareHistoryRows, withLivePoint } from "./proRiderHistory.js";

// #4649: fake supabase — subscriptions (isPro-opslag) + rider_derived_ability_history.
// #6286: + rider_derived_abilities (live-punkt) og seasons (aktiv saeson).
function fakeSupabase({
  sub = null, subError = null, historyRows = [], historyError = null, raceDayRows = [],
  current = null, currentError = null, activeSeason = null,
} = {}) {
  return {
    from(table) {
      if (table === "rider_derived_abilities") {
        const q = { select() { return q; }, eq() { return q; }, maybeSingle: () => Promise.resolve({ data: current, error: currentError }) };
        return q;
      }
      if (table === "seasons") {
        const q = {
          select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
          maybeSingle: () => Promise.resolve({ data: activeSeason == null ? null : { number: activeSeason }, error: null }),
        };
        return q;
      }
      if (table === "subscriptions") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: () => Promise.resolve({ data: sub, error: subError }),
        };
      }
      if (table === "rider_derived_ability_history") {
        return {
          select() { return this; },
          eq() { return this; },
          order: () => Promise.resolve({ data: historyRows, error: historyError }),
        };
      }
      if (table === "rider_ability_race_day_history") {
        const q = {
          select() { return q; }, eq() { return q; }, order() { return q; }, gte() { return q; },
          range: (from) => Promise.resolve({ data: from === 0 ? raceDayRows : [], error: null }),
        };
        return q;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("proRiderHistory: intet team → 400", async () => {
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase() });
  const r = res();
  await handler({ team: null, params: {} }, r);
  assert.equal(r.code, 400);
});

test("proRiderHistory: ikke Pro (ingen subscription) → 403 pro_required, ingen historik-kald", async () => {
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: null }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 403);
  assert.equal(r.body.errorCode, "pro_required");
});

test("proRiderHistory: udløbet abonnement (status inactive) → 403 pro_required", async () => {
  const sub = { status: "inactive", current_period_end: "2020-01-01T00:00:00Z", is_founder: false };
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 403);
});

test("proRiderHistory: aktivt abonnement → 200, dedupet én række pr. sæson (seneste vinder)", async () => {
  const sub = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };
  const historyRows = [
    { snapshot_date: "2026-01-01", season_number: 1, abilities: { climbing: 40 } },
    { snapshot_date: "2026-03-01", season_number: 1, abilities: { climbing: 45 } }, // sæson 1's seneste
    { snapshot_date: "2026-06-01", season_number: 2, abilities: { climbing: 52 } },
  ];
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.code, 0); // res() ikke eksplicit sat 200 — handler bruger json() uden status()
  assert.equal(r.body.abilityCeiling, 99);
  assert.deepEqual(r.body.seasons, [
    { season_number: 1, abilities: { climbing: 45 } },
    { season_number: 2, abilities: { climbing: 52 } },
  ]);
});

test("proRiderHistory: Founder uden aktivt abonnement er alligevel Pro (permanent status)", async () => {
  const sub = { status: "inactive", current_period_end: null, is_founder: true };
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows: [] }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.equal(r.body.errorCode, undefined);
  assert.deepEqual(r.body.seasons, []);
});

test("#5947 proRiderHistory: season end uses the last race day of the date, not the frozen first-gain row", async () => {
  const sub = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };
  const historyRows = [
    { snapshot_date: "2026-09-29", season_number: 4, source: "daily_training", abilities: { climbing: 50 } },
  ];
  const raceDayRows = [
    { snapshot_date: "2026-09-29", season_number: 4, source: "daily_training", game_day: 7, abilities: { climbing: 50 } },
    { snapshot_date: "2026-09-29", season_number: 4, source: "race_development", game_day: 9, abilities: { climbing: 52 } },
  ];
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows, raceDayRows }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.deepEqual(r.body.seasons, [{ season_number: 4, abilities: { climbing: 52 } }]);
});

test("#5947 proRiderHistory: a season-transition date shared by two seasons keeps both season ends", async () => {
  const sub = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };
  const historyRows = [
    { snapshot_date: "2026-09-26", season_number: 3, source: "daily_training", abilities: { climbing: 48 } },
    { snapshot_date: "2026-09-27", season_number: 3, source: "daily_training", abilities: { climbing: 49 } },
    { snapshot_date: "2026-09-27", season_number: 4, source: "season_transition", abilities: { climbing: 50 } },
  ];
  const raceDayRows = [
    { snapshot_date: "2026-09-27", season_number: 3, source: "daily_training", game_day: 139, abilities: { climbing: 49 } },
  ];
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub, historyRows, raceDayRows }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.deepEqual(r.body.seasons, [
    { season_number: 3, abilities: { climbing: 49 } },
    { season_number: 4, abilities: { climbing: 50 } },
  ]);
});

const ACTIVE = { status: "active", current_period_end: "2099-01-01T00:00:00Z", is_founder: false };

test("#6286 sortering er deterministisk: samme dato + saeson, kilde-prioritet afgoer uanset input-raekkefoelge", async () => {
  const transition = { snapshot_date: "2026-09-27", season_number: 4, source: "season_transition", abilities: { climbing: 50 } };
  const training = { snapshot_date: "2026-09-27", season_number: 4, source: "daily_training", abilities: { climbing: 51 } };
  for (const historyRows of [[transition, training], [training, transition]]) {
    const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: ACTIVE, historyRows }) });
    const r = res();
    await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
    assert.deepEqual(r.body.seasons, [{ season_number: 4, abilities: { climbing: 51 } }]);
  }
});

test("#6286 compareHistoryRows: dato, saa kilde-prioritet, saa loebsdag, saa kildenavn", () => {
  const rows = [
    { snapshot_date: "2026-09-28", source: "baseline" },
    { snapshot_date: "2026-09-27", source: "race_development", game_day: 4 },
    { snapshot_date: "2026-09-27", source: "daily_training" },
    { snapshot_date: "2026-09-27", source: "season_transition" },
    { snapshot_date: "2026-09-27", source: "race_development" },
  ];
  const order = (input) => [...input].sort(compareHistoryRows).map((r) => `${r.snapshot_date}:${r.source}:${r.game_day ?? "-"}`);
  const expected = [
    "2026-09-27:season_transition:-",
    "2026-09-27:daily_training:-",
    "2026-09-27:race_development:-",
    "2026-09-27:race_development:4",
    "2026-09-28:baseline:-",
  ];
  assert.deepEqual(order(rows), expected);
  assert.deepEqual(order([...rows].reverse()), expected);
});

test("#6286 live-punkt: nuvaerende evner erstatter den aktive saesons punkt og markeres live", async () => {
  const historyRows = [
    { snapshot_date: "2026-08-01", season_number: 3, source: "daily_training", abilities: { climbing: 48 } },
    { snapshot_date: "2026-09-29", season_number: 4, source: "daily_training", abilities: { climbing: 50 } },
  ];
  const current = { climbing: 53, teamwork: 31, hidden_potential: 77 };
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: ACTIVE, historyRows, current, activeSeason: 4 }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.deepEqual(r.body.seasons, [
    { season_number: 3, abilities: { climbing: 48 } },
    { season_number: 4, abilities: { climbing: 53, teamwork: 31 }, live: true },
  ]);
});

test("#6286 rytter uden historik faar eet nu-punkt i den aktive saeson", async () => {
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: ACTIVE, current: { climbing: 22 }, activeSeason: 5 }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.deepEqual(r.body.seasons, [{ season_number: 5, abilities: { climbing: 22 }, live: true }]);
});

test("#6286 live-opslaget fejler: historikken vises stadig, uden live-punkt", async () => {
  const historyRows = [{ snapshot_date: "2026-08-01", season_number: 3, source: "daily_training", abilities: { climbing: 48 } }];
  const handler = createProRiderHistoryHandler({ supabase: fakeSupabase({ sub: ACTIVE, historyRows, currentError: { message: "boom" } }) });
  const r = res();
  await handler({ team: { id: "t1" }, params: { riderId: "r1" } }, r);
  assert.deepEqual(r.body.seasons, [{ season_number: 3, abilities: { climbing: 48 } }]);
});

test("#6286 withLivePoint: ukendt aktiv saeson knyttes til seneste historik-saeson", () => {
  const seasons = [{ season_number: 2, abilities: { climbing: 40 } }];
  assert.deepEqual(withLivePoint(seasons, { season_number: null, abilities: { climbing: 41 } }), [
    { season_number: 2, abilities: { climbing: 41 }, live: true },
  ]);
  assert.equal(withLivePoint(seasons, null), seasons);
});
