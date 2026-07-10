import test from "node:test";
import assert from "node:assert/strict";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE, materializeTierCalendars, reconcilePoolCalendarOnActivation, detectCalendarViolations, detectPoolSignatureMismatch, TIER_CLASS_WHITELIST } from "./tierCalendarMaterializer.js";
import { TIER_GAME_DAY_QUOTA } from "./tierRaceSelection.js";
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
      maybeSingle() { return Promise.resolve({ data: rows().filter(matches)[0] ?? null, error: null }); },
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

// ── #2251 · GT-gate + kalender-invarianter ──────────────────────────────────────

test("#2251 plan: tier 4 vælger ALDRIG Grand Tours, selv når kataloget har ledige GT'er", () => {
  // GT'er ud over div 1's behov må ikke kaskadere ned: tier 4 skal fylde sin kvote
  // med ikke-GT-løb. Katalog: 2 GT'er + rigeligt småløb.
  const tier4EligibleRows = [];
  [5, 4, 4, 4, 3].forEach((st, i) => tier4EligibleRows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 60; i++) tier4EligibleRows.push({ id: `c2-od-${i}`, name: `C2 Classic ${i}`, race_class: "Class2", race_type: "single", stages: 1 });
  const catalog = [
    { id: "gt-a", name: "GT A", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
    { id: "gt-b", name: "GT B", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 },
    ...tier4EligibleRows,
  ];
  const t4pools = [{ id: 8, tier: 4, realManagerCount: 2 }];
  const { tierPlans } = buildTierMaterializationPlan({ pools: t4pools, catalog, from: FROM });
  const t4 = tierPlans.find((p) => p.tier === 4);
  assert.ok(t4, "tier 4 skal have en plan");
  const stagesById = new Map(catalog.map((c) => [c.id, c.stages]));
  for (const r of t4.pools[0].raceRows) {
    assert.ok((stagesById.get(r.pool_race_id) ?? 1) < 15, `GT i tier 4: ${r.pool_race_id}`);
  }
  assert.equal(t4.calendarViolations.length, 0);
  assert.equal(t4.quotaHit, true, `tier 4 skal stadig ramme kvoten (shortfall=${t4.shortfall})`);
});

test("#2251 detectCalendarViolations: GT i tier >1 + overlappende GT-rygrad flages; spredt rygrad i tier 1 er ren", () => {
  const gt = (id, gdStart) => ({
    id, stages: 21,
    stagesPlaced: Array.from({ length: 21 }, (_, k) => ({ stage_number: k + 1, game_day: gdStart + k })),
  });
  // Prod-tilstanden 5-10/7: to GT'er begge gd 0-20 i tier 4 → begge regler brudt.
  const bad = detectCalendarViolations({ tier: 4, placements: [gt("ib", 0), gt("hex", 0)] });
  assert.equal(bad.length, 2, bad.join(" · "));
  // Div 1's faktiske form (0-20 / 30-50 / 60-80): ingen brud.
  const good = detectCalendarViolations({ tier: 1, placements: [gt("a", 0), gt("b", 30), gt("c", 60)] });
  assert.deepEqual(good, []);
  // Småløb trigger aldrig.
  const small = detectCalendarViolations({ tier: 4, placements: [{ id: "s", stages: 6, stagesPlaced: [{ game_day: 0 }] }] });
  assert.deepEqual(small, []);
});

test("#2251 dryRun rapporterer calendarViolations pr. tier (tom liste når planen er ren)", async () => {
  const catalog = tier3Catalog();
  const league_divisions = [{ id: 8, tier: 4, pool_index: 0, label: "Division 4 — A" }];
  const teams = [mgrTeam("m1", 8)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, dryRun: true });
  assert.ok(summary.tiers.length > 0);
  assert.ok(summary.tiers.every((t) => Array.isArray(t.calendarViolations) && t.calendarViolations.length === 0));
});

