import test from "node:test";
import assert from "node:assert/strict";
import {
  hasRouteData, buildProfileSeries, sharedYMax,
  komPointsForClimb, routeReadKeys, waypointsFor,
  KOM_SCALES, GREEN_FINISH_SCALES, INTERMEDIATE_SPRINT_SCALE,
  FINISH_BONUS_SECONDS, INTERMEDIATE_BONUS_SECONDS,
  TECHNICAL_DESCENT_WINDOW_KM, VALLEY_MIN_DESCENT_KM, DISTANCE_BAND_MIDPOINTS,
} from "./stageRouteProfile.js";

const PICOS_S4 = {
  race_id: "picos", stage_number: 4, profile_type: "high_mountain", finale_type: "descent",
  distance_km: 160, elevation_gain_m: 5283,
  climbs: [
    { name: "Alto de Peña Blanca", category: "1", crest_km: 62, length_km: 12.2, avg_gradient: 7.5, summit_finish: false },
    { name: "Alto de Ancares", category: "1", crest_km: 84, length_km: 15.4, avg_gradient: 7.2, summit_finish: false },
    { name: "Puerto de Montaña", category: "1", crest_km: 106, length_km: 13.1, avg_gradient: 7.8, summit_finish: false },
    { name: "Alto de El Cordal", category: "HC", crest_km: 140, length_km: 13.7, avg_gradient: 8.3, summit_finish: false },
  ],
  sprints: [{ name: "Intermediate Sprint", km: 70, kind: "intermediate" }, { name: "Finish", km: 160, kind: "finish" }],
  sectors: [],
};
const IBERICA_S20 = {
  race_id: "iberica", stage_number: 20, profile_type: "high_mountain", finale_type: "long_climb",
  distance_km: 170, elevation_gain_m: 5286,
  climbs: [
    { name: "Coll de Ancares", category: "1", crest_km: 66, length_km: 14.2, avg_gradient: 6.6, summit_finish: false },
    { name: "Coll de Navacerrada", category: "1", crest_km: 89, length_km: 12.2, avg_gradient: 7.1, summit_finish: false },
    { name: "Puerto de Ancares", category: "1", crest_km: 113, length_km: 13.7, avg_gradient: 8.2, summit_finish: false },
    { name: "Alto de El Cordal", category: "HC", crest_km: 170, length_km: 14, avg_gradient: 9, summit_finish: true },
  ],
  sprints: [{ name: "Finish", km: 170, kind: "finish" }], sectors: [],
};
const VLAAMSE_S1 = {
  race_id: "vlaamse", stage_number: 1, profile_type: "cobbles", finale_type: "reduced_sprint",
  distance_km: 155, elevation_gain_m: 400, climbs: [],
  sprints: [{ name: "Finish", km: 155, kind: "finish" }],
  sectors: [
    { kind: "cobbles", name: "Pavé Stretch 1", start_km: 70, length_km: 1.7 },
    { kind: "cobbles", name: "Cobbled Sector 2", start_km: 78, length_km: 2.3 },
    { kind: "cobbles", name: "Pavé Stretch 3", start_km: 89, length_km: 2.1 },
    { kind: "cobbles", name: "Cobbled Sector 4", start_km: 102, length_km: 2.7 },
    { kind: "cobbles", name: "Cobbled Sector 5", start_km: 113, length_km: 2.7 },
  ],
};
const PROLOG = {
  race_id: "penisola", stage_number: 1, profile_type: "itt", finale_type: "solo_tt",
  distance_km: 6, elevation_gain_m: 80, climbs: [],
  sprints: [{ name: "Finish", km: 6, kind: "finish" }], sectors: [],
};
const CANTABRICO = {
  race_id: "cantabrico", stage_number: 1, profile_type: "classic", finale_type: "long_climb",
  distance_km: 235, elevation_gain_m: 2795,
  climbs: [
    { name: "Alto de Robledo", category: "3", crest_km: 85, length_km: 4.5, avg_gradient: 5.1, summit_finish: false },
    { name: "Alto de Peña Blanca", category: "3", crest_km: 110, length_km: 4.3, avg_gradient: 5.8, summit_finish: false },
    { name: "Alto de Valdeón", category: "3", crest_km: 136, length_km: 3.8, avg_gradient: 5, summit_finish: false },
    { name: "Puerto de Peña Blanca", category: "2", crest_km: 162, length_km: 7.4, avg_gradient: 6.4, summit_finish: false },
    { name: "Alto de Navacerrada", category: "1", crest_km: 235, length_km: 10.9, avg_gradient: 6.9, summit_finish: true },
  ],
  sprints: [{ name: "Finish", km: 235, kind: "finish" }], sectors: [],
};
const FIXTURES = { PICOS_S4, IBERICA_S20, VLAAMSE_S1, PROLOG, CANTABRICO };

