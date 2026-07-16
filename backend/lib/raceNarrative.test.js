// Race Engine v3 (#2224), slice S6 (#2355) — raceNarrative.js unit-tests.
import test from "node:test";
import assert from "node:assert/strict";

import { extractStageMoments, isStoryTagKey, STORY_TAG_KEYS } from "./raceNarrative.js";

function comp(overrides = {}) {
  return { terrain: 0.5, noise: 0, form: 0, fatigue: 0, team: 0, breakaway: 0, finale: 0, work_cost: 0, dayform: 0, jour_sans: 0, peak: 0, incident: 0, ...overrides };
}

function riderRow({ id, team = null, rank, gap = 0, components = {} }) {
  return { rider_id: id, team_id: team, rank, stageGap: gap, components: comp(components) };
}

function findMoment(moments, key) {
  return moments.find((m) => m.moment_key === key);
}
function findMoments(moments, key) {
  return moments.filter((m) => m.moment_key === key);
}

// ── Tier 0: finish-orden ────────────────────────────────────────────────────

test("sprint_win: gap < 3s til nr. 2", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 2, gap: 1 }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const m = findMoment(moments, "sprint_win");
  assert.ok(m, "forventede sprint_win");
  assert.equal(m.rider_ids[0], "r1");
});

test("close_win: gap 3-9s", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 2, gap: 5 }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  assert.ok(findMoment(moments, "close_win"));
});

test("solo_win: gap >= 10s", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 2, gap: 15 }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  assert.ok(findMoment(moments, "solo_win"));
});

test("breakaway_survived: vinder var i udbrud og blev ikke indhentet", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 2, gap: 20 }),
  ];
  const breakawayStatus = new Map([
    ["r1", { in_breakaway: true, breakaway_caught: false }],
    ["r3", { in_breakaway: true, breakaway_caught: false }],
  ]);
  const moments = extractStageMoments({ stageNumber: 1, ranked, breakawayStatus });
  const m = findMoment(moments, "breakaway_survived");
  assert.ok(m);
  assert.equal(m.params.count, 2);
});

test("breakaway_caught: udbrud blev indhentet, vinder kom ikke fra det", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 2, gap: 1 }),
  ];
  const breakawayStatus = new Map([
    ["r3", { in_breakaway: true, breakaway_caught: true }],
  ]);
  const moments = extractStageMoments({ stageNumber: 1, ranked, breakawayStatus });
  assert.ok(findMoment(moments, "breakaway_caught"));
  assert.ok(!findMoment(moments, "breakaway_survived"));
});

test("team_day: samme hold med >=2 i etapens top 10", () => {
  const ranked = [
    riderRow({ id: "r1", team: "t1", rank: 1, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", team: "t1", rank: 3 }),
    riderRow({ id: "r3", team: "t2", rank: 2 }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const m = findMoment(moments, "team_day");
  assert.ok(m);
  assert.equal(m.params.teamId, "t1");
  assert.equal(m.params.count, 2);
});

test("gc_takeover: kun når leder rent faktisk skifter, ikke på etape 1 (previousGcLeaderId=null)", () => {
  const ranked = [riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } })];
  const gc = [{ rider_id: "r1", rank: 1 }];
  const noPrev = extractStageMoments({ stageNumber: 1, isStageRace: true, ranked, gc, previousGcLeaderId: null });
  assert.ok(!findMoment(noPrev, "gc_takeover"));

  const samePrev = extractStageMoments({ stageNumber: 2, isStageRace: true, ranked, gc, previousGcLeaderId: "r1" });
  assert.ok(!findMoment(samePrev, "gc_takeover"), "uændret leder giver intet takeover-moment");

  const changedPrev = extractStageMoments({ stageNumber: 2, isStageRace: true, ranked, gc, previousGcLeaderId: "r9" });
  const m = findMoment(changedPrev, "gc_takeover");
  assert.ok(m);
  assert.equal(m.params.riderId, "r1");
  assert.equal(m.params.previousLeaderId, "r9");
});

test("final_gc: kun på sidste etape af et etapeløb", () => {
  const ranked = [riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } })];
  const gc = [{ rider_id: "r1", rank: 1 }, { rider_id: "r2", rank: 2 }, { rider_id: "r3", rank: 3 }];
  const notFinal = extractStageMoments({ stageNumber: 5, isStageRace: true, isFinal: false, ranked, gc, previousGcLeaderId: "r1" });
  assert.ok(!findMoment(notFinal, "final_gc"));
  const final = extractStageMoments({ stageNumber: 21, isStageRace: true, isFinal: true, ranked, gc, previousGcLeaderId: "r1" });
  const m = findMoment(final, "final_gc");
  assert.ok(m);
  assert.deepEqual(m.params.riderIds, ["r1", "r2", "r3"]);
});

// ── Tier 1: komponent-afledte momenter ──────────────────────────────────────

