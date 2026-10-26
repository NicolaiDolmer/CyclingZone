import test from "node:test";
import assert from "node:assert/strict";
import {
  morningBreakawayRiderIds, splitBreakawayRiders, labelBreakawayEvents, breakawayLabelOf,
  breakawayFilmCopy, morningFromStory, labelStoryLine,
} from "./breakawayLabels6299.ts";
import { describeEvent, buildFilmTimeline } from "./stageTimelineFilm.js";
import { deriveParticipationHistory } from "../../../backend/lib/raceParticipationHistory.ts";
import { curateMoments, type Cast, type RaceStory } from "../components/race/stagePageV2/raceStoryModel.ts";
import { historyForStage, participationForResult, breakawayMarkerEntries } from "./raceParticipationMarkers.ts";

// Etape 10-moenstret fra #6299 i lille skala: udbruddet er a+b. En kontra (c)
// lukker hullet og koerer med i en gruppe der er splittet ud af udbruddet og
// derfor ARVER oprindelsen "breakaway"; motoren naevner ham i survived.
const EVENTS = [
  { km: 0, type: "stage_start", params: { field_count: 6 } },
  { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["a", "b"] } },
  { km: 80, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ["b", "c"] } },
  { km: 120, type: "breakaway_dropped", params: { group_id: "breakaway-2", rider_ids: ["c"] } },
  { km: 150, type: "breakaway_survived", params: { group_id: "breakaway-2", rider_ids: ["a", "c"] } },
  { km: 151, type: "breakaway_survived", params: { group_id: "breakaway-3", rider_ids: ["c", "d"] } },
  { km: 151, type: "finish", params: { top: [{ rider_id: "a", rank: 1 }] } },
];

const NAMES = new Map([["a", "Alpha"], ["b", "Bravo"], ["c", "Charlie"], ["d", "Delta"]]);

test("udbruddet er rytterne fra breakaway_formed, samme regel som resultat-maerkerne", () => {
  const morning = morningBreakawayRiderIds(EVENTS);
  assert.deepEqual([...(morning ?? [])].sort(), ["a", "b"]);
  assert.deepEqual([...(morning ?? [])].sort(), [...deriveParticipationHistory(EVENTS).morningRiderIds].sort());
});

test("ukendt dannelse (ingen rytterliste) = ingen maerkning", () => {
  const old = [{ km: 10, type: "breakaway_formed", params: { group_id: "g" } }, { km: 50, type: "breakaway_survived", params: { rider_ids: ["x"] } }];
  assert.equal(morningBreakawayRiderIds(old), null);
  assert.equal(labelBreakawayEvents(old).some((e) => breakawayLabelOf(e)), false);
  assert.equal(morningBreakawayRiderIds(null), null);
});

test("et nyt udbrud efter en tidlig indhentning (reformation) er ogsaa udbrud; en senere dannelse uden maerket er ikke", () => {
  const events = [
    { km: 10, type: "breakaway_formed", params: { group_id: "b1", rider_ids: ["a"] } },
    { km: 40, type: "breakaway_formed", params: { group_id: "b2", rider_ids: ["e"], reformation: true } },
    { km: 60, type: "breakaway_formed", params: { group_id: "b3", rider_ids: ["f"] } },
  ];
  assert.deepEqual([...(morningBreakawayRiderIds(events) ?? [])].sort(), ["a", "e"]);
  const labelled = labelBreakawayEvents(events);
  assert.equal(breakawayLabelOf(labelled[1]), null);
  assert.equal(breakawayLabelOf(labelled[2])?.label, "group_ahead");
});

test("splitBreakawayRiders deler i udbrud og gruppe foran feltet", () => {
  const morning = new Set(["a", "b"]);
  assert.deepEqual(splitBreakawayRiders(["a", "b"], morning), { label: "breakaway", morningIds: ["a", "b"], aheadIds: [] });
  assert.deepEqual(splitBreakawayRiders(["a", "c"], morning), { label: "mixed", morningIds: ["a"], aheadIds: ["c"] });
  assert.deepEqual(splitBreakawayRiders(["c", "d"], morning), { label: "group_ahead", morningIds: [], aheadIds: ["c", "d"] });
  assert.equal(splitBreakawayRiders(["c"], null).label, "breakaway");
});

test("labelBreakawayEvents muterer aldrig tidslinjen og maerker kun udbruds-haendelser", () => {
  const before = JSON.stringify(EVENTS);
  const labelled = labelBreakawayEvents(EVENTS);
  assert.equal(JSON.stringify(EVENTS), before);
  assert.equal(breakawayLabelOf(labelled[1]), null); // formed: kun udbrydere
  assert.equal(breakawayLabelOf(labelled[2])?.label, "mixed");
  assert.equal(breakawayLabelOf(labelled[3])?.label, "group_ahead");
  assert.equal(breakawayLabelOf(labelled[5])?.label, "group_ahead");
  assert.equal(labelled[6], EVENTS[6]);
});

