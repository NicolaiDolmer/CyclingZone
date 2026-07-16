// Race Engine v3 (#2224), slice S6 (#2355) — raceStageMoments.js unit-tests.
import test from "node:test";
import assert from "node:assert/strict";
import { isStoryTagKey, momentsForStage, whyBeatsForStage, storyTagsForRider } from "./raceStageMoments.js";

function moment(overrides = {}) {
  return { stage_number: 1, moment_key: "sprint_win", params: {}, significance: 50, rider_ids: [], team_ids: [], ...overrides };
}

test("isStoryTagKey: skelner tag_-momenter fra beats", () => {
  assert.ok(isStoryTagKey("tag_jour_sans"));
  assert.ok(!isStoryTagKey("sprint_win"));
  assert.ok(!isStoryTagKey(null));
  assert.ok(!isStoryTagKey(undefined));
});

test("momentsForStage: filtrerer på stage_number, tom liste ved manglende input", () => {
  const moments = [moment({ stage_number: 1 }), moment({ stage_number: 2 })];
  assert.equal(momentsForStage(moments, 1).length, 1);
  assert.equal(momentsForStage(moments, 3).length, 0);
  assert.deepEqual(momentsForStage(null, 1), []);
  assert.deepEqual(momentsForStage([], 1), []);
});

test("whyBeatsForStage: kun de dedikerede 'nyt-lag'-nøgler, aldrig tag_-momenter eller v1-overlappende nøgler", () => {
  const moments = [
    moment({ moment_key: "gc_takeover" }),
    moment({ moment_key: "favorite_off_day" }),
    moment({ moment_key: "helper_shift" }),
    moment({ moment_key: "form_peak" }),
    moment({ moment_key: "final_gc" }),
    moment({ moment_key: "sprint_win" }),         // v1-recap dækker allerede dette
    moment({ moment_key: "incident_time_loss" }), // dækkes af DnfSection/recap
    moment({ moment_key: "tag_jour_sans" }),       // story-tag, ikke en beat
  ];
  const beats = whyBeatsForStage(moments, 1).map((m) => m.moment_key);
  assert.deepEqual(beats.sort(), ["favorite_off_day", "final_gc", "gc_takeover", "helper_shift", "form_peak"].sort());
});

test("storyTagsForRider: kun tag_-momenter der involverer rytteren, dedupliceret på tværs af etaper når stageNumber=null", () => {
  const moments = [
    moment({ stage_number: 1, moment_key: "tag_jour_sans", rider_ids: ["r1"] }),
    moment({ stage_number: 5, moment_key: "tag_jour_sans", rider_ids: ["r1"] }), // samme tag igen — dedupliceres
    moment({ stage_number: 2, moment_key: "tag_peak_day", rider_ids: ["r1"] }),
    moment({ stage_number: 1, moment_key: "tag_crash_ruined", rider_ids: ["r2"] }), // anden rytter
    moment({ stage_number: 1, moment_key: "sprint_win", rider_ids: ["r1"] }),        // ikke en tag
  ];
  const overall = storyTagsForRider(moments, "r1");
  assert.deepEqual(overall.map((m) => m.moment_key).sort(), ["tag_jour_sans", "tag_peak_day"]);

  const stageScoped = storyTagsForRider(moments, "r1", 1);
  assert.deepEqual(stageScoped.map((m) => m.moment_key), ["tag_jour_sans"]);

  assert.deepEqual(storyTagsForRider(moments, "r2", 2), []);
  assert.deepEqual(storyTagsForRider(null, "r1"), []);
  assert.deepEqual(storyTagsForRider(moments, null), []);
});
