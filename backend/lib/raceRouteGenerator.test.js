// backend/lib/raceRouteGenerator.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachRoute, DISTANCE_BANDS, PROLOGUE_DISTANCE_BAND } from "./raceRouteGenerator.js";

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
    // Sub-3 (#2771): stage_number=2 (ikke 1) her — itt-etape 1 i et etapeløb
    // kan nu legitimt blive en 5-8 km prolog (se de dedikerede prolog-tests
    // nedenfor); denne test verificerer kun det NORMALE bånd, så vi undgår
    // stage-1-prolog-grenen for pt==="itt" ved at bruge en senere etape.
    const r = attachRoute(stage(pt, null, 2), race, true);
    assert.ok(r.distance_km >= lo && r.distance_km <= hi, `${pt}: ${r.distance_km} udenfor [${lo},${hi}]`);
  }
});

// ── Sub-3 (#2771) Task 6: prolog-arketype via rute-pass ───────────────────────
test("prolog: etape 1 i etapeløb (itt) rammer 5-8 km hos NOGLE race-identiteter, normalt bånd hos ANDRE (begge udfald over ~20 identiteter)", () => {
  let prologCount = 0;
  let normalCount = 0;
  for (let i = 0; i < 20; i++) {
    const r = attachRoute(stage("itt", null, 1), { external_id: `race-${i}`, name: "Grand Tour" }, true);
    if (r.distance_km >= PROLOGUE_DISTANCE_BAND[0] && r.distance_km <= PROLOGUE_DISTANCE_BAND[1]) prologCount++;
    else {
      normalCount++;
      assert.ok(r.distance_km >= DISTANCE_BANDS.itt[0] && r.distance_km <= DISTANCE_BANDS.itt[1]);
    }
  }
  assert.ok(prologCount > 0, "forventede mindst én prolog-udfald over 20 identiteter");
  assert.ok(normalCount > 0, "forventede mindst ét normal-bånd-udfald over 20 identiteter");
});

test("prolog: KUN etape 1 i et etapeløb kan give 5-8 km — senere itt-etaper og enkeltstående itt-løb bruger altid det normale [15,40]-bånd", () => {
  for (let i = 0; i < 15; i++) {
    const raceId = { external_id: `race-later-${i}`, name: "Grand Tour" };
    const laterStage = attachRoute(stage("itt", null, 5), raceId, true);
    assert.ok(laterStage.distance_km >= DISTANCE_BANDS.itt[0] && laterStage.distance_km <= DISTANCE_BANDS.itt[1]);
    assert.ok(laterStage.distance_km > PROLOGUE_DISTANCE_BAND[1]); // 15-40 er disjunkt fra 5-8

    const oneDayId = { external_id: `race-oneday-${i}`, name: "Klassiker" };
    const oneDay = attachRoute(stage("itt", null, 1), oneDayId, false); // isStageRace=false
    assert.ok(oneDay.distance_km >= DISTANCE_BANDS.itt[0] && oneDay.distance_km <= DISTANCE_BANDS.itt[1]);
  }
});

test("prolog: samme race-identitet → samme (etape-1-itt-)distance to gange (determinisme)", () => {
  const raceId = { external_id: "race-determinism", name: "Grand Tour" };
  const a = attachRoute(stage("itt", null, 1), raceId, true);
  const b = attachRoute(stage("itt", null, 1), raceId, true);
  assert.equal(a.distance_km, b.distance_km);
  assert.deepEqual(a, b);
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

test("climb-navne er region-flavoured + ikke-tomme", () => {
  const es = attachRoute(stage("high_mountain", "long_climb"), { ...race, name: "Vuelta Burgalesa" }, true);
  assert.ok(es.climbs.every((c) => typeof c.name === "string" && c.name.length > 0));
});
