// #8604 Trend-prognosen: beregningen, læsningen, batchen og den frosne golden (#7587).
// Tallene i params her er opdigtede testværdier, ikke spillets kalibrering (hard rule 17).

import test from "node:test";
import assert from "node:assert/strict";

import { validateDevelopmentXpParams } from "./developmentXp.ts";
import { STANDARD_CAREER } from "./developmentXpExpectedTop.ts";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { AGING_V2_CONFIG, xpAgingConfig } from "./riderProgression.js";
import { clearFlagStageCache } from "./featureStage.js";
import {
  TREND_LEARNED_DATES, TREND_OWN_AFTER_DATES, blendPace, computeTrendPrognosis, expectedSeasonDrops,
  loadTrendPrognosisViews, priorFactorFromSamples, seasonHistoryPace, settledXpDates, simulateTrend,
  standardPriorPace, trendPace, trendView,
} from "./prognosisTrend8604.js";
import { publishTeam, runPrognosisTrendBatch, summarizeTeam } from "./prognosisTrendSweep.js";
import { GOLDEN_STAGES, GOLDEN_TEAM, goldenDigests, goldenSupabase, goldenSurfaces, goldenTables } from "./prognosisTrend8604.golden.mjs";

// ── Frossen golden ─────────────────────────────────────────────────────────────────
// Digest fra merge-basen 4c0b328b8edea7829d89dd8363ea83799045e6e7 (main før #8604, efter #8873/#8834), genereret
// med `node backend/lib/prognosisTrend8604.golden.mjs` i en read-only checkout af basen.
// Genereres ALDRIG med den nye kode.
const BASE_DIGEST = "25fee7bb736e5d383a4dcb9c9abf39402d8121d24839c7af542a3e09be2af71b";

test("golden: manglende, off og beta er bit for bit som merge-basen", async () => {
  const digests = await goldenDigests(GOLDEN_STAGES);
  for (const stage of GOLDEN_STAGES) assert.equal(digests[stage], BASE_DIGEST, `kontakten ${stage}`);
});

test("golden: slukket læser aldrig trend-tabellen", async () => {
  for (const stage of GOLDEN_STAGES) {
    clearFlagStageCache();
    const supabase = goldenSupabase(goldenTables(stage));
    const { buildEstimatesFromViews } = await import("./potentialEstimateRead.js");
    await buildEstimatesFromViews(supabase, { teamId: GOLDEN_TEAM, riderIds: ["young", "prime"] });
    assert.ok(!supabase.reads.some((read) => read.table === "rider_prognosis_trend"), `kontakten ${stage}`);
  }
});

test("tændt: egne ryttere læser trend-rækken på alle flader, modstandere får ingen prognose", async () => {
  const on = await goldenSurfaces("on");
  assert.deepEqual(on.estimates.young.prognosisView, { hidden: false, value: 81, basis: "trend", learning: true });
  assert.deepEqual(on.estimates.veteran.prognosisView, { hidden: false, value: 83, basis: "trend", learning: true, horizon: "year" });
  assert.equal(on.estimates.rival.prognosisView, undefined);
  assert.deepEqual(on.projection.young.prognosisView, on.estimates.young.prognosisView);
  assert.deepEqual(on.academy.roster[0].prognosisView, on.estimates.youth.prognosisView);
  assert.deepEqual(on.report.young.prognosisView, on.estimates.young.prognosisView);
  assert.equal(on.report.rival.prognosisView, undefined);
  // Ingen bånd forlader serveren.
  assert.ok(!JSON.stringify(on).includes("band"));
});

// ── Beregningen ────────────────────────────────────────────────────────────────────

const params = validateDevelopmentXpParams({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});