function totalAscent(ys) {
  let a = 0;
  for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1]) a += ys[i] - ys[i - 1];
  return a;
}

test("hasRouteData: kræver distance_km — alt andet er valgfrit", () => {
  assert.equal(hasRouteData(PICOS_S4), true);
  assert.equal(hasRouteData(PROLOG), true, "flad ITT uden climbs har stadig en rute");
  assert.equal(hasRouteData({ profile_type: "flat", distance_km: null }), false);
  assert.equal(hasRouteData({ profile_type: "flat" }), false);
  assert.equal(hasRouteData(null), false);
  assert.equal(hasRouteData(undefined), false);
});

test("INVARIANT: kurvens samlede stigning == elevation_gain_m (±0,5 m) på alle 5 ægte etapetyper", () => {
  for (const [name, st] of Object.entries(FIXTURES)) {
    const { ys } = buildProfileSeries(st);
    const diff = Math.abs(totalAscent(ys) - st.elevation_gain_m);
    assert.ok(diff <= 0.5, `${name}: afvigelse ${diff.toFixed(3)} m > 0,5 m`);
  }
});

test("determinisme: samme række → bit-identisk serie", () => {
  const a = buildProfileSeries(PICOS_S4);
  const b = buildProfileSeries({ ...PICOS_S4, climbs: PICOS_S4.climbs.map((c) => ({ ...c })) });
  assert.deepEqual(a.ys, b.ys);
  assert.deepEqual(a.xs, b.xs);
});

test("hver stigning rejser sig præcis sin egen højdemeter fra fod til top", () => {
  const { xs, ys, spans } = buildProfileSeries(PICOS_S4);
  assert.equal(spans.length, 4, "én span pr. stigning");
  const nearest = (km) => xs.reduce((best, x, i) => (Math.abs(x - km) < Math.abs(xs[best] - km) ? i : best), 0);
  PICOS_S4.climbs.forEach((c, i) => {
    const [foot, crest] = spans[i];
    const gain = Math.round((c.length_km * 1000 * c.avg_gradient) / 100);
    const measured = ys[nearest(crest)] - ys[nearest(foot)];
    assert.ok(Math.abs(measured - gain) < 2, `${c.name}: målte ${measured.toFixed(0)} m, forventede ${gain} m`);
  });
});

test("højeste punkt ligger PÅ en stigningstop, ikke i bølgeterrænet", () => {
  for (const st of [PICOS_S4, IBERICA_S20, CANTABRICO]) {
    const { xs, ys, spans } = buildProfileSeries(st);
    const peakKm = xs[ys.reduce((b, y, i) => (y > ys[b] ? i : b), 0)];
    const onACrest = spans.some(([, crest]) => Math.abs(peakKm - crest) < 2);
    assert.ok(onACrest, `${st.race_id}: toppunkt ved km ${peakKm.toFixed(0)} er ikke en stigningstop`);
  }
});

