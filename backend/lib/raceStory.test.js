// #6350 #6234 #6469 #6512: raceStory.js - løbshistorien afledt af tidslinjen.
// To slags beviser:
//   1. Mod motoren selv (official_times_v4, de frosne proxy-etaper): historiens
//      mellemtider og sluttider er motorens egne (gruppe-snapshots og
//      resultater), og løbsudfaldet er uændret (fysik-digest), fordi historien
//      kun læser loggen.
//   2. Små håndbyggede tidslinjer for hver regel (#6234 klassifikation, #6469
//      forklarede huller, #6350 km-spænd, #6512 endagsløb, fog-gate).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { frozenStageOutput, physicsOf } from "./engine/v4/testUtils/oldRevisionDigests6199.ts";
import {
  buildRaceStory, checkpointGapForRider, leaderTimeAt, replayFrames,
  GAP_CHANGE_EXPLAIN_SECONDS, REPLAY_FINALE_KM,
} from "./raceStory.js";

const LIVE_REVISION = "official_times_v4";
const SEED = "6350-story";

function proxyStages() {
  const raw = JSON.parse(readFileSync(new URL("../scripts/baselines/v4-proxy-stages-2026-09-06.json", import.meta.url), "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.stages;
  const seen = new Map();
  // Én etape pr. profil/finale-form (dækker udbrud, splits, nedkørsler, enkeltstart).
  return rows.filter((row) => {
    const shape = `${row.profile_type}/${row.finale_type ?? "-"}`;
    if (seen.has(shape)) return false;
    seen.set(shape, true);
    return true;
  });
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finishers = (results) => results.filter((r) => r.status !== "abandoned").map((r) => ({ rider_id: r.rider_id, rank: r.rank }));

// ── 1. Mod motoren ────────────────────────────────────────────────────────────

test("#6350: historien ændrer intet ved motorens output (samme fysik og tidslinje før og efter)", () => {
  for (const row of proxyStages().slice(0, 6)) {
    const out = frozenStageOutput(row, SEED, LIVE_REVISION);
    const before = digest(out);
    const physicsBefore = digest(physicsOf(out));
    buildRaceStory({ events: out.timeline.events, timelineVersion: out.timeline.timeline_version, results: finishers(out.results) });
    assert.equal(digest(out), before, "input muteres aldrig");
    // Løbsudfaldet (resultater, tider, grupper) er det samme ved en ny kørsel.
    assert.equal(digest(physicsOf(frozenStageOutput(row, SEED, LIVE_REVISION))), physicsBefore);
  }
});

test("#6350: sluttiderne i historien er motorens resultattider (alle ryttere, alle etapeformer)", () => {
  let checked = 0;
  for (const row of proxyStages()) {
    const out = frozenStageOutput(row, SEED, LIVE_REVISION);
    const story = buildRaceStory({ events: out.timeline.events, timelineVersion: out.timeline.timeline_version, results: finishers(out.results) });
    if (story.time_trial) {
      // Enkeltstart: ingen gruppehistorie, tiderne står i resultatet.
      assert.equal(story.snapshots.length, 0);
      continue;
    }
    const finish = story.checkpoints.find((c) => c.kind === "finish");
    assert.ok(finish, `${row.profile_type}: mål-kontrolpunkt`);
    for (const result of out.results) {
      if (result.status === "abandoned") continue;
      const gap = checkpointGapForRider(finish, result.rider_id);
      assert.ok(gap && gap.time_s != null, `${row.profile_type}: ${result.rider_id} har en tid`);
      assert.ok(Math.abs(gap.time_s - result.time_seconds) <= 1, `${row.profile_type}: ${result.rider_id} ${gap.time_s} vs ${result.time_seconds}`);
      checked++;
    }
  }
  assert.ok(checked > 500, `mange ryttere kontrolleret (${checked})`);
});

test("#6350: mellemtiderne pr. tjekpunkt matcher motorens gruppe-snapshots", () => {
  let checked = 0;
  let off = 0;
  for (const row of proxyStages()) {
    const out = frozenStageOutput(row, SEED, LIVE_REVISION);
    const story = buildRaceStory({ events: out.timeline.events, timelineVersion: out.timeline.timeline_version });
    if (story.time_trial) continue;
    for (const snap of out.groupSnapshots ?? []) {
      const mine = story.snapshots.find((s) => Math.abs(s.km - snap.km) < 1e-6);
      if (!mine) continue; // intet i loggen på det km: replay interpolerer
      for (const group of snap.groups) {
        for (const id of group.rider_ids) {
          const gap = checkpointGapForRider(mine, id);
          assert.ok(gap, `${row.profile_type} km ${snap.km}: ${id} findes i historien`);
          checked++;
          if (Math.abs(gap.gap_s - group.gap_seconds) > 2) off++;
        }
      }
    }
  }
  assert.ok(checked > 5000, `mange rytter-tjekpunkter kontrolleret (${checked})`);
  // Loggen melder kun et hul når det har flyttet sig; en sjælden gruppe kan
  // derfor bære et lidt forældet hul. Kravet: praktisk talt alle er præcise.
  assert.ok(off / checked < 0.001, `${off} af ${checked} afviger mere end 2 s`);
});

test("#6350 #6469: hvert hul over tærsklen mellem to meldinger har en linje i historien", () => {
  for (const row of proxyStages()) {
    const out = frozenStageOutput(row, SEED, LIVE_REVISION);
    const story = buildRaceStory({ events: out.timeline.events, timelineVersion: out.timeline.timeline_version });
    for (let i = 1; i < story.snapshots.length; i++) {
      const prev = story.snapshots[i - 1];
      const next = story.snapshots[i];
      for (const group of next.groups) {
        if (group.gap_source !== "reported") continue;
        const before = prev.groups.find((g) => g.group_id === group.group_id);
        if (!before || Math.abs(group.gap_s - before.gap_s) < GAP_CHANGE_EXPLAIN_SECONDS) continue;
        const explainedByEvent = story.moments.some((m) => m.type !== "gap_change"
          && (m.recorded_km ?? m.km) > prev.km && (m.recorded_km ?? m.km) <= next.km);
        const gapLine = story.moments.some((m) => m.type === "gap_change" && m.data.group_id === group.group_id && m.recorded_km === next.km);
        assert.ok(explainedByEvent || gapLine, `${row.profile_type} km ${prev.km}-${next.km}: hul for ${group.group_id} uden forklaring`);
      }
    }
  }
});

test("#6350: hver historie-linje har km, og race-tid når loggen kender den", () => {
  for (const row of proxyStages().slice(0, 8)) {
    const out = frozenStageOutput(row, SEED, LIVE_REVISION);
    const story = buildRaceStory({ events: out.timeline.events, timelineVersion: out.timeline.timeline_version });
    for (const m of story.moments) {
      assert.ok(Number.isFinite(m.km), `${m.type} har km`);
      assert.ok(typeof m.key === "string" && m.key.startsWith("story."));
      if (!story.time_trial && m.type !== "incident") assert.ok(m.race_time_s == null || m.race_time_s >= 0);
    }
    if (!story.time_trial) {
      const timed = story.moments.filter((m) => m.race_time_s != null).length;
      assert.ok(timed / story.moments.length > 0.9, `${row.profile_type}: ${timed}/${story.moments.length} linjer har tid`);
    }
  }
});

// ── 2. Små tidslinjer pr. regel ──────────────────────────────────────────────

const ev = (km, type, params = {}) => ({ km, type, params });

/** Endagsløb, formet efter en rigtig v4-etape (anonymiseret). */
function oneDayTimeline() {
  return [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 10, profile_type: "flat" }),
    ev(0, "gc_context", { status: "one_day", exact_km: 0 }),
    ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["a", "b"], exact_km: 10, exact_time: 800, drops_reported: true }),
    ev(20, "gap_update", { group_id: "peloton-0", gap_seconds: 60, exact_km: 20, exact_time: 1660 }),
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 200, exact_km: 40, exact_time: 3400 }),
    ev(60, "kom_passage", { name: "Top", category: "2", exact_km: 60, top: [{ rider_id: "a", points: 5 }] }),
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 100, exact_km: 60, exact_time: 5100 }),
    ev(80, "gap_update", { group_id: "peloton-0", gap_seconds: 30, exact_km: 80, exact_time: 6630 }),
    ev(90, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a", "b"], chase_group_id: "peloton-0", chase_group_kind: "peloton", exact_km: 88.5, exact_time: 7400 }),
    ev(90, "group_merged", { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["a", "b"], exact_km: 88.5, exact_time: 7400 }),
    ev(100, "sprint_decided", { rider_ids: ["c"], photo_finish: false, exact_km: 100, exact_time: 8200 }),
    ev(100, "finish", { win_type: "bunch_sprint", exact_km: 100, exact_time: 8200 }),
  ];
}

