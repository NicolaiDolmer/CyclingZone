import test from "node:test";
import assert from "node:assert/strict";

import { materializeSeasonCalendar } from "./seasonCalendarMaterializer.js";

// Mock-supabase (samme mønster som aiTeamGenerator.test.js), men races.insert().select()
// returnerer HELE den indsatte række (materializeren skal bruge name/race_type/stages
// til profil- + schedule-generering, ikke kun id).
function makeSupabase(initial = {}) {
  let idSeq = 1;
  const state = {
    league_divisions: [], teams: [], race_pool: [],
    races: [], race_stage_profiles: [], race_stage_schedule: [],
    ...JSON.parse(JSON.stringify(initial)),
  };
  function from(table) {
    if (!state[table]) state[table] = [];
    const rows = () => state[table];
    const filters = [];
    const matches = (row) => filters.every((f) =>
      f.t === "eq" ? row[f.c] === f.v : f.t === "in" ? f.v.includes(row[f.c]) : true);
    const builder = {
      select() { return builder; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return builder; },
      in(c, v) { filters.push({ t: "in", c, v }); return builder; },
      order() { return builder; },
      insert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const inserted = arr.map((r) => ({ id: `${table}-${idSeq++}`, ...r }));
        rows().push(...inserted.map((r) => JSON.parse(JSON.stringify(r))));
        return {
          select() { return Promise.resolve({ data: inserted.map((r) => ({ ...r })), error: null }); },
          then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
        };
      },
      update(payload) {
        const upd = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return upd; },
          then(res, rej) {
            for (const row of rows()) if (matches(row)) Object.assign(row, JSON.parse(JSON.stringify(payload)));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return upd;
      },
      then(res, rej) { return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej); },
    };
    return builder;
  }
  return { from, state };
}

function seed() {
  // 4 puljer: div1 (tier1, altid live), div3-A (tier3, 2 managere → live),
  // div3-B (tier3, 0 managere → skip), div4-A (tier4, 0 managere → skip).
  const league_divisions = [
    { id: 1, tier: 1, pool_index: 0, label: "Division 1" },
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
    { id: 8, tier: 4, pool_index: 0, label: "Division 4 — A" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("t1", 4), mgr("t2", 4), { id: "ai1", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 1 }];
  const race_pool = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) race_pool.push({ id: `rp${n++}`, name: `${race_class}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
  };
  add("Monuments", "single", 1, 6);
  add("OtherWorldTourA", "stage_race", 7, 4);
  add("ProSeries", "single", 1, 40);
  add("ProSeries", "stage_race", 5, 8);
  add("Class1", "single", 1, 30);
  add("Class1", "stage_race", 4, 6);
  add("Class2", "single", 1, 30);
  add("Class2", "stage_race", 3, 6);
  return { league_divisions, teams, race_pool };
}

const FROM = new Date("2026-06-22T00:00:00Z");

test("dryRun: ingen writes, previewer fresh pr. live pulje", async () => {
  const sb = makeSupabase(seed());
  const r = await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: true,
  });
  assert.equal(r.racesInserted, 0);
  assert.equal(sb.state.races.length, 0);
  const live = r.pools.map((p) => p.pool_id).sort((a, b) => a - b);
  assert.deepEqual(live, [1, 4]); // div1 (altid) + div3-A (manager); div3-B + div4-A skippet
  assert.ok(r.pools.find((p) => p.pool_id === 4).fresh > 0);
});

test("apply: races m. league_division_id + profiler + schedule, kun live puljer", async () => {
  const sb = makeSupabase(seed());
  const r = await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false,
  });
  assert.ok(r.racesInserted > 0);
  const divs = [...new Set(sb.state.races.map((x) => x.league_division_id))].sort((a, b) => a - b);
  assert.deepEqual(divs, [1, 4]); // ingen races i div3-B (5) eller div4-A (8)
  for (const rc of sb.state.races) {
    assert.equal(rc.season_id, "s1");
    assert.equal(rc.status, "scheduled");
    assert.ok(rc.pool_race_id, "pool_race_id sat");
    assert.equal(rc.edition_year, 2026);
    assert.ok(rc.scheduled_for, "scheduled_for sat");
  }
  assert.ok(sb.state.race_stage_profiles.length > 0, "profiler skrevet");
  assert.ok(sb.state.race_stage_schedule.length > 0, "etape-tider skrevet");
  // tier 3 (pulje 4) kører kun ProSeries/Class1
  for (const rc of sb.state.races.filter((x) => x.league_division_id === 4)) {
    assert.ok(["ProSeries", "Class1"].includes(rc.race_class), `tier 3 uventet klasse ${rc.race_class}`);
  }
});

test("idempotent: anden kørsel indsætter 0 (allerede materialiseret)", async () => {
  const sb = makeSupabase(seed());
  await materializeSeasonCalendar({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  const before = sb.state.races.length;
  const r2 = await materializeSeasonCalendar({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  assert.equal(r2.racesInserted, 0);
  assert.equal(sb.state.races.length, before);
});
