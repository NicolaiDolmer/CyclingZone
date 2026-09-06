// backend/scripts/v4DescentIncidents.test.js
// Tests for nedkoersels-uheld-maalingen (#4905). Samme praecedens som
// v4TailSpread.test.js: maaleredskabet skal selv vaere testet foer et tal
// fra det bruges som argument.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  measureDescentIncidents,
  summarizeDescentIncidents,
  withForcedWeather,
} from "./v4DescentIncidents.js";

// ── measureDescentIncidents ──────────────────────────────────────────────────

function stageOutput(events) {
  return { timeline: { events } };
}

test("measureDescentIncidents: taeller angreb PR. ANGRIBER (rider_ids.length), ikke pr. event", () => {
  const output = stageOutput([
    { km: 40, type: "finale_attack", params: { direction: "descent", rider_ids: ["a", "b", "c"] } },
  ]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 3, incidents: 0 });
});

test("measureDescentIncidents: kun descent-retningen taeller — climb/finale-angreb ignoreres", () => {
  const output = stageOutput([
    { km: 20, type: "finale_attack", params: { direction: "climb", rider_ids: ["a", "b"] } },
    { km: 40, type: "finale_attack", params: { direction: "descent", rider_ids: ["c"] } },
  ]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 1, incidents: 0 });
});

test("measureDescentIncidents: kun cause:descent_attack taeller som uheld — andre incident-causes ignoreres", () => {
  const output = stageOutput([
    { km: 40, type: "finale_attack", params: { direction: "descent", rider_ids: ["a", "b"] } },
    { km: 41, type: "incident", params: { rider_id: "a", cause: "descent_attack" } },
    { km: 42, type: "incident", params: { rider_id: "x", kind: "mechanical", outcome: "time_loss" } },
  ]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 2, incidents: 1 });
});

test("measureDescentIncidents: ingen events => 0/0, ikke en fejl", () => {
  assert.deepEqual(measureDescentIncidents(stageOutput([])), { attacks: 0, incidents: 0 });
});

test("measureDescentIncidents: rider_ids i et ukendt format falder tilbage til 1 angreb (defensivt, taeller aldrig for lidt)", () => {
  const output = stageOutput([{ km: 10, type: "finale_attack", params: { direction: "descent" } }]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 1, incidents: 0 });
});

// ── withForcedWeather ─────────────────────────────────────────────────────────

test("withForcedWeather: overskriver KUN kind, bevarer wind_exposure", () => {
  const route = { distance_km: 100, weather: { kind: "sun", wind_exposure: 0.42 } };
  const forced = withForcedWeather(route, "rain");
  assert.deepEqual(forced.weather, { kind: "rain", wind_exposure: 0.42 });
  assert.equal(forced.distance_km, 100, "resten af ruten er uroert");
});

test("withForcedWeather: uden weatherKind returneres ruten UROERT (samme reference)", () => {
  const route = { distance_km: 100, weather: { kind: "sun", wind_exposure: 0.42 } };
  assert.strictEqual(withForcedWeather(route, null), route);
  assert.strictEqual(withForcedWeather(route, undefined), route);
});

test("withForcedWeather: manglende wind_exposure falder tilbage til 0.2", () => {
  const route = { distance_km: 100 };
  assert.deepEqual(withForcedWeather(route, "wind").weather, { kind: "wind", wind_exposure: 0.2 });
});

// ── summarizeDescentIncidents ─────────────────────────────────────────────────

test("summarizeDescentIncidents: aggregerer attacks/incidents pr. noegle og regner uheld-pr-100-angreb", () => {
  const measurements = [
    { weatherKind: "rain", attacks: 50, incidents: 2 },
    { weatherKind: "rain", attacks: 50, incidents: 3 },
    { weatherKind: "sun", attacks: 100, incidents: 0 },
  ];
  const rows = summarizeDescentIncidents(measurements);
  const rain = rows.find((r) => r.key === "rain");
  const sun = rows.find((r) => r.key === "sun");
  assert.deepEqual(rain, { key: "rain", n: 2, attacks: 100, incidents: 5, incidentsPer100Attacks: 5 });
  assert.deepEqual(sun, { key: "sun", n: 1, attacks: 100, incidents: 0, incidentsPer100Attacks: 0 });
});

test("summarizeDescentIncidents: 0 angreb i cellen giver incidentsPer100Attacks = null, ikke NaN/Infinity", () => {
  const rows = summarizeDescentIncidents([{ weatherKind: "sun", attacks: 0, incidents: 0 }]);
  assert.equal(rows[0].incidentsPer100Attacks, null);
});

test("summarizeDescentIncidents: raekkerne er sorteret paa noeglen (deterministisk output)", () => {
  const rows = summarizeDescentIncidents([
    { weatherKind: "sun", attacks: 1, incidents: 0 },
    { weatherKind: "rain", attacks: 1, incidents: 0 },
    { weatherKind: "overcast", attacks: 1, incidents: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ["overcast", "rain", "sun"]);
});

test("summarizeDescentIncidents: custom keyFn grupperer pr. etapetype x vejr", () => {
  const rows = summarizeDescentIncidents(
    [
      { profileType: "mountain", weatherKind: "rain", attacks: 10, incidents: 1 },
      { profileType: "hilly", weatherKind: "rain", attacks: 10, incidents: 0 },
    ],
    (m) => `${m.profileType} | ${m.weatherKind}`,
  );
  assert.deepEqual(rows.map((r) => r.key).sort(), ["hilly | rain", "mountain | rain"]);
});
