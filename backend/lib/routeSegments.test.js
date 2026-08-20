// backend/lib/routeSegments.test.js
// #3855 F1 (race engine v4, rute-model v2): segmentliste + vejr-lag + legacy-syntese.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSegments, buildWeather, synthesizeSegments, attachSegmentsAndWeather } from "./routeSegments.js";
import { generateRaceStageProfiles, ARCHETYPE_PROFILES, PROFILE_TYPES } from "./raceStageProfileGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

// ── Hjælpere ──────────────────────────────────────────────────────────────────────

function totalCoverage(segments) {
  return segments.reduce((s, seg) => s + (seg.to_km - seg.from_km), 0);
}

// Asserter: sorteret, ingen huller, ingen overlap, dækker præcis [0, distanceKm].
function assertFullCoverage(segments, distanceKm, label) {
  assert.ok(segments.length > 0, `${label}: tom segmentliste`);
  let cursor = 0;
  for (const seg of segments) {
    assert.ok(seg.from_km >= cursor - 1e-6, `${label}: hul/overlap før ${JSON.stringify(seg)} (cursor=${cursor})`);
    assert.ok(seg.to_km > seg.from_km, `${label}: degenereret segment ${JSON.stringify(seg)}`);
    cursor = seg.to_km;
  }
  assert.ok(Math.abs(cursor - distanceKm) < 1e-6, `${label}: dækker ikke til distance_km (endte på ${cursor}, forventede ${distanceKm})`);
  assert.equal(segments[0].from_km, 0, `${label}: starter ikke ved 0`);
}

function raceFor(archetype, seed, stages) {
  const isStage = ARCHETYPE_PROFILES[archetype]?.kind === "stage";
  return {
    id: `route-seg-${archetype}-${seed}`,
    external_id: `route-seg-${archetype}-${seed}`,
    season_id: "s-test",
    race_type: isStage ? "stage_race" : "single",
    stages: isStage ? stages : 1,
    terrain_archetype: archetype,
    name: "Testronde",
  };
}

const STAGE_ARCHETYPES = Object.entries(ARCHETYPE_PROFILES)
  .filter(([, cfg]) => cfg.kind === "stage")
  .map(([name]) => name);
const SINGLE_ARCHETYPES = Object.entries(ARCHETYPE_PROFILES)
  .filter(([, cfg]) => cfg.kind === "single")
  .map(([name]) => name);

// ── Determinisme ──────────────────────────────────────────────────────────────────

test("buildSegments: samme rng-seed + samme rute → byte-identisk segmentliste", () => {
  const route = { distance_km: 180, profile_type: "high_mountain", finale_type: "long_climb", climbs: [
    { crest_km: 60, length_km: 10, category: "1", avg_gradient: 7.2 },
    { crest_km: 130, length_km: 14, category: "1", avg_gradient: 6.8 },
    { crest_km: 180, length_km: 12, category: "HC", avg_gradient: 8.5 },
  ], sectors: [] };
  const a = buildSegments(makeRng(12345), route);
  const b = buildSegments(makeRng(12345), route);
  assert.deepEqual(a, b);
});

test("buildWeather: samme rng-seed → identisk vejr", () => {
  assert.deepEqual(buildWeather(makeRng(777), "flat"), buildWeather(makeRng(777), "flat"));
});

test("generateRaceStageProfiles: segments + weather er deterministiske (samme løb-identitet → identisk output)", () => {
  const a = generateRaceStageProfiles(raceFor("grand_tour", "det-1", 7));
  const b = generateRaceStageProfiles(raceFor("grand_tour", "det-1", 7));
  assert.deepEqual(a, b);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i].segments, b[i].segments, `etape ${i + 1}: segments ikke deterministisk`);
    assert.deepEqual(a[i].weather, b[i].weather, `etape ${i + 1}: weather ikke deterministisk`);
  }
});

