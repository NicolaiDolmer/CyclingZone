import test from "node:test";
import assert from "node:assert/strict";

import { maskPullCandidate, rosterPrognosis } from "./academyIntake2View.ts";
import { KNOWLEDGE_DAYS } from "./academyProspectKnowledge.ts";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";

test("maskPullCandidate: intet potentiale forlader serveren for en hentet kandidat (punkt 1)", () => {
  const item = { source: "pull", potentialEstimate: { lo: 2, hi: 3 }, potentialBand: { prog: { lo: 40, hi: 60 } } };
  const masked = maskPullCandidate(item);
  assert.equal(masked.potentialEstimate, null);
  assert.equal(masked.potentialBand, null);
  assert.equal(masked.potentialLearned, true);
  // Bestyrelsens gave og gamle tilbud er uroerte.
  const gift = { source: "board_gift", potentialBand: { prog: { lo: 1, hi: 2 } } };
  assert.equal(maskPullCandidate(gift), gift);
});

const abilities = {
  rider_id: "r1",
  ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 30 + (i % 5) * 3])),
  climbing: 45,
};
const base = {
  rider: { id: "r1", birthdate: "2010-06-15" },
  abilities,
  potRow: { potentiale: 4, birthdate: "2010-06-15", primary_type: "climber", secondary_type: "gc" },
  speed: 1,
  seasonNumber: 4,
  teamId: "t1",
  scout: null,
};

test("rosterPrognosis: intet baand foer de foerste traeningsloebsdage", () => {
  const p = rosterPrognosis({ ...base, daysOnTeam: 3 });
  assert.equal(p.stage, "learning");
  assert.equal(p.band, null);
  assert.equal(p.daysOnTeam, 3);
});

test("rosterPrognosis: baandet snaevrer ind med traeningsloebsdage paa holdet", () => {
  const broad = rosterPrognosis({ ...base, daysOnTeam: KNOWLEDGE_DAYS.broad });
  const final = rosterPrognosis({ ...base, daysOnTeam: KNOWLEDGE_DAYS.final });
  assert.equal(broad.stage, "broad");
  assert.equal(final.stage, "final");
  assert.ok(broad.band && final.band, "baandet beregnes fra de afledte evner");
  assert.equal(final.band.role, "climber");
  assert.ok(final.band.hi - final.band.lo <= broad.band.hi - broad.band.lo, "endeligt baand er aldrig bredere end det brede");
});
