import test from "node:test";
import assert from "node:assert/strict";

import { materializeSeasonCalendar } from "./seasonCalendarMaterializer.js";
import { raceTimeWindow, windowsOverlap } from "./raceBinding.js";

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

test("materialiseret kalender har tids-overlap i en pulje (binding aktiveres)", async () => {
  const sb = makeSupabase(seed());
  await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false,
  });
  // Saml vinduer pr. løb i pulje 1 (div1, altid live).
  const pool1RaceIds = sb.state.races.filter((r) => r.league_division_id === 1).map((r) => r.id);
  const winByRace = new Map();
  for (const id of pool1RaceIds) {
    const sched = sb.state.race_stage_schedule.filter((s) => s.race_id === id);
    winByRace.set(id, raceTimeWindow(sched));
  }
  // Mindst ét par løb i puljen skal overlappe tidsmæssigt.
  let overlaps = 0;
  for (let i = 0; i < pool1RaceIds.length; i++)
    for (let j = i + 1; j < pool1RaceIds.length; j++)
      if (windowsOverlap(winByRace.get(pool1RaceIds[i]), winByRace.get(pool1RaceIds[j]))) overlaps++;
  assert.ok(overlaps > 0, `pulje 1 skal have mindst ét overlappende løb-par (fik ${overlaps})`);
});

test("idempotent: anden kørsel indsætter 0 (allerede materialiseret)", async () => {
  const sb = makeSupabase(seed());
  await materializeSeasonCalendar({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  const before = sb.state.races.length;
  const r2 = await materializeSeasonCalendar({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  assert.equal(r2.racesInserted, 0);
  assert.equal(sb.state.races.length, before);
});

test("#1714: global de-dup — intet pool_race_id går igen på tværs af puljer", async () => {
  // To live tier-3-puljer (begge med managere) → uden global de-dup ville de
  // dele etapeløb fra det delte ProSeries/Class1-segment.
  const s = seed();
  s.teams = [
    { id: "t1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 4 },
    { id: "t2", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 5 },
    { id: "ai1", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 1 },
  ];
  const sb = makeSupabase(s);
  await materializeSeasonCalendar({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  const seen = new Set();
  for (const rc of sb.state.races) {
    assert.ok(!seen.has(rc.pool_race_id), `pool_race_id ${rc.pool_race_id} materialiseret i mere end én pulje`);
    seen.add(rc.pool_race_id);
  }
});

test("onlyDivisionId: materialiserer KUN den ønskede division (Task 4)", async () => {
  const sb = makeSupabase(seed());
  // Live puljer er normalt 1 (altid) + 4 (managere). Begræns til pulje 1.
  const r = await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false,
    onlyDivisionId: 1,
  });
  assert.equal(r.onlyDivisionId, 1);
  const divs = [...new Set(sb.state.races.map((x) => x.league_division_id))];
  assert.deepEqual(divs, [1], "kun pulje 1 må have races");
  assert.ok(r.racesInserted > 0);
  // summary.pools indeholder kun den materialiserede division.
  assert.deepEqual(r.pools.map((p) => p.pool_id), [1]);
});

test("onlyDivisionId for ikke-live pulje → 0 races (dryRun previewer 0)", async () => {
  const sb = makeSupabase(seed());
  // Pulje 5 (div3-B) er ikke live (0 managere) → ingen kalender genereres for den.
  const r = await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: true,
    onlyDivisionId: 5,
  });
  assert.equal(r.racesInserted, 0);
  assert.deepEqual(r.pools.map((p) => p.pool_id), []);
});

test("tracks videregives til planRaceSchedules (default-adfærd uændret uden tracks)", async () => {
  // tracks=1 → alle etaper i ét enkelt dag-slot (12:30). Med default (2 spor) bruger
  // schedulen mindst to forskellige slots. Vi verificerer at tracks når igennem ved
  // at observere at ALLE etape-tider deler samme klokkeslæt når tracks=1.
  const sb = makeSupabase(seed());
  await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false,
    onlyDivisionId: 1, tracks: 1,
  });
  const slots = new Set(
    sb.state.race_stage_schedule.map((s) => new Date(s.scheduled_at).toISOString().slice(11, 16)),
  );
  assert.equal(slots.size, 1, `tracks=1 skal give præcis ét dag-slot, fik ${[...slots].join(",")}`);
});

test("#1714: knapt etape-segment → summary.truncated rapporterer beskårne puljer", async () => {
  // Minimalt katalog: kun 2 ProSeries-etapeløb men 3 tier-3-puljer der hver vil
  // have stageRaceQuota=8 → segmentet løber tør → beskæring SKAL rapporteres.
  const league_divisions = [
    { id: 1, tier: 3, pool_index: 0, label: "A" },
    { id: 2, tier: 3, pool_index: 1, label: "B" },
    { id: 3, tier: 3, pool_index: 2, label: "C" },
  ];
  const teams = [1, 2, 3].map((p) => ({
    id: `t${p}`, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: p,
  }));
  const race_pool = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) race_pool.push({ id: `rp${n++}`, name: `${race_class}-${i}`, race_class, race_type, stages });
  };
  add("ProSeries", "stage_race", 5, 2);
  add("ProSeries", "single", 1, 80);
  add("Class1", "single", 1, 80);

  const sb = makeSupabase({ league_divisions, teams, race_pool });
  const r = await materializeSeasonCalendar({
    supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: true, stageRaceQuota: 8,
  });
  assert.ok(Array.isArray(r.truncated), "summary skal have truncated-array");
  assert.ok(r.truncated.length > 0, "mindst én pulje skal rapporteres beskåret");
  for (const t of r.truncated) {
    assert.ok(t.stageRacesShort > 0, "truncated-entry rapporterer manglende etapeløb");
  }
});
