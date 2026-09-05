import test from "node:test";
import assert from "node:assert/strict";

import { isStaleJerseyGoal } from "./audit-4377-board-goal-counters.js";

// #4377 · Reproducerer spillerrapportens root-cause-prædikat isoleret:
// et sprint_kommerciel-DNA jersey_wins-mål der IKKE bærer cumulative:true er
// den præcise, pre-migration tilstand der fik målet til at nulstilles hvert
// sæsonskifte ("trøjer 0/2 selvom trøjer blev vundet sidste sæson").
test("#4377 · flager club_dna jersey_wins-mål uden cumulative:true som stale", () => {
  assert.equal(isStaleJerseyGoal({ type: "jersey_wins", source: "club_dna", target: 2 }), true);
  assert.equal(isStaleJerseyGoal({ type: "jersey_wins", source: "club_dna", target: 2, cumulative: false }), true);
});

test("#4377 · flager IKKE et repareret/nyt club_dna jersey_wins-mål med cumulative:true", () => {
  assert.equal(isStaleJerseyGoal({ type: "jersey_wins", source: "club_dna", target: 2, cumulative: true }), false);
});

test("#4377 · rører ALDRIG andre måltyper eller ikke-club_dna jersey_wins-mål (ingen falsk positiv)", () => {
  assert.equal(isStaleJerseyGoal({ type: "stage_wins", source: "club_dna" }), false);
  assert.equal(isStaleJerseyGoal({ type: "jersey_wins", source: "generated" }), false);
  assert.equal(isStaleJerseyGoal(null), false);
  assert.equal(isStaleJerseyGoal(undefined), false);
});