const flat = (level, over = {}) => ({ ...Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, level])), ...over });
const baseRider = (over = {}) => ({
  id: "r1", abilities: flat(50), bars: {}, potentiale: 4, primaryType: "climber", secondaryType: "puncheur", birthdate: "2004-06-15", ...over,
});
const TODAY = "2026-11-27";
const isoMinus = (days, from = TODAY) => new Date(Date.parse(`${from}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

// Datoer med XP i klatring og bjerg-evnerne; `team` er holdet, datoen blev trænet på.
function datesWith({ count, xp, team = "own", seasonAge = 22, startDaysAgo = count, extra = {} }) {
  return Array.from({ length: count }, (_, i) => ({
    date: isoMinus(startDaysAgo - i), xp: { climbing: xp, endurance: xp / 2, ...extra }, teams: [team], seasonAge,
  }));
}

const prognosis = (over = {}) => computeTrendPrognosis({
  rider: baseRider(), dates: [], teamId: "own", today: TODAY, seasonAge: 22, seasonProgress: 0.4, ...over,
}, params);

test("params er gyldige (forudsætning for resten)", () => {
  assert.ok(params);
});

test("procent-aldring: én sæsons fald er motorens fald fra værdien ved skiftet, ikke forrentet dato for dato (Codex #8876 P2)", () => {
  // Prisens top og aldringen er én pakke (developmentXp.ts): begge eller ingen.
  const pctParams = validateDevelopmentXpParams({
    price: { base: 10, exponent: 2, top: 120 },
    potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
    ageShare: {
      physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
      mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
    },
    offFocusShare: 0.1,
    raceOffFocusShare: 0.2,
    typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
    aging: {
      physical: [{ at: 30, value: 0 }, { at: 34, value: 0.08 }],
      mental: [{ at: 30, value: 0 }, { at: 34, value: 0.02 }],
    },
  });
  assert.ok(pctParams, "procent-aldringen skal være gyldig");
  const cfg = xpAgingConfig(pctParams);
  assert.ok(cfg?.percent);
  const start = flat(70);
  const sim = simulateTrend({ ...baseRider({ abilities: start }), seasonAge: 33, seasonProgress: 0 }, {}, pctParams);
  const drops = expectedSeasonDrops(start, "climber", 34, cfg);
  assert.ok(Object.keys(drops).length > 0, "der skal være et fald ved 34");
  const expectedState = Object.fromEntries(Object.entries(start).map(([a, v]) => [a, v - (drops[a] ?? 0)]));
  // Ratingen af den forventede tilstand: en rytter uden fald (alder 20) og uden fart.
  const expected = simulateTrend({ ...baseRider({ abilities: expectedState }), seasonAge: 20, seasonProgress: 0 }, {}, pctParams).ratingNow;
  const afterOneSeason = sim.ratings[STANDARD_CAREER.datesPerSeason];
  assert.ok(Math.abs(afterOneSeason - expected) < 1e-9, `${afterOneSeason} = ${expected}`);
});

test("hård træning giver en højere prognose end let træning", () => {
  const hard = prognosis({ dates: datesWith({ count: 40, xp: 60 }) });
  const light = prognosis({ dates: datesWith({ count: 40, xp: 15 }) });
  assert.ok(hard.value > light.value, `${hard.value} > ${light.value}`);
});

test("løbsdage løfter: samme datoer med løbets XP oveni giver en højere prognose", () => {
  const training = prognosis({ dates: datesWith({ count: 40, xp: 30 }) });
  const withRaces = prognosis({ dates: datesWith({ count: 40, xp: 30, extra: { punch: 40, acceleration: 30 } }) });
  assert.ok(withRaces.value >= training.value);
  const dates = datesWith({ count: 40, xp: 30 }).map((d, i) => (i % 3 ? d : { ...d, xp: { ...d.xp, climbing: d.xp.climbing + 40 } }));
  assert.ok(prognosis({ dates }).value > training.value);
});

test("prisen pr. trin bremser: samme fart løfter en lav rytter flere point end en høj", () => {
  const pace = { climbing: 80, endurance: 40, punch: 20 };
  const gain = (level) => {
    const sim = simulateTrend({ ...baseRider({ abilities: flat(level) }), seasonAge: 22, seasonProgress: 0 }, pace, params);
    return sim.ratings[sim.topIndex] - sim.ratingNow;
  };
  assert.ok(gain(40) > gain(60) && gain(60) > gain(75), `${gain(40)} > ${gain(60)} > ${gain(75)}`);
});

test("aldrig under ratingen nu før toppen, også uden fart", () => {
  const none = computeTrendPrognosis({
    rider: { ...baseRider(), potentiale: null }, dates: [], teamId: "own", today: TODAY, seasonAge: 22, seasonProgress: 0.5,
  }, { ...params, potentialXp: [{ at: 1, value: 0 }] });
  assert.equal(none.horizon, "top");
  assert.ok(none.value >= 50);
  for (const age of [18, 22, 26, 29]) {
    const r = prognosis({ seasonAge: age, dates: datesWith({ count: 10, xp: 1, seasonAge: age }) });
    if (r.horizon === "top") assert.ok(r.value >= 50, `alder ${age}: ${r.value}`);
  }
});

test("efter toppen: forventet rating om et år med det løbende fald", () => {
  const old = computeTrendPrognosis({
    rider: baseRider({ abilities: flat(70), birthdate: "1990-01-01" }), dates: datesWith({ count: 40, xp: 1, seasonAge: 35 }),
    teamId: "own", today: TODAY, seasonAge: 35, seasonProgress: 0.5,
  }, params);
  assert.equal(old.horizon, "year");
  assert.ok(old.value < 70, `${old.value}`);
});

// Samme øjeblik set fra to sider af sæsonskiftet: sidste dag i sæsonen (fremdrift 1) og første
// dag i den nye (fremdrift 0, alderen ét år op, motorens fald trukket fra evnerne).
function aroundSeasonChange({ abilities, age, dates }) {
  const before = computeTrendPrognosis({
    rider: baseRider({ abilities }), dates, teamId: "own", today: TODAY, seasonAge: age, seasonProgress: 1,
  }, params);
  const drops = expectedSeasonDrops(abilities, "climber", age + 1, AGING_V2_CONFIG, STANDARD_CAREER.declineLoad);
  const afterAbilities = Object.fromEntries(Object.entries(abilities).map(([a, v]) => [a, v - (drops[a] ?? 0)]));
  const after = computeTrendPrognosis({
    rider: baseRider({ abilities: afterAbilities }), dates, teamId: "own", today: TODAY, seasonAge: age + 1, seasonProgress: 0,
  }, params);
  return { before, after };
}

test("sæsonskiftet: 0 fald før toppen og intet hop efter toppen", () => {
  const riders = [
    { abilities: flat(45), age: 19 }, { abilities: flat(55), age: 23 }, { abilities: flat(60, { climbing: 72 }), age: 26 },
    { abilities: flat(65), age: 28 }, { abilities: flat(68), age: 29 },
  ];
  for (const r of riders) {
    const dates = datesWith({ count: 20, xp: 25, seasonAge: r.age });
    const { before, after } = aroundSeasonChange({ ...r, dates });
    if (before.horizon === "top") assert.ok(after.value >= before.value, `alder ${r.age}: ${before.value} → ${after.value}`);
  }
  for (const r of [{ abilities: flat(70), age: 32 }, { abilities: flat(66), age: 34 }]) {
    const dates = datesWith({ count: 20, xp: 5, seasonAge: r.age });
    const { before, after } = aroundSeasonChange({ ...r, dates });
    assert.ok(Math.abs(after.value - before.value) <= 1, `alder ${r.age}: ${before.value} → ${after.value}`);
  }
});

test("fødselsdagen: dagen før og dagen efter giver samme prognose", () => {
  const birthday = "2026-11-27";
  const dates = datesWith({ count: 12, xp: 30, startDaysAgo: 14 });
  for (const age of [21, 27, 33]) {
    const at = (today) => computeTrendPrognosis({
      rider: baseRider({ birthdate: `${2026 - age}-11-27` }), dates, teamId: "own", today, seasonAge: age, seasonProgress: 0.6,
    }, params);
    assert.equal(at(isoMinus(1, birthday)).value, at(isoMinus(-1, birthday)).value, `alder ${age}`);
  }
});

test("læres: prognosen er usikker, indtil holdet har nok egne datoer; gamle holds datoer tæller i farten", () => {
  const old = datesWith({ count: 40, xp: 40, team: "old", startDaysAgo: 60 });
  const own = datesWith({ count: TREND_LEARNED_DATES - 1, xp: 40, team: "own" });
  const learning = prognosis({ dates: [...old, ...own] });
  assert.equal(learning.learning, true);
  assert.equal(learning.ownDates, TREND_LEARNED_DATES - 1);
  assert.equal(learning.careerDates, 40 + TREND_LEARNED_DATES - 1);
  const learned = prognosis({ dates: datesWith({ count: TREND_LEARNED_DATES, xp: 40, team: "own" }) });
  assert.equal(learned.learning, false);
  // Det gamle holds datoer flytter farten: uden dem er prognosen en anden.
  assert.notEqual(prognosis({ dates: own }).value, prognosis({ dates: [...datesWith({ count: 40, xp: 90, team: "old", startDaysAgo: 60 }), ...own] }).value);
});

test("A+C: trenden vejer mere dato for dato og er helt hans egen efter en måned", () => {
  const trend = { climbing: 100 };
  const prior = { climbing: 0 };
  assert.equal(blendPace(trend, prior, 0).climbing, 0);
  assert.equal(blendPace(trend, prior, TREND_OWN_AFTER_DATES / 2).climbing, 50);
  assert.equal(blendPace(trend, prior, TREND_OWN_AFTER_DATES).climbing, 100);
  assert.equal(blendPace(trend, prior, TREND_OWN_AFTER_DATES * 3).climbing, 100);
  assert.equal(blendPace(null, prior, 0).climbing, 0);
  assert.equal(blendPace(trend, null, 1).climbing, 100);
});

test("normal træning for potentialet: højere potentiale = mere XP, faktoren måles på alle ryttere", () => {
  const low = standardPriorPace({ potentiale: 2, primaryType: "climber" }, params);
  const high = standardPriorPace({ potentiale: 5, primaryType: "climber" }, params);
  const total = (p) => Object.values(p).reduce((s, v) => s + v, 0);
  assert.ok(total(high) > total(low));
  const std = { climbing: 10 };
  assert.equal(priorFactorFromSamples([]), 1);
  assert.equal(priorFactorFromSamples([{ trend: { climbing: 12 }, standard: std, recentDates: 10 }, { trend: { climbing: 8 }, standard: std, recentDates: 10 },
    { trend: { climbing: 11 }, standard: std, recentDates: 10 }, { trend: { climbing: 1000 }, standard: std, recentDates: 1 }]), 1.1);
  assert.ok(priorFactorFromSamples([{ trend: { climbing: 1000 }, standard: std, recentDates: 10 }]) <= 1.5);
});

test("egen historik: kun en hel sæson tæller, omregnet med trinprisen", () => {
  const seasons = [{ number: 5, start_date: "2026-08-01", end_date: "2026-10-01" }, { number: 6, start_date: "2026-10-02", end_date: null }];
  const snap = (date, season, level) => ({ snapshot_date: date, season_number: season, abilities: flat(level) });
  const whole = seasonHistoryPace({ snapshots: [snap("2026-08-02", 5, 50), snap("2026-09-30", 5, 54)], seasons, birthdate: "2004-06-15", currentSeasonNumber: 6 }, params);
  assert.ok(whole && whole.climbing > 0);
  const partial = seasonHistoryPace({ snapshots: [snap("2026-09-01", 5, 50), snap("2026-09-30", 5, 54)], seasons, birthdate: "2004-06-15", currentSeasonNumber: 6 }, params);
  assert.equal(partial, null);
  const bigger = seasonHistoryPace({ snapshots: [snap("2026-08-02", 5, 50), snap("2026-09-30", 5, 58)], seasons, birthdate: "2004-06-15", currentSeasonNumber: 6 }, params);
  assert.ok(bigger.climbing > whole.climbing * 2, "flere trin koster mere end lineært");
});

test("afregnede datoer: skade og sygdom tæller ikke, felter uden XP heller ikke, datoen summeres", () => {
  const seasonNumberById = new Map([["s6", 6]]);
  const dates = settledXpDates([
    { tick_date: "2026-11-20", team_id: "own", season_id: "s6", xp: { climbing: 10 } },
    { tick_date: "2026-11-20", team_id: "own", season_id: "s6", xp: { climbing: 5, sprint: 2 } },
    { tick_date: "2026-11-21", team_id: "own", season_id: "s6", xp: { climbing: 10 }, injured: true },
    { tick_date: "2026-11-22", team_id: "own", season_id: "s6", xp: { climbing: 10 }, illness: 2 },
    { tick_date: "2026-11-23", team_id: "old", season_id: "s6", xp: null },
    { tick_date: "2026-11-24", team_id: "old", season_id: "s6", xp: "{\"climbing\":7}" },
  ], { seasonNumberById, birthdate: "2004-06-15" });
  assert.deepEqual(dates.map((d) => d.date), ["2026-11-20", "2026-11-24"]);
  assert.deepEqual(dates[0].xp, { climbing: 15, sprint: 2 });
  assert.deepEqual(dates[1].teams, ["old"]);
  assert.ok(Number.isFinite(dates[0].seasonAge));
});

test("trend-farten vægter de seneste datoer mest", () => {
  const recent = { date: isoMinus(2), xp: { climbing: 30 }, teams: ["own"], seasonAge: 22 };
  const old = { date: isoMinus(90), xp: { climbing: 0 }, teams: ["own"], seasonAge: 22 };
  const pace = trendPace([recent, old], { today: TODAY, params });
  assert.ok(pace.climbing > 15, `${pace.climbing}`);
});

test("visningen: gulv ved ratingen nu før toppen, intet gulv efter toppen, kun mærker", () => {
  assert.deepEqual(trendView({ value: 60, learning: true, horizon: "top" }, { currentRating: 64 }), { hidden: false, value: 64, basis: "trend", learning: true });
  assert.deepEqual(trendView({ value: 60, learning: false, horizon: "year" }, { currentRating: 64 }), { hidden: false, value: 60, basis: "trend", horizon: "year" });
  assert.equal(trendView(null), null);
});

test("læsningen: slukket returnerer intet og læser ikke tabellen", async () => {
  clearFlagStageCache();
  const supabase = goldenSupabase(goldenTables("off"));
  const views = await loadTrendPrognosisViews(supabase, { teamId: GOLDEN_TEAM, riderIds: ["young"] });
  assert.equal(views.size, 0);
  assert.ok(!supabase.reads.some((read) => read.table === "rider_prognosis_trend"));
});

// ── Batchen ────────────────────────────────────────────────────────────────────────

function fakeIo({ published = [] } = {}) {
  const store = new Map(published.map((row) => [row.rider_id, row]));
  const calls = { upserts: 0, removed: [] };
  return {
    store, calls,
    riders: async () => [
      { id: "a", team_id: "own", birthdate: "2004-06-15", primary_type: "climber", secondary_type: null, potentiale: 4 },
      { id: "b", team_id: "own", birthdate: "1988-02-01", primary_type: "sprinter", secondary_type: null, potentiale: 3 },
      { id: "gone-retired", team_id: "own", birthdate: "1985-01-01", is_retired: true },
    ],
    published: async () => [...store.values()].map((row) => ({ rider_id: row.rider_id, input_hash: row.input_hash })),
    abilities: async (ids) => ids.map((id) => ({ rider_id: id, ability_progress: {}, ...flat(id === "a" ? 50 : 70) })),
    ticks: async (ids) => ids.flatMap((id) => Array.from({ length: 12 }, (_, i) => ({
      rider_id: id, team_id: i < 6 ? "old" : "own", season_id: "s6", game_day: i, tick_date: isoMinus(12 - i), xp: id === "a" ? { climbing: 20, endurance: 10 } : { climbing: 1 },
    }))),
    history: async () => [],
    upsert: async (rows) => { calls.upserts += 1; for (const row of rows) store.set(row.rider_id, row); },
    remove: async (teamId, ids) => { calls.removed.push(...ids); for (const id of ids) store.delete(id); },
  };
}

const SEASON = { id: "s6", number: 6, race_days_completed: 40, race_days_total: 100 };
const SEASONS = [{ id: "s6", number: 6, status: "active", start_date: "2026-10-02", end_date: null }];

test("batchen publicerer idempotent pr. (rytter, hold), uden bånd, og fjerner rytterne, der er væk", async () => {
  const io = fakeIo({ published: [{ rider_id: "sold", input_hash: "x" }] });
  const now = new Date(`${TODAY}T08:00:00Z`);
  const summary = await summarizeTeam({ io, teamId: "own", season: SEASON, seasons: SEASONS, params, today: TODAY, since: "2026-11-01" });
  const first = await publishTeam({ io, summary, season: SEASON, params, factor: 1, today: TODAY, now });
  assert.equal(first.written, 2);
  assert.deepEqual(io.calls.removed, ["sold"]);
  const row = io.store.get("a");
  assert.equal(row.team_id, "own");
  assert.equal(row.learning, true);
  assert.equal(row.own_dates, 6);
  assert.ok(["top", "year"].includes(row.horizon));
  assert.ok(!Object.keys(row).some((key) => key.startsWith("band")));
  assert.equal(io.store.get("b").horizon, "year");
  const again = await publishTeam({
    io, summary: await summarizeTeam({ io, teamId: "own", season: SEASON, seasons: SEASONS, params, today: TODAY, since: "2026-11-01" }),
    season: SEASON, params, factor: 1, today: TODAY, now,
  });
  assert.equal(again.written, 0);
  assert.equal(again.unchanged, 2);
});

test("batchen: slukket kontakt læser intet ud over kontakten", async () => {
  clearFlagStageCache();
  const supabase = goldenSupabase({ app_config: [{ key: "prognosis_trend_8604", value: "beta" }] });
  const io = new Proxy({}, { get: () => { throw new Error("io må ikke bruges, når kontakten er slukket"); } });
  const result = await runPrognosisTrendBatch({ supabase, io, state: { fullRunDate: null, factor: null }, now: new Date("2026-11-28T06:00:00Z") });
  assert.deepEqual(result, { ran: false, skipped: "flag_off" });
  assert.deepEqual(supabase.reads.map((read) => read.table), ["app_config"]);
});
