// #6050: breakaway_caught bærer hvem der hentede udbruddet (additivt, kun fortælling).
import { test } from "node:test";
import assert from "node:assert/strict";

import { catchActorParams } from "./breakaway.ts";
import type { Entrant } from "../types.ts";

const entrants = {
  a1: { team_id: "team-b" },
  a2: { team_id: "team-a" },
  a3: { team_id: "team-a" },
  a4: { team_id: "" },
} as unknown as Record<string, Entrant>;

test("catchActorParams: jagt-gruppe + sorterede hold med jagt-arbejde", () => {
  const work = new Map([["a1", 1], ["a2", 0.5], ["a3", 1], ["a4", 1]]);
  assert.deepEqual(catchActorParams({ id: "peloton-0", kind: "peloton" }, work, entrants), {
    chase_group_id: "peloton-0",
    chase_group_kind: "peloton",
    chasing_team_ids: ["team-a", "team-b"],
  });
});

test("catchActorParams: ingen jagt-arbejde udelader chasing_team_ids", () => {
  assert.deepEqual(catchActorParams({ id: "chase-4000", kind: "chase" }, undefined, entrants), {
    chase_group_id: "chase-4000",
    chase_group_kind: "chase",
  });
  const zero = new Map([["a1", 0]]);
  assert.equal("chasing_team_ids" in catchActorParams({ id: "peloton-0", kind: "peloton" }, zero, entrants), false);
});