test("favorite_off_day: højeste terrain i feltet slutter uden for top 15, årsag=jour_sans", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.5 } }),
    riderRow({ id: "r2", rank: 20, components: { terrain: 0.95, jour_sans: -0.05 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const m = findMoment(moments, "favorite_off_day");
  assert.ok(m);
  assert.equal(m.params.riderId, "r2");
  assert.equal(m.params.rank, 20);
  assert.equal(m.params.reason, "jour_sans");
  assert.ok(findMoment(moments, "tag_favorite_collapse"), "jour_sans-forklaret favorit-nedtur giver også tag_favorite_collapse");
});

test("favorite_off_day: ingen forklarende komponent → reason=unexplained, ingen tag_favorite_collapse", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.5 } }),
    riderRow({ id: "r2", rank: 20, components: { terrain: 0.95 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const m = findMoment(moments, "favorite_off_day");
  assert.equal(m.params.reason, "unexplained");
  assert.ok(!findMoment(moments, "tag_favorite_collapse"));
});

test("favorite_off_day: udebliver når favoritten rent faktisk topper (top 15)", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.95 } }),
    riderRow({ id: "r2", rank: 2, components: { terrain: 0.5 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  assert.ok(!findMoment(moments, "favorite_off_day"));
});

test("tag_outsider_win: vinderen har IKKE feltets højeste terrain", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.4 } }),
    riderRow({ id: "r2", rank: 5, components: { terrain: 0.95 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const m = findMoment(moments, "tag_outsider_win");
  assert.ok(m);
  assert.equal(m.params.riderId, "r1");
});

test("form_peak: vinderens form >= 75", () => {
  const ranked = [riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } })];
  const formByRider = new Map([["r1", 80]]);
  const moments = extractStageMoments({ stageNumber: 1, ranked, formByRider });
  assert.ok(findMoment(moments, "form_peak"));
  const below = extractStageMoments({ stageNumber: 1, ranked, formByRider: new Map([["r1", 60]]) });
  assert.ok(!findMoment(below, "form_peak"));
});

test("helper_shift + tag_helper_sacrifice: kaptajn i top-5 modtog hjælp, >=2 hjælpere uden for top-25", () => {
  const ranked = [
    riderRow({ id: "captain", team: "t1", rank: 3, components: { terrain: 0.7, team: 0.05 } }),
    riderRow({ id: "helper1", team: "t1", rank: 40 }),
    riderRow({ id: "helper2", team: "t1", rank: 60 }),
    riderRow({ id: "rival", team: "t2", rank: 1, components: { terrain: 0.9 } }),
  ];
  const roleByRider = new Map([
    ["captain", "captain"], ["helper1", "helper"], ["helper2", "hunter"], ["rival", "free_role"],
  ]);
  const moments = extractStageMoments({ stageNumber: 1, ranked, roleByRider });
  const shift = findMoment(moments, "helper_shift");
  assert.ok(shift);
  assert.equal(shift.params.captainId, "captain");
  assert.deepEqual(shift.params.helperIds.sort(), ["helper1", "helper2"]);
  const sacrificeTags = findMoments(moments, "tag_helper_sacrifice");
  assert.equal(sacrificeTags.length, 2);
});

test("helper_shift udebliver når kaptajnens team-komponent ikke er positiv (ingen reel hjælp modtaget)", () => {
  const ranked = [
    riderRow({ id: "captain", team: "t1", rank: 3, components: { team: 0 } }),
    riderRow({ id: "helper1", team: "t1", rank: 40 }),
    riderRow({ id: "helper2", team: "t1", rank: 60 }),
  ];
  const roleByRider = new Map([["captain", "captain"], ["helper1", "helper"], ["helper2", "helper"]]);
  const moments = extractStageMoments({ stageNumber: 1, ranked, roleByRider });
  assert.ok(!findMoment(moments, "helper_shift"));
});

test("tag_jour_sans: fyrer når komponenten er forskellig fra 0", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } }),
    riderRow({ id: "r2", rank: 30, components: { jour_sans: -0.04 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked });
  const tags = findMoments(moments, "tag_jour_sans");
  assert.equal(tags.length, 1);
  assert.equal(tags[0].rider_ids[0], "r2");
});

test("tag_peak_day vs. tag_perfect_peak: sidstnævnte kun ved rank 1", () => {
  const winnerPeak = extractStageMoments({
    stageNumber: 1,
    ranked: [riderRow({ id: "r1", rank: 1, components: { terrain: 0.9, peak: 0.02 } })],
  });
  assert.ok(findMoment(winnerPeak, "tag_perfect_peak"));
  assert.ok(!findMoment(winnerPeak, "tag_peak_day"));

  const nonWinnerPeak = extractStageMoments({
    stageNumber: 1,
    ranked: [
      riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } }),
      riderRow({ id: "r2", rank: 4, components: { peak: 0.02 } }),
    ],
  });
  assert.ok(findMoment(nonWinnerPeak, "tag_peak_day"));
  assert.ok(!findMoment(nonWinnerPeak, "tag_perfect_peak"));
});

