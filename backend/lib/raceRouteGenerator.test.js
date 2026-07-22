// backend/lib/raceRouteGenerator.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachRoute, DISTANCE_BANDS } from "./raceRouteGenerator.js";

const race = { external_id: "abc123", season_id: "s1", name: "Vuelta Andaluza" };
const stage = (profile_type, finale_type, stage_number = 1) =>
  ({ stage_number, profile_type, finale_type, demand_vector: {} });

test("attachRoute er deterministisk (samme input → deep-equal)", () => {
  const a = attachRoute(stage("high_mountain", "long_climb"), race, true);
  const b = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.deepEqual(a, b);
});

test("distance_km ligger i profilens bånd", () => {
  for (const [pt, [lo, hi]] of Object.entries(DISTANCE_BANDS)) {
    const r = attachRoute(stage(pt, null), race, true);
    assert.ok(r.distance_km >= lo && r.distance_km <= hi, `${pt}: ${r.distance_km} udenfor [${lo},${hi}]`);
  }
});

test("summit-finale → sidste climb er summit_finish med crest = distance", () => {
  const r = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.ok(r.climbs.length >= 1);
  const last = r.climbs[r.climbs.length - 1];
  assert.equal(last.summit_finish, true);
  assert.equal(last.crest_km, r.distance_km);
});

test("descent-finale → ingen summit_finish", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  assert.ok(r.climbs.every((c) => c.summit_finish === false));
});

test("climbs er sorteret på crest_km stigende", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  for (let i = 1; i < r.climbs.length; i++) assert.ok(r.climbs[i].crest_km >= r.climbs[i - 1].crest_km);
});

test("cobbles-profil → 3–6 brosten-sektorer inden for distancen", () => {
  const r = attachRoute(stage("cobbles", "reduced_sprint"), race, true);
  assert.ok(r.sectors.length >= 3 && r.sectors.length <= 6);
  assert.ok(r.sectors.every((s) => s.kind === "cobbles" && s.start_km + s.length_km <= r.distance_km));
});

test("etapeløbs-etape → mellemsprint + målspurt; endagsløb → kun målspurt", () => {
  const stageRace = attachRoute(stage("flat", "bunch_sprint"), race, true);
  assert.ok(stageRace.sprints.some((s) => s.kind === "intermediate"));
  assert.equal(stageRace.sprints[stageRace.sprints.length - 1].kind, "finish");
  const oneDay = attachRoute(stage("flat", "bunch_sprint"), race, false);
  assert.ok(oneDay.sprints.every((s) => s.kind === "finish"));
});

test("prolog-flag → itt-distance i 5–8 km", () => {
  const r = attachRoute({ ...stage("itt", "solo_tt"), is_prolog: true }, race, true);
  assert.ok(r.distance_km >= 5 && r.distance_km <= 8);
});

test("climb-navne er region-flavoured + ikke-tomme", () => {
  const es = attachRoute(stage("high_mountain", "long_climb"), { ...race, name: "Vuelta Burgalesa" }, true);
  assert.ok(es.climbs.every((c) => typeof c.name === "string" && c.name.length > 0));
});
