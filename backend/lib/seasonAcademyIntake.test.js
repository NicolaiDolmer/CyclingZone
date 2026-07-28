import test from "node:test";
import assert from "node:assert/strict";

import {
  planSeasonAcademyIntake,
  runSeasonAcademyIntake,
  SEASON_ACADEMY_INTAKE,
  SEASON_ACADEMY_INTAKE_FLAG_KEY,
} from "./seasonAcademyIntake.js";
import { ACADEMY } from "./academyFlag.js";

// ─── Ren kerne ────────────────────────────────────────────────────────────────

test("mode 'fixed' giver alle hold samme antal", () => {
  const plan = planSeasonAcademyIntake({
    teams: [{ teamId: "b" }, { teamId: "a", academyCount: 8 }],
    mode: "fixed", count: 3,
  });
  assert.deepEqual(plan, [{ teamId: "a", count: 3 }, { teamId: "b", count: 3 }]);
});

test("mode 'top_up' fylder op til target og aldrig over count", () => {
  const plan = planSeasonAcademyIntake({
    teams: [
      { teamId: "tom", academyCount: 0, openOffers: 0 },   // 8 fri → cappet af count
      { teamId: "halv", academyCount: 5, openOffers: 1 },  // 8-6 = 2
      { teamId: "fuld", academyCount: 8, openOffers: 0 },  // 0 → sorteres fra
    ],
    mode: "top_up", count: 3, targetPipeline: 8,
  });
  assert.deepEqual(plan, [{ teamId: "halv", count: 2 }, { teamId: "tom", count: 3 }]);
});

test("top_up tæller åbne tilbud med — en fuld indbakke får ikke flere", () => {
  const plan = planSeasonAcademyIntake({
    teams: [{ teamId: "t", academyCount: 2, openOffers: 6 }],
    mode: "top_up", count: 3, targetPipeline: 8,
  });
  assert.deepEqual(plan, []);
});

test("top_up går aldrig negativt (overfyldt akademi)", () => {
  const plan = planSeasonAcademyIntake({
    teams: [{ teamId: "t", academyCount: 12, openOffers: 4 }],
    mode: "top_up", count: 3, targetPipeline: 8,
  });
  assert.deepEqual(plan, []);
});

test("planen er stabilt sorteret på teamId (deterministisk rækkefølge)", () => {
  const ids = ["z", "m", "a", "q"];
  const plan = planSeasonAcademyIntake({ teams: ids.map((teamId) => ({ teamId })), mode: "fixed", count: 1 });
  assert.deepEqual(plan.map((p) => p.teamId), ["a", "m", "q", "z"]);
});

test("hold uden teamId ignoreres i stedet for at vælte planen", () => {
  const plan = planSeasonAcademyIntake({
    teams: [{ teamId: null }, undefined, { teamId: "ok" }], mode: "fixed", count: 2,
  });
  assert.deepEqual(plan, [{ teamId: "ok", count: 2 }]);
});

test("count 0 giver en tom plan", () => {
  assert.deepEqual(planSeasonAcademyIntake({ teams: [{ teamId: "a" }], mode: "fixed", count: 0 }), []);
});

test("ukendt mode kaster", () => {
  assert.throws(() => planSeasonAcademyIntake({ teams: [], mode: "gæt" }), /ukendt mode/);
});

test("defaults er de owner-gatede værdier fra scorecardet", () => {
  assert.equal(SEASON_ACADEMY_INTAKE_FLAG_KEY, "season_academy_intake_enabled");
  assert.equal(SEASON_ACADEMY_INTAKE.MODE, "top_up");
  assert.equal(SEASON_ACADEMY_INTAKE.COUNT, 3);
  assert.equal(SEASON_ACADEMY_INTAKE.TARGET_PIPELINE, ACADEMY.SLOTS);
});

// ─── run-laget ────────────────────────────────────────────────────────────────

function buildMockSupabase({
  season = { id: "s2", number: 2, start_date: "2026-07-26" },
  teams = [],
  academyRiders = [],
  openOffers = [],
  claimed = new Set(),
} = {}) {
  const capture = { claims: [] };
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve({ data: season, error: null }) };
        return api;
      }
      if (table === "teams") {
        const chain = {
          eq() { return chain; },
          then(resolve) { return Promise.resolve({ data: teams, error: null }).then(resolve); },
        };
        return { select() { return chain; } };
      }
      if (table === "riders") {
        const api = {
          select: () => api,
          eq: () => api,
          order: () => api,
          range: (from, to) => Promise.resolve({ data: academyRiders.slice(from, to + 1), error: null }),
          // fetchExistingFoldedRiderNames bruger samme select().order().range()-sti
        };
        return api;
      }
      if (table === "academy_intake") {
        const api = {
          select: () => api,
          eq: () => api,
          order: () => api,
          range: (from, to) => Promise.resolve({ data: openOffers.slice(from, to + 1), error: null }),
        };
        return api;
      }
      if (table === "academy_season_intake_runs") {
        return {
          upsert(row) {
            const already = claimed.has(row.team_id);
            capture.claims.push(row);
            return { select: () => Promise.resolve({ data: already ? [] : [{ team_id: row.team_id }], error: null }) };
          },
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, capture };
}

