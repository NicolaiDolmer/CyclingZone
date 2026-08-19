import test from "node:test";
import assert from "node:assert/strict";
import { buildTierMaterializationPlan, MONUMENT_GAMEDAY_BASE, materializeTierCalendars, reconcilePoolCalendarOnActivation, detectCalendarViolations, detectPoolSignatureMismatch, TIER_CLASS_WHITELIST } from "./tierCalendarMaterializer.js";
import { TIER_GAME_DAY_QUOTA } from "./tierRaceSelection.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "./raceStageProfileGenerator.js";

const FROM = new Date("2026-06-28T00:00:00Z");

// #3327/#3328 (2026-08-04): eksplicit opt-out af de nye kalender-dækningsgarantier
// (endagsløb/etapeløb-mix, klasse↔længde-bånd, terræn-familie-minimum, mountain-free-
// minimum) for tests der bevidst bruger små/kunstige katalog-fixtures til at teste ANDEN
// mekanik (GT-gate, overlap-cap, kronologi, dedup, quote-hit-mekanik). Tomme objekter
// slår hver garanti fra (samme konvention som selectTierRaceSet: `?.[tier]` → undefined
// → springes). Dedikerede #3327/#3328-tests nedenfor bruger IKKE denne — de tester
// netop de nye garantier med formålsbyggede fixtures.
const LEGACY_MIX = {
  oneDayShareTargets: {}, classStageLengthBand: null, priorityArchetypes: null,
  oneDayShareMin: {}, terrainFamilyMin: {}, mountainFreeMin: {},
};

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
    let pendingUpdate = null;
    const matches = (row) => filters.every((f) =>
      f.t === "eq" ? row[f.c] === f.v : f.t === "in" ? f.v.includes(row[f.c]) : true);
    const builder = {
      select() { return builder; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return builder; },
      in(c, v) { filters.push({ t: "in", c, v }); return builder; },
      order() { return builder; },
      // #3959 · recomputeSeasonRaceDays() skriver seasons.race_days_completed/
      // race_days_total via .update(payload).eq(...) — mocken merger payload'en ind i
      // rækker der matcher de efterfølgende eq-filtre, samme lazy-apply-mønster som insert.
      update(payload) { pendingUpdate = payload; return builder; },
      // #2962 · materializeTierCalendars' teams-select pagineres nu via fetchAllRows
      // (.order("id").range()) — mocken slicer den filtrerede tabel som en enkelt side.
      range(from, to) { return Promise.resolve({ data: rows().filter(matches).slice(from, to + 1), error: null }); },
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
      then(res, rej) {
        if (pendingUpdate) {
          for (const row of rows()) if (matches(row)) Object.assign(row, pendingUpdate);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej);
      },
    };
    return builder;
  }
  return { from, state };
}

const routeStr = (profiles) => profiles.slice().sort((a, b) => a.stage_number - b.stage_number)
  .map((p) => `${p.stage_number}:${p.profile_type}|${p.finale_type ?? ""}`).join(">");