test("bølgeamplituden holder sig i realistisk, ikke-kategoriseret terræn (<120 m)", () => {
  for (const [name, st] of Object.entries(FIXTURES)) {
    const { waveAmplitude } = buildProfileSeries(st);
    assert.ok(waveAmplitude < 120, `${name}: amplitude ${waveAmplitude.toFixed(0)} m — kalibreringen er brudt`);
  }
});

test("prolog: 6 km / 80 hm giver ikke en bjergvæg (maks 120 m over dalen)", () => {
  const { ys } = buildProfileSeries(PROLOG);
  assert.ok(Math.max(...ys) - 180 <= 120, `prolog toppede i ${Math.max(...ys)} m`);
});

test("nedkørslen er begrænset — ruten falder aldrig stejlere end ~65 m/km + bølge", () => {
  const { xs, ys, spans } = buildProfileSeries(PICOS_S4);
  const inClimb = (x) => spans.some(([a, b]) => x >= a && x <= b);
  for (let i = 1; i < xs.length; i++) {
    if (inClimb(xs[i]) || inClimb(xs[i - 1])) continue;
    const slope = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    assert.ok(slope > -260, `fald på ${slope.toFixed(0)} m/km ved km ${xs[i].toFixed(1)}`);
  }
});

test("summit finish: seriens sidste punkt ER etapens sidste stigningstop", () => {
  const { xs, ys, spans } = buildProfileSeries(IBERICA_S20);
  const lastCrest = spans[spans.length - 1][1];
  assert.ok(Math.abs(xs[xs.length - 1] - lastCrest) < 0.5, "ruten slutter på toppen");
  const footAlt = ys[xs.reduce((b, x, i) => (Math.abs(x - spans[spans.length - 1][0]) < Math.abs(xs[b] - spans[spans.length - 1][0]) ? i : b), 0)];
  assert.ok(ys[ys.length - 1] - footAlt > 1000, "den afsluttende HC rejser sig over 1000 m");
});

test("dal-finish: sidste punkt ligger markant under etapens toppunkt", () => {
  const { ys } = buildProfileSeries(PICOS_S4);
  assert.ok(ys[ys.length - 1] < Math.max(...ys) * 0.6);
});

test("yMax-override: fælles skala ændrer ikke geometrien, kun det rapporterede loft", () => {
  const solo = buildProfileSeries(VLAAMSE_S1);
  const shared = buildProfileSeries(VLAAMSE_S1, { yMax: 2000 });
  assert.deepEqual(solo.ys, shared.ys, "kurven må ikke ændre sig");
  assert.equal(shared.maxY, 2000);
});

test("uden rutedata kastes ikke — der returneres null", () => {
  assert.equal(buildProfileSeries({ profile_type: "flat" }), null);
  assert.equal(buildProfileSeries(null), null);
});

test("sharedYMax: loftet er den højeste etapes top, ikke hver etapes egen", () => {
  const y = sharedYMax([VLAAMSE_S1, PICOS_S4, PROLOG]);
  assert.equal(y, buildProfileSeries(PICOS_S4).maxY, "bjergetapen sætter loftet");
  assert.ok(y > buildProfileSeries(VLAAMSE_S1).maxY * 3, "brosten-etapen skal blive lav");
});

