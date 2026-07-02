import test from "node:test";
import assert from "node:assert/strict";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE, materializeTierCalendars, assertNewRaceClearsInFlight } from "./tierCalendarMaterializer.js";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";

const FROM = new Date("2026-06-28T00:00:00Z");

// Mock-supabase (samme mønster som seasonCalendarMaterializer.test.js): insert().select()
// returnerer HELE den indsatte række, så materializeren får pool_race_id + name/stages.
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
      then(res, rej) { return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej); },
    };
    return builder;
  }
  return { from, state };
}

const routeStr = (profiles) => profiles.slice().sort((a, b) => a.stage_number - b.stage_number)
  .map((p) => `${p.stage_number}:${p.profile_type}|${p.finale_type ?? ""}`).join(">");

// Tier-3-katalog: ProSeries + Class1, > kvote 84.
function tier3Catalog() {
  const rows = [];
  [8, 6, 5, 5, 4].forEach((st, i) => rows.push({ id: `ps-sr-${i}`, name: `Stage ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 40; i++) rows.push({ id: `ps-od-${i}`, name: `Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 10; i++) rows.push({ id: `c1-od-${i}`, name: `C1 Classic ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  return rows;
}

const pools = [
  { id: 4, tier: 3, realManagerCount: 11 },
  { id: 5, tier: 3, realManagerCount: 10 },
  { id: 6, tier: 3, realManagerCount: 0 },
  { id: 7, tier: 3, realManagerCount: 10 },
];

test("plan: kun LIVE puljer får en kalender (pulje 6 uden managere udeladt)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  assert.equal(tierPlans.length, 1);
  assert.deepEqual(tierPlans[0].pools.map((p) => p.leagueDivisionId).sort((a, b) => a - b), [4, 5, 7]);
});

test("plan: div 3 rammer præcis 84, tæthed 3 hver dag, alt placeret", () => {
  const t = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM }).tierPlans[0];
  assert.equal(t.quota, 84);
  assert.equal(t.totalGameDays, 84);
  assert.equal(t.quotaHit, true, `shortfall=${t.shortfall}`);
  assert.equal(t.emptyDays, 0);
  assert.ok(t.load.every((x) => x === 3), `tæthed ikke 3 hver dag: ${t.load.join(",")}`);
  assert.equal(t.unplacedStages, 0);
  assert.equal(t.unplacedSingles, 0);
});

test("plan: div 3 har masser af overlap (≥2 løb de fleste dage)", () => {
  const t = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM }).tierPlans[0];
  assert.ok(t.overlapDays >= 20, `for få overlap-dage i div3: ${t.overlapDays}/28`);
});

test("plan: alle puljer i tieren kører PRÆCIS samme løb-sæt", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  const sets = tierPlans[0].pools.map((p) => p.raceRows.map((r) => r.pool_race_id).sort().join(","));
  assert.equal(new Set(sets).size, 1);
});

test("plan: races-rækker beriges (name + race_class + game_day_start i [0,28))", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  for (const r of tierPlans[0].pools[0].raceRows) {
    assert.ok(typeof r.name === "string" && r.name.length > 0);
    assert.ok(["ProSeries", "Class1"].includes(r.race_class));
    assert.ok(Number.isInteger(r.game_day_start) && r.game_day_start >= 0 && r.game_day_start < 28);
  }
});

test("plan: deterministisk", () => {
  const a = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  const b = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM });
  assert.deepEqual(a, b);
});

// Fuldt prestige-katalog til Div 1+2+3.
function fullCatalog() {
  const rows = [];
  rows.push({ id: "gt-0", name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-1", name: "Giro", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-2", name: "Vuelta", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  for (let i = 0; i < 5; i++) rows.push({ id: `mon-${i}`, name: `Mon ${i}`, race_class: "Monuments", race_type: "single", stages: 1 });
  [8, 8, 7, 7, 6, 6, 6, 5].forEach((st, i) => rows.push({ id: `owa-sr-${i}`, name: `OWA ${i}`, race_class: "OtherWorldTourA", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 6; i++) rows.push({ id: `owa-od-${i}`, name: `OWA OD ${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  [7, 5].forEach((st, i) => rows.push({ id: `owb-sr-${i}`, name: `OWB ${i}`, race_class: "OtherWorldTourB", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 8; i++) rows.push({ id: `owb-od-${i}`, name: `OWB OD ${i}`, race_class: "OtherWorldTourB", race_type: "single", stages: 1 });
  for (let i = 0; i < 24; i++) rows.push({ id: `ps-sr-${i}`, name: `PS ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 });
  for (let i = 0; i < 70; i++) rows.push({ id: `ps-od-${i}`, name: `PS OD ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 12; i++) rows.push({ id: `c1-od-${i}`, name: `C1 OD ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  return rows;
}
const fullPools = [
  { id: 1, tier: 1, realManagerCount: 5 },
  { id: 2, tier: 2, realManagerCount: 5 },
  { id: 4, tier: 3, realManagerCount: 5 },
];

test("plan: cross-division dedup — intet løb deles mellem to divisioner", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM });
  const idSets = tierPlans.map((tp) => new Set(tp.pools[0].raceRows.map((r) => r.pool_race_id)));
  for (let i = 0; i < idSets.length; i++) for (let j = i + 1; j < idSets.length; j++) {
    const shared = [...idSets[i]].filter((id) => idSets[j].has(id));
    assert.equal(shared.length, 0, `tier ${tierPlans[i].tier}&${tierPlans[j].tier} deler: ${shared.slice(0, 3)}`);
  }
});

test("plan: hver division rammer sin præcise kvote (140/112/84)", () => {
  const byTier = Object.fromEntries(buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.map((t) => [t.tier, t]));
  assert.equal(byTier[1].totalGameDays, 140);
  assert.equal(byTier[2].totalGameDays, 112);
  assert.equal(byTier[3].totalGameDays, 84);
  for (const t of [1, 2, 3]) assert.equal(byTier[t].quotaHit, true, `tier ${t} shortfall ${byTier[t].shortfall}`);
});

test("plan: Div 1 får alle 3 Grand Tours + alle 5 monumenter; div 3 ingen Grand Tour", () => {
  const tp = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans;
  const div1 = new Set(tp.find((t) => t.tier === 1).pools[0].raceRows.map((r) => r.pool_race_id));
  const div3 = tp.find((t) => t.tier === 3).pools[0].raceRows;
  assert.ok(["gt-0", "gt-1", "gt-2"].every((id) => div1.has(id)), "GT i div1");
  assert.ok([0, 1, 2, 3, 4].every((i) => div1.has(`mon-${i}`)), "monumenter i div1");
  assert.ok(!div3.some((r) => ["TourFrance", "GiroVuelta"].includes(r.race_class)), "ingen GT i div3");
});

test("plan: Grand Tour spænder 21 game-dage (kronologi) men komprimeres i IRL (>1 etape/dag)", () => {
  const div1 = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.find((t) => t.tier === 1).pools[0];
  for (const id of ["gt-0", "gt-1", "gt-2"]) {
    const rows = div1.stageRows.filter((s) => s.pool_race_id === id);
    // Kronologi: 21 etaper = 21 forskellige game-dage, sammenhængende.
    const gds = [...new Set(rows.map((s) => s.game_day))].sort((a, b) => a - b);
    assert.equal(gds.length, 21, `${id}: ${gds.length} game-dage (forventet 21)`);
    assert.equal(gds[20] - gds[0], 20, `${id}: game-dage ikke sammenhængende`);
    // IRL-komprimering: GT komprimeres (>1 etape på mindst én IRL-dag), ikke 1 etape/dag i 21 dage.
    const byIrl = {};
    for (const s of rows) { const d = Date.parse(s.scheduled_at) - (Date.parse(s.scheduled_at) % 86400000); byIrl[d] = (byIrl[d] || 0) + 1; }
    assert.ok(Object.keys(byIrl).length < 21, `${id}: ikke komprimeret (${Object.keys(byIrl).length} IRL-dage)`);
    assert.ok(Math.max(...Object.values(byIrl)) >= 2, `${id}: ingen IRL-dag med >1 etape (ingen komprimering)`);
  }
});

test("plan: monumenter får game_day i binding-fri båndet; game_day_start = almindelig dag", () => {
  const div1 = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans.find((t) => t.tier === 1).pools[0];
  const monRows = div1.raceRows.filter((r) => r.race_class === "Monuments");
  assert.equal(monRows.length, 5);
  for (const m of monRows) {
    assert.ok(m.game_day_start >= 0 && m.game_day_start < 28, "monument game_day_start = almindelig dag");
    const sched = div1.stageRows.filter((s) => s.pool_race_id === m.pool_race_id);
    assert.ok(sched.every((s) => s.game_day >= MONUMENT_GAMEDAY_BASE), "monument schedule game_day i båndet");
  }
  // ikke-monumenter: game_day = tidslinje-ordinal (lille, IKKE i båndet), adskilt fra real_day.
  const gt = div1.stageRows.filter((s) => s.pool_race_id === "gt-0");
  assert.ok(gt.every((s) => s.game_day < MONUMENT_GAMEDAY_BASE), "Grand Tour game_day uden for monument-bånd");
  assert.equal(new Set(gt.map((s) => s.game_day)).size, 21, "Grand Tour = 21 unikke game-dage");
});

test("plan: overlap-cap pr. division — Div 1/2 max 3, Div 3 max 2", () => {
  const tp = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM }).tierPlans;
  const byTier = Object.fromEntries(tp.map((t) => [t.tier, t]));
  assert.equal(byTier[1].overlapCap, 3);
  assert.equal(byTier[3].overlapCap, 2);
  assert.ok(byTier[1].maxOverlap <= 3, `div1 maxOverlap ${byTier[1].maxOverlap}`);
  assert.ok(byTier[2].maxOverlap <= 3, `div2 maxOverlap ${byTier[2].maxOverlap}`);
  assert.ok(byTier[3].maxOverlap <= 2, `div3 maxOverlap ${byTier[3].maxOverlap}`);
});

// ── I/O-wrapper: seed-threading (v2-fix) — samme løb = samme parcours i alle puljer ──
test("apply: en divisions puljer får IDENTISK parcours pr. løb, seedet på external_id", async () => {
  // To LIVE tier-3-puljer → den IDENTISKE kalender fan-out'es til begge. Hvert delt
  // pool_race_id skal give samme parcours (kernen i v2-fixet), og parcourset skal være
  // external_id-seedet (ikke race.id/pool_race_id) — så en revert af threading fanges.
  const catalog = tier3Catalog().map((c) => ({ ...c, external_id: `ext-${c.id}` }));
  const externalById = new Map(catalog.map((c) => [c.id, c.external_id]));
  const metaById = new Map(catalog.map((c) => [c.id, c]));
  const league_divisions = [
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4), mgr("b1", 5), mgr("b2", 5), mgr("b3", 5)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });

  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  assert.ok(summary.racesInserted > 0, "der skal indsættes løb");

  // generator_version stemplet 3 på hver profil.
  for (const p of sb.state.race_stage_profiles) assert.equal(p.generator_version, 3);

  const profByRaceId = new Map();
  for (const p of sb.state.race_stage_profiles) {
    if (!profByRaceId.has(p.race_id)) profByRaceId.set(p.race_id, []);
    profByRaceId.get(p.race_id).push(p);
  }
  const racesByPoolRace = new Map();
  for (const r of sb.state.races) {
    if (!racesByPoolRace.has(r.pool_race_id)) racesByPoolRace.set(r.pool_race_id, []);
    racesByPoolRace.get(r.pool_race_id).push(r);
  }

  let shared = 0;
  for (const [poolRaceId, rs] of racesByPoolRace) {
    if (rs.length < 2) continue; // kun løb der optræder i begge puljer
    shared++;
    // (1) Identisk parcours på tværs af puljerne.
    const variants = new Set(rs.map((r) => routeStr(profByRaceId.get(r.id) || [])));
    assert.equal(variants.size, 1, `pool_race ${poolRaceId}: parcours afviger mellem puljer`);
    // (2) Parcourset er external_id-seedet (ikke pool_race_id/race.id). external_id != pool_race_id
    // i denne fixture, så en revert til en anden seed-kilde ville give et andet parcours.
    const meta = metaById.get(poolRaceId);
    // season_id "s1" matcher materializerens seedRace (sæson-akse, Task 6).
    const expected = routeStr(generateRaceStageProfiles({ id: "ignored", external_id: externalById.get(poolRaceId), race_type: meta.race_type, stages: meta.stages, season_id: "s1" }));
    assert.equal([...variants][0], expected, `pool_race ${poolRaceId}: parcours er ikke seedet på external_id+sæson`);
  }
  assert.ok(shared > 0, "mindst ét løb skal optræde i begge puljer (fan-out)");
});

test("apply: arketype driver parcours (cobbled_classic endagsløb → brosten dominerer)", async () => {
  const catalog = tier3Catalog().map((c) => ({ ...c, external_id: `ext-${c.id}`, terrain_archetype: c.race_type === "stage_race" ? "mountain_tour" : "cobbled_classic" }));
  const league_divisions = [
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4), mgr("b1", 5), mgr("b2", 5), mgr("b3", 5)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });
  await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });

  const oneDayProfiles = sb.state.race_stage_profiles.filter((p) => {
    const r = sb.state.races.find((x) => x.id === p.race_id);
    const meta = catalog.find((c) => c.id === r.pool_race_id);
    return meta && meta.race_type === "single";
  });
  const cobbles = oneDayProfiles.filter((p) => p.profile_type === "cobbles").length;
  assert.ok(oneDayProfiles.length > 0, "der skal være endagsløb");
  assert.ok(cobbles >= oneDayProfiles.length * 0.6, `forventede brosten-dominans, fik ${cobbles}/${oneDayProfiles.length}`);
});

test("forceTiers: en tier-4-pulje uden rigtige managers får alligevel en kalender, når tier 4 er i forceTiers", () => {
  const pools = [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 5 },
    { id: 8, tier: 4, label: "Division 4 — A", realManagerCount: 0 },
    { id: 9, tier: 4, label: "Division 4 — B", realManagerCount: 0 },
  ];
  const catalog = [
    { id: "r1", name: "Test Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
    { id: "r2", name: "Test Class2", race_class: "Class2", race_type: "single", stages: 1 },
  ];

  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, quotas: { 1: 21, 4: 1 }, forceTiers: [4],
  });

  const tier4Plan = tierPlans.find((p) => p.tier === 4);
  assert.ok(tier4Plan, "tier 4 skal have en plan, selvom realManagerCount=0, fordi forceTiers inkluderer den");
  assert.equal(tier4Plan.pools.length, 2, "begge tier-4-puljer skal have fået samme plan");
});

test("forceTiers: uden flaget (default) springes en mandagsløs tier-4-pulje stadig over (uændret adfærd)", () => {
  const pools = [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 5 },
    { id: 8, tier: 4, label: "Division 4 — A", realManagerCount: 0 },
  ];
  const catalog = [
    { id: "r1", name: "Test Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
  ];

  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, quotas: { 1: 21, 4: 1 } });

  assert.equal(tierPlans.find((p) => p.tier === 4), undefined, "uden forceTiers er adfærden uændret: tier 4 uden managers får ingen plan");
});

// ── #1856: in-flight overlap-guard ──
test("assertNewRaceClearsInFlight: intet in-flight vindue eller intet nyt-vindue → ok", () => {
  assert.equal(assertNewRaceClearsInFlight({ newRaceWindow: { start: 10, end: 12 }, inFlightWindows: [] }), true);
  assert.equal(assertNewRaceClearsInFlight({ newRaceWindow: null, inFlightWindows: [{ start: 10, end: 12 }] }), true);
});

test("assertNewRaceClearsInFlight: nyt løb helt efter in-flight resterende vindue → ok", () => {
  assert.equal(assertNewRaceClearsInFlight({
    newRaceWindow: { start: 20, end: 25 },
    newRaceId: "new",
    inFlightWindows: [{ start: 10, end: 15, raceId: "la-corsa" }],
  }), true);
});

test("assertNewRaceClearsInFlight: nyt løb overlapper in-flight resterende vindue → kaster (#1856)", () => {
  assert.throws(
    () => assertNewRaceClearsInFlight({
      newRaceWindow: { start: 14, end: 18 },
      newRaceId: "new-stage-race",
      inFlightWindows: [{ start: 10, end: 15, raceId: "la-corsa" }],
    }),
    /in-flight overlap invariant.*new-stage-race.*la-corsa/s,
  );
});

// Fuld apply-path: en division har et IGANGVÆRENDE etapeløb hvis RESTERENDE vindue dækker de
// dage hvor materializeren placerer nye løb → guarden skal kaste FØR nogen insert (fail-closed).
// Ville have forhindret prod-overlappen (nyt etapeløb schedulet oven på den igangværende La Corsa).
function inFlightApplyFixture() {
  const catalog = tier3Catalog();
  const league_divisions = [{ id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" }];
  const mgr = (id) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 4 });
  const teams = [mgr("a1"), mgr("a2"), mgr("a3")];
  // In-flight etapeløb (status='scheduled', 6/7 afviklet) i division 4. RESTERENDE etape 7 er
  // planlagt bredt over de dage materializeren fylder (FROM=28/6 → nye løb starter 29/6).
  const inflightRace = {
    id: "inflight-1", season_id: "s1", league_division_id: 4, pool_race_id: "was-la-corsa",
    name: "La Corsa (in-flight)", race_type: "stage_race", stages: 7, stages_completed: 6, status: "scheduled",
  };
  // 7 schedule-rækker; kun etape 7 (resterende) tæller. Læg den 29/6 (samme CET-dag som nye løbs dag 0).
  const race_stage_schedule = [
    { race_id: "inflight-1", stage_number: 1, scheduled_at: "2026-06-23T10:00:00Z", game_day: 0 },
    { race_id: "inflight-1", stage_number: 2, scheduled_at: "2026-06-24T10:00:00Z", game_day: 1 },
    { race_id: "inflight-1", stage_number: 3, scheduled_at: "2026-06-25T10:00:00Z", game_day: 2 },
    { race_id: "inflight-1", stage_number: 4, scheduled_at: "2026-06-26T10:00:00Z", game_day: 3 },
    { race_id: "inflight-1", stage_number: 5, scheduled_at: "2026-06-27T10:00:00Z", game_day: 4 },
    { race_id: "inflight-1", stage_number: 6, scheduled_at: "2026-06-28T10:00:00Z", game_day: 5 },
    { race_id: "inflight-1", stage_number: 7, scheduled_at: "2026-06-29T10:00:00Z", game_day: 6 }, // resterende → binder 29/6
  ];
  return { catalog, league_divisions, teams, races: [inflightRace], race_stage_schedule };
}

test("apply: guard kaster når et nyt løb placeres oven på et in-flight løbs resterende vindue (#1856)", async () => {
  const fx = inFlightApplyFixture();
  const sb = makeSupabase({
    league_divisions: fx.league_divisions, teams: fx.teams, race_pool: fx.catalog,
    races: fx.races, race_stage_schedule: fx.race_stage_schedule,
  });
  await assert.rejects(
    () => materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false }),
    /in-flight overlap invariant/,
    "materialize skal afbryde når et nyt løb overlapper det in-flight løbs resterende vindue",
  );
  // Fail-closed: intet nyt løb blev indsat i den ramte division (kun det pre-seedede in-flight løb består).
  const div4Races = sb.state.races.filter((r) => r.league_division_id === 4);
  assert.deepEqual(div4Races.map((r) => r.id), ["inflight-1"], "ingen nye løb må være indsat før guarden kastede");
});

test("apply: guard rører IKKE dry-run (ingen writes, ingen kast)", async () => {
  const fx = inFlightApplyFixture();
  const sb = makeSupabase({
    league_divisions: fx.league_divisions, teams: fx.teams, race_pool: fx.catalog,
    races: fx.races, race_stage_schedule: fx.race_stage_schedule,
  });
  // dryRun (default) inserter aldrig → guarden (som sidder på insert-stien) rammes ikke.
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: true });
  assert.equal(summary.racesInserted, 0, "dry-run skriver ikke");
});

test("apply: et completed (afviklet) løb binder IKKE — nye løb placeres frit ovenpå", async () => {
  const fx = inFlightApplyFixture();
  // Gør in-flight-løbet completed (afviklet) → det binder ikke fremad; materialize skal lykkes.
  const completed = { ...fx.races[0], stages_completed: 7, status: "completed" };
  const sb = makeSupabase({
    league_divisions: fx.league_divisions, teams: fx.teams, race_pool: fx.catalog,
    races: [completed], race_stage_schedule: fx.race_stage_schedule,
  });
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false });
  assert.ok(summary.racesInserted > 0, "afviklet løb må ikke blokere ny materialisering");
});