// Tier-3-katalog: ProSeries + Class1, > kvote 84.
// #3469 (2026-08-07 morgen, ejer-beslutning om endagsløbs-balancen): D3's endagsløb-
// TARGET faldt 0,76→0,58 — under DEFAULT (ikke-LEGACY_MIX) settings vil to-fase-budgettet
// nu bede om FLERE etapeløbs-game-days end før. ProSeries-etapeløbene på 8/6 falder uden
// for #3328's klasse-bånd [3,5] og udgår derfor af det tilgængelige udvalg under default —
// Class1-etapeløbs-udvalget er derfor udvidet (Class1 har intet bånd) så fixturen har nok
// forsyning til at ramme 84 UDEN shortfall under de nye default-mål (verificeret mod det
// rigtige katalog: D3 rammer 84/84 uændret — det er KUN denne lille syntetiske fixture der
// var for sparsom).
function tier3Catalog() {
  const rows = [];
  [8, 6, 5, 5, 4].forEach((st, i) => rows.push({ id: `ps-sr-${i}`, name: `Stage ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 40; i++) rows.push({ id: `ps-od-${i}`, name: `Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, name: `C1 ${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
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
  const t = buildTierMaterializationPlan({ pools, catalog: tier3Catalog(), from: FROM, ...LEGACY_MIX }).tierPlans[0];
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
  const byTier = Object.fromEntries(buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalog(), from: FROM, ...LEGACY_MIX }).tierPlans.map((t) => [t.tier, t]));
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

// #3470: fullCatalog() har INGEN date_text på nogen løb — GT'erne rammer derfor
// #3469/#3470s fraction-/hviledags-FRIE fallback-sti (perGap, bit-identisk med før
// #3469), som SKAL forblive 100% kontinuert (0 hviledage, ingen date_text at udlede dem
// af). Se "#3470: GT-hviledage" nedenfor for den NYE kontrakt (span = stages-1+restDays)
// når date_text ER sat på GT'erne.
test("plan: Grand Tour spænder 21 game-dage (kronologi, fallback uden date_text) men komprimeres i IRL (>1 etape/dag)", () => {
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

// #3470: fullCatalog() + date_text på de 3 GT'er (rigtige Giro/Tour/Vuelta-datoer, samme
// tal som grandTourRestDays.test.js) — aktiverer #3469's fase-ankrede STREAM-gren OG
// dermed #3470's hviledags-segmentering (restDays udledes AUTOMATISK af date_text, ingen
// separat "restDays"-fixture-felt). Resten af kataloget er bevidst UDEN date_text (samme
// isolerede gate-test-mønster som raceCalendarLanePacker.test.js's fallback-tests).
function fullCatalogWithGtDates() {
  return fullCatalog().map((c) => {
    if (c.id === "gt-1") return { ...c, date_text: "8/5 - 31/5" };  // Giro → 24 dage/21 etaper → 3 hviledage
    if (c.id === "gt-0") return { ...c, date_text: "1/7 - 23/7" };  // Tour → 23 dage/21 etaper → 2 hviledage
    if (c.id === "gt-2") return { ...c, date_text: "22/8 - 13/9" }; // Vuelta → 23 dage/21 etaper → 2 hviledage
    return c;
  });
}

test("#3470: GT-hviledage — span = stages-1+restDaysFilled når date_text findes, stage_number tæt 1..21, kvote uændret", () => {
  // LEGACY_MIX: denne test isolerer #3470's GT-hviledags-mekanik (ANDEN mekanik, jf.
  // LEGACY_MIX's docstring øverst i filen) — uden opt-out fanger #3327/#3328's
  // downstreamProtectedArchetypes (main, klasse-bevidst nedstrøms-beskyttelse) et 1-dags
  // shortfall PÅ NETOP dette minimale/kunstige katalog (139/140), et selection-lag-fund der
  // intet har med #3470 at gøre — samme isolerings-mønster som #2251/overlap-cap/kronologi/
  // dedup-testene i denne fil.
  const plan = buildTierMaterializationPlan({ pools: fullPools, catalog: fullCatalogWithGtDates(), from: FROM, ...LEGACY_MIX });
  const tier1 = plan.tierPlans.find((t) => t.tier === 1);
  const div1 = tier1.pools[0];
  const expectedRestDaysPlanned = { "gt-1": 3, "gt-0": 2, "gt-2": 2 };
  assert.equal(tier1.grandTourRestDays.length, 3, "en rapportlinje pr. GT (#3470 punkt 3)");
  for (const [id, restDaysPlanned] of Object.entries(expectedRestDaysPlanned)) {
    const report = tier1.grandTourRestDays.find((r) => r.id === id);
    assert.ok(report, `${id}: mangler grandTourRestDays-rapportlinje`);
    assert.equal(report.restDaysPlanned, restDaysPlanned, `${id}: restDaysPlanned skal matche date_text-spændet`);
    // Konsistens: hver planlagt hviledag er enten fyldt (filler) eller degraderet — aldrig tabt.
    assert.equal(report.restDaysFilled + report.degradedAfterStage.length, restDaysPlanned, `${id}: filled+degraded skal summe til planned`);
    assert.equal(report.fillerIds.length, report.restDaysFilled);

    const rows = div1.stageRows.filter((s) => s.pool_race_id === id);
    const gds = [...new Set(rows.map((s) => s.game_day))].sort((a, b) => a - b);
    assert.equal(gds.length, 21, `${id}: skal stadig have 21 UNIKKE etape-game-dage`);
    // Kun de FAKTISK fyldte hviledage strækker spændet — degraderede hviledage lægges IKKE
    // ind som et hul (GT'ens næste etape lægges umiddelbart efter, "degradér ærligt").
    assert.equal(gds[gds.length - 1] - gds[0], 21 - 1 + report.restDaysFilled, `${id}: span skal være stages-1+restDaysFilled`);
    const stageNumbers = rows.map((s) => s.stage_number).sort((a, b) => a - b);
    assert.deepEqual(stageNumbers, Array.from({ length: 21 }, (_, i) => i + 1), `${id}: stage_number skal være tæt 1..21 (Option A)`);
  }
  // Mindst ét GT fik rent faktisk mindst én hviledag fyldt i dette katalog — beviser at
  // fyldnings-stien (ikke kun degrade-stien) faktisk er udøvet af testen.
  assert.ok(tier1.grandTourRestDays.some((r) => r.restDaysFilled > 0), "mindst ét GT skal have mindst én fyldt hviledag");
  // #2251-invarianten (ingen GT-overlap) holder stadig med de forlængede spænd.
  assert.deepEqual(tier1.calendarViolations, [], `uventede violations: ${JSON.stringify(tier1.calendarViolations)}`);
  // #3327-uafhængigt: totalGameDays/kvote UÆNDRET — fillere er allerede en del af puljen.
  assert.equal(tier1.totalGameDays, 140);
  assert.equal(tier1.quotaHit, true, `shortfall=${tier1.shortfall}`);
  // #3470 (ejer-beslutning 7/8): diagnose()'s overlap-optælling er nu STAGE-baseret — en GT
  // på hviledag tæller ikke længere med i den dags overlap, loftet er atter det hårde cap.
  assert.ok(tier1.maxOverlap <= 3, `tier1 maxOverlap ${tier1.maxOverlap} > cap 3`);
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

  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false, ...LEGACY_MIX });
  assert.ok(summary.racesInserted > 0, "der skal indsættes løb");

  // generator_version stemplet med DEN AKTUELLE GENERATOR_VERSION på hver profil (#2769:
  // pass 2 rute-berigelse wired ind; #3326: bumpet til 5 — assert mod konstanten fremfor
  // et hårdkodet literal, så fremtidige bumps ikke kræver en usynlig genopdatering her).
  for (const p of sb.state.race_stage_profiles) {
    assert.equal(p.generator_version, GENERATOR_VERSION);
    // Rute-felterne (pass 2) skal være persisteret på hver indsat profil-række.
    assert.equal(typeof p.distance_km, "number");
    assert.ok(Array.isArray(p.climbs));
  }

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

  // #3347: materializeren rapporterer hvilken re-draw-variant tieren blev skrevet med.
  const tier3Attempt = summary.tiers.find((t) => t.tier === 3)?.realismDraw?.attempt ?? 0;
  assert.equal(typeof tier3Attempt, "number");

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
    // season_id "s1" matcher materializerens seedRace (sæson-akse, Task 6); season_variant
    // er tierens #3347-re-draw som materializeren selv rapporterer — så assertionen
    // beskriver "det materializeren skrev", også hvis et gen-træk var nødvendigt.
    const expected = routeStr(generateRaceStageProfiles({ id: "ignored", external_id: externalById.get(poolRaceId), race_type: meta.race_type, stages: meta.stages, season_id: "s1", season_variant: tier3Attempt }));
    assert.equal([...variants][0], expected, `pool_race ${poolRaceId}: parcours er ikke seedet på external_id+sæson`);
  }
  assert.ok(shared > 0, "mindst ét løb skal optræde i begge puljer (fan-out)");
});

// ── #3347: skrive-stien bruger PRÆCIS det træk realisme-gaten scorer ──────────
// Gaten (raceRouteRealismScorecard) og materializeren løser re-draw-varianten med
// samme rene funktion (resolveTierDraw). Går de fra hinanden, scorer gaten ét
// parcours mens databasen får et andet — gaten ville være en løgn.
test("#3347 apply: de indsatte profiler er tierens RESOLVEREDE re-draw, ikke altid attempt 0", async () => {
  // Katalog hvor tier 3's bånd (summit ≥ 8 · M-Down ≤ 55 % · 1 fritstående ITT ·
  // 1 brosten-i-etapeløb · #3469: bunch-sprint ≥ 10 · nedkørsels-finale ≥ 4 ·
  // enkeltstart-slutfinale ≥ 1) er OPNÅELIGE — ellers ville hvert træk fejle og attempt
  // altid lande på 0 (udtømt), og testen ville ikke måle det den påstår. flat_sprint-
  // løbene (#3469-tilføjelse) leverer bunch-sprint-forsyning; uden dem har kataloget
  // næsten ingen "flat"-etaper (kun de garanterede flad-åbningsetaper i summit_tour/
  // cobbled_tour), og bunch_sprint_min ville aldrig kunne opfyldes.
  const catalog = [
    ...[6, 5, 5, 4].map((stages, i) => ({ id: `st-${i}`, name: `Summit Tour ${i}`, race_class: "ProSeries", race_type: "stage_race", stages, external_id: `ext-st-${i}`, terrain_archetype: "summit_tour" })),
    ...[5, 4].map((stages, i) => ({ id: `cb-${i}`, name: `Cobbled Tour ${i}`, race_class: "ProSeries", race_type: "stage_race", stages, external_id: `ext-cb-${i}`, terrain_archetype: "cobbled_tour" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `itt-${i}`, name: `Chrono ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, external_id: `ext-itt-${i}`, terrain_archetype: "itt_classic" })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `hc-${i}`, name: `Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, external_id: `ext-hc-${i}`, terrain_archetype: "hilly_classic" })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `fs-${i}`, name: `Sprint Classic ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, external_id: `ext-fs-${i}`, terrain_archetype: "flat_sprint" })),
  ];
  const metaById = new Map(catalog.map((c) => [c.id, c]));
  const league_divisions = [{ id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" }];
  const mgr = (id) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 4 });
  const teams = [mgr("a1"), mgr("a2"), mgr("a3")];

  // Deterministisk søgning efter en sæson hvis kanoniske træk bryder båndene — netop
  // det tilfælde #3347 handler om. Generatoren er deterministisk, så listen er stabil.
  let hit = null;
  for (let i = 0; i < 12 && !hit; i++) {
    const seasonId = `s-3347-${i}`;
    const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });
    const summary = await materializeTierCalendars({ supabase: sb, seasonId, seasonStartDate: "2026-06-22", from: FROM, dryRun: false, ...LEGACY_MIX });
    const draw = summary.tiers.find((t) => t.tier === 3)?.realismDraw;
    if (draw && draw.attempt > 0 && !draw.exhausted) hit = { seasonId, sb, draw };
  }
  assert.ok(hit, "fandt ingen sæson hvor det kanoniske træk brød båndene — fixturen måler ikke re-draw-stien");
  assert.ok(hit.draw.firstDrawFailures.length > 0, "et re-draw skal kunne begrundes med det kanoniske træks brud");

  // Hver persisteret profil-række skal matche generatoren MED tierens variant — og
  // IKKE attempt 0. Gør den det, er skrive-stien og gaten beviseligt samme træk.
  const racesById = new Map(hit.sb.state.races.map((r) => [r.id, r]));
  const persisted = new Map();
  for (const p of hit.sb.state.race_stage_profiles) {
    const poolRaceId = racesById.get(p.race_id).pool_race_id;
    if (!persisted.has(poolRaceId)) persisted.set(poolRaceId, []);
    persisted.get(poolRaceId).push(p);
  }
  assert.ok(persisted.size > 0);
  let differsFromCanonical = 0;
  for (const [poolRaceId, rows] of persisted) {
    const meta = metaById.get(poolRaceId);
    const seed = { id: "ignored", external_id: meta.external_id, race_type: meta.race_type, stages: meta.stages, terrain_archetype: meta.terrain_archetype, season_id: hit.seasonId };
    const withVariant = generateRaceStageProfiles({ ...seed, season_variant: hit.draw.attempt });
    assert.deepEqual(rows.map(routeStr2), withVariant.map(routeStr2), `pool_race ${poolRaceId}: persisteret parcours ≠ det resolverede træk`);
    if (JSON.stringify(generateRaceStageProfiles(seed).map(routeStr2)) !== JSON.stringify(withVariant.map(routeStr2))) differsFromCanonical++;
  }
  assert.ok(differsFromCanonical > 0, "re-drawet skal faktisk ændre mindst ét løbs parcours ift. attempt 0");
});
const routeStr2 = (p) => `${p.stage_number}:${p.profile_type}|${p.finale_type ?? ""}|${p.distance_km}`;