test("#2251 reconcile: kvote-override MERGES oven på defaults, så tier 1-3's selections stadig optager løb i cross-tier-dedup'en", async () => {
  // Rod-årsagen bag GT'erne i div 4: quotas = { [tier4]: X } gav tier 1-3 kvote 0 i
  // plan-genberegningen → tom selection → tom dedup → tier 4 valgte frit (GT'er først).
  const state = tier4ActivationState();
  state.league_divisions.push({ id: 1, tier: 1, pool_index: 0, label: "Division 1" });
  state.teams.push(mgrTeam("d1-m1", 1));
  state.races = [{ id: "race-d1", season_id: "s1", league_division_id: 1, pool_race_id: "eksisterende-d1" }];
  state.race_stage_schedule = [
    { race_id: "race-d1", stage_number: 1, scheduled_at: "2026-07-01T16:00:00Z", game_day: 3 },
    { race_id: "race-d1", stage_number: 2, scheduled_at: "2026-07-10T16:00:00Z", game_day: 12 },
  ];
  const sb = makeSupabase(state);
  const calls = [];
  const recording = async (args) => { calls.push(args); return { racesInserted: 0, tiers: [] }; };

  await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, materialize: recording });
  assert.equal(calls.length, 1);
  const q = calls[0].quotas;
  assert.equal(q[1], TIER_GAME_DAY_QUOTA[1], "tier 1 skal beholde sin default-kvote i dedup-genberegningen");
  assert.equal(q[2], TIER_GAME_DAY_QUOTA[2]);
  assert.equal(q[3], TIER_GAME_DAY_QUOTA[3]);
  assert.equal(q[4], 2 * 11, "den aktiverede tiers kvote = density × rest-dage");
});

// ── #2149 · reconcilePoolCalendarOnActivation: forward-guard ved pulje-aktivering ──
// Signup i en sovende tier 3/4-pulje gør poolHasCalendar true, men intet materialiserede
// historisk kalenderen. Reconcile'n skal materialisere KUN den ramte puljes tier — og være
// et billigt no-op i alle normale tilfælde (pulje har allerede løb / ingen aktiv sæson).

const mgrTeam = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });

function tier4ActivationState() {
  return {
    seasons: [{ id: "s1", number: 2, status: "active", start_date: "2026-06-22" }],
    league_divisions: [
      { id: 8, tier: 4, pool_index: 0, label: "Division 4 — A" },
      { id: 9, tier: 4, pool_index: 1, label: "Division 4 — B" },
    ],
    teams: [mgrTeam("m1", 8)], // første ægte manager aktiverer pulje 8; pulje 9 forbliver sovende
    race_pool: tier3Catalog(),
  };
}

test("#2149 aktivering af sovende tier-4-pulje materialiserer kalender for den pulje (søster-pulje forbliver tom)", async () => {
  const sb = makeSupabase(tier4ActivationState());
  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM });

  assert.equal(summary.skipped, null);
  assert.equal(summary.tier, 4);
  assert.ok(summary.racesInserted > 0, "der skal indsættes løb for den aktiverede pulje");
  assert.ok(sb.state.races.filter((r) => r.league_division_id === 8).length > 0, "pulje 8 har løb");
  assert.equal(sb.state.races.filter((r) => r.league_division_id === 9).length, 0, "managerløs pulje 9 må IKKE få kalender (ingen forceTiers)");
  // from = næste dags UTC-midnat efter now — dagens afvikling forstyrres ikke.
  assert.equal(summary.from, "2026-06-29T00:00:00.000Z");
});

test("#2149 idempotent: andet kald er no-op (has-calendar) og duplikerer intet", async () => {
  const sb = makeSupabase(tier4ActivationState());
  await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM });
  const racesAfterFirst = sb.state.races.length;

  const second = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM });
  assert.equal(second.skipped, "has-calendar");
  assert.equal(sb.state.races.length, racesAfterFirst, "ingen dubletter ved dobbelt-kald");
});

