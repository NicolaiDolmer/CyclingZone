// #8045: angrebets forløb læst af den gemte løbslog. Fixturen er tre afviklede etaper
// (anonymiseret: rytter-id'er er aliaser, stigningerne er omdøbt, hold er fjernet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attackStory8045, attackStoryLines8045, gapParts8045, lastClimb8045 } from "./raceAttackStory8045.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./raceAttackStory8045.fixture.json", import.meta.url), "utf8"));

function story(stage) {
  return attackStory8045(stage.events, { timelineVersion: stage.timeline_version, climbs: stage.climbs, distanceKm: stage.distance_km });
}

function byRider(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!m.has(e.rider_id)) m.set(e.rider_id, []);
    m.get(e.rider_id).push(e);
  }
  return m;
}

const OUTCOMES = new Set(["caught", "dropped", "held", "level"]);

function assertHonest(entries, stage) {
  const top = lastClimb8045(stage.climbs, stage.distance_km);
  for (const [rider, list] of byRider(entries)) {
    assert.equal(list[0].phase, "started", `${rider}: forløbet begynder med angrebet`);
    assert.ok(list[0].km >= top.foot - 1e-9, `${rider}: angrebet ligger på den sidste stigning`);
    let lastKm = -Infinity;
    let lastTime = -Infinity;
    let outcomes = 0;
    for (const e of list) {
      assert.ok(Number.isFinite(e.km), `${rider}: hver hændelse har et punkt`);
      assert.ok(e.km >= lastKm - 1e-9, `${rider}: kronologisk på vejen`);
      lastKm = e.km;
      if (e.time != null) {
        assert.ok(e.time >= lastTime - 1e-9, `${rider}: kronologisk i tid`);
        lastTime = e.time;
      }
      if (OUTCOMES.has(e.phase)) outcomes += 1;
      if (e.phase === "held" || e.phase === "checkpoint") assert.ok(e.gap_seconds > 0, `${rider}: et forspring er altid foran`);
    }
    assert.ok(outcomes <= 2, `${rider}: højst ét udfald (plus en indhentning efter toppen)`);
  }
}

test("#8045 knust felt på en topankomst: angreb, kørt fra feltet, holder til mål med målt afstand", () => {
  const stage = FIXTURE["summit-shattered-field"];
  const entries = story(stage);
  assertHonest(entries, stage);
  const winner = stage.events.find((e) => e.type === "finish").params.top[0].rider_id;
  const mine = byRider(entries).get(winner).map((e) => e.phase);
  assert.deepEqual(mine, ["started", "away", "held"]);
  const held = entries.find((e) => e.rider_id === winner && e.phase === "held");
  assert.equal(held.group, "peloton");
  assert.equal(held.at, "finish");
  // Afstanden er feltets egen tid i mål minus vinderens tid, ikke et opfundet tal.
  const fieldAtFinish = stage.events.filter((e) => e.type === "gap_update" && e.km === stage.distance_km).map((e) => e.params.exact_time);
  assert.ok(fieldAtFinish.some((t) => Math.round(t - held.time) === held.gap_seconds));
  // Rytteren der knækkede, bliver sat af gruppen, han angreb fra, på knækkets sted.
  const cracked = entries.find((e) => e.phase === "dropped");
  assert.equal(cracked.cause, "cracked");
  assert.ok(cracked.km < stage.distance_km);
  // Ingen "holder"-linje for en rytter, der blev sat.
  assert.equal(entries.filter((e) => e.rider_id === cracked.rider_id && e.phase === "held").length, 0);
});

test("#8045 forgruppen splintres: de sidste bag ham måles som nærmeste forfølgere, de andre er sat", () => {
  const stage = FIXTURE["summit-front-group-splinters"];
  const entries = story(stage);
  assertHonest(entries, stage);
  const held = entries.filter((e) => e.phase === "held");
  assert.equal(held.length, 3);
  for (const h of held) assert.equal(h.group, "chasers");
  const dropped = entries.filter((e) => e.phase === "dropped");
  assert.equal(dropped.length, 3);
  for (const d of dropped) assert.equal(d.cause, "outpaced");
  // Hver "kørt fra"-linje står ved motorens eget split-punkt (et split med negativt hul).
  for (const a of entries.filter((e) => e.phase === "away")) {
    const split = stage.events.find((e) => e.type === "peloton_splits" && e.params.gap_seconds < 0 && e.params.rider_ids.includes(a.rider_id));
    assert.equal(a.km, split.params.exact_km);
    assert.equal(a.time, split.params.exact_time);
  }
});