test("apply: arketype driver parcours (cobbled_classic endagsløb → brosten dominerer)", async () => {
  const catalog = tier3Catalog().map((c) => ({ ...c, external_id: `ext-${c.id}`, terrain_archetype: c.race_type === "stage_race" ? "mountain_tour" : "cobbled_classic" }));
  const league_divisions = [
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4), mgr("b1", 5), mgr("b2", 5), mgr("b3", 5)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: catalog });
  await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false, ...LEGACY_MIX });

  const oneDayProfiles = sb.state.race_stage_profiles.filter((p) => {
    const r = sb.state.races.find((x) => x.id === p.race_id);
    const meta = catalog.find((c) => c.id === r.pool_race_id);
    return meta && meta.race_type === "single";
  });
  const cobbles = oneDayProfiles.filter((p) => p.profile_type === "cobbles").length;
  assert.ok(oneDayProfiles.length > 0, "der skal være endagsløb");
  assert.ok(cobbles >= oneDayProfiles.length * 0.6, `forventede brosten-dominans, fik ${cobbles}/${oneDayProfiles.length}`);
});

// #3959 (lønbasis-cutover, 19/8, jf. ejer-note): seasons.race_days_total stod i prod på
// SCHEMA-DEFAULTEN (60) for en sæson med en allerede-materialiseret, RIGTIG kalender på 28
// dage — fordi race_days_total kun blev genberegnet REAKTIVT (raceRunner.js/
// pcmResultsImport.js efter et resultat-import), aldrig da kalenderen selv blev skrevet.
// wageDeductionSweep dividerer dagslønnen med race_days_total, så et sådant hul ville
// opkræve ~halv dagsløn indtil første resultat-import. Testen låser at
// materializeTierCalendars nu selv materialiserer feltet fra den FAKTISKE kalender
// (distinkte game_day_start, samme sandhed som seasonRaceDays.js), så en frisk sæsons
// dagsløn er korrekt fra dag 1 — ikke først efter et løb er kørt.
test("#3959 apply: materialiserer seasons.race_days_total fra den faktiske kalender (28 distinkte dage), ikke schema-defaulten (60)", async () => {
  const league_divisions = [
    { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
    { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
  ];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4), mgr("b1", 5), mgr("b2", 5), mgr("b3", 5)];
  // Schema-defaulten (database/schema.sql: race_days_total INTEGER DEFAULT 60) — netop
  // den stale værdi #3959 fandt i prod for en sæson med en allerede-bygget kalender.
  const seasons = [{ id: "s1", number: 3, status: "upcoming", race_days_total: 60, race_days_completed: 0 }];
  const sb = makeSupabase({ league_divisions, teams, race_pool: tier3Catalog(), seasons });

  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false, ...LEGACY_MIX });

  assert.ok(summary.racesInserted > 0, "der skal indsættes løb");
  assert.equal(summary.raceDaysTotalError, undefined, "recompute må ikke fejle når seasons-tabellen findes");
  const season = sb.state.seasons.find((s) => s.id === "s1");
  assert.equal(season.race_days_total, 28, "S3-invarianten: alle sæsoner er 28 kalenderdage, ikke 60-defaulten");
  assert.equal(season.race_days_completed, 0, "ingen løb er kørt endnu — kun kalenderen er materialiseret");
});