test("#2149 pulje med eksisterende kalender: no-op UDEN at røre materialiseringen", async () => {
  const state = tier4ActivationState();
  state.races = [{ id: "race-1", season_id: "s1", league_division_id: 8, pool_race_id: "ps-od-0" }];
  const sb = makeSupabase(state);
  const materializeCalls = [];
  const recording = async (args) => { materializeCalls.push(args); return { racesInserted: 0 }; };

  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, materialize: recording });
  assert.equal(summary.skipped, "has-calendar");
  assert.equal(materializeCalls.length, 0, "precheck skal kortslutte før den tunge materialisering");
});

test("#2149 ingen aktiv sæson / ukendt pulje / null pulje: no-op uden kast", async () => {
  const noSeason = makeSupabase({ ...tier4ActivationState(), seasons: [] });
  assert.equal((await reconcilePoolCalendarOnActivation({ supabase: noSeason, poolId: 8, now: FROM })).skipped, "no-active-season");
  assert.equal(noSeason.state.races.length, 0);

  const sb = makeSupabase(tier4ActivationState());
  assert.equal((await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 9999, now: FROM })).skipped, "unknown-pool");
  assert.equal((await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: null, now: FROM })).skipped, "no-pool");
});

test("#2149 midt-sæson-aktivering afkortes til de-facto sæson-slut (ingen etaper efter sidste eksisterende etape)", async () => {
  // Ejer-krav 4/7: alle divisioner slutter deres kalender SAMME dag. En pulje aktiveret midt i
  // sæsonen skal derfor kun have rest-horisonten — ikke materializerens fulde 28-dages default.
  const state = tier4ActivationState();
  state.league_divisions.push({ id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" });
  state.teams.push(mgrTeam("m2", 4));
  state.races = [{ id: "race-d3", season_id: "s1", league_division_id: 4, pool_race_id: "eksisterende-d3" }];
  // Eksisterende sæson slutter 2026-07-10 (sidste planlagte etape).
  state.race_stage_schedule = [
    { race_id: "race-d3", stage_number: 1, scheduled_at: "2026-07-01T16:00:00Z", game_day: 10 },
    { race_id: "race-d3", stage_number: 2, scheduled_at: "2026-07-10T16:00:00Z", game_day: 40 },
  ];
  const sb = makeSupabase(state);

  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM }); // now=28/6 → from=29/6
  assert.equal(summary.skipped, null);
  assert.equal(summary.realDays, 11, "29/6 → 10/7 = 11 rest-dage");
  assert.equal(summary.tiers[0].quota, 22, "kvote = density 2 × 11 dage");
  assert.ok(summary.racesInserted > 0);

  const insertedRaceIds = new Set(sb.state.races.filter((r) => r.league_division_id === 8).map((r) => r.id));
  const seasonEnd = Date.parse("2026-07-10T23:59:59Z");
  for (const s of sb.state.race_stage_schedule.filter((s) => insertedRaceIds.has(s.race_id))) {
    assert.ok(Date.parse(s.scheduled_at) <= seasonEnd, `etape ${s.scheduled_at} ligger efter sæson-slut 10/7`);
  }
});

test("#2149 aktivering på/efter sæsonens sidste dag: no-op (season-ending) i stedet for 0-dages kalender", async () => {
  const state = tier4ActivationState();
  state.races = [{ id: "race-d3", season_id: "s1", league_division_id: 4, pool_race_id: "eksisterende-d3" }];
  state.race_stage_schedule = [{ race_id: "race-d3", stage_number: 1, scheduled_at: "2026-06-29T16:00:00Z", game_day: 1 }];
  const sb = makeSupabase(state);

  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM }); // from=29/6 = sidste dag
  assert.equal(summary.skipped, "season-ending");
  assert.equal(sb.state.races.filter((r) => r.league_division_id === 8).length, 0, "ingen kalender de sidste dage af sæsonen");
});