test("generateRaceStageProfiles: FORSKELLIG løb-identitet → typisk forskellige segments/weather (variation virker)", () => {
  const a = generateRaceStageProfiles(raceFor("grand_tour", "var-a", 7));
  const b = generateRaceStageProfiles(raceFor("grand_tour", "var-b", 7));
  const anyDiffer = a.some((p, i) => JSON.stringify(p.segments) !== JSON.stringify(b[i].segments) || JSON.stringify(p.weather) !== JSON.stringify(b[i].weather));
  assert.ok(anyDiffer, "forskellige løb burde give forskellige segments/weather for mindst én etape");
});

test("segments/weather rører ALDRIG pass 1 eller pass 2 (bit-identitet bevaret, jf. golden-testen i raceStageProfileGenerator.test.js)", () => {
  // Selvstændig krydstjek: generér med og uden at kalde attachSegmentsAndWeather
  // (indirekte — vi kan ikke slå det fra i generatoren, så vi verificerer i stedet at
  // profile_type/finale_type/demand_vector/distance_km/climbs/sprints/sectors er
  // UÆNDREDE på tværs af to uafhængige generation-kald af samme løb).
  const a = generateRaceStageProfiles(raceFor("balanced_week", "cross-1", 8));
  const b = generateRaceStageProfiles(raceFor("balanced_week", "cross-1", 8));
  for (let i = 0; i < a.length; i++) {
    const { segments: _sA, weather: _wA, ...restA } = a[i];
    const { segments: _sB, weather: _wB, ...restB } = b[i];
    assert.deepEqual(restA, restB);
  }
});

// ── Dækning: [0, distance_km] uden huller/overlap ────────────────────────────────

test("dækning: alle stage-arketyper, alle etaper, flere seeds — [0,distance_km] uden huller/overlap", () => {
  for (const archetype of STAGE_ARCHETYPES) {
    for (const seed of ["a", "b", "c"]) {
      const profiles = generateRaceStageProfiles(raceFor(archetype, seed, 6));
      for (const p of profiles) {
        assertFullCoverage(p.segments, p.distance_km, `${archetype}/${seed}/etape ${p.stage_number} (${p.profile_type}/${p.finale_type})`);
      }
    }
  }
});

test("dækning: alle endagsløbs-arketyper, flere seeds", () => {
  for (const archetype of SINGLE_ARCHETYPES) {
    for (const seed of ["a", "b", "c"]) {
      const [p] = generateRaceStageProfiles(raceFor(archetype, seed, 1));
      assertFullCoverage(p.segments, p.distance_km, `${archetype}/${seed} (${p.profile_type}/${p.finale_type})`);
    }
  }
});

test("dækning: buildSegments alene, direkte konstruerede ruter med overlappende climb/cobbles-input", () => {
  // Bevidst overlap mellem en climb og en sector (kan i teorien ske for 'classic', som
  // har både climbs og sectors uafhængigt trukket) — overlap-opløsningen skal stadig
  // give en gyldig, ikke-overlappende, fuldt dækkende liste.
  const route = {
    distance_km: 220, profile_type: "classic", finale_type: "punch",
    climbs: [{ crest_km: 100, length_km: 20, category: "1", avg_gradient: 6.0 }],
    sectors: [{ start_km: 95, length_km: 3, name: "Sector Test 1" }],
  };
  const segs = buildSegments(makeRng(999), route);
  assertFullCoverage(segs, 220, "overlap-case");
});

test("dækning: distance_km <= 0 → tom segmentliste (defensivt, ingen crash)", () => {
  assert.deepEqual(buildSegments(makeRng(1), { distance_km: 0, profile_type: "flat", finale_type: null, climbs: [], sectors: [] }), []);
});

// ── Konsistens med profile_type/finale_type ──────────────────────────────────────

