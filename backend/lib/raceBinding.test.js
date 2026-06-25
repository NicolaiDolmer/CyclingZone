import test from "node:test";
import assert from "node:assert/strict";
import { raceTimeWindow, raceBindingWindow, windowsOverlap, findRiderBindingConflicts, loadTeamBindingContext, findManualOverlapConflicts, teamInRacePool } from "./raceBinding.js";

test("raceTimeWindow: start=tidligste, end=seneste etape", () => {
  const w = raceTimeWindow([
    { scheduled_at: "2026-06-23T10:30:00Z" },
    { scheduled_at: "2026-06-25T13:00:00Z" },
    { scheduled_at: "2026-06-24T13:00:00Z" },
  ]);
  assert.equal(w.start, Date.parse("2026-06-23T10:30:00Z"));
  assert.equal(w.end, Date.parse("2026-06-25T13:00:00Z"));
});

test("raceTimeWindow: tom/ugyldig → null", () => {
  assert.equal(raceTimeWindow([]), null);
  assert.equal(raceTimeWindow(null), null);
});

// raceBindingWindow (#1823): binding er pr. CET-KALENDERDAG, ikke pr. instant. Et
// endagsløb optager hele sin danske dag; et etapeløb optager fra første til sidste
// etapes danske dag. Rod-årsag for prod-dobbeltbookingen: instant-vinduer fik to
// samme-dag-løb (fx Hamburger 22:00 + La Corsa etape 1 23:00) til IKKE at overlappe.
test("raceBindingWindow: endagsløb spænder præcis én CET-dag (instant → hel dag)", () => {
  const w = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]); // 22:00 CEST
  assert.equal(w.start, w.end, "endagsløb = én dag");
});

test("raceBindingWindow: to løb samme CET-dag overlapper (regression for #1823)", () => {
  const hamburger = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]); // 22:00 CEST 23/6
  const laCorsa = raceBindingWindow([
    { scheduled_at: "2026-06-23T21:00:00Z" }, // 23:00 CEST etape 1, 23/6
    { scheduled_at: "2026-06-26T13:00:00Z" }, // etape 7, 26/6
  ]);
  assert.equal(windowsOverlap(hamburger, laCorsa), true, "samme-dag-løb bindes (må ikke dobbeltbookes)");
});

test("raceBindingWindow: etapeløb spænder fra første til sidste CET-dag", () => {
  const w = raceBindingWindow([
    { scheduled_at: "2026-06-23T21:00:00Z" },
    { scheduled_at: "2026-06-26T13:00:00Z" },
  ]);
  assert.equal(w.end - w.start, 3, "Jun23→Jun26 = 3 dages span");
});

test("raceBindingWindow: forskellige CET-dage overlapper ikke", () => {
  const jun23 = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]);
  const jun24 = raceBindingWindow([{ scheduled_at: "2026-06-24T20:00:00Z" }]);
  assert.equal(windowsOverlap(jun23, jun24), false);
});

test("raceBindingWindow: CET-midnatsgrænse (sommer) — 00:30 CEST hører til den danske dag, ikke UTC-dagen før", () => {
  const tidlig24 = raceBindingWindow([{ scheduled_at: "2026-06-23T22:30:00Z" }]); // 00:30 CEST 24/6
  const jun24 = raceBindingWindow([{ scheduled_at: "2026-06-24T12:00:00Z" }]);
  const jun23 = raceBindingWindow([{ scheduled_at: "2026-06-23T12:00:00Z" }]);
  assert.equal(windowsOverlap(tidlig24, jun24), true, "00:30 CEST = samme danske dag som middag 24/6");
  assert.equal(windowsOverlap(tidlig24, jun23), false, "00:30 CEST 24/6 ≠ 23/6");
});

test("raceBindingWindow: DST-robust — vinter-midnatsgrænse (CET=UTC+1)", () => {
  const tidlig16 = raceBindingWindow([{ scheduled_at: "2026-12-15T23:30:00Z" }]); // 00:30 CET 16/12
  const dec16 = raceBindingWindow([{ scheduled_at: "2026-12-16T12:00:00Z" }]);
  const dec15 = raceBindingWindow([{ scheduled_at: "2026-12-15T12:00:00Z" }]);
  assert.equal(windowsOverlap(tidlig16, dec16), true);
  assert.equal(windowsOverlap(tidlig16, dec15), false);
});

test("raceBindingWindow: tom/ugyldig → null", () => {
  assert.equal(raceBindingWindow([]), null);
  assert.equal(raceBindingWindow(null), null);
  assert.equal(raceBindingWindow([{ scheduled_at: "not-a-date" }]), null);
});