const ON = async () => true;

test("akademi-flaget off → mekanikken rører intet", async () => {
  const { supabase } = buildMockSupabase();
  const res = await runSeasonAcademyIntake({ supabase, isEnabled: ON, academyEnabled: async () => false });
  assert.deepEqual(res, { ran: false, reason: "academy_flag_off" });
});

test("eget flag off → mekanikken rører intet, og akademi-flaget læses slet ikke", async () => {
  const { supabase } = buildMockSupabase();
  let academyFlagRead = false;
  const res = await runSeasonAcademyIntake({
    supabase,
    isEnabled: async () => false,
    academyEnabled: async () => { academyFlagRead = true; return true; },
  });
  assert.deepEqual(res, { ran: false, reason: "flag_off" });
  assert.equal(academyFlagRead, false);
});

test("ingen aktiv sæson → no-op i stedet for at kaste", async () => {
  const { supabase } = buildMockSupabase({ season: null });
  const res = await runSeasonAcademyIntake({ supabase, isEnabled: ON, academyEnabled: ON });
  assert.deepEqual(res, { ran: false, reason: "no_active_season" });
});

test("seeder kuld pr. hold ud fra ledig kapacitet, og afleder dem i ÉT kald", async () => {
  const { supabase } = buildMockSupabase({
    teams: [{ id: "t-tom", season_1_identity_basis: null }, { id: "t-fuld", season_1_identity_basis: null }],
    academyRiders: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, team_id: "t-fuld" })),
  });
  const seeded = [];
  let derivedWith = null;
  const res = await runSeasonAcademyIntake({
    supabase, isEnabled: ON, academyEnabled: ON,
    seedCohortFn: async (_sb, args) => {
      seeded.push({ teamId: args.teamId, count: args.countOverride });
      return Array.from({ length: args.countOverride }, (_, i) => `${args.teamId}-new-${i}`);
    },
    deriveRiders: async (_sb, ids) => { derivedWith = ids; },
    notify: async () => {},
  });

  assert.equal(res.ran, true);
  assert.equal(res.seasonNumber, 2);
  assert.deepEqual(seeded, [{ teamId: "t-tom", count: 3 }]); // t-fuld har 8/8 → intet
  assert.equal(res.teams, 1);
  assert.equal(res.candidates, 3);
  assert.equal(derivedWith.length, 3, "afled-pipelinen skal køre for alle nye ryttere");
});

test("allerede claimet hold springes over (idempotens pr. hold+sæson)", async () => {
  const { supabase } = buildMockSupabase({
    teams: [{ id: "t1" }, { id: "t2" }],
    claimed: new Set(["t1"]),
  });
  const seeded = [];
  const res = await runSeasonAcademyIntake({
    supabase, isEnabled: ON, academyEnabled: ON,
    seedCohortFn: async (_sb, args) => { seeded.push(args.teamId); return ["x"]; },
    deriveRiders: async () => {},
    notify: async () => {},
  });
  assert.deepEqual(seeded, ["t2"]);
  assert.equal(res.teams, 1);
});

test("ét holds fejl isoleres — de andre hold får stadig deres kuld", async () => {
  const { supabase } = buildMockSupabase({ teams: [{ id: "a" }, { id: "b" }] });
  const res = await runSeasonAcademyIntake({
    supabase, isEnabled: ON, academyEnabled: ON,
    seedCohortFn: async (_sb, args) => {
      if (args.teamId === "a") throw new Error("insert failed");
      return ["b1", "b2", "b3"];
    },
    deriveRiders: async () => {},
    notify: async () => {},
  });
  assert.equal(res.teams, 1);
  assert.equal(res.candidates, 3);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /^a: insert failed$/);
});

test("dryRun returnerer planen uden at claime eller seede", async () => {
  const { supabase, capture } = buildMockSupabase({ teams: [{ id: "a" }, { id: "b" }] });
  let seedCalls = 0;
  const res = await runSeasonAcademyIntake({
    supabase, dryRun: true, isEnabled: ON, academyEnabled: ON,
    seedCohortFn: async () => { seedCalls++; return []; },
  });
  assert.equal(res.dryRun, true);
  assert.equal(res.teams, 2);
  assert.equal(res.candidates, 6);
  assert.equal(seedCalls, 0);
  assert.equal(capture.claims.length, 0);
});
