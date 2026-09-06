// backend/scripts/v4DescentIncidents.test.js
// Tests for nedkoersels-uheld-maalingen (#4905). Samme praecedens som
// v4TailSpread.test.js: maaleredskabet skal selv vaere testet foer et tal
// fra det bruges som argument.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  measureDescentIncidents,
  summarizeDescentIncidents,
  summarizeDescentSeverity,
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
  assert.deepEqual(measureDescentIncidents(output), { attacks: 3, incidents: 0, crashes: [] });
});

test("measureDescentIncidents: kun descent-retningen taeller — climb/finale-angreb ignoreres", () => {
  const output = stageOutput([
    { km: 20, type: "finale_attack", params: { direction: "climb", rider_ids: ["a", "b"] } },
    { km: 40, type: "finale_attack", params: { direction: "descent", rider_ids: ["c"] } },
  ]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 1, incidents: 0, crashes: [] });
});

test("measureDescentIncidents: kun cause:descent_attack taeller som uheld — andre incident-causes ignoreres", () => {
  const output = stageOutput([
    { km: 40, type: "finale_attack", params: { direction: "descent", rider_ids: ["a", "b"] } },
    {
      km: 41,
      type: "incident",
      params: { rider_id: "a", cause: "descent_attack", kind: "crash", severity: "light", outcome: "time_loss", time_loss_seconds: 12.5, injury_days: null },
    },
    { km: 42, type: "incident", params: { rider_id: "x", kind: "mechanical", outcome: "time_loss" } },
  ]);
  assert.deepEqual(measureDescentIncidents(output), {
    attacks: 2,
    incidents: 1,
    crashes: [{ severity: "light", outcome: "time_loss", timeLossSeconds: 12.5, injuryDays: null }],
  });
});

// ── summarizeDescentSeverity (#4934) ─────────────────────────────────────────

test("summarizeDescentSeverity: tidstab regnes KUN over uheld der faktisk kostede tid", () => {
  const rows = summarizeDescentSeverity([
    {
      crashes: [
        { severity: "light", outcome: "time_loss", timeLossSeconds: 10, injuryDays: null },
        { severity: "light", outcome: "time_loss", timeLossSeconds: 20, injuryDays: null },
        // Beskyttet: intet tidstab — maa ikke traekke gennemsnittet mod 0.
        { severity: "light", outcome: "protected_three_km_rule", timeLossSeconds: null, injuryDays: null },
      ],
    },
  ]);
  const light = rows.find((r) => r.severity === "light");
  assert.equal(light.n, 3);
  assert.equal(light.timeLossN, 2);
  assert.equal(light.meanTimeLossSeconds, 15);
  assert.equal(light.minTimeLossSeconds, 10);
  assert.equal(light.maxTimeLossSeconds, 20);
  assert.equal(light.protected, 1);
});

test("summarizeDescentSeverity: et alvorligt styrt taelles som udgaaet med skadedage, uden tidstab", () => {
  const rows = summarizeDescentSeverity([
    { crashes: [{ severity: "serious", outcome: "abandoned", timeLossSeconds: null, injuryDays: 9 }] },
    { crashes: [{ severity: "hard", outcome: "time_loss", timeLossSeconds: 120, injuryDays: 3 }] },
  ]);
  const serious = rows.find((r) => r.severity === "serious");
  const hard = rows.find((r) => r.severity === "hard");
  assert.equal(serious.abandoned, 1);
  assert.equal(serious.meanTimeLossSeconds, null, "en udgaaet rytter har ingen etapetid at tabe");
  assert.equal(serious.meanInjuryDays, 9);
  assert.equal(hard.meanTimeLossSeconds, 120);
  assert.equal(hard.meanInjuryDays, 3);
  assert.equal(serious.share, 0.5);
});

test("summarizeDescentSeverity: ingen uheld giver en tom raekke-liste, ikke en fejl", () => {
  assert.deepEqual(summarizeDescentSeverity([{ crashes: [] }, {}]), []);
});

test("summarizeDescentSeverity: raekkerne er sorteret paa trin (deterministisk output)", () => {
  const rows = summarizeDescentSeverity([
    { crashes: [{ severity: "serious", outcome: "abandoned", timeLossSeconds: null, injuryDays: 5 }] },
    { crashes: [{ severity: "light", outcome: "time_loss", timeLossSeconds: 5, injuryDays: null }] },
    { crashes: [{ severity: "hard", outcome: "time_loss", timeLossSeconds: 90, injuryDays: 2 }] },
  ]);
  assert.deepEqual(rows.map((r) => r.severity), ["hard", "light", "serious"]);
});

test("measureDescentIncidents: ingen events => 0/0, ikke en fejl", () => {
  assert.deepEqual(measureDescentIncidents(stageOutput([])), { attacks: 0, incidents: 0, crashes: [] });
});

test("measureDescentIncidents: rider_ids i et ukendt format falder tilbage til 1 angreb (defensivt, taeller aldrig for lidt)", () => {
  const output = stageOutput([{ km: 10, type: "finale_attack", params: { direction: "descent" } }]);
  assert.deepEqual(measureDescentIncidents(output), { attacks: 1, incidents: 0, crashes: [] });
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