// Fallback-guard: en fejlende race_days_total-recompute (fx en flaky seasons-write) må
// ALDRIG vælte selve kalender-materialiseringen — løbene er allerede skrevet, og en
// efterfølgende re-kørsel/backfill kan lukke hullet idempotent (samme fail-safe-disciplin
// som resten af #2642-fixes). wageDeductionSweep har desuden sin egen uafhængige fallback
// (DEFAULT_SEASON_LENGTH_DAYS=60, se wageDeductionSweep.js) hvis feltet forbliver stale.
test("#3959 apply: fejlende race_days_total-recompute vælter ALDRIG selve kalender-materialiseringen", async () => {
  const league_divisions = [{ id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" }];
  const mgr = (id, pool) => ({ id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: pool });
  const teams = [mgr("a1", 4), mgr("a2", 4), mgr("a3", 4)];
  const seasons = [{ id: "s1", number: 3, status: "upcoming", race_days_total: 60, race_days_completed: 0 }];
  const sb = makeSupabase({ league_divisions, teams, race_pool: tier3Catalog(), seasons });
  const realFrom = sb.from;
  // Simulér en fejlende seasons-write (fx netværk/RLS) — races/race_pool/etc. uændret.
  sb.from = (table) => {
    if (table !== "seasons") return realFrom(table);
    return { update: () => ({ eq: () => Promise.resolve({ error: { message: "boom (simuleret seasons-write-fejl)" } }) }) };
  };

  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", seasonStartDate: "2026-06-22", from: FROM, dryRun: false, ...LEGACY_MIX });

  assert.ok(summary.racesInserted > 0, "kalenderen skal stadig materialiseres selvom recompute fejler");
  assert.ok(String(summary.raceDaysTotalError || "").includes("boom"), "fejlen rapporteres i summary til debugging/Sentry, men kastes ikke");
  assert.equal(sb.state.seasons[0].race_days_total, 60, "stale værdi bevares urørt — næste materialisering/backfill retter den selv-helende");
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
  const { tierPlans } = buildTierMaterializationPlan({ pools: t4pools, catalog, from: FROM, ...LEGACY_MIX });
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
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, dryRun: true, ...LEGACY_MIX });
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
  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, coverageOverrides: LEGACY_MIX });

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
  await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, coverageOverrides: LEGACY_MIX });
  const racesAfterFirst = sb.state.races.length;

  const second = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, coverageOverrides: LEGACY_MIX });
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

  const summary = await reconcilePoolCalendarOnActivation({ supabase: sb, poolId: 8, now: FROM, coverageOverrides: LEGACY_MIX }); // now=28/6 → from=29/6
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
  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, tiers: [4], dryRun: false, realDays: 28, ...LEGACY_MIX });
  const tier4Names = new Set(sb.state.races.filter((r) => r.league_division_id === 401).map((r) => r.name));
  assert.ok(!tier4Names.has("Il Lombardia"), "tier 4 må ikke vælge et navn allerede brugt i tier 1");
  assert.equal(summary.tiers.find((t) => t.tier === 4)?.calendarViolations?.length ?? 0, 0);
});

