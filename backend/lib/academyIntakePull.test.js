import test from "node:test";
import assert from "node:assert/strict";

import {
  copenhagenDateParts,
  currentIntakeWeekKey,
  hasPulledThisWeek,
  pullWeeklyAcademyIntake,
  INTAKE_PULL_VALUE_MIN,
  INTAKE_PULL_VALUE_MAX,
} from "./academyIntakePull.js";
import { candidatesForTier } from "./academyIntakeProfile.ts";
import { seedAcademyCohortForTeam } from "./academyIntake.js";

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
  failRiderUpdate = false, // #6666: provisorisk værdi fejler (efter claim + kuld + derive)
  failRiderDelete = false, // #6666: oprydningen selv fejler
  keptIntake = [], // Codex 16/10: kandidater der blev signeret/afvist i en anden fane under hentningen
} = {}) {
  const capture = { upserts: [], riderUpdates: [], deletes: [], claimDeletes: [] };
  let claimHeld = claimed; // stateful: en oprydning frigiver claimet, så ugen kan hentes igen
  const deleteIn = (table, fail) => ({
    in(col, ids) {
      capture.deletes.push({ table, col, ids });
      const p = Promise.resolve({ error: fail ? { message: `${table} delete boom` } : null });
      // @ts-ignore - mock: .eq() kædes på sletningen af intake-rækker
      p.eq = () => p;
      return p;
    },
  });
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
          delete() { return deleteIn("riders", failRiderDelete); },
          update(patch) {
            const upApi = {
              eq(col, val) {
                capture.riderUpdates.push({ id: val, patch });
                return Promise.resolve({ error: failRiderUpdate ? { message: "update boom" } : null });
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
                if (claimHeld) return Promise.resolve({ data: [], error: null });
                claimHeld = true;
                return Promise.resolve({ data: [{ team_id: row.team_id }], error: null });
              },
            };
          },
          select() {
            const api = {
              eq() { return api; },
              maybeSingle() {
                return Promise.resolve({ data: claimHeld ? { team_id: team.id } : null, error: null });
              },
            };
            return api;
          },
          delete() {
            const filters = [];
            const api = {
              eq(col, val) {
                filters.push([col, val]);
                if (filters.length < 2) return api;
                capture.claimDeletes.push(Object.fromEntries(filters));
                claimHeld = false;
                return Promise.resolve({ error: null });
              },
            };
            return api;
          },
        };
      }

      if (table === "academy_intake") {
        return {
          delete() { return deleteIn("academy_intake", false); },
          select() { return { in: () => Promise.resolve({ data: keptIntake.map((id) => ({ rider_id: id })), error: null }) }; },
        };
      }

      // #6666: akademi-faciliteten + profilen (ingen køb, ingen profil = niveau 0).
      if (table === "team_facilities") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        };
        return api;
      }
      if (table === "academy_intake_profiles") {
        const api = {
          select() { return api; },
          eq() { return api; },
          order() { return api; },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return api;
      }

      throw new Error(`buildMockSupabase: uventet tabel ${table}`);
    },
    _capture: capture,
  };
  return supabase;
}

// ─── Uge-bucket (Europe/Copenhagen) ─────────────────────────────────────────────

test("currentIntakeWeekKey: ugen er søndag-lørdag; nøglen er lørdagen der afslutter ugen (ejer 25/10)", () => {
  // 2026-08-16 er en søndag: en NY uge starter, nøglen er lørdag 2026-08-22.
  assert.equal(currentIntakeWeekKey(new Date("2026-08-16T10:00:00Z")), "2026-08-22");
  // Onsdag 2026-08-19 → samme uge.
  assert.equal(currentIntakeWeekKey(new Date("2026-08-19T10:00:00Z")), "2026-08-22");
  // Lørdag formiddag → dagens dato.
  assert.equal(currentIntakeWeekKey(new Date("2026-08-22T10:00:00Z")), "2026-08-22");
});