test("#8045 forgruppen opløses om vinderen: de andre kan ikke følge, vinderen holder til mål", () => {
  const stage = FIXTURE["summit-front-group-dissolves"];
  const entries = story(stage);
  assertHonest(entries, stage);
  const winner = stage.events.find((e) => e.type === "finish").params.top[0].rider_id;
  const held = entries.filter((e) => e.phase === "held");
  assert.deepEqual(held.map((e) => e.rider_id), [winner]);
  assert.equal(entries.filter((e) => e.phase === "dropped").length, 5);
  // Et split uden tid i loggen giver en linje uden tid, aldrig en gættet tid.
  assert.ok(entries.some((e) => e.phase === "dropped" && e.time == null));
});

// ── Syntetiske etaper for faserne, der ikke findes i fixturen ──────────────

function leg(km, rider, task) {
  return { km, type: "stage_plan_leg", params: { rider_id: rider, task, exact_km: km } };
}
function gap(km, group, time, seconds) {
  return { km, type: "gap_update", params: { group_id: group, exact_km: km, exact_time: time, gap_seconds: seconds } };
}

test("#8045 forspring ved hver ægte grænse, vokser og skrumper, og hentet ved kontaktpunktet", () => {
  const events = [
    { km: 0, type: "stage_start", params: { distance_km: 100, field_count: 10, exact_km: 0, exact_time: 0 } },
    gap(80, "peloton-0", 8000, 0),
    leg(80, "r1", "attack"),
    leg(80, "r2", "attack"),
    { km: 85, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "peloton-0", rider_ids: ["r1"], gap_seconds: -40, exact_km: 81.2, exact_time: 8120 } },
    gap(85, "solo-1", 8500, 0),
    gap(85, "peloton-0", 8515, 15),
    gap(90, "solo-1", 9000, 0),
    gap(90, "peloton-0", 9045, 45),
    gap(95, "solo-1", 9500, 0),
    gap(95, "peloton-0", 9520, 20),
    { km: 100, type: "group_merged", params: { group_id: "solo-1", into_group_id: "peloton-0", rider_ids: ["r1"], exact_km: 98.4, exact_time: 9840 } },
    gap(100, "peloton-0", 10000, 0),
  ];
  const climbs = [{ name: "Climb", crest_km: 100, length_km: 20 }];
  const entries = attackStory8045(events, { timelineVersion: 2, climbs, distanceKm: 100 });
  const r1 = entries.filter((e) => e.rider_id === "r1");
  assert.deepEqual(r1.map((e) => e.phase), ["started", "away", "checkpoint", "checkpoint", "checkpoint", "caught"]);
  assert.deepEqual(r1.filter((e) => e.phase === "checkpoint").map((e) => [e.km, e.gap_seconds, e.trend]), [[85, 15, null], [90, 45, "growing"], [95, 20, "shrinking"]]);
  const caught = r1.at(-1);
  assert.equal(caught.km, 98.4);
  assert.equal(caught.time, 9840);
  assert.equal(caught.group, "peloton");
  // Den anden angriber kom aldrig væk: han når målet med feltet, uden tidsgevinst.
  assert.deepEqual(entries.filter((e) => e.rider_id === "r2").map((e) => e.phase), ["started", "level"]);
  assertHonest(entries, { climbs, distance_km: 100 });
});