test("#2276 rest-af-sæson override: buildTierMaterializationPlan tager eksplicit density/quota-override for ét tier uden at røre andre tiers' design-defaults", () => {
  const overrideRealDays = 16; // forkortet vindue (reparationsdag+1..sæson-slut)
  const overrideDensity = 3;
  const { tierPlans } = buildTierMaterializationPlan({
    pools: cascadePools, catalog: fullCascadeCatalog(), from: FROM,
    realDays: overrideRealDays,
    quotas: { ...TIER_GAME_DAY_QUOTA, 4: overrideDensity * overrideRealDays },
    density: { 1: 5, 2: 4, 3: 3, 4: overrideDensity },
    ...LEGACY_MIX,
  });
  const tier4 = tierPlans.find((t) => t.tier === 4);
  const tier3 = tierPlans.find((t) => t.tier === 3);
  // kvote = density × vinduesdage (48 for tier 4 i #2276-scenariet: 3 × 16).
  assert.equal(tier4.quota, overrideDensity * overrideRealDays);
  assert.equal(tier4.density, overrideDensity);
  assert.ok(tier4.load.every((x) => x === overrideDensity), `tier 4 tæthed ikke ${overrideDensity} hver dag: ${tier4.load.join(",")}`);
  // andre tiers uændrede design-defaults (tier 3 kører stadig tæthed 3 / kvote 84, IKKE 16-dages-vinduet).
  assert.equal(tier3.quota, TIER_GAME_DAY_QUOTA[3]);
  assert.equal(tier3.density, 3);
  // #2276-invarianter (klasse-whitelist, cross-tier-dedup, identisk pulje-signatur) håndhæves stadig.
  assert.equal(tier4.calendarViolations.length, 0, tier4.calendarViolations.join(" · "));
  const allowed4 = new Set(TIER_CLASS_WHITELIST[4]);
  for (const r of tier4.pools[0].raceRows) assert.ok(allowed4.has(r.race_class), `ulovlig klasse ${r.race_class} i override-plan`);
});

