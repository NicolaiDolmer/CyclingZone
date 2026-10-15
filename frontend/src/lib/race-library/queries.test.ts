import test from "node:test";
import assert from "node:assert/strict";
import { createRaceLibraryReader } from "./queries.ts";

function fake(rows: Record<string, Record<string, unknown>[]>, failTable = "") {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, ops: [] as [string, unknown[]][] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "or", "in", "order", "range", "abortSignal"])
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      builder.then = (resolve: (v: unknown) => unknown) => {
        let result = rows[table] ?? [];
        for (const [op, args] of call.ops) {
          if (op === "eq") result = result.filter((r) => r[String(args[0])] === args[1]);
          if (op === "in")
            result = result.filter((r) => (args[1] as unknown[]).includes(r[String(args[0])]));
          if (op === "range") result = result.slice(Number(args[0]), Number(args[1]) + 1);
        }
        return Promise.resolve(
          resolve({ data: result, error: table === failTable ? new Error("read failed") : null })
        );
      };
      return builder;
    },
  };
  return { client, calls };
}
const seasons = [
  { id: "s4", number: 4, status: "active" },
  { id: "s3", number: 3, status: "completed" },
];
const pools = [
  { id: 10, tier: 1, pool_index: 0, label: "1" },
  { id: 11, tier: 2, pool_index: 0, label: "2", retired_at: "2026-10-01" },
];
const race = (id: string, overrides = {}) => ({
  id,
  name: "Vuelta Ibérica",
  race_type: "stage_race",
  race_class: "TourSpain",
  stages: 3,
  stages_completed: 0,
  status: "scheduled",
  season_id: "s4",
  league_division_id: 10,
  pool_race_id: "new",
  edition_year: 2026,
  squad: "senior",
  ...overrides,
});
const scope = { seasonId: "s4", tier: 1, poolId: 10, squad: "senior" as const };
test("every page is searched: more than 1000 races remain available without results on upcoming", async () => {
  const db = fake({
    races: Array.from({ length: 1005 }, (_, i) => race("race-" + i)),
    race_stage_schedule: [],
    race_stage_profiles: [],
    race_results: [],
  });
  const result = await createRaceLibraryReader(db.client).listRaceLibrary(
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.equal(result.length, 1005);
  assert.equal(
    db.calls.some((c) => c.table === "race_results"),
    false
  );
  assert.ok(
    db.calls
      .filter((c) => c.table === "races")
      .every((c) => c.ops.some(([op, a]) => op === "order" && a[0] === "id"))
  );
});
test("scope does not mix youth or other pools; a shared race remains visible", async () => {
  const db = fake({
    races: [
      race("own"),
      race("other", { league_division_id: 11 }),
      race("youth", { squad: "u23" }),
      race("shared", { league_division_id: null }),
    ],
  });
  const result = await createRaceLibraryReader(db.client).listRaceLibrary(
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.deepEqual(
    result.map((r) => r.id),
    ["own", "shared"]
  );
  assert.ok(
    db.calls
      .filter((c) => c.table === "races")
      .every((c) =>
        c.ops.some(([op, a]) => op === "or" && String(a[0]).includes("squad.eq.senior"))
      )
  );
});
test("unknown scope fails closed before any read; query errors are not empty success", async () => {
  const db = fake({});
  await assert.rejects(
    () =>
      createRaceLibraryReader(db.client).listRaceLibrary(
        { ...scope, poolId: 11 },
        seasons,
        pools,
        new AbortController().signal
      ),
    /scope/i
  );
  assert.equal(db.calls.length, 0);
  const broken = fake({ races: [] }, "races");
  await assert.rejects(
    () =>
      createRaceLibraryReader(broken.client).listRaceLibrary(
        scope,
        seasons,
        pools,
        new AbortController().signal
      ),
    /read failed/
  );
});
test("edition history uses exact name/type across replaced catalog IDs and retains retired historical pool", async () => {
  const db = fake({
    races: [
      race("s4"),
      race("s3", { season_id: "s3", pool_race_id: "old" }),
      race("different", { name: "Vuelta Iberica" }),
    ],
  });
  const result = await createRaceLibraryReader(db.client).listRaceEditions(
    { name: "Vuelta Ibérica", race_type: "stage_race" },
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.deepEqual(
    result.map((r) => r.id),
    ["s4", "s3"]
  );
  assert.ok(
    db.calls.some(
      (c) =>
        c.table === "races" &&
        c.ops.some(([op, a]) => op === "eq" && a[0] === "name" && a[1] === "Vuelta Ibérica")
    )
  );
});
test("cancelled read propagates instead of rendering an empty library", async () => {
  const signal = new AbortController();
  signal.abort();
  const db = fake({ races: [race("own")] });
  await assert.rejects(
    () => createRaceLibraryReader(db.client).listRaceLibrary(scope, seasons, pools, signal.signal),
    /abort/i
  );
  assert.equal(db.calls.length, 0);
});

test("upcoming ignores completed result payloads; history explicitly requests final winners", async () => {
  const db = fake({
    races: [race("next"), race("old", { status: "completed" })],
    race_results: [
      {
        id: "result-1",
        race_id: "old",
        stage_number: 3,
        result_type: "gc",
        rank: 1,
        rider_name: "Synthetic winner",
      },
    ],
  });
  const reader = createRaceLibraryReader(db.client);
  const next = await reader.listRaceLibrary(scope, seasons, pools, new AbortController().signal);
  assert.deepEqual(
    next.map((r) => r.id),
    ["next"]
  );
  assert.equal(
    db.calls.some((c) => c.table === "race_results"),
    false
  );
  const old = await reader.listRaceLibrary(
    scope,
    seasons,
    pools,
    new AbortController().signal,
    "history"
  );
  assert.equal(old[0].winner?.name, "Synthetic winner");
});

test("legacy name lookup includes completed races and treats wildcard characters literally", async () => {
  const db = fake({
    races: [
      race("finished", { name: "100% Tour_", status: "completed" }),
      race("other", { name: "1000 TourA" }),
    ],
  });
  const result = await createRaceLibraryReader(db.client).findRaceByName(
    "100% Tour_",
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.deepEqual(
    result.map((r) => r.id),
    ["finished"]
  );
});

test("a legacy name still finds editions when absent from the current season", async () => {
  const db = fake({ races: [race("older", { season_id: "s3", status: "completed" })] });
  const result = await createRaceLibraryReader(db.client).findRaceByName(
    "Vuelta Ibérica",
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.deepEqual(
    result.map((r) => r.id),
    ["older"]
  );
});

test("statistics retain separate GC/stage wins and points from every classification", async () => {
  const db = fake({
    races: [race("finished", { status: "completed" })],
    race_results: [
      {
        id: "g",
        race_id: "finished",
        result_type: "gc",
        rank: 1,
        rider_id: "r",
        rider_name: "Synthetic rider",
        points_earned: 100,
      },
      {
        id: "s",
        race_id: "finished",
        result_type: "stage",
        rank: 1,
        rider_id: "r",
        points_earned: 10,
      },
      {
        id: "p",
        race_id: "finished",
        result_type: "points",
        rank: 2,
        rider_id: "r",
        points_earned: 30,
      },
    ],
  });
  const [stat] = await createRaceLibraryReader(db.client).listRaceStats(
    { name: "Vuelta Ibérica", race_type: "stage_race" },
    scope,
    seasons,
    pools,
    new AbortController().signal
  );
  assert.equal(stat.stageWins, 1);
  assert.equal(stat.gcWins, 1);
  assert.equal(stat.points, 140);
  assert.equal(stat.podiums, 3);
});
test("large season and pool selectors are bounded while shared editions are deduplicated", async () => {
  const manySeasons = Array.from({ length: 205 }, (_, i) => ({
    id: "s" + i,
    number: i + 1,
    status: "completed",
  }));
  const manyPools = Array.from({ length: 205 }, (_, i) => ({
    id: i,
    tier: 1,
    pool_index: i,
    label: String(i),
  }));
  const db = fake({ races: [race("shared", { season_id: "s4", league_division_id: null })] });
  const rows = await createRaceLibraryReader(db.client).listRaceEditions(
    { name: "Vuelta Ibérica", race_type: "stage_race" },
    { ...scope, poolId: null },
    manySeasons,
    manyPools,
    new AbortController().signal
  );
  assert.equal(rows.length, 1);
  const calls = db.calls.filter((c) => c.table === "races");
  assert.ok(calls.length >= 9);
  for (const call of calls) {
    assert.ok(
      call.ops.filter(([op]) => op === "in").every(([, a]) => (a[1] as unknown[]).length <= 100)
    );
    const selector = String(
      call.ops.find(
        ([op, a]) => op === "or" && String(a[0]).includes("league_division_id")
      )?.[1][0] ?? ""
    );
    assert.ok(selector.split(",").length <= 102);
  }
});