test("windowsOverlap: deler tidspunkt → true; adskilte → false", () => {
  const a = { start: 100, end: 200 };
  assert.equal(windowsOverlap(a, { start: 150, end: 300 }), true);  // overlap
  assert.equal(windowsOverlap(a, { start: 200, end: 400 }), true);  // rører ved enden
  assert.equal(windowsOverlap(a, { start: 201, end: 400 }), false); // adskilt
  assert.equal(windowsOverlap(a, null), false);
});

test("findRiderBindingConflicts: rytter i tidsoverlappende løb flagges", () => {
  const thisWindow = { start: 100, end: 200 };
  const otherRaces = [
    { window: { start: 150, end: 250 }, riderIds: ["r1", "r2"] }, // overlapper
    { window: { start: 400, end: 500 }, riderIds: ["r3"] },        // overlapper IKKE
  ];
  const conflicts = findRiderBindingConflicts({ riderIds: ["r1", "r3", "r4"], thisWindow, otherRaces });
  assert.deepEqual(conflicts.sort(), ["r1"]); // r1 bundet; r3 i ikke-overlappende; r4 fri
});

test("findRiderBindingConflicts: intet vindue → ingen konflikter", () => {
  assert.deepEqual(findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: null, otherRaces: [] }), []);
});

// Mock-supabase: svarer pr. tabel; ignorerer filtre (testen verificerer kombinations-
// logikken, ikke query-filtrene). Mønster fra raceFatigue.test.js.
function makeSupabase({ scheduleByRace = {}, teamEntries = [] } = {}) {
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(col, val) { f[col] = val; return b; },
      neq(col, val) { f["neq_" + col] = val; return b; },
      in(col, vals) { f["in_" + col] = vals; return b; },
      then(resolve, reject) {
        let data = [];
        if (table === "race_stage_schedule") {
          if (f.race_id) data = scheduleByRace[f.race_id] || [];
          else if (f.in_race_id) data = f.in_race_id.flatMap((id) => scheduleByRace[id] || []);
        } else if (table === "race_entries") {
          data = teamEntries;
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("loadTeamBindingContext: bygger thisWindow + otherRaces grupperet pr. løb", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }],
      "race-a": [
        { race_id: "race-a", scheduled_at: "2026-06-23T13:00:00Z" },
        { race_id: "race-a", scheduled_at: "2026-06-24T13:00:00Z" },
      ],
    },
    teamEntries: [
      { race_id: "race-a", rider_id: "r1" },
      { race_id: "race-a", rider_id: "r2" },
    ],
  });
  // Binding-vinduer er CET-dag-ordinaler (#1823), ikke ms.
  const ORD = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.equal(ctx.thisWindow.start, ORD("2026-06-23")); // 10:30Z = 12:30 CEST 23/6
  assert.equal(ctx.otherRaces.length, 1);
  assert.equal(ctx.otherRaces[0].window.end, ORD("2026-06-24")); // sidste etape 13:00Z = 15:00 CEST 24/6
  assert.deepEqual(ctx.otherRaces[0].riderIds.sort(), ["r1", "r2"]);
});

test("findManualOverlapConflicts: ingen konflikt når vinduer ikke overlapper", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 200 }],
    ["B", { start: 300, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: samme rytter i to overlappende løb → drop det senere", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }], // overlapper A
  ]);
  const conflicts = findManualOverlapConflicts({ entries, windowByRace });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], { rider_id: "r1", keepRaceId: "A", dropRaceId: "B" });
});

test("findManualOverlapConflicts: forskellige ryttere giver ingen konflikt", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r2" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: løb uden vindue ignoreres", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([["A", { start: 100, end: 300 }]]); // B mangler vindue
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("loadTeamBindingContext: ingen andre entries → tom otherRaces", async () => {
  const supabase = makeSupabase({
    scheduleByRace: { "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }] },
    teamEntries: [],
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.deepEqual(ctx.otherRaces, []);
});

// Race-hub pulje-binding (#1798-opfølgning): et hold må kun være i feltet for et løb
// i sin EGEN pulje. Komplementerer rytter-bindingen (rytter↔tid) ovenfor med
// hold↔pulje. Pure spejling af autofill-pulje-filteret (raceRunner.js: racePoolId).
test("teamInRacePool: samme pulje → true", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 4, racePoolId: 4 }), true);
});

test("teamInRacePool: anden pulje → false", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 5, racePoolId: 4 }), false);
});

test("teamInRacePool: løb uden pulje (racePoolId null) → true (ingen restriktion, jf. autofill)", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 4, racePoolId: null }), true);
  assert.equal(teamInRacePool({ teamDivisionId: null, racePoolId: null }), true);
});

test("teamInRacePool: hold uden pulje men løb har pulje → false", () => {
  assert.equal(teamInRacePool({ teamDivisionId: null, racePoolId: 4 }), false);
});