test("#2149 sovende pulje der STADIG er managerløs: materializeren gater selv (0 løb indsat)", async () => {
  // Defensivt hjørne: kaldes reconcile'n for en pulje uden ægte manager (fx race mellem
  // insert og læsning), holder poolHasCalendar-gaten i materializeren stadig — intet indsættes.
  const state = tier4ActivationState();
  state.teams = []; // ingen managere overhovedet
  const sb = makeSupabase(state);
  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM });
  assert.equal(summary.skipped, null, "reconcile'n når materialiseringen");
  assert.equal(summary.racesInserted, 0, "poolHasCalendar-gaten holder — 0 løb");
  assert.equal(sb.state.races.length, 0);
});

// ── #2276 · prestige-kaskade brudt i Div 4 — klasse-whitelist + cross-tier dedup + pool-signatur ──

function fullCascadeCatalog() {
  const rows = [];
  rows.push({ id: "gt-tdf", name: "Tour de France", race_class: "TourFrance", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-giro", name: "Giro d'Italia", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-vuelta", name: "Vuelta a España", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  ["Paris-Roubaix", "Milano-Sanremo", "Ronde van Vlaanderen", "Liège-Bastogne-Liège", "Il Lombardia"].forEach((name, i) =>
    rows.push({ id: `mon-${i}`, name, race_class: "Monuments", race_type: "single", stages: 1 }));
  for (let i = 0; i < 6; i++) rows.push({ id: `owta-${i}`, name: `OWT-A ${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  for (let i = 0; i < 30; i++) rows.push({ id: `owtb-${i}`, name: `OWT-B ${i}`, race_class: "OtherWorldTourB", race_type: "single", stages: 1 });
  for (let i = 0; i < 30; i++) rows.push({ id: `owtc-${i}`, name: `OWT-C ${i}`, race_class: "OtherWorldTourC", race_type: "single", stages: 1 });
  for (let i = 0; i < 40; i++) rows.push({ id: `ps-${i}`, name: `ProSeries ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  for (let i = 0; i < 40; i++) rows.push({ id: `c1-${i}`, name: `Class1 ${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  for (let i = 0; i < 60; i++) rows.push({ id: `c2-${i}`, name: `Class2 ${i}`, race_class: "Class2", race_type: "single", stages: 1 });
  return rows;
}

const cascadePools = [
  { id: 101, tier: 1, realManagerCount: 10 },
  { id: 201, tier: 2, realManagerCount: 10 }, { id: 202, tier: 2, realManagerCount: 10 },
  { id: 301, tier: 3, realManagerCount: 10 }, { id: 302, tier: 3, realManagerCount: 10 },
  { id: 401, tier: 4, realManagerCount: 10 }, { id: 402, tier: 4, realManagerCount: 10 }, { id: 403, tier: 4, realManagerCount: 10 },
];

test("#2276 invariant 1: klasse-whitelist pr. tier — tier 2/3/4 får ALDRIG Monuments/GrandTour/OtherWorldTourA", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools: cascadePools, catalog: fullCascadeCatalog(), from: FROM });
  for (const tp of tierPlans) {
    if (tp.tier === 1) continue;
    const allowed = new Set(TIER_CLASS_WHITELIST[tp.tier]);
    for (const pool of tp.pools) {
      for (const r of pool.raceRows) {
        assert.ok(allowed.has(r.race_class), `tier ${tp.tier} pool ${pool.leagueDivisionId}: ulovlig klasse ${r.race_class} (${r.name})`);
      }
    }
    assert.equal(tp.calendarViolations.length, 0, `tier ${tp.tier} violations: ${tp.calendarViolations.join(" · ")}`);
  }
});

test("#2276 invariant 2: cross-tier dedup — intet løbsnavn optræder i to tiers samme sæson", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools: cascadePools, catalog: fullCascadeCatalog(), from: FROM });
  const nameToTiers = new Map();
  for (const tp of tierPlans) {
    const namesInTier = new Set(tp.pools[0].raceRows.map((r) => r.name));
    for (const name of namesInTier) {
      if (!nameToTiers.has(name)) nameToTiers.set(name, new Set());
      nameToTiers.get(name).add(tp.tier);
    }
  }
  for (const [name, tiersSet] of nameToTiers) {
    assert.equal(tiersSet.size, 1, `løb "${name}" optræder i flere tiers: ${[...tiersSet].join(",")}`);
  }
});

test("#2276 invariant 2b: detectCalendarViolations flager et løbsnavn genbrugt fra en højere tier", () => {
  const placements = [{ id: "dup-1", stages: 1, stagesPlaced: [{ stage_number: 1, game_day: 0 }] }];
  const catalogById = new Map([["dup-1", { name: "Il Lombardia", race_class: "Class1" }]]);
  const violations = detectCalendarViolations({
    tier: 4, placements, catalogById, usedRaceNamesBeforeTier: new Set(["Il Lombardia"]),
  });
  assert.ok(violations.some((v) => v.includes("#2276 cross-tier dedup")), violations.join(" · "));
});

test("#2276 invariant 3: alle puljer i en division får identisk kalender-signatur (navn+game_day+stages)", () => {
  const { tierPlans } = buildTierMaterializationPlan({ pools: cascadePools, catalog: fullCascadeCatalog(), from: FROM });
  for (const tp of tierPlans) {
    assert.equal(detectPoolSignatureMismatch({ tier: tp.tier, pools: tp.pools }).length, 0, `tier ${tp.tier} puljer divergerer`);
  }
});

test("#2276 invariant 3b: detectPoolSignatureMismatch flager en pulje med afvigende raceRows", () => {
  const pools4 = [
    { leagueDivisionId: 1, raceRows: [{ pool_race_id: "a", name: "A", game_day_start: 0, stages: 1 }] },
    { leagueDivisionId: 2, raceRows: [{ pool_race_id: "a", name: "A", game_day_start: 5, stages: 1 }] },
  ];
  const violations = detectPoolSignatureMismatch({ tier: 4, pools: pools4 });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /#2276 identical-pools invariant/);
});

test("#2276 reconcile: aktivering af en enkelt tier-4-pulje senere respekterer allerede-materialiserede tier 1-3-navne (usedRaceNames seedet fra DB)", async () => {
  // Simulerer prod-scenariet: tier 1-3 er allerede materialiseret (races i DB); tier 4
  // aktiveres separat via reconcilePoolCalendarOnActivation, som IKKE har tier 1-3's
  // selection i hukommelsen — kun usedRaceNames seedet fra eksisterende DB-rækker forhindrer
  // at tier 4 vælger et navn der allerede kører i en højere tier.
  const catalog = fullCascadeCatalog();
  const divisions = [
    { id: 101, tier: 1 }, { id: 201, tier: 2 }, { id: 301, tier: 3 }, { id: 401, tier: 4 },
  ];
  const teams = divisions.map((d) => ({ league_division_id: d.id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }));
  // Tier 1 har allerede fået Il Lombardia (Monuments) materialiseret.
  const existingRaces = [{ id: "existing-1", season_id: "s1", league_division_id: 101, pool_race_id: "mon-4", name: "Il Lombardia" }];
  const state = { league_divisions: divisions, teams, race_pool: catalog, races: existingRaces, race_stage_profiles: [], race_stage_schedule: [] };
  const sb = makeSupabase(state);
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, tiers: [4], dryRun: false, realDays: 28 });
  const tier4Names = new Set(sb.state.races.filter((r) => r.league_division_id === 401).map((r) => r.name));
  assert.ok(!tier4Names.has("Il Lombardia"), "tier 4 må ikke vælge et navn allerede brugt i tier 1");
  assert.equal(summary.tiers.find((t) => t.tier === 4)?.calendarViolations?.length ?? 0, 0);
});