test("#6512: et endagsløb (etape 1) får en fuld historie: øjeblikke, mellemtider og replay", () => {
  const story = buildRaceStory({ events: oneDayTimeline(), timelineVersion: 2 });
  assert.equal(story.distance_km, 100);
  assert.ok(story.moments.some((m) => m.key === "story.breakaway_formed"));
  assert.ok(story.moments.some((m) => m.key === "story.breakaway_caught" && m.km === 88.5 && m.race_time_s === 7400));
  const climb = story.checkpoints.find((c) => c.kind === "climb");
  assert.equal(climb.leader_time_s, 5000);
  assert.equal(climb.leader_group_id, "breakaway-0");
  assert.deepEqual(climb.leader_rider_ids, ["a", "b"]);
  assert.deepEqual(checkpointGapForRider(climb, "c"), { group_id: "peloton-0", gap_s: 100, time_s: 5100, in_front: false, via_rest: true });
  const frames = replayFrames(story);
  const finale = frames.filter((f) => f.km >= 100 - REPLAY_FINALE_KM);
  assert.deepEqual(finale.map((f) => f.km), [95, 96, 97, 98, 99, 100]);
});

test("#6350: førerens tid følger loggen (exact_time minus hul) og interpoleres mellem tjekpunkter", () => {
  const story = buildRaceStory({ events: oneDayTimeline(), timelineVersion: 2 });
  assert.equal(leaderTimeAt(story, 20), 1600);
  assert.equal(leaderTimeAt(story, 30), 2400);
  assert.equal(leaderTimeAt(story, 100), 8200);
});

