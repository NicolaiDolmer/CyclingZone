import test from "node:test";
import assert from "node:assert/strict";
import { selectStoryEvents, MAX_STORY_EVENTS } from "./stageTimelineStory.js";
import { MOUNTAIN_TIMELINE, BREAKAWAY_WIN_TIMELINE, BUNCH_SPRINT_TIMELINE } from "./stageTimelineFixtures.js";

test("ingen events → tom historie (degraderer ærligt)", () => {
  assert.deepEqual(selectStoryEvents([]), []);
  assert.deepEqual(selectStoryEvents(undefined), []);
});

test("gap_update indgår ALDRIG i historien, uanset hvor mange der findes", () => {
  const events = [
    { km: 10, type: "gap_update", params: { gap_seconds: 10 } },
    { km: 20, type: "gap_update", params: { gap_seconds: 20 } },
    { km: 168, type: "finish", params: {} },
  ];
  const story = selectStoryEvents(events);
  assert.ok(story.every((e) => e.type !== "gap_update"));
});

test("resultatet er sorteret kronologisk (km stigende), ikke efter vægt", () => {
  const story = selectStoryEvents(MOUNTAIN_TIMELINE.events);
  for (let i = 1; i < story.length; i++) assert.ok(story[i].km >= story[i - 1].km);
});

test("aldrig flere end MAX_STORY_EVENTS, selv for en tæt tidslinje", () => {
  const story = selectStoryEvents(MOUNTAIN_TIMELINE.events);
  assert.ok(story.length <= MAX_STORY_EVENTS);
});

test("fixture: bjergetape vælger de tungeste beats (finish, finale_attack, cracket favorit, catch)", () => {
  const story = selectStoryEvents(MOUNTAIN_TIMELINE.events);
  const types = story.map((e) => e.type);
  assert.ok(types.includes("finish"));
  assert.ok(types.includes("finale_attack"));
  assert.ok(story.length >= 3);
});

test("fixture: udbrudssejr fremhæver gc_change og breakaway_survived over KOM/sprint-støj", () => {
  const story = selectStoryEvents(BREAKAWAY_WIN_TIMELINE.events);
  const types = story.map((e) => e.type);
  assert.ok(types.includes("gc_change"));
  assert.ok(types.includes("breakaway_survived"));
  assert.ok(types.includes("finish"));
  // Den lavvægtede kom_passage-event fra samme fixture fortrænges af de 5
  // tungere beats (finish/gc_change/breakaway_survived/breakaway_formed/
  // intermediate_sprint) — feltet er fyldt op før den tunge-lav grænse.
  assert.ok(!types.includes("kom_passage"));
  assert.equal(story.length, MAX_STORY_EVENTS);
});

test("fixture: massespurt fremhæver fotofinish-afgørelsen og selve målstregen", () => {
  const story = selectStoryEvents(BUNCH_SPRINT_TIMELINE.events);
  const types = story.map((e) => e.type);
  assert.ok(types.includes("sprint_decided"));
  assert.ok(types.includes("finish"));
});

test("determinisme: samme input giver samme udvalg + rækkefølge ved gentagne kald", () => {
  const a = selectStoryEvents(MOUNTAIN_TIMELINE.events);
  const b = selectStoryEvents(MOUNTAIN_TIMELINE.events);
  assert.deepEqual(a, b);
});

test("ukendte fremtidige event-typer udelades stille (forward-kompatibelt, spec §2.2)", () => {
  const events = [
    { km: 5, type: "weather_shift", params: {} },
    { km: 168, type: "finish", params: {} },
  ];
  const story = selectStoryEvents(events);
  assert.deepEqual(story.map((e) => e.type), ["finish"]);
});
