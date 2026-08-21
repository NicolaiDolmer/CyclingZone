// backend/lib/engine/v4/mechanics/weather.test.ts
// Kontrakt- + property-tests for M11 (vejr-laget). SSOT: mor-spec §4 M11 +
// §8 beslutning 13 ("vejr-teknik", ny stat, foedes skjult).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  weatherAdjustedRiskBase,
  weatherRiskMultiplier,
  weatherTechniqueDampening,
  weatherTechniqueProxy,
} from "./weather.ts";
import { WEATHER_EXTRA_TUNING } from "../tuning.ts";
import type { WeatherKind } from "../types.ts";

const KINDS: WeatherKind[] = ["sun", "overcast", "rain", "wind"];

// ── kontrakt: multiplikator aldrig under 1, regn > vind > sol/overskyet ────

test("weatherRiskMultiplier: altid >= 1 for alle kendte vejrtyper", () => {
  for (const kind of KINDS) {
    const m = weatherRiskMultiplier({ kind }, WEATHER_EXTRA_TUNING);
    assert.ok(m >= 1, `${kind} gav multiplikator ${m} < 1`);
  }
});

test("weatherRiskMultiplier: regn forstaerker risikoen MEST (mor-spec M11: 'regn forstaerker ... risiko')", () => {
  const rain = weatherRiskMultiplier({ kind: "rain" }, WEATHER_EXTRA_TUNING);
  const wind = weatherRiskMultiplier({ kind: "wind" }, WEATHER_EXTRA_TUNING);
  const sun = weatherRiskMultiplier({ kind: "sun" }, WEATHER_EXTRA_TUNING);
  const overcast = weatherRiskMultiplier({ kind: "overcast" }, WEATHER_EXTRA_TUNING);
  assert.ok(rain > wind, "regn skal forstaerke risikoen mere end vind");
  assert.ok(wind > sun, "vind skal give 'let forhoejet' risiko over baseline");
  assert.equal(sun, overcast, "sol/overskyet er begge baseline (ingen risiko-effekt)");
  assert.equal(sun, 1, "sol/overskyet-baseline skal vaere praecis 1 (ingen forstaerkning)");
});

test("weatherRiskMultiplier: ukendt vejr-kind falder tilbage til baseline (forward-kompatibilitet)", () => {
  const m = weatherRiskMultiplier({ kind: "fog" as WeatherKind }, WEATHER_EXTRA_TUNING);
  assert.equal(m, 1);
});

// ── kontrakt: weatherAdjustedRiskBase — clamped [0,1], skalerer korrekt ────

test("weatherAdjustedRiskBase: regn ganger basis-risikoen op, sol lader den staa", () => {
  const base = 0.01;
  const rainAdjusted = weatherAdjustedRiskBase(base, { kind: "rain" }, WEATHER_EXTRA_TUNING);
  const sunAdjusted = weatherAdjustedRiskBase(base, { kind: "sun" }, WEATHER_EXTRA_TUNING);
  assert.ok(Math.abs(sunAdjusted - base) < 1e-9, "sol skal ikke aendre basis-risikoen");
  assert.ok(rainAdjusted > base, "regn skal forstaerke basis-risikoen");
  assert.ok(Math.abs(rainAdjusted - base * WEATHER_EXTRA_TUNING.rainIncidentRiskMultiplier) < 1e-9);
});

test("weatherAdjustedRiskBase: fast-check — altid clamped [0,1] for alle gyldige basis-sandsynligheder/vejrtyper (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.constantFrom(...KINDS),
      (base, kind) => {
        const adjusted = weatherAdjustedRiskBase(base, { kind }, WEATHER_EXTRA_TUNING);
        assert.ok(adjusted >= 0 && adjusted <= 1, `adjusted=${adjusted} uden for [0,1]`);
        assert.ok(adjusted >= base - 1e-9, "vejr kan aldrig SAENKE risikoen under basis (kun daempning kan)");
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── kontrakt: vejr-teknik-daempning — monoton, aldrig omvendt fortegn ──────

test("weatherTechniqueDampening: strengt monoton stigende med teknik-vaerdien, aldrig negativ", () => {
  let prev = weatherTechniqueDampening(0, WEATHER_EXTRA_TUNING);
  assert.ok(prev >= 0);
  for (let technique = 1; technique <= 99; technique += 1) {
    const d = weatherTechniqueDampening(technique, WEATHER_EXTRA_TUNING);
    assert.ok(d >= prev - 1e-12, `daempning FALDT ved technique=${technique} (${d} < ${prev}) — omvendt fortegn`);
    prev = d;
  }
});

test("weatherTechniqueDampening: fast-check — aldrig negativ, clampet input [0,99] (200 runs)", () => {
  fc.assert(
    fc.property(fc.integer({ min: -50, max: 200 }), (raw) => {
      const d = weatherTechniqueDampening(raw, WEATHER_EXTRA_TUNING);
      assert.ok(d >= 0, `daempning ${d} < 0 for input ${raw}`);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

// ── kontrakt: weatherTechniqueProxy — hook-punkt for F4's rigtige stat ─────

test("weatherTechniqueProxy: vaegtet gennemsnit af descending+durability, aldrig uden for [0,99]", () => {
  const weights = WEATHER_EXTRA_TUNING.weatherTechniqueProxyWeights;
  assert.equal(weatherTechniqueProxy({ descending: 0, durability: 0 }, weights), 0);
  assert.equal(weatherTechniqueProxy({ descending: 99, durability: 99 }, weights), 99);
  const mixed = weatherTechniqueProxy({ descending: 20, durability: 80 }, weights);
  assert.ok(mixed > 0 && mixed < 99);
});

test("weatherTechniqueProxy: fast-check — altid inden for [0,99] for gyldige evne-input (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      (descending, durability) => {
        const proxy = weatherTechniqueProxy(
          { descending, durability },
          WEATHER_EXTRA_TUNING.weatherTechniqueProxyWeights,
        );
        assert.ok(proxy >= 0 && proxy <= 99, `proxy=${proxy} uden for [0,99]`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── determinisme: rene funktioner, ingen skjult tilstand ──────────────────

test("determinisme: samme input -> byte-identisk output ved gentagne kald", () => {
  const a = weatherAdjustedRiskBase(0.012, { kind: "rain" }, WEATHER_EXTRA_TUNING);
  const b = weatherAdjustedRiskBase(0.012, { kind: "rain" }, WEATHER_EXTRA_TUNING);
  assert.equal(a, b);
});
