import test from "node:test";
import assert from "node:assert/strict";
import { academyEstimate, loadAcademyPrognoses } from "./academyDisclosure.ts";

const learning: import("./academyIntake2View.ts").RosterPrognosis = { stage: "learning", daysOnTeam: 0, nextStageDays: 1, band: null };
test("academy estimates contain only the academy prognosis, never scout stars or labels", () => {
  assert.deepEqual(academyEstimate(learning), { academyPrognosis: learning });
  const learned: import("./academyIntake2View.ts").RosterPrognosis = { ...learning, stage: "broad", band: { role: "climber", lo: 31, hi: 57 } };
  assert.deepEqual(academyEstimate(learned), { academyPrognosis: learned });
});
test("foreign and senior riders never enter academy disclosure; flag off performs no reads", async () => {
  const db = { from() { throw new Error("unexpected read"); } };
  for (const enabled of [false, true]) {
    const out = await loadAcademyPrognoses(db, { enabled, teamId: "own", riders: [
      { id: "senior", team_id: "own", is_academy: false },
      { id: "foreign", team_id: "other", is_academy: true },
    ], abilitiesByRider: new Map(), seasonNumber: 4, scout: null });
    assert.equal(out.size, 0);
  }
});

import { rosterPrognosis } from "./academyIntake2View.ts";
import { KNOWLEDGE_DAYS } from "./academyProspectKnowledge.ts";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
const rider = { id: "academy", team_id: "own", is_academy: true, potentiale: 4,
  birthdate: "2010-06-15", primary_type: "climber", secondary_type: "gc" };
const abilities = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, 35]));
function database(days: number, fail = false) {
  return { from(table: string) {
    const result = table === "rider_training_scores"
      ? { count: days, error: fail ? { message: "unavailable" } : null }
      : { data: [], error: null };
    const query: any = { select() { return query; }, eq() { return query; },
      then(resolve: any) { return Promise.resolve(result).then(resolve); } };
    return query;
  } };
}
for (const days of [0, KNOWLEDGE_DAYS.broad, KNOWLEDGE_DAYS.narrow, KNOWLEDGE_DAYS.final]) {
  test(`all academy stages equal the academy roster calculation (${days} training days)`, async () => {
    const result = await loadAcademyPrognoses(database(days), { enabled: true, teamId: "own",
      riders: [rider], abilitiesByRider: new Map([[rider.id, abilities]]), seasonNumber: 4, scout: null });
    assert.deepEqual(result.get(rider.id), rosterPrognosis({ rider, abilities, potRow: rider,
      daysOnTeam: days, speed: 1, seasonNumber: 4, teamId: "own", scout: null }));
  });
}
test("missing knowledge fails closed instead of falling back to the full scouting estimate", async () => {
  await assert.rejects(loadAcademyPrognoses(database(0, true), { enabled: true, teamId: "own",
    riders: [rider], abilitiesByRider: new Map(), seasonNumber: 4, scout: null }), /unavailable/);
});

import { isAcademyKnowledgeEnabled } from "./academyDisclosure.ts";
for (const value of [null, "unknown"]) {
  test(`unavailable or unknown flag cannot reopen full scouting (${value})`, async () => {
    const db = { from() { const q: any = { select() { return q; }, eq() { return q; },
      maybeSingle: async () => ({ data: { value }, error: null }) }; return q; } };
    await assert.rejects(isAcademyKnowledgeEnabled(db), /flag unavailable/);
  });
}
test("flag network failure cannot reopen full scouting", async () => {
  await assert.rejects(isAcademyKnowledgeEnabled({ from() { throw new Error("offline"); } }), /flag unavailable/);
});