test("mountain/high_mountain-etaper har mindst ét climb-segment", () => {
  for (const archetype of ["mountain_tour", "summit_tour", "grand_tour"]) {
    for (const seed of ["a", "b"]) {
      const profiles = generateRaceStageProfiles(raceFor(archetype, seed, 6));
      for (const p of profiles.filter((x) => x.profile_type === "mountain" || x.profile_type === "high_mountain")) {
        assert.ok(p.segments.some((s) => s.kind === "climb"), `${archetype}/${seed}/etape ${p.stage_number}: ${p.profile_type} uden climb-segment`);
      }
    }
  }
});

test("finale_type='descent' → sidste segment er 'descent' og rammer distance_km præcist", () => {
  let sawDescentFinale = false;
  for (const seed of Array.from({ length: 12 }, (_, i) => `desc-${i}`)) {
    const profiles = generateRaceStageProfiles(raceFor("mountain_tour", seed, 6));
    for (const p of profiles.filter((x) => x.finale_type === "descent")) {
      sawDescentFinale = true;
      const last = p.segments[p.segments.length - 1];
      assert.equal(last.kind, "descent", `descent-finale men sidste segment er '${last.kind}'`);
      assert.ok(Math.abs(last.to_km - p.distance_km) < 1e-6, "descent-finale segmentet rammer ikke distance_km");
    }
  }
  assert.ok(sawDescentFinale, "test-fixturen ramte aldrig en descent-finale over 12 seeds — udvid seed-rækken");
});

test("finale_type='long_climb' (summit finish) → sidste segment er 'climb' og topper ved distance_km", () => {
  let sawSummitFinale = false;
  for (const seed of Array.from({ length: 8 }, (_, i) => `summit-${i}`)) {
    const profiles = generateRaceStageProfiles(raceFor("summit_tour", seed, 5));
    for (const p of profiles.filter((x) => x.finale_type === "long_climb")) {
      sawSummitFinale = true;
      const last = p.segments[p.segments.length - 1];
      assert.equal(last.kind, "climb", `long_climb-finale men sidste segment er '${last.kind}'`);
      assert.ok(Math.abs(last.to_km - p.distance_km) < 1e-6, "summit-climb-segmentet topper ikke ved distance_km");
    }
  }
  assert.ok(sawSummitFinale, "test-fixturen ramte aldrig en long_climb-finale over 8 seeds — udvid seed-rækken");
});

test("cobbles-etaper har mindst ét cobbles-segment (cobbles-profilen garanterer altid ≥3 sektorer)", () => {
  let sawCobbles = false;
  for (const seed of ["a", "b", "c"]) {
    const [p] = generateRaceStageProfiles(raceFor("cobbled_classic", seed, 1));
    assert.equal(p.profile_type, "cobbles");
    sawCobbles = true;
    assert.ok(p.segments.some((s) => s.kind === "cobbles"), `${seed}: cobbles-etape uden cobbles-segment`);
  }
  assert.ok(sawCobbles);
});

test("flad etape: kun flat/rolling/evt. ét lille cat-4-climb(+matchende descent) — ingen dominerende rolling-strækning", () => {
  // CLIMB_SPEC.flat tillader 0-1 SMÅ kategori-4-climbs (uændret, eksisterende
  // rute-generator-adfærd) — en flad etape kan derfor undtagelsesvis have ét lille
  // climb-segment og en tilsvarende lille descent efter det. Spec-kravet ("flad har
  // hoejst smaa rolling-stykker") gælder selve GAP-fyldet, ikke denne eksisterende
  // climb-mulighed.
  for (const seed of Array.from({ length: 10 }, (_, i) => `flat-${i}`)) {
    const [p] = generateRaceStageProfiles(raceFor("flat_sprint", seed, 1));
    assert.equal(p.profile_type, "flat");
    for (const seg of p.segments) {
      assert.ok(["flat", "rolling", "climb", "descent"].includes(seg.kind), `flad etape indeholder uventet segment-kind '${seg.kind}'`);
      if (seg.kind === "rolling") {
        assert.ok(seg.to_km - seg.from_km <= 15 + 1e-6, `flad etape: rolling-lomme for lang (${seg.to_km - seg.from_km} km)`);
      }
      if (seg.kind === "climb") assert.equal(seg.category, "4", "flad etape burde kun kunne få kategori-4-climbs");
    }
  }
});

