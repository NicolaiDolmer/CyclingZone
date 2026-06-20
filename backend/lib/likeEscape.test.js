// Kontrakt-test for P4-fixet (#1338): LIKE/ILIKE-wildcards i bruger-input til et
// EXACT-match-check skal escapes, så de ikke virker som wildcards.

import test from "node:test";
import assert from "node:assert/strict";

import { likeEscape } from "./likeEscape.js";
import { upsertOwnTeamProfile } from "./teamProfileEngine.js";

// --- Direkte enhedstest af escaping ---

test("likeEscape — escaper % som literal", () => {
  assert.equal(likeEscape("100%"), "100\\%");
});

test("likeEscape — escaper _ som literal", () => {
  assert.equal(likeEscape("Te_m"), "Te\\_m");
});

test("likeEscape — escaper backslash før wildcards (ingen dobbelt-escape)", () => {
  assert.equal(likeEscape("a\\b"), "a\\\\b");
  assert.equal(likeEscape("\\%"), "\\\\\\%");
});

test("likeEscape — lader almindelige tegn være urørte", () => {
  assert.equal(likeEscape("Team Nova"), "Team Nova");
});

test("likeEscape — håndterer null/undefined uden at kaste", () => {
  assert.equal(likeEscape(null), "");
  assert.equal(likeEscape(undefined), "");
});

// --- Regression: ensureUniqueTeamName sender en escaped pattern til .ilike() ---
// En supabase-double der fanger den værdi der sendes til .ilike("name", ...).

function createIlikeCapturingSupabase() {
  const captured = { ilikeValues: [] };
  function selectQuery(table) {
    const q = {
      select() { return q; },
      eq() { return q; },
      limit() { return q; },
      ilike(column, value) {
        if (table === "teams" && column === "name") captured.ilikeValues.push(value);
        return q;
      },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return q;
  }
  const supabase = {
    captured,
    from(table) {
      return {
        select() { return selectQuery(table); },
        update() {
          const q = { eq() { return q; }, select() { return q; }, single() { return Promise.resolve({ data: { id: "t1" }, error: null }); } };
          return q;
        },
        insert() {
          const q = {
            select() { return q; },
            single() { return Promise.resolve({ data: { id: "t1", name: "x", manager_name: "y" }, error: null }); },
            then(resolve) { return Promise.resolve({ data: { id: "t1" }, error: null }).then(resolve); },
          };
          return q;
        },
      };
    },
  };
  return supabase;
}

test("ensureUniqueTeamName — holdnavn med wildcards sendes escaped til .ilike() (#1338)", async () => {
  const supabase = createIlikeCapturingSupabase();
  await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "100% _Team",
    managerName: "Manager",
    // #1560: dette test verificerer kun ilike-escaping ved hold-oprettelse — stub
    // starter-squad-allokeringen (dækkes i starterSquadAllocator.test.js), så den
    // minimale mock ikke behøver riders/derive-kæden.
    allocateStarterSquad: async () => ({ assigned: 0, skipped: "test-noop" }),
  });

  assert.ok(supabase.captured.ilikeValues.length >= 1, ".ilike skal kaldes på teams.name i unikheds-checket");
  const pattern = supabase.captured.ilikeValues[0];
  assert.ok(!/(?<!\\)%/.test(pattern), "rå % må ikke nå .ilike (ville virke som wildcard)");
  assert.ok(!/(?<!\\)_/.test(pattern), "rå _ må ikke nå .ilike (ville virke som single-char wildcard)");
  assert.equal(pattern, "100\\% \\_Team");
});
