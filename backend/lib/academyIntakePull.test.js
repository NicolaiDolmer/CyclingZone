import test from "node:test";
import assert from "node:assert/strict";

import {
  copenhagenDateParts,
  currentIntakeWeekSunday,
  hasPulledThisWeek,
  pullWeeklyAcademyIntake,
  INTAKE_PULL_VALUE_MIN,
  INTAKE_PULL_VALUE_MAX,
} from "./academyIntakePull.js";
import { SUNDAY_DRIP_COUNT } from "./sundayIntakeTick.js";

// ─── Mock-supabase helper ──────────────────────────────────────────────────────
//
// pullWeeklyAcademyIntake taler direkte til supabase for: seasons, teams,
// academy_intake_ticks (claim) og riders (fetchExistingFoldedRiderNames +
// applyProvisionalValues' update). seedCohortFn/deriveRiders/isEnabled er
// DI-hooks og injiceres direkte, så mocken IKKE behøver understøtte
// riders-insert eller academy_intake-insert (dækket af academyIntake.test.js).
function buildMockSupabase({
  season = { id: "season-1", number: 2, start_date: "2026-07-27" },
  team = { id: "team-A", season_1_identity_basis: null },
  existingRiders = [],
  claimed = false, // true = allerede claimet denne uge (boot-race/gentaget klik)
} = {}) {
  const capture = { upserts: [], riderUpdates: [] };
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: season, error: null }); },
        };
        return api;
      }

      if (table === "teams") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: team, error: null }); },
        };
        return api;
      }

      if (table === "riders") {
        const api = {
          select() { return api; },
          order() { return api; },
          range() { return Promise.resolve({ data: existingRiders, error: null }); },
          update(patch) {
            const upApi = {
              eq(col, val) {
                capture.riderUpdates.push({ id: val, patch });
                return Promise.resolve({ error: null });
              },
            };
            return upApi;
          },
        };
        return api;
      }

      if (table === "academy_intake_ticks") {
        return {
          upsert(row, opts) {
            capture.upserts.push({ row, opts });
            return {
              select(cols) {
                assert.equal(cols, "team_id");
                return Promise.resolve({
                  data: claimed ? [] : [{ team_id: row.team_id }],
                  error: null,
                });
              },
            };
          },
          select() {
            const api = {
              eq() { return api; },
              maybeSingle() {
                return Promise.resolve({ data: claimed ? { team_id: team.id } : null, error: null });
              },
            };
            return api;
          },
        };
      }

      throw new Error(`buildMockSupabase: uventet tabel ${table}`);
    },
    _capture: capture,
  };
  return supabase;
}

// ─── Uge-bucket (Europe/Copenhagen) ─────────────────────────────────────────────

test("currentIntakeWeekSunday: en søndag-formiddag giver SAMME dags dato", () => {
  // 2026-08-16 er en søndag. 10:00 UTC = 12:00 CEST (Europe/Copenhagen, UTC+2 i august).
  const week = currentIntakeWeekSunday(new Date("2026-08-16T10:00:00Z"));
  assert.equal(week, "2026-08-16");
});

test("currentIntakeWeekSunday: onsdag giver den KOMMENDE søndag samme uge", () => {
  // 2026-08-19 er en onsdag → kommende søndag er 2026-08-23.
  const week = currentIntakeWeekSunday(new Date("2026-08-19T10:00:00Z"));
  assert.equal(week, "2026-08-23");
});

test("currentIntakeWeekSunday: sen søndag aften (23:50 CEST) er STADIG samme uges bucket", () => {
  // 21:50 UTC = 23:50 CEST samme dag — deadline er endnu ikke passeret.
  const week = currentIntakeWeekSunday(new Date("2026-08-16T21:50:00Z"));
  assert.equal(week, "2026-08-16");
});

test("currentIntakeWeekSunday: lige efter midnat mandag (00:05 CEST) er NÆSTE søndag — deadline passeret", () => {
  // 2026-08-16 23:59:59 CEST er deadline (ejer-beslutning punkt 1). 22:05 UTC
  // samme dag = 00:05 CEST mandag → ugen er rullet videre, bucket'en flipper.
  const week = currentIntakeWeekSunday(new Date("2026-08-16T22:05:00Z"));
  assert.equal(week, "2026-08-23", "en ny uges bucket — mandagens kuld hentes ikke ved at klikke tirsdag på sidste uges tilbud");
});

test("copenhagenDateParts: kalenderdato-dele i Europe/Copenhagen", () => {
  assert.deepEqual(copenhagenDateParts(new Date("2026-08-16T22:05:00Z")), { year: 2026, month: 8, day: 17 });
});