test("descent-segmenter har technicality 1-3", () => {
  const profiles = generateRaceStageProfiles(raceFor("grand_tour", "tech-1", 7));
  let sawDescent = false;
  for (const p of profiles) {
    for (const seg of p.segments.filter((s) => s.kind === "descent")) {
      sawDescent = true;
      assert.ok([1, 2, 3].includes(seg.technicality), `ugyldig technicality: ${seg.technicality}`);
    }
  }
  assert.ok(sawDescent, "ingen descent-segmenter fundet i fixturen — udvid seed");
});

test("cobbles-segmenter har stars 1-5 + sector_name", () => {
  const [p] = generateRaceStageProfiles(raceFor("cobbled_classic", "stars-1", 1));
  const cobbles = p.segments.filter((s) => s.kind === "cobbles");
  assert.ok(cobbles.length > 0);
  for (const seg of cobbles) {
    assert.ok(seg.stars >= 1 && seg.stars <= 5, `ugyldigt stars: ${seg.stars}`);
    assert.equal(typeof seg.sector_name, "string");
  }
});

test("climb-segmenter har category/avg_gradient/top_elevation_m", () => {
  const [p] = generateRaceStageProfiles(raceFor("mountain_classic", "climbfields-1", 1));
  const climbs = p.segments.filter((s) => s.kind === "climb");
  assert.ok(climbs.length > 0);
  for (const seg of climbs) {
    assert.ok(["HC", "1", "2", "3", "4"].includes(seg.category), `ugyldig category: ${seg.category}`);
    assert.equal(typeof seg.avg_gradient, "number");
    assert.ok(seg.top_elevation_m > 0, "top_elevation_m skal være positiv");
  }
});

// ── Vejr ──────────────────────────────────────────────────────────────────────────

test("weather: kind er en af de fire gyldige, wind_exposure ligger i [0,1]", () => {
  for (const p of generateRaceStageProfiles(raceFor("grand_tour", "weather-1", 7))) {
    assert.ok(["sun", "overcast", "rain", "wind"].includes(p.weather.kind), `ugyldig weather.kind: ${p.weather.kind}`);
    assert.ok(p.weather.wind_exposure >= 0 && p.weather.wind_exposure <= 1, `wind_exposure uden for [0,1]: ${p.weather.wind_exposure}`);
  }
});

test("weather-fordeling nærmer sig ca. 55/25/12/8 (sol/overskyet/regn/vind) over mange trækninger", () => {
  const counts = { sun: 0, overcast: 0, rain: 0, wind: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const w = buildWeather(makeRng(i * 7919 + 3), "rolling");
    counts[w.kind]++;
  }
  const pct = (k) => (counts[k] / N) * 100;
  assert.ok(Math.abs(pct("sun") - 55) < 5, `sol-andel skæv: ${pct("sun").toFixed(1)}%`);
  assert.ok(Math.abs(pct("overcast") - 25) < 5, `overskyet-andel skæv: ${pct("overcast").toFixed(1)}%`);
  assert.ok(Math.abs(pct("rain") - 12) < 5, `regn-andel skæv: ${pct("rain").toFixed(1)}%`);
  assert.ok(Math.abs(pct("wind") - 8) < 5, `vind-andel skæv: ${pct("wind").toFixed(1)}%`);
});

// ── attachSegmentsAndWeather (wiring-funktionen) ─────────────────────────────────