test("#2276 rest-af-sæson override: materializeTierCalendars respekterer density-parameteren og slutdatoen ligger inden for vinduet", async () => {
  const overrideRealDays = 10;
  const overrideDensity = 3;
  const divisions = [
    { id: 101, tier: 1 }, { id: 201, tier: 2 }, { id: 301, tier: 3 },
    { id: 401, tier: 4 }, { id: 402, tier: 4 },
  ];
  const teams = divisions.map((d) => ({ league_division_id: d.id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }));
  const state = { league_divisions: divisions, teams, race_pool: fullCascadeCatalog(), races: [], race_stage_profiles: [], race_stage_schedule: [] };
  const sb = makeSupabase(state);
  const summary = await materializeTierCalendars({
    supabase: sb, seasonId: "s1", from: FROM, tiers: [4], dryRun: false,
    realDays: overrideRealDays,
    quotas: { ...TIER_GAME_DAY_QUOTA, 4: overrideDensity * overrideRealDays },
    density: { 1: 5, 2: 4, 3: 3, 4: overrideDensity },
    ...LEGACY_MIX,
  });
  const tier4Line = summary.tiers.find((t) => t.tier === 4);
  assert.equal(tier4Line.quota, overrideDensity * overrideRealDays);
  assert.equal(tier4Line.calendarViolations.length, 0);
  // buildScheduleRows planlægger real_day 0..realDays-1 på from+1..from+realDays (real_day+1
  // dage efter `from`) — windowEnd er derfor from + (realDays+1) dage.
  const scheduled = sb.state.race_stage_schedule.map((s) => new Date(s.scheduled_at).getTime());
  const windowEnd = new Date(FROM.getTime() + (overrideRealDays + 1) * 86_400_000).getTime();
  assert.ok(scheduled.every((t) => t < windowEnd), "en etape-tid ligger uden for det forkortede vindue");
  // begge tier 4-puljer får identisk kalender (invariant 3).
  const pool401 = sb.state.races.filter((r) => r.league_division_id === 401).map((r) => r.name).sort();
  const pool402 = sb.state.races.filter((r) => r.league_division_id === 402).map((r) => r.name).sort();
  assert.deepEqual(pool401, pool402);
});

