// #7684: de fire ruter kørt rigtigt (handler uddraget af api.js, samme greb som
// academyDisclosure.routes.test.ts) med det rigtige flag-modul og den rigtige læse-lib.
// Beviser begge veje: slukket når intet skøn-opslag, og svaret er dagens; tændt svarer
// ruten fra læse-lib'en, før den gamle model når at køre.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { isPotentialEstimateDisplayEnabled } from "./potentialEstimateFlag.js";
import {
  buildAcademyFromViews,
  buildEstimatesFromViews,
  buildProjectionFromView,
  buildScoutingReportFromView,
} from "./potentialEstimateRead.js";

const source = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const TEAM = "own";
const FORBIDDEN = /uncertainty|knowledge_key|ceiling_at_write/;
const ESTIMATE_TABLES = ["rider_potential_estimates", "training_rider_ticks"];
// AGENTS regel 16: vm-kontekstens Date når ikke det importerede flag-modul, så uret gives med.
const FIXED_NOW = Date.parse("2026-11-05T12:00:00Z");
const flagClock = () => { flagClock.calls += 1; return FIXED_NOW; };
flagClock.calls = 0;

function block(marker, closer) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} skal findes`);
  return source.slice(start, source.indexOf(closer, start) + closer.length);
}

function fakeSupabase(stage) {
  const tables = {
    app_config: [{ key: "potential_estimate_display", value: stage }],
    users: [{ id: "user", role: "manager", is_beta_tester: true }],
    riders: [
      { id: "scouted", team_id: "other", is_academy: false, best_role_rating: 60, birthdate: "2003-01-01", primary_type: "climber" },
      { id: "youth", team_id: TEAM, is_academy: true, best_role_rating: 20, birthdate: "2008-01-01", primary_type: "climber" },
    ],
    rider_potential_estimates: [{
      rider_id: "scouted", team_id: TEAM, value: 74, certainty: "fair", previous_value: null, previous_certainty: null,
      changed_at: null, uncertainty: 3.5, knowledge_key: "s2t3", ceiling_at_write: 77,
    }],
    training_rider_ticks: [{ rider_id: "youth", team_id: TEAM, tick_date: "2026-11-01", season_id: "s", game_day: 1 }],
    rider_derived_abilities: [{ rider_id: "scouted", climbing: 50 }],
  };
  const reads = [];
  return {
    reads,
    from(table) {
      reads.push(table);
      const filters = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every(([column, values]) => values.includes(row[column])));
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, [value]]); return query; },
        in(column, values) { filters.push([column, values]); return query; },
        order() { return query; },
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return query;
    },
  };
}

const legacy = (name) => () => { throw new Error(`${name} må ikke køre, når skønnet svarer`); };

function context(supabase, extra = {}) {
  return {
    supabase,
    router: {},
    requireAuth() {}, presencePulseLimiter() {},
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-05T12:00:00Z"])); } },
    isPotentialEstimateDisplayEnabled: (client, opts) => isPotentialEstimateDisplayEnabled(client, { ...opts, now: flagClock }),
    buildAcademyFromViews, buildEstimatesFromViews, buildProjectionFromView, buildScoutingReportFromView,
    SCOUTING_CONFIG: { maxLevel: 3 },
    PEAK_AGE: 28,
    loadScoutState: async () => ({ state: { maxLevel: 3, levels: { scouted: 2 } } }),
    loadScout: async () => ({ isDefault: false, name: "Scout A", tier: 3, overall: 70, hiredAt: null }),
    getActiveSeasonNumber: async () => 4,
    resolveScoutBandSeasonNumber: async () => 4,
    ageForSeason: () => 23,
    scoutBandAge: () => 23,
    fetchAllRowsChunkedIn: legacy("fetchAllRowsChunkedIn"),
    loadAcademyPrognoses: legacy("loadAcademyPrognoses"),
    isAcademyKnowledgeEnabled: legacy("isAcademyKnowledgeEnabled"),
    buildScoutEstimate: legacy("buildScoutEstimate"),
    buildTypePrognosisBands: legacy("buildTypePrognosisBands"),
    buildTypeCeilingBands: legacy("buildTypeCeilingBands"),
    projectCeilingBand: legacy("projectCeilingBand"),
    ...extra,
  };
}

function route(method, path, supabase, extra) {
  let handler;
  const ctx = context(supabase, extra);
  ctx.router[method] = (...args) => { handler = args.at(-1); };
  const helpers = block("async function isViewerBetaTester(req)", "\n}\n") + block("function isPotentialEstimateOn(req)", "\n}\n");
  vm.runInNewContext(helpers + block(`router.${method}("${path}"`, "\n});"), ctx);
  return async (req = {}) => {
    let status = 200;
    let body;
    const res = { status(code) { status = code; return res; }, json(value) { body = value; return res; } };
    await handler({ team: { id: TEAM }, user: { id: "user" }, params: { id: "scouted" }, body: { riderIds: ["scouted", "youth"] }, ...req }, res);
    assert.equal(status, 200, JSON.stringify(body));
    return JSON.parse(JSON.stringify(body));
  };
}

const legacyEstimates = {
  fetchAllRowsChunkedIn: async (ids, query) => (await query(ids)).data,
  loadAcademyPrognoses: async () => new Map(),
  isAcademyKnowledgeEnabled: async () => false,
  buildScoutEstimate: () => ({ lo: 3, hi: 4, level: 2 }),
  buildTypePrognosisBands: () => [],
  displayPotentialBand: () => null,
};

const touchedEstimates = (supabase) => supabase.reads.filter((table) => ESTIMATE_TABLES.includes(table));

test("estimates slukket: dagens svar, intet skøn-opslag og intet beta-opslag", async () => {
  const supabase = fakeSupabase("off");
  const out = await route("post", "/scouting/estimates", supabase, legacyEstimates)();
  assert.deepEqual(out.estimates.scouted, { lo: 3, hi: 4, level: 2 });
  assert.ok(!JSON.stringify(out).includes("potentialView"));
  assert.deepEqual(touchedEstimates(supabase), []);
  assert.ok(!supabase.reads.includes("users"));
});

test("estimates tændt: potentialView pr. rytter, den gamle model kører ikke", async () => {
  const out = await route("post", "/scouting/estimates", fakeSupabase("on"))();
  assert.equal(out.teamId, TEAM);
  assert.deepEqual(out.estimates.scouted, {
    potentialView: { hidden: false, value: 74, certainty: "fair", previousValue: null, previousCertainty: null, changedAt: null },
  });
  assert.deepEqual(out.estimates.youth, { potentialView: { hidden: true, reason: "learning", trainings: 1, trainingsNeeded: 5 } });
  assert.doesNotMatch(JSON.stringify(out), FORBIDDEN);
});

test("flaget læses med testens faste ur, ikke vægur", async () => {
  flagClock.calls = 0;
  await route("post", "/scouting/estimates", fakeSupabase("on"))();
  assert.ok(flagClock.calls > 0);
});

test("beta: kun beta-seeren får skønnet", async () => {
  const on = await route("post", "/scouting/estimates", fakeSupabase("beta"))();
  assert.equal(on.estimates.scouted.potentialView.value, 74);
  const supabase = fakeSupabase("beta");
  const off = await route("post", "/scouting/estimates", supabase, legacyEstimates)({ user: { id: "someone-else" } });
  assert.deepEqual(off.estimates.scouted, { lo: 3, hi: 4, level: 2 });
  assert.deepEqual(touchedEstimates(supabase), []);
});

test("scouting-rapport slukket: uscoutet rytter er dagens skjulte svar uden opslag", async () => {
  const supabase = fakeSupabase("off");
  const out = await route("get", "/riders/:id/scouting-report", supabase, {
    loadScoutState: async () => ({ state: { maxLevel: 3, levels: {} } }),
  })();
  assert.deepEqual(out, { hidden: true, level: 0, maxLevel: 3, own: false });
  assert.deepEqual(touchedEstimates(supabase), []);
});

test("scouting-rapport tændt: et gemt skøn vinder, også uden kig i scout_actions", async () => {
  const out = await route("get", "/riders/:id/scouting-report", fakeSupabase("on"), {
    loadScoutState: async () => ({ state: { maxLevel: 3, levels: {} } }),
  })();
  assert.equal(Object.keys(out)[0], "potentialView");
  assert.equal(out.potentialView.value, 74);
  assert.equal(out.looks, 0);
  assert.equal(out.scout.name, "Scout A");
  assert.equal(out.generatedAt, "2026-11-05T12:00:00.000Z");
  assert.ok(!("hidden" in out) && !("types" in out) && !("stars" in out));
  assert.doesNotMatch(JSON.stringify(out), FORBIDDEN);
});

test("development-projection slukket: uscoutet rytter er dagens skjulte svar uden opslag", async () => {
  const supabase = fakeSupabase("off");
  const out = await route("get", "/riders/:id/development-projection", supabase, {
    loadScoutState: async () => ({ state: { maxLevel: 3, levels: {} } }),
  })();
  assert.deepEqual(out, { hidden: true, level: 0, maxLevel: 3, own: false });
  assert.deepEqual(touchedEstimates(supabase), []);
});

test("development-projection tændt: estimateLine + potentialView, ingen band/ceil/timing", async () => {
  const out = await route("get", "/riders/:id/development-projection", fakeSupabase("on"))();
  assert.equal(out.potentialView.value, 74);
  assert.ok(out.estimateLine.length > 1);
  for (const key of ["band", "ceil", "timing"]) assert.ok(!(key in out));
  assert.doesNotMatch(JSON.stringify(out), FORBIDDEN);
});

test("development-projection tændt: akademiets gamle tomme svar er væk for egne ungdomsryttere", async () => {
  const out = await route("get", "/riders/:id/development-projection", fakeSupabase("on"))({ params: { id: "youth" } });
  assert.deepEqual(out.potentialView, { hidden: true, reason: "learning", trainings: 1, trainingsNeeded: 5 });
  assert.deepEqual(out.estimateLine, []);
});

const academyContext = (buildIntake2View) => ({
  isAcademyEnabled: async () => true,
  youthSquadRooms: async () => ({ junior: { used: 0 }, u23: { used: 0 } }),
  getTeamMarketState: async () => ({ future_count: 10, squad_limits: { max: 30 } }),
  isMissingIntakeSourceSchema: () => false,
  REGISTRY_ABILITY_KEYS: ["climbing"],
  SQUAD_CAPS: {},
  isAcademyIntakePullEnabled: async () => true,
  hasPulledThisWeek: async () => false,
  buildIntake2View,
  captureException(err) { throw err; },
});

const intake2 = async () => ({
  roster: [{ id: "youth", prognosis: { stage: "broad", band: { lo: 1, hi: 2 } } }],
  intake: [{ riderId: "scouted", is_serious: true, potentialEstimate: { lo: 3, hi: 4 }, potentialBand: { prog: { lo: 60, hi: 80 } } }],
  profile: { tier: 1 },
});

test("akademi slukket: dagens svar uden skøn-opslag", async () => {
  const supabase = fakeSupabase("off");
  const out = await route("get", "/academy/me", supabase, academyContext(intake2))();
  assert.deepEqual(out.roster, [{ id: "youth", prognosis: { stage: "broad", band: { lo: 1, hi: 2 } } }]);
  assert.equal(out.intake[0].potentialEstimate.lo, 3);
  assert.deepEqual(touchedEstimates(supabase), []);
});

test("akademi tændt: trup og kandidater svarer fra skønnet", async () => {
  const out = await route("get", "/academy/me", fakeSupabase("on"), academyContext(intake2))();
  assert.deepEqual(out.roster, [{ id: "youth", potentialView: { hidden: true, reason: "learning", trainings: 1, trainingsNeeded: 5 } }]);
  assert.equal(out.intake[0].potentialView.value, 74);
  assert.equal(out.intake[0].potentialBand, null);
  assert.equal(out.intake[0].is_serious, false);
  assert.equal(out.academyProfile.tier, 1);
});