test("attachSegmentsAndWeather: returnerer {segments, weather} matchende buildSegments/buildWeather-formen", () => {
  const stage = { profile_type: "hilly", finale_type: "punch", distance_km: 175, climbs: [], sectors: [] };
  const { segments, weather } = attachSegmentsAndWeather(stage, { id: "x", external_id: "ext-x" }, 3);
  assertFullCoverage(segments, 175, "attachSegmentsAndWeather");
  assert.ok(["sun", "overcast", "rain", "wind"].includes(weather.kind));
});

// ── synthesizeSegments (legacy, rng-fri) ──────────────────────────────────────────

test("synthesizeSegments: deterministisk — gentagne kald på SAMME profil-række giver SAMME segmentliste", () => {
  const profile = { race_id: "legacy-race-1", id: "legacy-row-1", stage_number: 4, profile_type: "mountain", finale_type: "descent", distance_km: 165 };
  const a = synthesizeSegments(profile);
  const b = synthesizeSegments(profile);
  assert.deepEqual(a, b);
});

test("synthesizeSegments: FORSKELLIG profil-identitet → typisk forskellig segmentliste", () => {
  const base = { profile_type: "mountain", finale_type: "descent", distance_km: 165 };
  const a = synthesizeSegments({ ...base, race_id: "legacy-A", stage_number: 1 });
  const b = synthesizeSegments({ ...base, race_id: "legacy-B", stage_number: 1 });
  assert.notDeepEqual(a, b);
});

test("synthesizeSegments: dækker [0,distance_km] for alle PROFILE_TYPES uden gemt distance_km (auto-genereret bånd-midtpunkt)", () => {
  for (const pt of PROFILE_TYPES) {
    const profile = { race_id: `legacy-${pt}`, stage_number: 1, profile_type: pt, finale_type: null };
    const segs = synthesizeSegments(profile);
    // distance_km blev IKKE angivet — funktionen skal selv vælge en realistisk værdi og
    // segmenterne skal dække PRÆCIS den værdi den endte med at bruge.
    const total = totalCoverage(segs);
    assert.ok(total > 0, `${pt}: ingen dækning`);
    assertFullCoverage(segs, total, `synth/${pt} (uden gemt distance)`);
  }
});

test("synthesizeSegments: med gemt distance_km respekteres den præcist", () => {
  const profile = { race_id: "legacy-flat-1", stage_number: 2, profile_type: "flat", finale_type: "bunch_sprint", distance_km: 187 };
  const segs = synthesizeSegments(profile);
  assertFullCoverage(segs, 187, "synth med gemt distance");
});

test("synthesizeSegments: konsistent med profile_type — mountain får climb-segmenter, cobbles får cobbles-segmenter", () => {
  const mountain = synthesizeSegments({ race_id: "legacy-m", stage_number: 1, profile_type: "mountain", finale_type: "long_climb" });
  assert.ok(mountain.some((s) => s.kind === "climb"), "syntetiseret mountain-etape uden climb-segment");

  let sawCobbles = false;
  for (let i = 0; i < 10; i++) {
    const cobbles = synthesizeSegments({ race_id: `legacy-c-${i}`, stage_number: 1, profile_type: "cobbles", finale_type: "reduced_sprint" });
    if (cobbles.some((s) => s.kind === "cobbles")) sawCobbles = true;
  }
  assert.ok(sawCobbles, "ingen af 10 syntetiserede cobbles-etaper fik et cobbles-segment");
});

test("synthesizeSegments: ukendt profile_type falder tilbage til 'flat' (defensivt, ingen crash)", () => {
  const segs = synthesizeSegments({ race_id: "legacy-unknown", stage_number: 1, profile_type: "does-not-exist", finale_type: null });
  assert.ok(segs.length > 0);
  assert.ok(segs.every((s) => ["flat", "rolling", "climb", "descent"].includes(s.kind)));
});

test("synthesizeSegments: helt tomt/minimalt profil-objekt crasher ikke og giver en gyldig dækkende liste", () => {
  const segs = synthesizeSegments({});
  assert.ok(segs.length > 0);
  assertFullCoverage(segs, totalCoverage(segs), "synth/tom profil");
});
