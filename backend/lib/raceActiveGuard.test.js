// Tests for race-active forward-guard (#2074: tabt startfelt i igangværende løb).
import test from "node:test";
import assert from "node:assert/strict";
import {
  isRaceLineupFrozen,
  assertLineupMutationAllowed,
  detectInFlightRacesWithoutEntries,
} from "./raceActiveGuard.js";

// ── isRaceLineupFrozen (ren predikat) ──────────────────────────────────────────
test("isRaceLineupFrozen: stages_completed>0 = frosset (afvikling i gang)", () => {
  assert.equal(isRaceLineupFrozen({ status: "scheduled", stages_completed: 1 }), true);
  assert.equal(isRaceLineupFrozen({ status: "scheduled", stages_completed: 6 }), true);
});

test("isRaceLineupFrozen: stages_completed=0 og scheduled = ikke frosset (åben trup)", () => {
  assert.equal(isRaceLineupFrozen({ status: "scheduled", stages_completed: 0 }), false);
  assert.equal(isRaceLineupFrozen({ status: "scheduled", stages_completed: null }), false);
  assert.equal(isRaceLineupFrozen({ status: "scheduled" }), false);
});

test("isRaceLineupFrozen: completed = frosset (historik)", () => {
  assert.equal(isRaceLineupFrozen({ status: "completed", stages_completed: 0 }), true);
});

test("isRaceLineupFrozen: null/undefined = ikke frosset (defensivt)", () => {
  assert.equal(isRaceLineupFrozen(null), false);
  assert.equal(isRaceLineupFrozen(undefined), false);
});

// ── assertLineupMutationAllowed (prævention) ───────────────────────────────────
test("assertLineupMutationAllowed: kaster for igangværende løb (medsendt race)", async () => {
  await assert.rejects(
    () => assertLineupMutationAllowed({ raceId: "r1", race: { status: "scheduled", stages_completed: 2 }, label: "test" }),
    (err) => {
      assert.equal(err.code, "race_lineup_frozen");
      assert.match(err.message, /in-flight race r1/);
      return true;
    }
  );
});

test("assertLineupMutationAllowed: tillader ikke-startet løb (medsendt race)", async () => {
  await assert.doesNotReject(
    () => assertLineupMutationAllowed({ raceId: "r1", race: { status: "scheduled", stages_completed: 0 }, label: "test" })
  );
});

test("assertLineupMutationAllowed: slår løb op når race ikke medsendes, og kaster hvis frosset", async () => {
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: { status: "scheduled", stages_completed: 3 }, error: null }); },
      };
    },
  };
  await assert.rejects(
    () => assertLineupMutationAllowed({ supabase, raceId: "r9", label: "lookup" }),
    (err) => err.code === "race_lineup_frozen"
  );
});

test("assertLineupMutationAllowed: fail-open uden supabase og uden race (kalder-ansvar)", async () => {
  await assert.doesNotReject(() => assertLineupMutationAllowed({ raceId: "r1" }));
});

// ── detectInFlightRacesWithoutEntries (detektion/alarm) ────────────────────────
// Fake-supabase: races-tabellen returnerer canned in-flight-løb; race_entries returnerer
// et count pr. race_id (head:true → { count }). eqs registreres så vi kan slå op.
function makeDetectSupabase({ inFlight = [], entryCountByRace = {} }) {
  return {
    from(table) {
      const state = { table, eqs: [] };
      const b = {
        select(_cols, opts) { state.opts = opts; return b; },
        eq(c, v) { state.eqs.push([c, v]); return b; },
        neq() { return b; },
        gt() { return b; },
        then(res, rej) {
          // races-listen (ingen count/head)
          return Promise.resolve({ data: inFlight, error: null }).then(res, rej);
        },
      };
      if (table === "race_entries") {
        // head-count-query: returnér { count } for det efterspurgte race_id.
        b.then = (res, rej) => {
          const raceId = state.eqs.find(([c]) => c === "race_id")?.[1];
          const count = entryCountByRace[raceId] ?? 0;
          return Promise.resolve({ count, data: null, error: null }).then(res, rej);
        };
      }
      return b;
    },
  };
}

test("detect: rapporterer igangværende løb med 0 entries", async () => {
  const supabase = makeDetectSupabase({
    inFlight: [
      { id: "lost", name: "La Corsa", stages: 7, stages_completed: 2, status: "scheduled" },
      { id: "ok", name: "Volta", stages: 5, stages_completed: 3, status: "scheduled" },
    ],
    entryCountByRace: { lost: 0, ok: 138 },
  });
  const { affected } = await detectInFlightRacesWithoutEntries({ supabase });
  assert.equal(affected.length, 1);
  assert.equal(affected[0].id, "lost");
  assert.equal(affected[0].stages_completed, 2);
});

test("detect: ingen affected når alle igangværende løb har entries", async () => {
  const supabase = makeDetectSupabase({
    inFlight: [{ id: "ok", name: "Volta", stages: 5, stages_completed: 3, status: "scheduled" }],
    entryCountByRace: { ok: 138 },
  });
  const { affected } = await detectInFlightRacesWithoutEntries({ supabase });
  assert.deepEqual(affected, []);
});

test("detect: tom in-flight-liste → tomt resultat uden entry-opslag", async () => {
  const supabase = makeDetectSupabase({ inFlight: [] });
  const { affected } = await detectInFlightRacesWithoutEntries({ supabase });
  assert.deepEqual(affected, []);
});
