import { test } from "node:test";
import assert from "node:assert/strict";
import { youthSquadRoom, youthSquadRooms, YOUTH_SQUAD_ORDER } from "./youthSquadRoom.js";
import { SQUAD_CAPS } from "./squads.js";

// Minimal supabase-mock: head-count på riders filtreret på team_id + squad.
function mockSupabase(countsBySquad) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "riders");
      const filters = {};
      const builder = {
        select(_cols, opts) {
          assert.deepEqual(opts, { count: "exact", head: true });
          return builder;
        },
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        then(resolve, reject) {
          calls.push({ ...filters });
          return Promise.resolve({ count: countsBySquad[filters.squad] ?? 0, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test("youthSquadRoom: tæller MÅL-truppen og giver dens eget loft fra SQUAD_CAPS", async () => {
  const supabase = mockSupabase({ u23: 8, junior: 3 });
  assert.deepEqual(await youthSquadRoom(supabase, { teamId: "team-A", squad: "u23" }), { squad: "u23", used: 8, max: SQUAD_CAPS.u23 });
  assert.deepEqual(await youthSquadRoom(supabase, { teamId: "team-A", squad: "junior" }), { squad: "junior", used: 3, max: SQUAD_CAPS.junior });
  assert.deepEqual(supabase.calls, [{ team_id: "team-A", squad: "u23" }, { team_id: "team-A", squad: "junior" }]);
});

test("youthSquadRoom: senior eller tastefejl er en programmeringsfejl", async () => {
  const supabase = mockSupabase({});
  await assert.rejects(() => youthSquadRoom(supabase, { teamId: "t", squad: "senior" }), /invalid_squad/);
  await assert.rejects(() => youthSquadRoom(supabase, { teamId: "t", squad: "U23" }), /invalid_squad/);
  assert.equal(supabase.calls.length, 0);
});

test("youthSquadRooms: begge trupper, U23 først", async () => {
  assert.deepEqual([...YOUTH_SQUAD_ORDER], ["u23", "junior"]);
  const rooms = await youthSquadRooms(mockSupabase({ u23: 5, junior: 10 }), "team-B");
  assert.deepEqual(rooms, { u23: { used: 5, max: SQUAD_CAPS.u23 }, junior: { used: 10, max: SQUAD_CAPS.junior } });
  assert.deepEqual(Object.keys(rooms), ["u23", "junior"]);
});