test("sharedYMax: etaper uden rutedata ignoreres; ingen rutedata → null", () => {
  assert.equal(sharedYMax([{ profile_type: "flat" }]), null);
  assert.equal(sharedYMax([]), null);
  assert.equal(sharedYMax([{ profile_type: "flat" }, PROLOG]), buildProfileSeries(PROLOG).maxY);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 (#2448): motor-aflæsning — routeReadKeys, komPointsForClimb, waypointsFor.

test("routeReadKeys(PICOS_S4): valley km=20 + technical, men IKKE summit", () => {
  const keys = routeReadKeys(PICOS_S4);
  const byKey = Object.fromEntries(keys.map((k) => [k.key, k]));
  assert.equal(byKey.valley?.params.km, 20);
  assert.ok(byKey.technical, "descent-finale skal give technical");
  assert.equal(byKey.summit, undefined, "sidste stigning er ikke summit_finish");
});

test("routeReadKeys(IBERICA_S20): summit, IKKE valley", () => {
  const keys = routeReadKeys(IBERICA_S20);
  const byKey = Object.fromEntries(keys.map((k) => [k.key, k]));
  assert.ok(byKey.summit, "sidste stigning har summit_finish: true");
  assert.equal(byKey.valley, undefined, "summit-finish har ingen nedkørsel at måle");
});

test("routeReadKeys: brosten-etape hvor sidste sektor slutter <10 km fra mål giver technical", () => {
  const stage = { ...VLAAMSE_S1, distance_km: 120 }; // sidste sektor slutter km 115,7
  const keys = routeReadKeys(stage);
  assert.ok(keys.some((k) => k.key === "technical"));
});

test("routeReadKeys(VLAAMSE_S1): cobbles-chip bærer params.count === 5", () => {
  const keys = routeReadKeys(VLAAMSE_S1);
  const cobbles = keys.find((k) => k.key === "cobbles");
  assert.equal(cobbles?.params.count, 5);
});

test("routeReadKeys: lang/kort dag omkring DISTANCE_BAND_MIDPOINTS.flat (175 km)", () => {
  const long = routeReadKeys({ profile_type: "flat", distance_km: 200, climbs: [], sprints: [], sectors: [] });
  const short = routeReadKeys({ profile_type: "flat", distance_km: 150, climbs: [], sprints: [], sectors: [] });
  const neither = routeReadKeys({ profile_type: "flat", distance_km: 175, climbs: [], sprints: [], sectors: [] });
  assert.ok(long.some((k) => k.key === "long"));
  assert.ok(short.some((k) => k.key === "short"));
  assert.ok(!neither.some((k) => k.key === "long" || k.key === "short"));
});

test("routeReadKeys: uden rutedata → tom liste", () => {
  assert.deepEqual(routeReadKeys({ profile_type: "flat" }), []);
  assert.deepEqual(routeReadKeys(null), []);
});

test("komPointsForClimb: HC/kat.1 fordobles på summit_finish, kat.2+ gør ikke", () => {
  assert.equal(komPointsForClimb({ category: "HC", summit_finish: false }), 20);
  assert.equal(komPointsForClimb({ category: "HC", summit_finish: true }), 40);
  assert.equal(komPointsForClimb({ category: "1", summit_finish: true }), 20);
  assert.equal(komPointsForClimb({ category: "2", summit_finish: true }), 5, "kun HC/1 fordobles");
  assert.equal(komPointsForClimb({ category: "4", summit_finish: false }), 1);
});

test("komPointsForClimb: ukendt kategori → 0, ingen kastet fejl", () => {
  assert.equal(komPointsForClimb({ category: "ukendt" }), 0);
  assert.equal(komPointsForClimb({}), 0);
});

test("waypointsFor(PICOS_S4): 6 waypoints sorteret på km, HC har index 3 og 20 point", () => {
  const wps = waypointsFor(PICOS_S4);
  assert.equal(wps.length, 6);
  assert.deepEqual(wps.map((w) => w.km), [62, 70, 84, 106, 140, 160]);
  assert.deepEqual(wps.map((w) => w.kind), ["kom", "sprint", "kom", "kom", "kom", "finish"]);
  const hc = wps.find((w) => w.category === "HC");
  assert.equal(hc.index, 3);
  assert.equal(hc.points, 20);
});

test("waypointsFor: uden rutedata → tom liste", () => {
  assert.deepEqual(waypointsFor({ profile_type: "flat" }), []);
});

test("waypointsFor: index følger climbs' RÅ array-position, ikke km-sorteringen", () => {
  const rawClimbs = [...PICOS_S4.climbs];
  [rawClimbs[0], rawClimbs[1]] = [rawClimbs[1], rawClimbs[0]]; // byt Peña Blanca (62) og Ancares (84) om
  const stage = { ...PICOS_S4, climbs: rawClimbs };
  const wps = waypointsFor(stage);
  const komWps = wps.filter((w) => w.kind === "kom");
  // Visningen er stadig sorteret på km...
  assert.deepEqual(komWps.map((w) => w.km), [62, 84, 106, 140]);
  // ...men index matcher positionen i det RÅ array (racePassages.js:88), ikke
  // km-rækkefølgen — ellers slår et klik på grafen op i en forkert stignings
  // passage-resultat i race_stage_passages.
  for (const w of komWps) {
    const rawIndex = rawClimbs.findIndex((c) => c.name === w.name);
    assert.equal(w.index, rawIndex, `${w.name}: index ${w.index} matcher ikke rå position ${rawIndex}`);
  }
  const ancares = komWps.find((w) => w.name === "Alto de Ancares");
  const penaBlanca = komWps.find((w) => w.name === "Alto de Peña Blanca");
  assert.equal(ancares.index, 0, "Ancares står først i det rå (ombyttede) array");
  assert.equal(penaBlanca.index, 1, "Peña Blanca står som nummer to i det rå array");
});

test("waypointsFor: ukendt profile_type falder tilbage til mountain-skalaen på finish (samme som racePassages.scaleFor)", () => {
  const stage = {
    profile_type: "some_future_type", distance_km: 100, elevation_gain_m: 1000,
    climbs: [], sprints: [{ name: "Finish", km: 100, kind: "finish" }], sectors: [],
  };
  const finish = waypointsFor(stage).find((w) => w.kind === "finish");
  assert.equal(finish.points, GREEN_FINISH_SCALES.mountain[0]);
});

test("DRIFT-GUARD: passage-konstanter i frontend matcher backend/lib/racePassages.js 1:1", async () => {
  const backend = await import("../../../backend/lib/racePassages.js");
  assert.deepEqual(KOM_SCALES, backend.KOM_SCALES, "KOM_SCALES afveget fra motoren");
  assert.deepEqual(GREEN_FINISH_SCALES, backend.GREEN_FINISH_SCALES, "GREEN_FINISH_SCALES afveget fra motoren");
  assert.deepEqual(INTERMEDIATE_SPRINT_SCALE, backend.INTERMEDIATE_SPRINT_SCALE, "INTERMEDIATE_SPRINT_SCALE afveget fra motoren");
  assert.deepEqual(FINISH_BONUS_SECONDS, backend.FINISH_BONUS_SECONDS, "FINISH_BONUS_SECONDS afveget fra motoren");
  assert.deepEqual(INTERMEDIATE_BONUS_SECONDS, backend.INTERMEDIATE_BONUS_SECONDS, "INTERMEDIATE_BONUS_SECONDS afveget fra motoren");
});

test("DRIFT-GUARD: rute-konstanter i frontend matcher backend/lib/raceSimulator.js 1:1", async () => {
  const backend = await import("../../../backend/lib/raceSimulator.js");
  assert.deepEqual(TECHNICAL_DESCENT_WINDOW_KM, backend.TECHNICAL_DESCENT_WINDOW_KM, "TECHNICAL_DESCENT_WINDOW_KM afveget fra motoren");
  assert.equal(VALLEY_MIN_DESCENT_KM, backend.VALLEY_MIN_DESCENT_KM, "VALLEY_MIN_DESCENT_KM afveget fra motoren");
  assert.deepEqual(DISTANCE_BAND_MIDPOINTS, backend.DISTANCE_BAND_MIDPOINTS, "DISTANCE_BAND_MIDPOINTS afveget fra motoren");
});