test("#8045 stigningen topper før mål: holder til toppen, hentes senere på nedkørslen", () => {
  const events = [
    { km: 0, type: "stage_start", params: { distance_km: 100, field_count: 10 } },
    gap(50, "peloton-0", 5000, 0),
    leg(50, "r1", "attack"),
    { km: 60, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "peloton-0", rider_ids: ["r1"], gap_seconds: -30, exact_km: 52.5, exact_time: 5250 } },
    gap(60, "solo-1", 6000, 0),
    gap(60, "peloton-0", 6030, 30),
    { km: 80, type: "group_merged", params: { group_id: "solo-1", into_group_id: "peloton-0", rider_ids: ["r1"], exact_km: 74.1, exact_time: 7410 } },
    gap(100, "peloton-0", 10000, 0),
  ];
  const entries = attackStory8045(events, { timelineVersion: 2, climbs: [{ name: "Col", crest_km: 60, length_km: 10 }], distanceKm: 100 });
  assert.deepEqual(entries.map((e) => [e.phase, e.km]), [["started", 50], ["away", 52.5], ["held", 60], ["caught", 74.1]]);
  assert.equal(entries[2].at, "top");
  assert.equal(entries[2].gap_seconds, 30);
});

test("#8045 kører op til udbruddet foran", () => {
  const events = [
    { km: 0, type: "stage_start", params: { distance_km: 100, field_count: 10 } },
    { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2"] } },
    gap(80, "breakaway-0", 7900, 0),
    gap(80, "peloton-0", 8000, 100),
    leg(80, "r1", "attack"),
    { km: 90, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "peloton-0", rider_ids: ["r1"], gap_seconds: -60, exact_km: 81, exact_time: 8100 } },
    { km: 90, type: "group_merged", params: { group_id: "solo-1", into_group_id: "breakaway-0", rider_ids: ["r1"], exact_km: 88, exact_time: 8800 } },
    gap(100, "breakaway-0", 10000, 0),
    gap(100, "peloton-0", 10050, 50),
  ];
  const entries = attackStory8045(events, { timelineVersion: 2, climbs: [{ name: "Col", crest_km: 100, length_km: 20 }], distanceKm: 100 });
  assert.deepEqual(entries.map((e) => e.phase), ["started", "away", "bridged", "held"]);
  assert.equal(entries[2].group, "breakaway");
  assert.equal(entries[3].gap_seconds, 50);
});

test("#8045 intet at fortælle: gammel log, ingen stigning, intet angreb", () => {
  const fx = FIXTURE["summit-shattered-field"];
  assert.deepEqual(attackStory8045(fx.events, { timelineVersion: 1, climbs: fx.climbs, distanceKm: fx.distance_km }), []);
  assert.deepEqual(attackStory8045(fx.events, { timelineVersion: 2, climbs: [], distanceKm: fx.distance_km }), []);
  assert.deepEqual(attackStory8045([{ km: 0, type: "stage_start", params: { distance_km: 100 } }], { timelineVersion: 2, climbs: [{ crest_km: 100, length_km: 5 }] }), []);
  assert.deepEqual(attackStory8045(null), []);
});

test("#8045 en angrebs-opgave før stigningen begynder først at virke ved stigningens fod", () => {
  const fx = FIXTURE["summit-shattered-field"];
  const top = lastClimb8045(fx.climbs, fx.distance_km);
  const early = fx.events.filter((e) => e.type === "stage_plan_leg" && e.params.task === "attack" && e.km < top.foot).map((e) => e.params.rider_id);
  assert.ok(early.length > 0);
  for (const e of story(fx).filter((x) => x.phase === "started" && early.includes(x.rider_id))) assert.equal(e.km, top.foot);
});

test("#8045 filmens linjer: samme sted, tid og udfald bliver én linje med flere navne", () => {
  const lines = attackStoryLines8045(story(FIXTURE["summit-shattered-field"]));
  const away = lines.filter((l) => l.phase === "away");
  assert.equal(away.length, 1);
  assert.equal(away[0].rider_ids.length, 7);
  assert.equal(new Set(away[0].rider_ids).size, 7);
  for (const l of lines) assert.equal(l.kind, "attackStory");
  for (let i = 1; i < lines.length; i += 1) assert.ok(lines[i].km >= lines[i - 1].km);
});

test("#8045 afstand i minutter og sekunder", () => {
  assert.deepEqual(gapParts8045(48), { minutes: 0, seconds: 48, total: 48 });
  assert.deepEqual(gapParts8045(723.51), { minutes: 12, seconds: 4, total: 724 });
  assert.deepEqual(gapParts8045(-3), { minutes: 0, seconds: 0, total: 0 });
});