test("#6469: et hul der vokser uden hændelse får en linje med km-vindue og terræn; et forklaret gør ikke", () => {
  const story = buildRaceStory({ events: oneDayTimeline(), timelineVersion: 2 });
  const lines = story.moments.filter((m) => m.type === "gap_change");
  // 60 -> 200 (km 20-40) og 200 -> 100 (km 40-60, over toppen) og 100 -> 30 (km 60-80).
  assert.deepEqual(lines.map((m) => [m.key, m.km_span.from, m.km_span.to, m.data.delta_s]), [
    ["story.gap_grew", 20, 40, 140],
    ["story.gap_shrank", 40, 60, -100],
    ["story.gap_shrank", 60, 80, -70],
  ]);
  assert.deepEqual(lines[1].data.terrain, [{ type: "kom_passage", km: 60, name: "Top", category: "2" }]);
  // Med et split i vinduet der rører gruppen, er hullet forklaret.
  const events = oneDayTimeline();
  events.splice(4, 0, ev(40, "peloton_splits", { group_id: "chase-1", source_group_id: "peloton-0", rider_ids: ["c"], exact_km: 35 }));
  const explained = buildRaceStory({ events, timelineVersion: 2 });
  assert.ok(!explained.moments.some((m) => m.type === "gap_change" && m.km === 20));
});

