// #5903: engangs-oprydningens kerne + ejer-go-gaten.
import test from "node:test";
import assert from "node:assert/strict";
import { findOffSquadEntries, deleteOffSquadEntries, recheckRider, parseArgs, OWNER_GO_TOKEN } from "./cleanup5903.mjs";

const open = (id, squad) => ({ id, squad, status: "scheduled", stages_completed: 0 });
const rider = (id, squad, extra = {}) => ({
  id, team_id: "A", squad, is_academy: squad !== "senior", is_retired: false, ...extra,
});

test("#5903 findOffSquadEntries: U23-rytter i juniorløb findes; rigtig trup bliver", () => {
  const races = [open("J1", "junior"), open("U1", "u23")];
  const riders = [rider("u1", "u23"), rider("j1", "junior")];
  const entries = [
    { race_id: "J1", team_id: "A", rider_id: "u1" }, // forkert: hændelsen 28/9
    { race_id: "J1", team_id: "A", rider_id: "j1" },
    { race_id: "U1", team_id: "A", rider_id: "u1" },
  ];
  const { offSquad, ghosts, units } = findOffSquadEntries({ races, entries, riders });
  assert.deepEqual(offSquad, [{ race_id: "J1", team_id: "A", rider_id: "u1", rider_squad: "u23", race_squad: "junior" }]);
  assert.equal(ghosts, 0);
  assert.deepEqual(units, [{ race_id: "J1", team_id: "A", removed: 1, remaining: 1, belowFloor: true }]);
});

test("#5903 findOffSquadEntries: senior i U23-løb og akademirytter (før backfill) i seniorløb", () => {
  const races = [open("U1", "u23"), open("S1", "senior")];
  const riders = [
    rider("s1", "senior"),
    // Før riders.squad-backfill: squad='senior' men is_academy=true = ikke senior.
    rider("a1", "senior", { is_academy: true }),
  ];
  const entries = [
    { race_id: "U1", team_id: "A", rider_id: "s1" },
    { race_id: "S1", team_id: "A", rider_id: "a1" },
  ];
  const { offSquad } = findOffSquadEntries({ races, entries, riders });
  assert.deepEqual(offSquad.map((r) => r.race_id).sort(), ["S1", "U1"]);
});

test("#5903 findOffSquadEntries: startede løb og ghosts røres ikke", () => {
  const races = [
    { id: "U2", squad: "u23", status: "scheduled", stages_completed: 1 }, // låst (#1825)
    { id: "U3", squad: "u23", status: "completed", stages_completed: 3 },
    open("J1", "junior"),
  ];
  const riders = [rider("s1", "senior"), rider("x1", "u23", { team_id: "B" }), rider("p1", "u23", { is_retired: true })];
  const entries = [
    { race_id: "U2", team_id: "A", rider_id: "s1" },
    { race_id: "U3", team_id: "A", rider_id: "s1" },
    { race_id: "J1", team_id: "A", rider_id: "x1" }, // solgt: ghost
    { race_id: "J1", team_id: "A", rider_id: "p1" }, // pensioneret: ghost
    { race_id: "J1", team_id: "A", rider_id: "gone" }, // slettet rytter: ghost
  ];
  const { offSquad, ghosts } = findOffSquadEntries({ races, entries, riders });
  assert.equal(offSquad.length, 0);
  assert.equal(ghosts, 3);
});

test("#5903 findOffSquadEntries: enhed på gulvet efter sletning markeres ikke som redning", () => {
  const races = [open("J1", "junior")];
  const riders = [rider("u1", "u23"), ...Array.from({ length: 6 }, (_, i) => rider(`j${i}`, "junior"))];
  const entries = [
    { race_id: "J1", team_id: "A", rider_id: "u1" },
    ...Array.from({ length: 6 }, (_, i) => ({ race_id: "J1", team_id: "A", rider_id: `j${i}` })),
  ];
  const { units } = findOffSquadEntries({ races, entries, riders });
  assert.equal(units[0].remaining, 6);
  assert.equal(units[0].belowFloor, false);
});

test("#5903 deleteOffSquadEntries: én delete pr. rytter, kun de fundne løb", async () => {
  const deletes = [];
  const supabase = {
    from(table) {
      assert.equal(table, "race_entries");
      return {
        delete() {
          const f = {};
          const api = {
            eq(c, v) { f[c] = v; return api; },
            in(c, v) { f[c] = v; return api; },
            then(res, rej) { deletes.push(f); return Promise.resolve({ error: null }).then(res, rej); },
          };
          return api;
        },
      };
    },
  };
  const keepAll = async (_s, { raceIds }) => raceIds;
  const res = await deleteOffSquadEntries(supabase, [
    { race_id: "J1", rider_id: "u1" }, { race_id: "J2", rider_id: "u1" }, { race_id: "U1", rider_id: "s1" },
  ], { recheck: keepAll });
  assert.equal(res.deleted, 3);
  assert.deepEqual(deletes, [{ rider_id: "u1", race_id: ["J1", "J2"] }, { rider_id: "s1", race_id: ["U1"] }]);
});

test("#5903 deleteOffSquadEntries: genberegningen afgør; ændret siden snapshot = sprunget over", async () => {
  const deletes = [];
  const supabase = { from() { return { delete() { const f = {}; const api = { eq(c, v) { f[c] = v; return api; }, in(c, v) { f[c] = v; return api; }, then(res, rej) { deletes.push(f); return Promise.resolve({ error: null }).then(res, rej); } }; return api; } }; } };
  // u1 er imens flyttet til løbets trup (intet tilbage); s1: kun U1 er stadig forkert.
  const recheck = async (_s, { riderId }) => (riderId === "u1" ? [] : ["U1"]);
  const res = await deleteOffSquadEntries(supabase, [
    { race_id: "J1", rider_id: "u1" }, { race_id: "U1", rider_id: "s1" }, { race_id: "U2", rider_id: "s1" },
  ], { recheck });
  assert.equal(res.deleted, 1);
  assert.equal(res.skipped, 2);
  assert.deepEqual(deletes, [{ rider_id: "s1", race_id: ["U1"] }]);
});

test("#5903 recheckRider: rytter flyttet til løbets trup eller løb startet → intet at slette", async () => {
  const state = {
    riders: { id: "u1", team_id: "A", squad: "junior", is_academy: true, is_retired: false }, // nu junior
    races: [open("J1", "junior"), { id: "U9", squad: "u23", status: "scheduled", stages_completed: 1 }],
    race_entries: [{ race_id: "J1", team_id: "A", rider_id: "u1" }, { race_id: "U9", team_id: "A", rider_id: "u1" }],
  };
  const supabase = {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, in() { return api; },
        maybeSingle() { return Promise.resolve({ data: state[table], error: null }); },
        then(res, rej) { return Promise.resolve({ data: state[table], error: null }).then(res, rej); },
      };
      return api;
    },
  };
  assert.deepEqual(await recheckRider(supabase, { riderId: "u1", raceIds: ["J1", "U9"] }), []);
  state.riders = { ...state.riders, squad: "u23" }; // tilbage i U23: J1 er forkert igen, U9 er startet
  assert.deepEqual(await recheckRider(supabase, { riderId: "u1", raceIds: ["J1", "U9"] }), ["J1"]);
});

test("#5903 parseArgs: --apply kræver præcis ejer-go-token", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.ok(parseArgs(["--apply"]).error);
  assert.ok(parseArgs(["--apply", "--owner-go=forkert"]).error);
  assert.deepEqual(parseArgs(["--apply", `--owner-go=${OWNER_GO_TOKEN}`]), { apply: true });
});