test("currentIntakeWeekKey: lørdag 23:50 er samme uge, søndag 00:05 er en ny uge (CEST)", () => {
  // 21:50 UTC lørdag = 23:50 CEST: fristen er ikke passeret.
  assert.equal(currentIntakeWeekKey(new Date("2026-08-22T21:50:00Z")), "2026-08-22");
  // 22:05 UTC lørdag = 00:05 CEST søndag: ny uge.
  assert.equal(currentIntakeWeekKey(new Date("2026-08-22T22:05:00Z")), "2026-08-29");
});

test("currentIntakeWeekKey: vintertid (CET) og DST-skiftet 25/10 2026", () => {
  // 25/10 2026 kl. 03:00 CEST går uret til 02:00 CET. Søndag 25/10 er en ny uge hele dagen.
  assert.equal(currentIntakeWeekKey(new Date("2026-10-24T21:59:00Z")), "2026-10-24", "lørdag 23:59 CEST");
  assert.equal(currentIntakeWeekKey(new Date("2026-10-24T22:00:00Z")), "2026-10-31", "søndag 00:00 CEST");
  assert.equal(currentIntakeWeekKey(new Date("2026-10-25T09:00:00Z")), "2026-10-31", "søndag formiddag CET");
  // Lørdag 31/10 23:59 CET = 22:59 UTC; søndag 1/11 00:00 CET = 23:00 UTC.
  assert.equal(currentIntakeWeekKey(new Date("2026-10-31T22:59:00Z")), "2026-10-31");
  assert.equal(currentIntakeWeekKey(new Date("2026-10-31T23:00:00Z")), "2026-11-07");
});

test("currentIntakeWeekKey: en række fra den gamle mandag-søndag-model blokerer ikke den nye uge", () => {
  // Den gamle model nøglede ugen 19-25/10 på søndag 2026-10-25. Den nye uge fra
  // søndag 25/10 har nøglen lørdag 2026-10-31: forskellige nøgler, ingen kollision.
  assert.notEqual(currentIntakeWeekKey(new Date("2026-10-25T09:00:00Z")), "2026-10-25");
  for (let d = 0; d < 14; d++) {
    const key = currentIntakeWeekKey(new Date(Date.UTC(2026, 9, 20 + d, 12)));
    assert.equal(new Date(`${key}T12:00:00Z`).getUTCDay(), 6, `${key} er en lørdag`);
  }
});

test("copenhagenDateParts: kalenderdato-dele i Europe/Copenhagen", () => {
  assert.deepEqual(copenhagenDateParts(new Date("2026-08-16T22:05:00Z")), { year: 2026, month: 8, day: 17 });
});

// ─── hasPulledThisWeek ───────────────────────────────────────────────────────────

test("hasPulledThisWeek: true når claim-rækken findes for ugens lørdag", async () => {
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
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => false,
  });
  assert.deepEqual(r, { ok: false, reason: "flag_off" });
});

test("pullWeeklyAcademyIntake: ingen aktiv sæson → no-op", async () => {
  const supabase = buildMockSupabase({ season: null });
  const r = await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
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

test("pullWeeklyAcademyIntake (#6666): akademi-niveauet styrer kuldets størrelse og profilens overvægt", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  const seen = [];
  await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => true,
    loadProfileState: async () => ({
      tier: 4,
      effective: { origins: ["DK"], types: ["climber", "gc"] },
    }),
    seedCohortFn: async (_sb, opts) => { seen.push(opts); return []; },
    deriveRiders: async () => {},
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].countOverride, candidatesForTier(4));
  assert.ok(seen[0].generatorOptions?.nationalityWeights, "nationalitets-overvægt sendt til generatoren");
  assert.ok(seen[0].generatorOptions?.primaryArchetypeDistribution, "type-overvægt sendt til generatoren");
});

