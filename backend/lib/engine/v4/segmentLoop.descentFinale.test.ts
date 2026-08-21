// Regressionstest for descent-som-finale-segment (fundet af golden fixture 4, 21/8):
// M3-angreb paa etapens SIDSTE segment gav angrebsgruppen negativt gap, og
// finale-opgoerets frontPool-filter (gap_seconds === 0) tabte angriberne helt —
// de beholdt init-vaerdier (time_seconds 0, group_id peloton-0). Fixet er
// rebaseline FOER finale-hooket i segmentLoop.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { simulateStageV4 } from "./index.ts";
import type { StageInput } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(
  readFileSync(path.join(here, "fixtures", "nedkoerselsfinale", "input.json"), "utf8"),
) as StageInput;

test("descent som sidste segment: angribere falder ikke ud af finale-opgoerelsen", () => {
  // Samme scenarie som fixture 4, men UDEN det flade indkoerselssegment —
  // nedkoerslen ER finalen. Det er praecis kollisionsmoenstret.
  const input: StageInput = {
    ...base,
    route: {
      ...base.route,
      distance_km: 68,
      segments: base.route.segments.filter((s) => s.to_km <= 68),
    },
  };
  const out = simulateStageV4(input);

  assert.equal(out.results.length, input.startlist.length);
  for (const r of out.results) {
    assert.ok(r.time_seconds > 0, `rytter ${r.rider_id} har time_seconds=${r.time_seconds} (init-vaerdi = bug)`);
    assert.equal(r.status, "finished");
  }
  // Determinisme paa selve moenstret: to koersler er byte-identiske.
  assert.deepEqual(simulateStageV4(input), out);
});