// ── #3327/#3328 · dækningsgarantier — genereringen fejler HØJLYDT, aldrig stille underdækning ──

// D2-lignende katalog (tier 2-whitelist: OtherWorldTourB/ProSeries/OtherWorldTourC), rigeligt
// forsynet med alt UNDTAGEN brosten-arketyper (cobbled_classic/cobbled_tour) — INGEN
// cobbles-etaper er mulige uanset hvad selection vælger. Klasse↔længde-bånd overholdes
// (ProSeries 3-5, WorldTour B/C 6-8), så #3328-båndet ikke selv trigger violations her.
function d2CatalogWithoutCobbles() {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-flat-${i}`, name: `PS Flat ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "flat_sprint" });
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-hilly-${i}`, name: `PS Hilly ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "hilly_classic" });
  for (let i = 0; i < 5; i++) rows.push({ id: `ps-itt-${i}`, name: `PS ITT ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "itt_classic" });
  for (let i = 0; i < 30; i++) rows.push({ id: `ps-sr-${i}`, name: `PS Tour ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "balanced_week" });
  for (let i = 0; i < 10; i++) rows.push({ id: `ps-ht-${i}`, name: `PS Hilly Tour ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "hilly_tour" });
  for (let i = 0; i < 10; i++) rows.push({ id: `owb-sr-${i}`, name: `OWB Tour ${i}`, race_class: "OtherWorldTourB", race_type: "stage_race", stages: 7, terrain_archetype: "mountain_tour" });
  for (let i = 0; i < 10; i++) rows.push({ id: `owc-sr-${i}`, name: `OWC Tour ${i}`, race_class: "OtherWorldTourC", race_type: "stage_race", stages: 7, terrain_archetype: "sprinters_week" });
  return rows;
}

test("#3327 dryRun: en brosten-fri katalog-tier rapporterer coverageStats + calendarViolations, kaster IKKE (dryRun=true)", async () => {
  const league_divisions = [{ id: 2, tier: 2, pool_index: 0, label: "Division 2 — A" }, { id: 3, tier: 2, pool_index: 1, label: "Division 2 — B" }];
  const teams = [mgrTeam("m1", 2), mgrTeam("m2", 3)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: d2CatalogWithoutCobbles() });

  const summary = await materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, dryRun: true });
  const tier2Line = summary.tiers.find((t) => t.tier === 2);
  assert.ok(tier2Line, "tier 2 skal have en rapport-linje");
  assert.equal(tier2Line.coverageStats.familyCounts.cobbles, 0, "intet cobbled_classic/cobbled_tour i kataloget → 0 brosten-etaper");
  assert.ok(
    tier2Line.calendarViolations.some((v) => v.includes('terræn-familie "cobbles"') && v.includes("#3327")),
    tier2Line.calendarViolations.join(" · "),
  );
  // dryRun rapporterer, men SKRIVER intet og kaster intet.
  assert.equal(summary.racesInserted, 0);
});

test("#3327 apply: samme brosten-fri kalender NÆGTES appliet (dryRun=false kaster højlydt, ingen stille underdækning)", async () => {
  const league_divisions = [{ id: 2, tier: 2, pool_index: 0, label: "Division 2 — A" }, { id: 3, tier: 2, pool_index: 1, label: "Division 2 — B" }];
  const teams = [mgrTeam("m1", 2), mgrTeam("m2", 3)];
  const sb = makeSupabase({ league_divisions, teams, race_pool: d2CatalogWithoutCobbles() });

  await assert.rejects(
    materializeTierCalendars({ supabase: sb, seasonId: "s1", from: FROM, dryRun: false }),
    /terræn-familie "cobbles".*#3327/,
  );
  // Intet blev skrevet — refusal-gaten er FØR nogen insert.
  assert.equal(sb.state.races.length, 0);
});

test("#3328 apply: en klasse↔længde-bånd-brydende plan (band-filter omgået via forceTiers/allowedClasses=null) nægtes appliet", async () => {
  // Byg et rent tier-2-katalog der OPFYLDER #3327's dækningsgarantier fint, men indeholder
  // en ProSeries-etapeløb på 8 etaper — over #3328's ProSeries-bånd [3,5]. classStageLengthBand
  // filtrerer den fra i SELECTION, så vi tvinger den ind via en direkte raceRows-konstruktion
  // for at bevise at detectCoverageViolations selv (defense-in-depth) fanger et brud, hvis
  // en fremtidig selection-ændring nogensinde skulle lade den slippe igennem.
  const { computeTierCoverageStats, detectCoverageViolations, CLASS_STAGE_LENGTH_BAND } = await import("./tierCalendarGuarantees.js");
  const raceRows = [
    { pool_race_id: "ps-8", race_class: "ProSeries", race_type: "stage_race", stages: 8 },
  ];
  const profilesByPoolRaceId = new Map([["ps-8", Array.from({ length: 8 }, () => ({ profile_type: "flat" }))]]);
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId, classStageLengthBand: CLASS_STAGE_LENGTH_BAND });
  const violations = detectCoverageViolations({ tier: 2, stats, oneDayShareMin: {}, terrainFamilyMin: {}, mountainFreeMin: {} });
  assert.ok(violations.some((v) => v.includes("klasse↔længde-bånd brudt") && v.includes("ps-8") && v.includes("#3328")), violations.join(" · "));
});

// ── #3469 (ejer-fund 8/8): downstreamProtectedArchetypes — cross-tier integrationstest ──
// Rod-årsag: D2 (processeres FØR D3/D4) havde rigeligt budget til at tage MERE end sin
// egen cobbled_tour-reservation, og sultede D4's tilsvarende reservation tavst (kataloget
// rummer kun 4 cobbled_tour i alt, 1 pr. tier). buildTierMaterializationPlan skal nu selv
// beregne + videresende downstreamProtectedArchetypes, så den ØVERSTE af to tiers der
// begge reserverer samme arketype IKKE dobbelt-dypper.
function crossTierScarceCatalog() {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ id: `ps-big-${i}`, name: `Stort ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 });
  for (let i = 0; i < 30; i++) rows.push({ id: `ps-od-${i}`, name: `Endags ${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  // KUN 2 cobbled_tour i hele kataloget, delt mellem to tiers der HVER reserverer 1 —
  // efterligner det rigtige katalogs knaphed (4 cobbled_tour, 4 tiers, 1 hver).
  rows.push({ id: "ps-cob-1", name: "Brostensløb 1", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour" });
  rows.push({ id: "ps-cob-2", name: "Brostensløb 2", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour" });
  return rows;
}

test("#3469 cross-tier arketype-knaphed: en øvre tier med rigeligt budget sulter IKKE en nedre tiers reservation af samme arketype", () => {
  const pools2 = [
    { id: 10, tier: 2, realManagerCount: 8 },
    { id: 11, tier: 3, realManagerCount: 8 },
  ];
  const { tierPlans } = buildTierMaterializationPlan({
    pools: pools2, catalog: crossTierScarceCatalog(), from: FROM,
    archetypeReservations: { 2: { cobbled_tour: 1 }, 3: { cobbled_tour: 1 } },
    oneDayShareTargets: {}, classStageLengthBand: null, priorityArchetypes: null,
  });
  const tier2 = tierPlans.find((t) => t.tier === 2);
  const tier3 = tierPlans.find((t) => t.tier === 3);
  const cobbledCount = (tp) => tp.pools[0].raceRows.filter((r) => r.pool_race_id === "ps-cob-1" || r.pool_race_id === "ps-cob-2").length;
  assert.equal(cobbledCount(tier2), 1, "tier 2 (processeres først) skal kun tage SIN egen reservation, ikke begge");
  assert.equal(cobbledCount(tier3), 1, "tier 3's egen reservation skal stadig kunne opfyldes — intet dobbelt-dyp fra tier 2");
});

test("#3469 nedre tier (ingen senere tier reserverer arketypen) kan stadig frit tage mere end sin egen reservation", () => {
  // Modstykke til testen ovenfor: en tier der er den SIDSTE til at reservere en arketype
  // (her: kun tier 4 reserverer cobbled_tour) skal IKKE begrænses — intet nedstrøms at
  // beskytte. Regressionsvagt mod at "downstreamProtectedArchetypes" fejlagtigt anvendes
  // for bredt (det brød oprindeligt D4's egen kvote-udfyldning under implementeringen).
  const pools2 = [{ id: 40, tier: 4, realManagerCount: 8 }];
  const { tierPlans } = buildTierMaterializationPlan({
    pools: pools2, catalog: crossTierScarceCatalog(), from: FROM,
    archetypeReservations: { 4: { cobbled_tour: 1 } },
    oneDayShareTargets: {}, classStageLengthBand: null, priorityArchetypes: null,
    classWhitelist: { 4: null },
  });
  const tier4 = tierPlans.find((t) => t.tier === 4);
  const cobbledCount = tier4.pools[0].raceRows.filter((r) => r.pool_race_id === "ps-cob-1" || r.pool_race_id === "ps-cob-2").length;
  assert.equal(cobbledCount, 2, "den eneste tier der reserverer arketypen skal frit kunne tage begge — intet nedstrøms at beskytte");
});
