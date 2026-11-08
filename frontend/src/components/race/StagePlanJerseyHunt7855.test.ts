// #7855: troejejagten i etapeplanens flade (valg, opsummering) og i loebsfilmen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  orderWithoutJerseyHunt,
  setRiderPlan,
  stagePlanOutcomes,
  stagePlanRecap,
  stagePlanRouteFromRaw,
  taskOptions,
  withJerseyHunt7855,
  type StagePlanLeg,
} from "./StagePlanModel.ts";
import { collectRiderIds, describeEvent } from "../../lib/stageTimelineFilm.js";

const RAW = {
  distance_km: 170,
  profile_type: "mountain",
  climbs: [{ name: "Col B", crest_km: 60, category: "1" }, { name: "Col C", crest_km: 110, category: "1" }],
  sprints: [{ name: "Spurt", km: 85, kind: "intermediate" }],
};
const OFF = stagePlanRouteFromRaw(RAW);
const ON = withJerseyHunt7855(OFF, true);

test("#7855 reviewfund: en gemt plan med jagt bliver til planen uden jagt, naar jagten ikke gaelder", () => {
  const order = { riders: [{ rider_id: "a", plan: [{ task: "hunt_points" }, { task: "ride_in", from: { at: "dropped" } }] as StagePlanLeg[] }, { rider_id: "b", plan: [{ task: "tempo" }] as StagePlanLeg[] }] };
  const out = orderWithoutJerseyHunt(order);
  assert.deepEqual(out.riders[0].plan, [{ task: "stay_sheltered" }, { task: "ride_in", from: { at: "dropped" } }]);
  assert.equal((out.riders[0] as { hunt_off?: boolean }).hunt_off, true, "boardet skal kunne sige det");
  assert.equal(out.riders[1], order.riders[1], "andre ryttere er uroerte");
  assert.equal(orderWithoutJerseyHunt({ riders: [order.riders[1]] }).riders[0], order.riders[1]);
  const noJagt = { riders: [order.riders[1]] };
  assert.equal(orderWithoutJerseyHunt(noJagt), noJagt, "uden jagt: samme objekt");
  // Saetter spilleren selv en ny plan, er maerket vaek.
  const edited = setRiderPlan(out, "a", [{ task: "tempo" }]);
  assert.equal("hunt_off" in edited.riders[0], false);
});

test("#7855 reviewfund: motorens tilbagefalds-event staar ikke i loebsfilmen", () => {
  assert.equal(describeEvent({ km: 0, type: "stage_plan_hunt_fallback", params: { rider_id: "a" } }, { riderNameById: new Map() }), null);
});

test("#7855 reviewfund: alle fem sprog har spillertekst for jagtens fejl og noten", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const races = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    assert.ok(races.stagePlan.huntOffNote, `${lang} huntOffNote`);
    for (const code of ["stage_plan_unknown_task", "stage_plan_hunt_no_sprint", "stage_plan_hunt_no_climb", "stage_plan_hunt_after_dropped"]) {
      assert.ok(races.intention.errors[code], `${lang} ${code}`);
    }
  }
});

test("#7855 valg: slukket findes opgaverne ikke; taendt kun hvor straekningen har passagen", () => {
  const off = taskOptions([{ task: "stay_sheltered" }], 0, "helper", OFF);
  assert.ok(!off.includes("hunt_points") && !off.includes("hunt_kom"));
  const on = taskOptions([{ task: "stay_sheltered" }], 0, "helper", ON);
  assert.ok(on.includes("hunt_points") && on.includes("hunt_kom"));
  // Efter Col C er spurten passeret og der er ingen stigning tilbage.
  const late = taskOptions([{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }], 1, "helper", ON);
  assert.ok(!late.includes("hunt_points") && !late.includes("hunt_kom"));
  // Kaptajnen koerer for klassementet.
  assert.ok(!taskOptions([{ task: "stay_sheltered" }], 0, "captain", ON).some((t) => t === "hunt_points" || t === "hunt_kom"));
});

const legs: StagePlanLeg[] = [{ task: "hunt_kom" }, { task: "ride_in", from: { at: "kom", kom_index: 1 } }];
const film = (hunters: string[], top: Array<{ rider_id: string; points: number }>) => [
  { km: 60, type: "kom_passage", params: { name: "Col B", category: "1", top, hunters } },
  { km: 110, type: "stage_plan_leg", params: { rider_id: "h1", leg: 1, task: "ride_in", reason: "kom" } },
  { km: 110, type: "kom_passage", params: { name: "Col C", category: "1", top: [{ rider_id: "h1", points: 10 }], hunters: [] } },
];

test("#7855 opsummering: pointene paa hans straekning, eller at han jagede uden point", () => {
  const withPoints = film(["h1"], [{ rider_id: "x", points: 10 }, { rider_id: "h1", points: 8 }]);
  const items = stagePlanRecap(legs, withPoints, "h1");
  const outcome = stagePlanOutcomes(items, withPoints, "h1")[0];
  assert.equal(outcome.mark, "done");
  assert.deepEqual(outcome.word, { key: "stagePlan.recap.outcome.komPoints", params: { points: 8 } }, "Col C ligger paa naeste led og taeller ikke");
  const none = film(["h1"], [{ rider_id: "x", points: 10 }]);
  assert.deepEqual(stagePlanOutcomes(stagePlanRecap(legs, none, "h1"), none, "h1")[0].word, { key: "stagePlan.recap.outcome.noPoints" });
  // Filmen navngiver ham ikke som jaeger: intet bevis, ingen tekst.
  const silent = film([], [{ rider_id: "h1", points: 10 }]);
  assert.equal(stagePlanOutcomes(stagePlanRecap(legs, silent, "h1"), silent, "h1")[0].word, null);
});

test("#7855 filmen: passagen siger hvem der koerte efter pointene, og navnene hentes med", () => {
  const event = { km: 85, type: "intermediate_sprint", params: { name: "Spurt", top: [{ rider_id: "a", points: 20 }], hunters: ["h1"] } };
  const names = new Map([["a", "Rytter A"], ["h1", "Rytter H"]]);
  assert.deepEqual(describeEvent(event, { riderNameById: names }), { key: "intermediate_sprint_hunted", params: { name: "Spurt", rider: "Rytter A", hunters: "Rytter H", count: 1 } });
  const plain = { ...event, params: { name: "Spurt", top: [{ rider_id: "a", points: 20 }] } };
  assert.equal(describeEvent(plain, { riderNameById: names })?.key, "intermediate_sprint", "uden jaegere er linjen som foer");
  assert.ok(collectRiderIds([event]).includes("h1"));
});

test("#7855 i18n: alle nye noegler findes paa de fem sprog", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const j = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    for (const v of [j.stagePlan.task.hunt_points, j.stagePlan.task.hunt_kom, j.stagePlan.huntOption, j.stagePlan.price.hard, j.stagePlan.huntNote,
      j.stagePlan.recap.outcome.sprintPoints, j.stagePlan.recap.outcome.komPoints, j.stagePlan.recap.outcome.noPoints,
      j.detail.film.event.kom_passage_hunted, j.detail.film.event.intermediate_sprint_hunted]) {
      assert.equal(typeof v, "string", lang);
      assert.ok(v.length > 0, lang);
    }
  }
});
