import test from "node:test";
import assert from "node:assert/strict";

import { planRepairs, REPLACEMENT_PROFILE } from "./repairDuplicateItt.js";
import { DEMAND_VECTORS } from "../lib/raceStageProfileGenerator.js";

// Mock for repair-stien:
//   races.select().eq().order().range()
//   race_stage_profiles.select().in().order().range()
// Begge er paginerede single-page reads i disse tests (data.length < 1000).
function makeMock({ races = [], profiles = [] } = {}) {
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      order() { return b; },
      range() {
        if (table === "races") return Promise.resolve({ data: races, error: null });
        if (table === "race_stage_profiles") return Promise.resolve({ data: profiles, error: null });
        return Promise.resolve({ data: [], error: null });
      },
    };
    return b;
  }
  return { from };
}

function makeRace(id, { name = `Race ${id}`, stages = 8, stages_completed = 0, status = "scheduled" } = {}) {
  return { id, name, race_type: "stage_race", stages, stages_completed, status };
}

function makeProfile(id, race_id, stage_number, profile_type, distance_km) {
  return { id, race_id, stage_number, profile_type, distance_km, finale_type: profile_type === "itt" || profile_type === "itt_hilly" ? "solo_tt" : null, demand_vector: DEMAND_VECTORS[profile_type] };
}

test("no findings when no duplicate time trial pairs exist", async () => {
  const races = [makeRace("r1")];
  const profiles = [
    makeProfile("p1", "r1", 1, "itt", 20),
    makeProfile("p2", "r1", 3, "itt_hilly", 20), // forskellig type → ikke duplikat
  ];
  const supabase = makeMock({ races, profiles });

  const plan = await planRepairs({ supabase });
  assert.equal(plan.duplicate_pairs, 0);
  assert.equal(plan.fixable, 0);
  assert.equal(plan.blocked, 0);
});

test("La Course au Soleil-mønstret: finder parret og foreslår itt_hilly for det SENESTE (etape 3)", async () => {
  const races = [makeRace("r1", { name: "La Course au Soleil", stages: 8, stages_completed: 0 })];
  const profiles = [
    makeProfile("p1", "r1", 1, "itt", 20),
    makeProfile("p2", "r1", 2, "rolling", 170),
    makeProfile("p3", "r1", 3, "itt", 20),
  ];
  const supabase = makeMock({ races, profiles });

  const plan = await planRepairs({ supabase });
  assert.equal(plan.duplicate_pairs, 1);
  assert.equal(plan.fixable, 1);
  assert.equal(plan.blocked, 0);

  const item = plan.items[0];
  assert.equal(item.stage_a.stage_number, 1);
  assert.equal(item.stage_b.stage_number, 3);
  assert.equal(item.stage_b.id, "p3");
  assert.equal(item.proposed_profile_type, REPLACEMENT_PROFILE.itt);
  assert.deepEqual(item.proposed_demand_vector, DEMAND_VECTORS[REPLACEMENT_PROFILE.itt]);
});

test("nægter at røre en etape der allerede er kørt (stages_completed)", async () => {
  const races = [makeRace("r1", { stages: 8, stages_completed: 3 })]; // etape 1-3 er kørt
  const profiles = [
    makeProfile("p1", "r1", 1, "itt", 20),
    makeProfile("p2", "r1", 3, "itt", 20), // target — men allerede kørt
  ];
  const supabase = makeMock({ races, profiles });

  const plan = await planRepairs({ supabase });
  assert.equal(plan.duplicate_pairs, 1);
  assert.equal(plan.fixable, 0);
  assert.equal(plan.blocked, 1);
  assert.equal(plan.items[0].blocked, true);
  assert.match(plan.items[0].block_reason, /allerede kørt/);
  assert.equal(plan.items[0].proposed_profile_type, null);
});

test("itt_hilly-par foreslås rettet til itt (omvendt retning af markSecondIttAsHilly)", async () => {
  const races = [makeRace("r1")];
  const profiles = [
    makeProfile("p1", "r1", 2, "itt_hilly", 35),
    makeProfile("p2", "r1", 6, "itt_hilly", 36),
  ];
  const supabase = makeMock({ races, profiles });

  const plan = await planRepairs({ supabase });
  assert.equal(plan.fixable, 1);
  assert.equal(plan.items[0].proposed_profile_type, "itt");
});

test("flere løb med forskellige udfald rapporteres uafhængigt", async () => {
  const races = [
    makeRace("clean", { name: "Clean Race" }),
    makeRace("dup", { name: "Dup Race" }),
  ];
  const profiles = [
    makeProfile("c1", "clean", 1, "itt", 20),
    makeProfile("c2", "clean", 4, "mountain", 190),
    makeProfile("d1", "dup", 1, "itt", 25),
    makeProfile("d2", "dup", 5, "itt", 27), // inden for TT_LOOKALIKE_DISTANCE_BAND_KM (8)
  ];
  const supabase = makeMock({ races, profiles });

  const plan = await planRepairs({ supabase });
  assert.equal(plan.races_scanned, 2);
  assert.equal(plan.duplicate_pairs, 1);
  assert.equal(plan.items[0].race_id, "dup");
});