test("#6234: kun en indhentning med ryttere uden for udbruddet hedder 'udbruddet hentet'", () => {
  const base = oneDayTimeline().filter((e) => e.type !== "breakaway_caught" && e.type !== "group_merged");
  // Et afsat stykke af udbruddet lukker hullet: en samling, ikke en indhentning.
  const regroup = [
    ...base.slice(0, 3),
    ev(15, "breakaway_dropped", { group_id: "chase-1", from_group_id: "breakaway-0", rider_ids: ["b"], exact_km: 14 }),
    ev(30, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a"], chase_group_id: "chase-1", exact_km: 29 }),
    ev(30, "group_merged", { group_id: "chase-1", into_group_id: "breakaway-0", rider_ids: ["b"], exact_km: 29 }),
    ...base.slice(3),
  ];
  const story = buildRaceStory({ events: regroup, timelineVersion: 2 });
  assert.ok(!story.moments.some((m) => m.key === "story.breakaway_caught"));
  assert.ok(story.moments.some((m) => m.key === "story.breakaway_regrouped"));
  // To grupper uden udbrydere mødes: grupper samles, udbruddet er ikke hentet.
  const contact = [...base, ev(70, "breakaway_caught", { group_id: "gruppetto-9", rider_ids: ["x"], chase_group_id: "gruppetto-8", exact_km: 69 })];
  const story2 = buildRaceStory({ events: contact, timelineVersion: 2 });
  assert.ok(story2.moments.some((m) => m.key === "story.group_caught"));
  assert.ok(!story2.moments.some((m) => m.key === "story.breakaway_caught"));
});

test("#6234: udbryderes udfald afgøres som mærkerne (samme projektion + målresultatet)", () => {
  const events = oneDayTimeline().filter((e) => e.type !== "breakaway_caught" && e.type !== "group_merged");
  events.splice(events.length - 2, 0, ev(100, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["a", "b"], gap_seconds: 5, exact_km: 100, exact_time: 8200 }));
  const story = buildRaceStory({ events, timelineVersion: 2, results: [{ rider_id: "a", rank: 1 }, { rider_id: "b", rank: 2 }, { rider_id: "c", rank: 3 }] });
  assert.deepEqual(story.breakaway, { morning_rider_ids: ["a", "b"], outcomes: { a: "survived", b: "survived" } });
});

test("#6350: ældre v4-tidslinje uden exact_km viser det ærlige km-spænd, aldrig tjekpunktet som sandhed", () => {
  const events = [
    ev(0, "stage_start", { distance_km: 100, field_count: 10, profile_type: "flat" }),
    ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["a"] }),
    ev(50, "gap_update", { group_id: "peloton-0", gap_seconds: 120 }),
    ev(70, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a"], chase_group_id: "peloton-0" }),
    ev(100, "finish", { win_type: "bunch_sprint" }),
  ];
  const story = buildRaceStory({ events, timelineVersion: 2 });
  const caught = story.moments.find((m) => m.type === "breakaway_caught");
  assert.deepEqual(caught.km_span, { from: 50, to: 70 });
  assert.equal(caught.km, 50);
  assert.equal(caught.race_time_s, null, "ingen opdigtet tid uden exact_time");
  assert.equal(story.precise_times, false);
});

test("fog-gate: historien sender aldrig motor-interne nøgler videre", () => {
  const events = oneDayTimeline();
  events[2] = ev(10, "breakaway_formed", { ...events[2].params, score: 0.7, weights: [1] });
  const story = buildRaceStory({ events, timelineVersion: 2 });
  const formed = story.moments.find((m) => m.type === "breakaway_formed");
  assert.equal("score" in formed.data, false);
  assert.equal("weights" in formed.data, false);
});

test("deterministisk og ren: samme input giver samme historie, input muteres ikke", () => {
  const events = oneDayTimeline();
  const before = JSON.stringify(events);
  const a = buildRaceStory({ events, timelineVersion: 2 });
  const b = buildRaceStory({ events: JSON.parse(before), timelineVersion: 2 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(events), before);
});

test("uheldsoffer: rytteren knyttes til sin solo-gruppe (udledt) og får sit eget hul", () => {
  const events = oneDayTimeline();
  events.splice(3, 0, ev(12, "incident", { rider_id: "d", kind: "crash", outcome: "time_loss", time_loss_seconds: 90, exact_km: 12 }));
  events.splice(5, 0, ev(20, "gap_update", { group_id: "solo-m10-0-0", gap_seconds: 150, exact_km: 20, exact_time: 1750 }));
  const story = buildRaceStory({ events, timelineVersion: 2 });
  const snap = story.snapshots.find((s) => s.km === 20);
  const solo = snap.groups.find((g) => g.group_id === "solo-m10-0-0");
  assert.deepEqual(solo.rider_ids, ["d"]);
  assert.equal(solo.members_inferred, true);
  assert.equal(checkpointGapForRider(snap, "d").gap_s, 150);
  assert.equal(snap.groups.find((g) => g.includes_rest).size, 7);
});