// ─── hasPulledThisWeek ───────────────────────────────────────────────────────────

test("hasPulledThisWeek: true når claim-rækken findes for ugens søndag", async () => {
  const supabase = buildMockSupabase({ claimed: true });
  const result = await hasPulledThisWeek(supabase, { teamId: "team-A", now: new Date("2026-08-19T10:00:00Z") });
  assert.equal(result, true);
});

test("hasPulledThisWeek: false når ingen claim-række findes", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  const result = await hasPulledThisWeek(supabase, { teamId: "team-A", now: new Date("2026-08-19T10:00:00Z") });
  assert.equal(result, false);
});

// ─── pullWeeklyAcademyIntake ─────────────────────────────────────────────────────

test("pullWeeklyAcademyIntake: flag off → no-op, ingen writes", async () => {
  const supabase = { from: () => { throw new Error("må ikke røres når flaget er slukket"); } };
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    isEnabled: async () => false,
  });
  assert.deepEqual(r, { ok: false, reason: "flag_off" });
});

test("pullWeeklyAcademyIntake: ingen aktiv sæson → no-op", async () => {
  const supabase = buildMockSupabase({ season: null });
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    isEnabled: async () => true,
  });
  assert.deepEqual(r, { ok: false, reason: "no_active_season" });
});

test("pullWeeklyAcademyIntake: allerede hentet denne uge → alreadyPulled, ingen generering", async () => {
  const supabase = buildMockSupabase({ claimed: true });
  let seedCalled = false;
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async () => { seedCalled = true; return []; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.alreadyPulled, true);
  assert.deepEqual(r.candidates, []);
  assert.equal(seedCalled, false, "claim-guarden forhindrer et andet kuld samme uge");
});

test("pullWeeklyAcademyIntake (happy path): genererer SUNDAY_DRIP_COUNT kandidater, kører derive, sætter provisorisk værdi 1.000-5.000 EFTER derive", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  const derivedCalls = [];
  const seedCalls = [];
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    seed: 1,
    isEnabled: async () => true,
    seedCohortFn: async (_sb, opts) => {
      seedCalls.push(opts);
      assert.equal(opts.countOverride, SUNDAY_DRIP_COUNT, "pull-kuldet bruger samme størrelse som det gamle drip");
      return ["rider-1", "rider-2"];
    },
    deriveRiders: async (_sb, ids) => { derivedCalls.push(ids); },
  });

  assert.equal(r.ok, true);
  assert.equal(r.alreadyPulled, false);
  assert.deepEqual(r.candidates, ["rider-1", "rider-2"]);

  assert.equal(derivedCalls.length, 1, "afled-pipeline kørt ÉN gang for hele kuldet");
  assert.deepEqual(derivedCalls[0], ["rider-1", "rider-2"]);

  // #3550 punkt 2: provisorisk værdi sat på HVER nyindsat kandidat, i intervallet.
  const updates = supabase._capture.riderUpdates;
  assert.equal(updates.length, 2, "én base_value-update pr. ny kandidat");
  for (const u of updates) {
    assert.ok(["rider-1", "rider-2"].includes(u.id));
    assert.ok(Number.isInteger(u.patch.base_value));
    assert.ok(u.patch.base_value >= INTAKE_PULL_VALUE_MIN && u.patch.base_value <= INTAKE_PULL_VALUE_MAX,
      `base_value ${u.patch.base_value} skal ligge i [${INTAKE_PULL_VALUE_MIN}, ${INTAKE_PULL_VALUE_MAX}]`);
  }
});

test("pullWeeklyAcademyIntake: claimer FØR generering (claim-first TOCTOU-forsvar)", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async () => [],
    deriveRiders: async () => {},
  });
  assert.equal(supabase._capture.upserts.length, 1);
  assert.equal(supabase._capture.upserts[0].row.team_id, "team-A");
  assert.equal(supabase._capture.upserts[0].row.tick_date, "2026-08-23", "claim på UGENS søndag, ikke kørselsdagen");
  assert.deepEqual(supabase._capture.upserts[0].opts, { onConflict: "team_id,tick_date", ignoreDuplicates: true });
});

test("pullWeeklyAcademyIntake: tomt kuld (identityBasis udelukker alt — edge case) skriver INGEN provisoriske værdier og kalder ikke derive", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  const derivedCalls = [];
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async () => [],
    deriveRiders: async (_sb, ids) => { derivedCalls.push(ids); },
  });
  assert.deepEqual(r.candidates, []);
  assert.equal(derivedCalls.length, 0);
  assert.equal(supabase._capture.riderUpdates.length, 0);
});