test("pullWeeklyAcademyIntake (#6666): uden profil og uden facilitet = niveau 0, ingen overvægt", async () => {
  const supabase = buildMockSupabase({ claimed: false });
  const seen = [];
  await pullWeeklyAcademyIntake(supabase, {
    teamId: "team-A",
    now: new Date("2026-08-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async (_sb, opts) => { seen.push(opts); return []; },
    deriveRiders: async () => {},
  });
  assert.equal(seen[0].countOverride, candidatesForTier(0));
  assert.equal(seen[0].generatorOptions, null);
});

test("pullWeeklyAcademyIntake (happy path): genererer niveau-0-kuldet, kører derive, sætter provisorisk værdi 1.000-5.000 EFTER derive", async () => {
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
      assert.equal(opts.countOverride, candidatesForTier(0), "#6666: niveau 0 (ingen akademi-facilitet)");
      assert.equal(opts.source, "pull", "#6155: pull-kandidater markeres source=pull");
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
  assert.equal(supabase._capture.upserts[0].row.tick_date, "2026-08-22", "claim på UGENS lørdag, ikke kørselsdagen");
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

// ─── #6666 (CodeRabbit Major): atomisk, genkørbar hentning ───────────────────────
// En fejl EFTER claimet må aldrig efterlade et halvt kuld eller et claim uden
// kandidater. Oprydningen sletter kuldets rækker og derefter claimet, så samme
// uge kan hentes igen.

const PULL_NOW = new Date("2026-08-19T10:00:00Z");
const PULL_WEEK = "2026-08-22";

function pullOpts(overrides = {}) {
  return {
    teamId: "team-A",
    now: PULL_NOW,
    seed: 1,
    isEnabled: async () => true,
    seedCohortFn: async () => ["rider-1", "rider-2"],
    deriveRiders: async () => {},
    ...overrides,
  };
}

test("pullWeeklyAcademyIntake (#6666): profil-fejl efter claim → claimet frigives, intet kuld, fejlen kastes", async () => {
  const supabase = buildMockSupabase();
  let seeded = false;
  await assert.rejects(
    pullWeeklyAcademyIntake(supabase, pullOpts({
      loadProfileState: async () => { throw new Error("profile boom"); },
      seedCohortFn: async () => { seeded = true; return []; },
    })),
    /profile boom/,
  );
  assert.equal(seeded, false);
  assert.deepEqual(supabase._capture.deletes, [], "ingen ryttere oprettet → intet at slette");
  assert.deepEqual(supabase._capture.claimDeletes, [{ team_id: "team-A", tick_date: PULL_WEEK }]);
});

test("pullWeeklyAcademyIntake (#6666): derive-fejl → kuldets intake-rækker + ryttere slettes, så claimet", async () => {
  const supabase = buildMockSupabase();
  await assert.rejects(
    pullWeeklyAcademyIntake(supabase, pullOpts({
      deriveRiders: async () => { throw new Error("derive boom"); },
    })),
    /derive boom/,
  );
  assert.deepEqual(supabase._capture.deletes, [
    { table: "academy_intake", col: "rider_id", ids: ["rider-1", "rider-2"] },
    { table: "riders", col: "id", ids: ["rider-1", "rider-2"] },
  ]);
  assert.deepEqual(supabase._capture.claimDeletes, [{ team_id: "team-A", tick_date: PULL_WEEK }]);
  assert.equal(supabase._capture.riderUpdates.length, 0, "ingen provisoriske værdier efter en derive-fejl");
});

test("pullWeeklyAcademyIntake (Codex 16/10): kuld-fejl hvor kuldets egen oprydning fejlede → ryttere ryddes her", async () => {
  const supabase = buildMockSupabase();
  const seedCohortFn = async () => {
    const e = new Error("intake insert boom; cleanup failed");
    // @ts-ignore - mock
    e.orphanRiderIds = ["orphan-1", "orphan-2"];
    throw e;
  };
  await assert.rejects(pullWeeklyAcademyIntake(supabase, pullOpts({ seedCohortFn })), /intake insert boom/);
  assert.deepEqual(supabase._capture.deletes.map((d) => [d.table, d.ids]), [
    ["academy_intake", ["orphan-1", "orphan-2"]],
    ["riders", ["orphan-1", "orphan-2"]],
  ]);
});

test("pullWeeklyAcademyIntake (Codex 16/10): en kandidat signeret i en anden fane slettes ikke, og ugens claim beholdes", async () => {
  const supabase = buildMockSupabase({ keptIntake: ["rider-2"] });
  await assert.rejects(
    pullWeeklyAcademyIntake(supabase, pullOpts({ deriveRiders: async () => { throw new Error("derive boom"); } })),
    /derive boom/,
  );
  assert.deepEqual(supabase._capture.deletes, [
    { table: "academy_intake", col: "rider_id", ids: ["rider-1", "rider-2"] },
    { table: "riders", col: "id", ids: ["rider-1"] },
  ]);
  assert.equal(supabase._capture.claimDeletes.length, 0, "en afgjort kandidat = ugen er brugt");
});

test("pullWeeklyAcademyIntake (#6666): fejl i provisorisk værdi → hele kuldet + claimet ryddes", async () => {
  const supabase = buildMockSupabase({ failRiderUpdate: true });
  await assert.rejects(pullWeeklyAcademyIntake(supabase, pullOpts()), /provisional value/);
  assert.deepEqual(supabase._capture.deletes.map((d) => d.table), ["academy_intake", "riders"]);
  assert.equal(supabase._capture.claimDeletes.length, 1);
});

test("pullWeeklyAcademyIntake (#6666): genkørbar — efter en fejl kan samme uge hentes igen", async () => {
  const supabase = buildMockSupabase();
  let attempt = 0;
  const deriveRiders = async () => { attempt += 1; if (attempt === 1) throw new Error("derive boom"); };
  await assert.rejects(pullWeeklyAcademyIntake(supabase, pullOpts({ deriveRiders })), /derive boom/);

  const retry = await pullWeeklyAcademyIntake(supabase, pullOpts({ deriveRiders, seedCohortFn: async () => ["rider-3", "rider-4"] }));
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyPulled, false, "claimet blev frigivet, så andet forsøg genererer");
  assert.deepEqual(retry.candidates, ["rider-3", "rider-4"]);

  const third = await pullWeeklyAcademyIntake(supabase, pullOpts());
  assert.equal(third.alreadyPulled, true, "efter et vellykket forsøg er ugen hentet");
});

test("pullWeeklyAcademyIntake (#6666): fejler oprydningen af kuldet, BEHOLDES claimet (intet dobbelt-kuld)", async () => {
  const supabase = buildMockSupabase({ failRiderDelete: true });
  await assert.rejects(
    pullWeeklyAcademyIntake(supabase, pullOpts({ deriveRiders: async () => { throw new Error("derive boom"); } })),
    (err) => /derive boom/.test(err.message) && /rollback incomplete/.test(err.message),
  );
  assert.deepEqual(supabase._capture.claimDeletes, [], "claimet står, så et nyt klik ikke lægger et kuld oveni resterne");
});

test("seedAcademyCohortForTeam (#6666): fejler intake-indsættelsen, slettes de netop indsatte ryttere før fejlen kastes", async () => {
  const deleted = [];
  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          insert(rows) {
            return { select: () => Promise.resolve({ data: rows.map((_, i) => ({ id: `new-${i}` })), error: null }) };
          },
          delete() {
            return { in(col, ids) { deleted.push({ col, ids }); return Promise.resolve({ error: null }); } };
          },
        };
      }
      if (table === "academy_intake") {
        return { insert: () => Promise.resolve({ error: { message: "intake boom" } }) };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
  await assert.rejects(
    seedAcademyCohortForTeam(supabase, {
      teamId: "team-A",
      season: { id: "season-1", number: 2 },
      referenceYear: 2026,
      existingNames: new Set(),
      rng: () => 0.5,
      countOverride: 2,
    }),
    /intake boom/,
  );
  assert.deepEqual(deleted, [{ col: "id", ids: ["new-0", "new-1"] }]);
});