test("filmen: kun udbrydderne naevnes som udbrud, senere grupper hedder gruppe foran feltet", () => {
  const labelled = labelBreakawayEvents(EVENTS);
  const opts = { riderNameById: NAMES };
  assert.deepEqual(describeEvent(labelled[1], opts), { key: "breakaway_formed", params: { riders: "Alpha, Bravo", count: 2 } });
  assert.deepEqual(describeEvent(labelled[2], opts), { key: "breakaway_caught", params: { riders: "Bravo", count: 1 } });
  assert.deepEqual(describeEvent(labelled[3], opts), { key: "group_ahead_dropped", params: { riders: "Charlie", count: 1 } });
  assert.deepEqual(describeEvent(labelled[4], opts), { key: "breakaway_survived", params: { riders: "Alpha", count: 1 } });
  assert.deepEqual(describeEvent(labelled[5], opts), { key: "group_ahead_survived", params: { riders: "Charlie, Delta", count: 2 } });
  // Umaerket haendelse (ingen kendt dannelse) = uaendret tekst.
  assert.deepEqual(describeEvent(EVENTS[5], opts), { key: "breakaway_survived", params: { riders: "Charlie, Delta", count: 2 } });
});

test("breakawayFilmCopy fjerner aktoer-varianten for en gruppe foran feltet", () => {
  const event = labelBreakawayEvents(EVENTS)[3];
  assert.deepEqual(breakawayFilmCopy(event, "breakaway_caught_by_teams"), { key: "group_ahead_caught", riderIds: ["c"], ahead: true });
});

test("filmens feed baerer maerkningen", () => {
  const built = buildFilmTimeline({ events: EVENTS, distanceKm: 151 });
  const survived = built.feedEvents.filter((e: { type?: string }) => e.type === "breakaway_survived");
  assert.ok(survived.some((e: unknown) => breakawayLabelOf(e)?.label === "group_ahead"));
});

function story(moments: Array<{ key: string; km: number; rider_ids: string[] }>, morning: string[] | null): RaceStory {
  return {
    version: 1, timeline_version: 2, distance_km: 151, field_count: 6, precise_times: true, time_trial: false,
    leader_line: [], checkpoints: [], snapshots: [], group_spans: [],
    moments: moments.map((m) => ({ type: m.key.replace("story.", ""), key: m.key, km: m.km, race_time_s: null, importance: "key" as const, data: { rider_ids: m.rider_ids } })),
    breakaway: morning ? { morning_rider_ids: morning, outcomes: {} } : null,
  };
}

const CAST: Cast = { nameOf: (id) => NAMES.get(id) ?? null, mine: new Set(["c"]), rankOf: () => null, finishers: [] };

test("Saadan blev etapen koert: kun udbrydderne taelles, en senere gruppe hedder gruppe foran feltet", () => {
  const lines = curateMoments(story([
    { key: "story.breakaway_formed", km: 10, rider_ids: ["a", "b"] },
    { key: "story.breakaway_caught", km: 80, rider_ids: ["b", "c"] },
    { key: "story.breakaway_survived", km: 151, rider_ids: ["c", "d"] },
  ], ["a", "b"]), CAST);
  const caught = lines.find((l) => l.kind === "caught");
  assert.equal(caught?.data.riders, 1);
  assert.deepEqual(caught?.mineIds, []);
  assert.equal(lines.find((l) => l.kind === "formed")?.data.ahead, undefined);
  assert.equal(lines.find((l) => l.kind === "survived")?.data.ahead, true);
});

test("historie uden kendt udbrud er uaendret", () => {
  assert.equal(morningFromStory(null), null);
  assert.equal(morningFromStory({ breakaway: null }), null);
  const line = { riderIds: ["x"], mineIds: [], count: 1, data: {} };
  assert.deepEqual(labelStoryLine(line, null), { riderIds: ["x"], mineIds: [], count: 1, data: {} });
});

test("udbruds-ikonerne (#7092/#7119) foelger samme regel: en rytter i en arvet udbrudsgruppe faar intet udbrudsflag", () => {
  const history = historyForStage({ timeline_version: 2, stage_number: 10, events: EVENTS }, 10, ["a", "b", "c", "d"]);
  const kinds = (id: string) => { const p = participationForResult({ rider_id: id, in_breakaway: true }, history); return p ? breakawayMarkerEntries(p).map((e) => e.kind) : null; };
  assert.deepEqual(kinds("a"), ["morning"]);
  assert.deepEqual(kinds("c"), []);
  assert.deepEqual(kinds("d"), []);
});
