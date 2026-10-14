// backend/lib/routeElevationProfile.test.js
// #6594: højdeprofil pr. etape. Spec §5 (a)-(f) + bit-identitet + gate-kontrollen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildElevationProfile, checkElevationProfile, elevationProfileGain, elevationSeedKey, elevationStepCount,
  ELEVATION_STEP_KM, MIN_ALTITUDE_M, UNCATEGORIZED_MAX_UP_PCT,
} from "./routeElevationProfile.js";
import { generateRaceStageProfiles, toStageProfileRow, S5_GENERATOR_VERSION } from "./raceStageProfileGenerator.js";
import { checkStage } from "./s5BenchmarkGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "racePoolCatalog.prod.json"), "utf8")).catalog;
const SEEDS = ["s5-elev-1", "s5-elev-2", "s5-elev-3"];

// Hele kataloget × 3 sæson-træk med S5-modellen, genereret én gang for alle tests.
const SWEEP = [];
for (const sid of SEEDS) {
  for (const c of CATALOG) {
    const race = { ...c, season_id: sid };
    for (const stage of generateRaceStageProfiles(race, { profileModel: "s5" })) SWEEP.push({ race, stage });
  }
}
const label = ({ race, stage }) => `${race.name} etape ${stage.stage_number} (${race.season_id}, ${stage.profile_type})`;
const climbGain = (len, g) => Math.round((Number(len) * 1000 * Number(g)) / 100);

// Skridt-indeksene en stigning/rampe ejer (samme gitter som generatoren: skridtets midtpunkt).
function climbSteps(c, n, step) {
  const crest = Number(c.crest_km);
  const foot = crest - Number(c.length_km);
  const idx = [];
  for (let i = 0; i < n; i++) { const m = (i + 0.5) * step; if (m > foot && m <= crest + 1e-9) idx.push(i); }
  if (!idx.length) idx.push(Math.min(n - 1, Math.max(0, Math.ceil(crest / step) - 1)));
  return idx;
}
function rampSteps(stage, n, step) {
  const fin = (stage.sprints ?? []).find((s) => s.kind === "finish" && Number(s.ramp_km) > 0);
  if (!fin) return null;
  const k = Math.min(n, Math.max(1, Math.round(Number(fin.ramp_km) / step)));
  const idx = [];
  for (let i = n - k; i < n; i++) idx.push(i);
  return { idx, gain: climbGain(fin.ramp_km, fin.ramp_gradient) };
}
// Stigninger + rampe grupperet efter overlap: overlappende lægges oven i hinanden, så gruppens
// samlede stigning skal være summen af medlemmernes gain.
function fixedGroups(stage, n, step) {
  const items = (stage.climbs ?? []).map((c) => ({ idx: climbSteps(c, n, step), gain: climbGain(c.length_km, c.avg_gradient), crest: Number(c.crest_km), climbs: 1 }));
  const ramp = rampSteps(stage, n, step);
  if (ramp) items.push({ ...ramp, crest: null, climbs: 0 });
  const groups = [];
  for (const it of items) {
    const set = new Set(it.idx);
    const hits = groups.filter((g) => [...set].some((i) => g.set.has(i)));
    const merged = { set, gain: it.gain, members: [it] };
    for (const g of hits) { for (const i of g.set) merged.set.add(i); merged.gain += g.gain; merged.members.push(...g.members); groups.splice(groups.indexOf(g), 1); }
    groups.push(merged);
  }
  return groups;
}

