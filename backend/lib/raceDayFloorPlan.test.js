import test from "node:test";
import assert from "node:assert/strict";
import {
  peakConcurrentNeed, countFieldableRaces, floorAwareRescueCap, loadSameDaySiblingNeeds,
} from "./raceDayFloorPlan.js";

const day = (d) => ({ start: d, end: d, days: [d] });

test("#7339 peakConcurrentNeed: samme dag lægges sammen, hver sin dag gør ikke", () => {
  assert.equal(peakConcurrentNeed([{ window: day(3), need: 6 }, { window: day(3), need: 6 }]), 12);
  assert.equal(peakConcurrentNeed([{ window: day(3), need: 6 }, { window: day(4), need: 6 }]), 6);
  assert.equal(peakConcurrentNeed([
    { window: { start: 1, end: 3, days: [1, 2, 3] }, need: 6 }, { window: day(2), need: 4 }, { window: day(5), need: 6 },
  ]), 10);
  assert.equal(peakConcurrentNeed([]), 0);
});

test("#7339 countFieldableRaces: truppens kapacitet en løbsdag", () => {
  assert.equal(countFieldableRaces({ supply: 16, races: 3, floor: 6 }), 2);
  assert.equal(countFieldableRaces({ supply: 18, races: 3, floor: 6 }), 3);
  assert.equal(countFieldableRaces({ supply: 40, races: 3, floor: 6 }), 3);
  assert.equal(countFieldableRaces({ supply: 5, races: 2, floor: 6 }), 0);
});

test("#7339 floorAwareRescueCap: fylder hele løb først (16 → 8+8+0, 18 → 6+6+6)", () => {
  const rescue = (supply, siblings) => floorAwareRescueCap({ max: 8, supply, floor: 6, siblings });
  // 16 frie, to tomme søsterløb samme dag: kun ét af dem kan også stilles op → 8 her.
  assert.equal(rescue(16, [{ window: day(7), need: 6 }, { window: day(7), need: 6 }]), 8);
  // 18 frie: alle tre kan stilles op → kun gulvet her.
  assert.equal(rescue(18, [{ window: day(7), need: 6 }, { window: day(7), need: 6 }]), 6);
  // Søsterløb der allerede står på gulvet har need 0 og reserverer intet.
  assert.equal(rescue(16, [{ window: day(7), need: 0 }]), 8);
  // Et søsterløb med 3 manuelle mangler kun 3.
  assert.equal(rescue(12, [{ window: day(7), need: 3 }]), 8);
  assert.equal(rescue(10, [{ window: day(7), need: 3 }]), 7);
});

test("#7339 floorAwareRescueCap: uden søsterløb eller under gulvet = gammel adfærd", () => {
  assert.equal(floorAwareRescueCap({ max: 8, supply: 18, floor: 6 }), 8);
  assert.equal(floorAwareRescueCap({ max: 8, supply: 18, floor: 6, siblings: undefined }), 8);
  assert.equal(floorAwareRescueCap({ max: 8, supply: 4, floor: 6, siblings: [{ window: day(1), need: 6 }] }), 8);
});

// Minimal thenable query-builder: filtrerer state-rækker på eq/neq/in/is.
function makeSupabase(state, { failTable = null } = {}) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(col, v) { filters.push((r) => r[col] === v); return q; },
        neq(col, v) { filters.push((r) => r[col] !== v); return q; },
        is(col, v) { filters.push((r) => (r[col] ?? null) === v); return q; },
        in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
        order() { return q; },
        then(resolve) {
          if (table === failTable) return resolve({ data: null, error: { message: `${table} down` } });
          return resolve({ data: (state[table] || []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return q;
    },
  };
}

function siblingState() {
  const races = ["R", "A", "B", "X", "U"].map((id) => ({
    id, season_id: "s1", league_division_id: 5, stages_completed: 0, squad: id === "U" ? "u23" : "senior",
  }));
  races.find((r) => r.id === "X").league_division_id = 9; // anden pulje
  return {
    races: [...races, { id: "S", season_id: "s1", league_division_id: 5, stages_completed: 2, squad: "senior" }],
    race_stage_schedule: [
      ...["R", "A", "X", "U", "S"].map((race_id) => ({ race_id, stage_number: 1, scheduled_at: "2026-11-02T10:00:00Z", game_day: 30 })),
      { race_id: "B", stage_number: 1, scheduled_at: "2026-11-03T10:00:00Z", game_day: 31 }, // anden løbsdag
    ],
    race_entries: [
      { race_id: "A", team_id: "t2", rider_id: "x1" }, { race_id: "A", team_id: "t2", rider_id: "x2" },
    ],
    race_withdrawals: [{ race_id: "A", team_id: "t3" }],
    race_entry_clears: [],
  };
}

test("#7339 loadSameDaySiblingNeeds: kun senior, samme pulje, samme dag, ikke startet, ikke afmeldt", async () => {
  const race = { id: "R", season_id: "s1", league_division_id: 5, squad: "senior" };
  const needs = await loadSameDaySiblingNeeds({
    supabase: makeSupabase(siblingState()), race, thisWindow: day(30), teamIds: ["t1", "t2", "t3"],
  });
  assert.deepEqual(needs.get("t1")?.map((n) => [n.raceId, n.need]), [["A", 6]]);
  assert.deepEqual(needs.get("t2")?.map((n) => [n.raceId, n.need]), [["A", 4]], "2 ryttere står allerede i A");
  assert.equal(needs.has("t3"), false, "afmeldt fra A → intet behov");
});

test("#7339 loadSameDaySiblingNeeds: læsefejl giver tomt kort (gammel adfærd), aldrig en væltet start", async () => {
  const race = { id: "R", season_id: "s1", league_division_id: 5, squad: "senior" };
  const needs = await loadSameDaySiblingNeeds({
    supabase: makeSupabase(siblingState(), { failTable: "race_entries" }), race, thisWindow: day(30), teamIds: ["t1"],
  });
  assert.equal(needs.size, 0);
});

test("#7339 loadSameDaySiblingNeeds: ungdomsløb og løb uden vindue springes over", async () => {
  const supabase = makeSupabase(siblingState());
  assert.equal((await loadSameDaySiblingNeeds({ supabase, race: { id: "U", season_id: "s1", squad: "u23" }, thisWindow: day(30), teamIds: ["t1"] })).size, 0);
  assert.equal((await loadSameDaySiblingNeeds({ supabase, race: { id: "R", season_id: "s1", league_division_id: 5 }, thisWindow: null, teamIds: ["t1"] })).size, 0);
});
