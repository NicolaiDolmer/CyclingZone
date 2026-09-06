// backend/lib/engine/v4/mechanics/weather.test.ts
// Kontrakt- + property-tests for M11 (vejr-laget). SSOT: mor-spec §4 M11 +
// §8 beslutning 13 ("vejr-teknik", ny stat, foedes skjult).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  weatherAdjustedRiskBase,
  weatherCpMultiplier,
  weatherCpPenalty,
  weatherRiskMultiplier,
  weatherTechniqueDampening,
  weatherTechniqueProxy,
} from "./weather.ts";
import { WEATHER_EXTRA_TUNING } from "../tuning.ts";
import type { SegmentKind, WeatherKind } from "../types.ts";

const KINDS: WeatherKind[] = ["sun", "overcast", "rain", "wind"];
const SEGMENT_KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];

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

// ── BELASTNINGS-ARMEN (#3855, M11-wiring 6/9) ─────────────────────────────

test("weatherCpPenalty: sol/overskyet koster PRAECIS 0 paa alle terraener (baseline i begge arme)", () => {
  for (const kind of ["sun", "overcast"] as WeatherKind[]) {
    for (const segmentKind of SEGMENT_KINDS) {
      const penalty = weatherCpPenalty({ kind, wind_exposure: 1 }, segmentKind, WEATHER_EXTRA_TUNING);
      assert.equal(penalty, 0, `${kind} paa ${segmentKind} kostede ${penalty}, ikke 0`);
    }
  }
});

test("weatherCpPenalty: regn er terraen-UAFHAENGIG — en vaad stigning koster som en vaad flade", () => {
  const penalties = SEGMENT_KINDS.map((segmentKind) =>
    weatherCpPenalty({ kind: "rain", wind_exposure: 0.4 }, segmentKind, WEATHER_EXTRA_TUNING),
  );
  assert.ok(penalties[0] > 0, "regn skal koste noget");
  for (const p of penalties) assert.equal(p, penalties[0], "regn-straffen maa ikke variere med terraenet");
});

test("weatherCpPenalty: vind koster mest paa aabent terraen og mindst paa stigning (lae af sig selv)", () => {
  const at = (segmentKind: SegmentKind) =>
    weatherCpPenalty({ kind: "wind", wind_exposure: 1 }, segmentKind, WEATHER_EXTRA_TUNING);
  assert.ok(at("flat") > at("rolling"), "flad, aaben vej skal fange mest vind");
  assert.ok(at("rolling") > at("descent"), "rullende terraen skal fange mere vind end en nedkoersel");
  assert.ok(at("descent") > at("climb"), "en stigning ligger i lae af sig selv og skal fange mindst vind");
  assert.ok(at("climb") > 0, "vind skal stadig koste NOGET paa en stigning");
});

test("weatherCpPenalty: vind-straffen skalerer med rutens wind_exposure og forsvinder ved 0", () => {
  const at = (exposure: number) =>
    weatherCpPenalty({ kind: "wind", wind_exposure: exposure }, "flat", WEATHER_EXTRA_TUNING);
  assert.equal(at(0), 0, "en etape uden vind-eksponering skal ikke koste noget selv i vindvejr");
  assert.ok(at(0.5) > at(0.2), "hoejere eksponering skal koste mere");
  assert.ok(at(1) > at(0.5));
});

test("weatherCpMultiplier: ALTID i (0, 1] — vejr kan aldrig HAEVE en rytters troeskel (fast-check, 400 runs)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...KINDS),
      fc.constantFrom(...SEGMENT_KINDS),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.integer({ min: -50, max: 200 }),
      (kind, segmentKind, exposure, technique) => {
        const m = weatherCpMultiplier({ kind, wind_exposure: exposure }, segmentKind, technique, WEATHER_EXTRA_TUNING);
        assert.ok(Number.isFinite(m), `multiplikator ${m} er ikke endelig`);
        assert.ok(m > 0, `multiplikator ${m} <= 0 for ${kind}/${segmentKind}/exp=${exposure}/tek=${technique}`);
        assert.ok(m <= 1, `multiplikator ${m} > 1 — vejret haevede CP'en for ${kind}/${segmentKind}`);
      },
    ),
    { numRuns: 400, seed: 3855 },
  );
});

// Invariant 3 (§3 punkt 3, "styrke straffes aldrig") paa selve vejr-koblingen:
// en rytter med hoejere vejr-teknik maa ALDRIG faa en lavere CP-multiplikator
// end en med lavere teknik. Testet punkt for punkt over hele 0-99-skalaen, ikke
// stikproevevis — det er den invariant der er dyrest at bryde.
test("weatherCpMultiplier: monotont IKKE-FALDENDE i vejr-teknik (invariant 3, hele 0-99-skalaen)", () => {
  for (const kind of KINDS) {
    for (const segmentKind of SEGMENT_KINDS) {
      let prev = weatherCpMultiplier({ kind, wind_exposure: 0.7 }, segmentKind, 0, WEATHER_EXTRA_TUNING);
      for (let technique = 1; technique <= 99; technique += 1) {
        const m = weatherCpMultiplier({ kind, wind_exposure: 0.7 }, segmentKind, technique, WEATHER_EXTRA_TUNING);
        assert.ok(
          m >= prev - 1e-12,
          `CP-multiplikatoren FALDT ved technique=${technique} (${m} < ${prev}) for ${kind}/${segmentKind} — staerkere rytter straffet`,
        );
        prev = m;
      }
    }
  }
});

test("weatherCpMultiplier: vejr-teknik er maerkbar men aldrig et frikort (§9 punkt 3's 'aldrig gratis')", () => {
  const weak = weatherCpMultiplier({ kind: "rain", wind_exposure: 0.3 }, "flat", 0, WEATHER_EXTRA_TUNING);
  const strong = weatherCpMultiplier({ kind: "rain", wind_exposure: 0.3 }, "flat", 99, WEATHER_EXTRA_TUNING);
  assert.ok(strong > weak, "hoej vejr-teknik skal MAERKES");
  assert.ok(strong < 1, "selv en rytter paa 99 skal stadig miste noget CP i regnen — aldrig gratis");
});

test("weatherCpMultiplier: sol/overskyet giver PRAECIS 1 (byte-identisk med en etape uden vejr-lag)", () => {
  for (const kind of ["sun", "overcast"] as WeatherKind[]) {
    for (const segmentKind of SEGMENT_KINDS) {
      for (const technique of [0, 33, 66, 99]) {
        const m = weatherCpMultiplier({ kind, wind_exposure: 0.9 }, segmentKind, technique, WEATHER_EXTRA_TUNING);
        assert.equal(m, 1, `${kind}/${segmentKind}/tek=${technique} gav ${m}, ikke praecis 1`);
      }
    }
  }
});

// ── determinisme: rene funktioner, ingen skjult tilstand ──────────────────

test("determinisme: samme input -> byte-identisk output ved gentagne kald", () => {
  const a = weatherAdjustedRiskBase(0.012, { kind: "rain" }, WEATHER_EXTRA_TUNING);
  const b = weatherAdjustedRiskBase(0.012, { kind: "rain" }, WEATHER_EXTRA_TUNING);
  assert.equal(a, b);

  const c = weatherCpMultiplier({ kind: "wind", wind_exposure: 0.42 }, "flat", 51, WEATHER_EXTRA_TUNING);
  const d = weatherCpMultiplier({ kind: "wind", wind_exposure: 0.42 }, "flat", 51, WEATHER_EXTRA_TUNING);
  assert.equal(c, d);
});