test("incidents: time_loss → incident_time_loss, abandon → incident_abandon", () => {
  const ranked = [riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } })];
  const incidentsForStage = [
    { rider_id: "r2", kind: "crash", outcome: "time_loss", time_loss_seconds: 45 },
    { rider_id: "r3", kind: "mechanical", outcome: "abandon" },
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked, incidentsForStage });
  const loss = findMoment(moments, "incident_time_loss");
  assert.equal(loss.params.secondsLost, 45);
  assert.ok(findMoment(moments, "incident_abandon"));
});

test("tag_crash_ruined: kun når uheldet ramte en top-5-terrain-favorit", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, components: { terrain: 0.9 } }),
    riderRow({ id: "favorite", rank: 2, components: { terrain: 0.95 } }),
    riderRow({ id: "r3", rank: 3, components: { terrain: 0.85 } }),
    riderRow({ id: "r4", rank: 4, components: { terrain: 0.8 } }),
    riderRow({ id: "r5", rank: 5, components: { terrain: 0.75 } }),
    riderRow({ id: "midpack", rank: 6, components: { terrain: 0.1 } }),
  ];
  const incidentsForStage = [
    { rider_id: "favorite", kind: "crash", outcome: "time_loss", time_loss_seconds: 60 },
    { rider_id: "midpack", kind: "crash", outcome: "time_loss", time_loss_seconds: 60 },
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked, incidentsForStage });
  const ruined = findMoments(moments, "tag_crash_ruined");
  assert.equal(ruined.length, 1);
  assert.equal(ruined[0].rider_ids[0], "favorite");
});

// ── Fog-gate + determinisme ─────────────────────────────────────────────────

test("fog-gate: ingen params-felt hedder som et rå komponent-navn med numerisk værdi ud over allerede-offentlige felter", () => {
  const ranked = [
    riderRow({ id: "r1", rank: 1, gap: 0, components: { terrain: 0.9, jour_sans: -0.04, peak: 0.02 } }),
    riderRow({ id: "r2", rank: 20, gap: 5, components: { terrain: 0.95, jour_sans: -0.05 } }),
  ];
  const moments = extractStageMoments({ stageNumber: 1, ranked, formByRider: new Map([["r1", 80]]) });
  const ALLOWED_NUMERIC_KEYS = new Set(["gapSeconds", "count", "rank", "secondsLost"]); // allerede offentlige/tælletal
  const RAW_COMPONENT_KEYS = new Set(["terrain", "noise", "form", "fatigue", "team", "breakaway", "finale", "work_cost", "dayform", "jour_sans", "peak", "incident"]);
  for (const m of moments) {
    for (const [k, v] of Object.entries(m.params || {})) {
      if (typeof v === "number") {
        assert.ok(ALLOWED_NUMERIC_KEYS.has(k), `params.${k} er et uventet numerisk felt i moment ${m.moment_key} — mulig fog-gate-lækage`);
      }
      assert.ok(!RAW_COMPONENT_KEYS.has(k), `params.${k} ser ud som et rå komponent-navn i moment ${m.moment_key}`);
    }
  }
});

test("determinisme: samme input giver bit-identisk output ved gentagne kald", () => {
  const ranked = [
    riderRow({ id: "captain", team: "t1", rank: 3, components: { terrain: 0.7, team: 0.05 } }),
    riderRow({ id: "helper1", team: "t1", rank: 40 }),
    riderRow({ id: "helper2", team: "t1", rank: 60 }),
    riderRow({ id: "rival", team: "t2", rank: 1, gap: 0, components: { terrain: 0.9, peak: 0.02 } }),
    riderRow({ id: "favorite", rank: 2, gap: 20, components: { terrain: 0.97, jour_sans: -0.05 } }),
  ];
  const roleByRider = new Map([["captain", "captain"], ["helper1", "helper"], ["helper2", "hunter"]]);
  const formByRider = new Map([["rival", 80]]);
  const breakawayStatus = new Map([["rival", { in_breakaway: true, breakaway_caught: false }]]);
  const incidentsForStage = [{ rider_id: "favorite", kind: "crash", outcome: "time_loss", time_loss_seconds: 30 }];
  const gc = [{ rider_id: "rival", rank: 1 }, { rider_id: "captain", rank: 2 }];

  const args = { stageNumber: 4, isStageRace: true, isFinal: false, ranked, roleByRider, formByRider, breakawayStatus, incidentsForStage, gc, previousGcLeaderId: "captain" };
  const a = extractStageMoments(args);
  const b = extractStageMoments(args);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0, "fixturen skal rent faktisk producere momenter (ellers tester determinisme-checket ingenting)");
});

// ── STORY_TAG_KEYS / isStoryTagKey ──────────────────────────────────────────

test("isStoryTagKey: skelner tag_-momenter fra beats", () => {
  assert.ok(isStoryTagKey("tag_jour_sans"));
  assert.ok(!isStoryTagKey("sprint_win"));
  for (const k of STORY_TAG_KEYS) assert.ok(isStoryTagKey(k));
});
