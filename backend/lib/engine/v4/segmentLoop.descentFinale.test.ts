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
import { validateTimelineEvents } from "./timeline.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
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

// ── #4934: nedkoersels-styrt gaar gennem uheldstrappen, ende-til-ende ────────

/**
 * Produktions-risikoen for et nedkoersels-styrt er lav med vilje (maal ~1-2 %
 * uheld pr. etape), saa en ende-til-ende-test paa den ville vaere groen uanset
 * om koblingen fandtes. Vi haever basis-risikoen via tuning'en — samme
 * spread-teknik som segmentLoop.weather.test.ts's risiko-arm — og maaler DEN
 * forskel koblingen goer. Tallet er ikke en kalibrerings-paastand.
 */
const LOUD_DESCENT_RISK_TUNING = {
  ...RACE_V4_TUNING,
  descent: { ...RACE_V4_TUNING.descent, incidentRiskBase: 0.6 },
};

test("#4934: et descent-styrt i den fulde motor koster tid og efterlader tidslinjen konsistent", () => {
  const input: StageInput = { ...base, tuning: LOUD_DESCENT_RISK_TUNING };
  const out = simulateStageV4(input);

  const descentIncidents = out.timeline.events.filter(
    (e) => e.type === "incident" && (e.params as { cause?: string }).cause === "descent_attack",
  );
  assert.ok(descentIncidents.length > 0, "den haevede risiko skal producere mindst ét nedkoersels-styrt");

  for (const e of descentIncidents) {
    const params = e.params as Record<string, unknown>;
    assert.equal(params.kind, "crash", "en nedkoersel giver et STYRT, aldrig en mekanisk defekt");
    assert.ok(
      ["light", "hard", "serious"].includes(String(params.severity)),
      `uheldet skal baere et alvorstrin fra trappen (fik ${String(params.severity)})`,
    );
    if (params.outcome === "time_loss") {
      assert.ok(Number(params.time_loss_seconds) > 0, "et ubeskyttet styrt skal koste tid");
    }
  }

  // Trappen skal vaere synlig i RESULTATET, ikke kun i tidslinjen.
  const victimIds = new Set(descentIncidents.map((e) => (e.params as { rider_id: string }).rider_id));
  assert.ok(
    out.results.some((r) => victimIds.has(r.rider_id) && (r.status !== "finished" || (r.injury_days ?? 0) > 0))
      || out.incidents?.some((i) => victimIds.has(i.rider_id)),
    "uheldet skal vaere bogfoert i output (incidents[]/status/injury_days), ikke kun som event",
  );

  // Invariant 4 (km-daekning + taksonomi) og invariant 6 (laast feltstoerrelse).
  const violations = validateTimelineEvents(out.timeline.events, {
    distanceKm: input.route.distance_km,
    knownRiderIds: new Set(input.startlist.map((e) => e.rider_id)),
  });
  assert.deepEqual(violations, [], `tidslinje-overtraedelser: ${JSON.stringify(violations)}`);
  assert.equal(out.results.length, input.startlist.length);
  assert.equal(new Set(out.results.map((r) => r.rider_id)).size, input.startlist.length);
});