test("(a) Σ positive deltaer === elevation_gain_m for hver S5-etape (hele kataloget × 3 træk)", () => {
  assert.ok(SWEEP.length > 1500, `for få etaper i sweepet: ${SWEEP.length}`);
  const bad = SWEEP.filter((x) => checkElevationProfile(x.stage) !== null).map((x) => `${label(x)}: ${checkElevationProfile(x.stage)}`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} etaper uden korrekt højdeprofil`);
  for (const x of SWEEP) assert.equal(elevationProfileGain(x.stage.elevation_profile.h), x.stage.elevation_gain_m, label(x));
});

test("(b) determinisme: samme seed giver identisk serie, både direkte og gennem generatoren", () => {
  for (const x of SWEEP.slice(0, 400)) {
    const again = buildElevationProfile(x.stage, elevationSeedKey(x.race, x.stage.stage_number));
    assert.deepEqual(again, x.stage.elevation_profile, label(x));
  }
  const race = { ...CATALOG.find((c) => c.race_type === "stage_race"), season_id: SEEDS[0] };
  const a = generateRaceStageProfiles(race, { profileModel: "s5" }).map((s) => s.elevation_profile);
  const b = generateRaceStageProfiles(race, { profileModel: "s5" }).map((s) => s.elevation_profile);
  assert.deepEqual(a, b);
});

test("(c) form: ét heltalspunkt pr. 0,5 km over [0, D], ingen negative højder", () => {
  for (const x of SWEEP) {
    const { distance_km: D, elevation_profile: p } = x.stage;
    const n = Math.max(1, Math.round(D / ELEVATION_STEP_KM));
    assert.equal(p.v, 1);
    assert.equal(p.h.length, n + 1, label(x));
    assert.equal(p.step_km, Math.round((D / n) * 1000) / 1000, label(x));
    assert.ok(p.h.every((v) => Number.isInteger(v)), `${label(x)}: ikke-heltal`);
    assert.ok(Math.min(...p.h) >= MIN_ALTITUDE_M, `${label(x)}: min ${Math.min(...p.h)}`);
  }
});

test("(d) hver stigning stiger præcis sin formel-gain og topper ved crest_km (±0,5 km); overlap lægges oven i", () => {
  let overlapping = 0;
  for (const x of SWEEP) {
    const h = x.stage.elevation_profile.h;
    const n = h.length - 1;
    const step = x.stage.distance_km / n;
    for (const g of fixedGroups(x.stage, n, step)) {
      const rise = [...g.set].reduce((s, i) => s + (h[i + 1] - h[i]), 0);
      assert.equal(rise, g.gain, `${label(x)}: gruppe med ${g.members.length} led stiger ${rise} m, forventet ${g.gain} m`);
      if (g.members.filter((m) => m.climbs).length > 1) overlapping += 1;
      for (const m of g.members) {
        if (m.crest == null) continue;
        const endKm = (Math.max(...m.idx) + 1) * step;
        assert.ok(Math.abs(endKm - m.crest) <= 0.5 + 1e-9, `${label(x)}: top ved km ${endKm}, crest_km ${m.crest}`);
      }
    }
  }
  assert.ok(overlapping > 0, "sweepet skal indeholde mindst én etape med overlappende stigninger (itt_hilly)");
});

test(`(e) intet ukategoriseret skridt stiger mere end ${UNCATEGORIZED_MAX_UP_PCT} %`, () => {
  const over = [];
  for (const x of SWEEP) {
    const h = x.stage.elevation_profile.h;
    const n = h.length - 1;
    const step = x.stage.distance_km / n;
    const fixed = new Set(fixedGroups(x.stage, n, step).flatMap((g) => [...g.set]));
    for (let i = 0; i < n; i++) {
      if (fixed.has(i)) continue;
      const pct = ((h[i + 1] - h[i]) / (step * 1000)) * 100;
      if (pct > UNCATEGORIZED_MAX_UP_PCT + 1e-9) over.push(`${label(x)} skridt ${i}: ${pct.toFixed(2)} %`);
    }
  }
  assert.deepEqual(over.slice(0, 10), [], `${over.length} ukategoriserede skridt over loftet`);
});

test("(f) nedkørsels-finale: fra sidste top til mål stiger vejen aldrig", () => {
  let seen = 0;
  for (const x of SWEEP) {
    if (x.stage.finale_type !== "descent" || !x.stage.climbs?.length) continue;
    seen += 1;
    const h = x.stage.elevation_profile.h;
    const step = x.stage.distance_km / (h.length - 1);
    const lastCrest = Math.max(...x.stage.climbs.map((c) => Number(c.crest_km)));
    for (let i = 0; i < h.length - 1; i++) {
      if ((i + 0.5) * step <= lastCrest) continue;
      assert.ok(h[i + 1] <= h[i], `${label(x)}: stiger ved km ${((i + 1) * step).toFixed(1)}`);
    }
  }
  assert.ok(seen > 0, "sweepet skal indeholde nedkørsels-finaler");
});

test("overlappende stigninger (syntetisk): begge gains lægges oven i hinanden", () => {
  const route = {
    distance_km: 30, elevation_gain_m: 0, profile_type: "itt_hilly", finale_type: "solo_tt",
    climbs: [{ crest_km: 14, length_km: 5.9, avg_gradient: 5 }, { crest_km: 15, length_km: 2.5, avg_gradient: 6 }],
    sprints: [{ kind: "finish", km: 30 }],
    segments: [{ kind: "flat", from_km: 0, to_km: 8.1 }, { kind: "climb", from_km: 8.1, to_km: 15 }, { kind: "flat", from_km: 15, to_km: 30 }],
  };
  const g = climbGain(5.9, 5) + climbGain(2.5, 6);
  route.elevation_gain_m = g + 240;
  const p = buildElevationProfile(route, "synthetic:elevation:1");
  assert.equal(elevationProfileGain(p.h), route.elevation_gain_m);
  const step = route.distance_km / (p.h.length - 1);
  const union = new Set([...climbSteps(route.climbs[0], p.h.length - 1, step), ...climbSteps(route.climbs[1], p.h.length - 1, step)]);
  assert.equal([...union].reduce((s, i) => s + p.h[i + 1] - p.h[i], 0), g, "overlappet skal bære summen, ikke kun den ene");
});

test("ren funktion: muterer ikke ruten; null uden distance; kort etape får ét skridt", () => {
  const x = SWEEP.find((s) => s.stage.climbs?.length > 2);
  const before = structuredClone(x.stage);
  buildElevationProfile(x.stage, elevationSeedKey(x.race, x.stage.stage_number));
  assert.deepEqual(x.stage, before);
  assert.equal(buildElevationProfile({ distance_km: 0, elevation_gain_m: 0 }, "k"), null);
  assert.equal(elevationStepCount(0.2), 1);
  const tiny = buildElevationProfile({ distance_km: 0.2, elevation_gain_m: 0, segments: [] }, "k");
  assert.equal(tiny.h.length, 2);
});

test("egen rng-strøm: nøglen er ':elevation:' og adskilt fra rute/segment-strømmene", () => {
  const race = { id: "r", external_id: "ext-1", season_id: "s5" };
  assert.match(elevationSeedKey(race, 3), /:elevation:3$/);
  assert.ok(!elevationSeedKey(race, 3).includes(":segments:"));
});

test("bit-identitet: S5-etaper har præcis de gamle felter + elevation_profile; v5 er uden nøglen", () => {
  const race = { ...CATALOG.find((c) => c.terrain_archetype === "grand_tour"), season_id: SEEDS[1] };
  const s5 = generateRaceStageProfiles(race, { profileModel: "s5" });
  for (const st of s5) {
    assert.equal(st.generator_version, S5_GENERATOR_VERSION);
    assert.deepEqual(Object.keys(st), [
      "stage_number", "profile_type", "finale_type", "demand_vector", "distance_km", "elevation_gain_m",
      "climbs", "sprints", "sectors", "segments", "weather", "elevation_profile", "generator_version",
    ]);
    assert.deepEqual(toStageProfileRow("r1", st).elevation_profile, st.elevation_profile);
  }
  for (const st of generateRaceStageProfiles(race)) {
    assert.equal("elevation_profile" in st, false);
    assert.equal("elevation_profile" in toStageProfileRow("r1", st), false, "v5-rækker må ikke få en ny kolonne");
  }
});

test("gate-kontrollen (#6367): S5-etape uden serie, med forkert sum eller negativ højde er et brud", () => {
  const x = SWEEP.find((s) => s.race.terrain_archetype === "grand_tour" && s.stage.profile_type === "mountain");
  assert.deepEqual(checkStage(x.stage).violations, [], label(x));
  const h = x.stage.elevation_profile.h;
  const missing = { ...x.stage, elevation_profile: null };
  assert.ok(checkStage(missing).violations.some((v) => v.includes("højdeprofil mangler")));
  const doubled = { ...x.stage, elevation_profile: { ...x.stage.elevation_profile, h: h.map((v) => v * 2) } };
  assert.ok(checkStage(doubled).violations.some((v) => v.includes("≠ elevation_gain_m")));
  const negative = { ...x.stage, elevation_profile: { ...x.stage.elevation_profile, h: h.map((v) => v - 10_000) } };
  assert.ok(checkStage(negative).violations.some((v) => v.includes("negativ højde")));
  // v5-etaper (generator_version < 6) dømmes ikke på serien.
  assert.equal(checkStage({ ...missing, generator_version: 5 }).violations.some((v) => v.includes("højdeprofil")), false);
});
