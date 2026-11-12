// #6294 + #6350: løbsfilmen viser hvad motoren regnede. Ingen falsk
// indhentning ved en samling af udbruddet, og hændelser stemplet ved et
// tjekpunkt står med det ærlige spænd "km A-B".
import { test } from "node:test";
import assert from "node:assert/strict";
import { honestTimelineEvents, honestKmResolver, lossEntriesWithFilmKm, filmKmValue, exactEventKm } from "./stageTimelineKmSpan.ts";
import { buildFilmTimeline, eventsPlayedUpTo } from "./stageTimelineFilm.js";
import { catchActorCopy, findMorningCatch } from "./raceCatchActor.ts";
import { buildOwnTimeLoss, buildSplitTimes } from "./stageSplitTimes.ts";
import { withEventPlaces } from "../../../backend/lib/raceTimeline.js";

type Ev = { km: number; type: string; params?: Record<string, unknown>; exact_km?: number; recorded_km?: number; km_span?: { from: number; to: number } };
const fmt = (value: number) => String(value);
const V4 = { timelineVersion: 2 };

// Prod-form (anonymiseret) af en kørt etape: segmentgrænser hver ~19 km,
// spurt ved km 105, en rytter der kører op til udbruddet stemplet ved
// tjekpunktet km 121,83, og en opdeling på toppen ved km 184.
const ranStage: Ev[] = [
  { km: 0, type: "stage_start", params: { distance_km: 190 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3"] } },
  { km: 76.16, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 200 } },
  { km: 85.84, type: "incident", params: { kind: "crash", outcome: "time_loss", rider_id: "p9", severity: "light" } },
  { km: 95.2, type: "group_merged", params: { group_id: "solo-x", into_group_id: "solo-y", rider_ids: ["p8"] } },
  { km: 100, type: "kom_passage", params: { name: "Top A", category: "3", top: [{ rider_id: "b1" }] } },
  { km: 103.2, type: "finale_attack", params: { direction: "descent", group_id: "solo-6000", rider_ids: ["b1"] } },
  { km: 105, type: "intermediate_sprint", params: { name: "Sprint", top: [{ rider_id: "b2" }] } },
  { km: 121.83, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b2", "b3"], chase_group_id: "solo-6000", chase_group_kind: "solo" } },
  { km: 121.83, type: "group_merged", params: { group_id: "solo-6000", into_group_id: "breakaway-0", rider_ids: ["b1"] } },
  { km: 177.7, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 100 } },
  { km: 184, type: "peloton_splits", params: { source_group_id: "peloton-0", group_id: "chase-1", rider_ids: ["p1", "p2"] } },
  { km: 184, type: "kom_passage", params: { name: "Top B", category: "2", top: [{ rider_id: "b1" }] } },
  { km: 190, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "finale-winner-0", rider_ids: ["b1"] } },
  { km: 190, type: "finish", params: { top: [{ rider_id: "b1", rank: 1 }] } },
];

test("#6350 a checkpoint-stamped merge shows the honest span from the last known point (the sprint)", () => {
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  const merge = shown.find((e) => e.type === "group_merged" && e.recorded_km === 121.83);
  assert.ok(merge);
  assert.deepEqual(merge.km_span, { from: 105, to: 121.83 });
  assert.equal(merge.km, 105);
  assert.equal(filmKmValue(merge, fmt), "105-122");
});

test("#6350 the span opens at the previous checkpoint when no passage is closer", () => {
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  const merge = shown.find((e) => e.type === "group_merged" && e.recorded_km === 95.2);
  assert.deepEqual(merge?.km_span, { from: 76.16, to: 95.2 });
  assert.equal(filmKmValue(merge, fmt), "76-96");
});

test("#6350 the split on a summit is sorted before the summit passage it led up to", () => {
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  const split = shown.findIndex((e) => e.type === "peloton_splits");
  const top = shown.findIndex((e) => e.type === "kom_passage" && e.km === 184);
  assert.ok(split >= 0 && top >= 0 && split < top);
  assert.equal(filmKmValue(shown[split], fmt), "177-184");
});

test("#6350 a passage that opens a span stays before the span; precise events keep their own km", () => {
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  const sprint = shown.findIndex((e) => e.type === "intermediate_sprint");
  const merge = shown.findIndex((e) => e.type === "group_merged" && e.recorded_km === 121.83);
  assert.ok(sprint < merge);
  for (const type of ["incident", "kom_passage", "intermediate_sprint", "breakaway_formed"]) {
    for (const e of shown.filter((x) => x.type === type)) assert.equal(e.km_span, undefined, type);
  }
});

test("#6350 events on the finish line never get a span", () => {
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  const finale = shown.find((e) => e.type === "group_merged" && e.km === 190);
  assert.ok(finale);
  assert.equal(finale.km_span, undefined);
  assert.equal(filmKmValue(finale, fmt), "190");
});

test("#6350 new stages with a precise contact km show that km, never a span", () => {
  const precise: Ev[] = ranStage.map((e) => e.type === "group_merged" && e.km === 121.83 ? { ...e, exact_km: 118.4 } : e);
  const shown = honestTimelineEvents(precise, V4) as Ev[];
  const merge = shown.find((e) => e.type === "group_merged" && e.km === 118.4);
  assert.ok(merge);
  assert.equal(merge.km_span, undefined);
  assert.equal(filmKmValue(merge, fmt), "118.4");
  assert.equal(exactEventKm({ type: "group_merged", params: { exact_km: 50.5 } }), 50.5);
  assert.equal(exactEventKm({ type: "group_merged", params: {} }), null);
});

test("#6350 v3 timelines (version 1) and unknown versions keep their own km, never a span", () => {
  for (const timelineVersion of [1, null]) {
    const shown = honestTimelineEvents(ranStage, { timelineVersion }) as Ev[];
    assert.equal(shown.some((e) => e.km_span), false);
    assert.ok(shown.some((e) => e.type === "group_merged" && e.km === 121.83));
  }
});

test("#6350 live playback shows a span line from the start of its span", () => {
  const film = buildFilmTimeline({ events: ranStage, distanceKm: 190, timelineVersion: 2 });
  const at = (km: number) => eventsPlayedUpTo(film.feedEvents, km).map((e: { km?: number; recorded_km?: number }) => e.recorded_km ?? e.km);
  assert.ok(at(106).includes(121.83));
  assert.ok(!at(104).includes(121.83));
});

test("#6294 the film never shows a regroup of the break as a catch; the catch point is not invented", () => {
  const film = buildFilmTimeline({ events: ranStage, distanceKm: 190, timelineVersion: 2 });
  assert.equal(film.feedEvents.some((e) => e.type === "breakaway_caught"), false);
  assert.equal(film.catchKm, null);
  assert.equal(catchActorCopy(ranStage), null);
});

test("#6294 a real catch keeps its film line and catch point at the checkpoint", () => {
  const caught: Ev[] = [
    ...ranStage.slice(0, 3),
    { km: 150.5, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
    { km: 150.5, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["b1", "b2", "b3"] } },
    { km: 190, type: "finish", params: {} },
  ];
  const film = buildFilmTimeline({ events: caught, distanceKm: 190, timelineVersion: 2 });
  const line = film.feedEvents.find((e) => e.type === "breakaway_caught") as Ev | undefined;
  assert.ok(line);
  assert.deepEqual(line.km_span, { from: 76.16, to: 150.5 });
  assert.equal(film.catchKm, 150.5);
});

const realCatch: Ev[] = [
  ...ranStage.slice(0, 3),
  { km: 150.5, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
  { km: 150.5, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["b1", "b2", "b3"] } },
  { km: 190, type: "finish", params: {} },
];

test("#6350 a precise contact km (exact_km) is the catch point and the film line, never a span", () => {
  const precise = realCatch.map((e) => e.km === 150.5 ? { ...e, exact_km: 141.2 } : e);
  const film = buildFilmTimeline({ events: precise, distanceKm: 190, timelineVersion: 2 });
  const line = film.feedEvents.find((e) => e.type === "breakaway_caught") as Ev | undefined;
  assert.equal(line?.km, 141.2);
  assert.equal(line?.km_span, undefined);
  assert.equal(film.catchKm, 141.2);
});

// Deterministisk blanding (ingen Math.random i tests). Hændelser på samme km
// beholder motorens indbyrdes rækkefølge: den ER tiden inden for et km, og
// ingen sortering kan genskabe den, hvis den smides væk.
function shuffled(items: readonly Ev[], seed: number): Ev[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  const byKm = new Map<number, Ev[]>();
  for (const e of items) byKm.set(e.km, [...(byKm.get(e.km) ?? []), e]);
  return out.map((e) => (byKm.get(e.km) as Ev[]).shift() as Ev);
}

test("#6294 findMorningCatch sorts before it looks: the input order never changes the answer", () => {
  for (const seed of [1, 7, 42, 1234, 99991]) {
    // Samlingen af udbruddet: aldrig en indhentning, uanset rækkefølge.
    const regroup = shuffled(ranStage, seed);
    assert.equal(findMorningCatch(regroup), null, `regroup seed ${seed}`);
    assert.equal(catchActorCopy(regroup), null, `regroup copy seed ${seed}`);
    // Den ægte indhentning findes, uanset rækkefølge.
    const caught = findMorningCatch(shuffled(realCatch, seed));
    assert.equal(caught?.type, "breakaway_caught", `catch seed ${seed}`);
    assert.equal(caught?.km, 150.5);
  }
  // Også når listen er filmens (spænd har flyttet `km` til spændets start).
  const fromFilm = findMorningCatch(honestTimelineEvents(realCatch, V4)) as Ev | null;
  assert.equal(fromFilm?.type, "breakaway_caught");
  assert.equal(fromFilm?.recorded_km, 150.5);
  assert.equal(findMorningCatch(honestTimelineEvents(ranStage, V4)), null);
});

test("#6350 'where your riders lost time' shows the same km as the film line", () => {
  const events: Ev[] = [
    ...ranStage.slice(0, 11),
    { km: 184, type: "peloton_splits", params: { source_group_id: "peloton-0", group_id: "chase-1", rider_ids: ["p1", "p2"] } },
    { km: 184, type: "kom_passage", params: { name: "Top B", category: "2", top: [{ rider_id: "b1" }] } },
    { km: 190, type: "finish", params: {} },
  ];
  const losses = [
    { type: "drop", km: 184, riderId: "p1" },
    { type: "event", km: 85.84, riderId: "p9", event: events[3] },
  ];
  const shown = lossEntriesWithFilmKm(events, losses, V4);
  // Filmens rækkefølge: styrtet (præcist) før faldet (spændet 177-184).
  assert.deepEqual(shown.map((l) => l.riderId), ["p9", "p1"]);
  assert.equal(filmKmValue(shown[0].shown, fmt), "85.84");
  const film = buildFilmTimeline({ events, distanceKm: 190, timelineVersion: 2 });
  const filmSplit = film.feedEvents.find((e) => e.type === "peloton_splits");
  assert.equal(filmKmValue(shown[1].shown, fmt), filmKmValue(filmSplit, fmt));
  assert.equal(filmKmValue(shown[1].shown, fmt), "177-184");
  // v3 og et præcist kontakt-km: ingen spænd, samme km som filmen.
  assert.equal(filmKmValue(lossEntriesWithFilmKm(events, losses, { timelineVersion: 1 })[1].shown, fmt), "184");
  const precise = events.map((e) => e.type === "peloton_splits" ? { ...e, exact_km: 181.5 } : e);
  assert.equal(filmKmValue(lossEntriesWithFilmKm(precise, losses, V4)[1].shown, fmt), "181.5");
});

test("#6350 honestKmResolver gives a single event the km its film line shows", () => {
  const resolve = honestKmResolver(ranStage, V4);
  const shown = honestTimelineEvents(ranStage, V4) as Ev[];
  for (const raw of ranStage.filter((e) => e.type !== "breakaway_caught")) {
    const line = shown.find((e) => e.type === raw.type && (e.recorded_km ?? e.km) === raw.km && e.params === raw.params);
    assert.ok(line, `${raw.type}@${raw.km}`);
    assert.equal(filmKmValue(resolve(raw), fmt), filmKmValue(line, fmt), `${raw.type}@${raw.km}`);
  }
});

test("#6350: et split i to halvdele: tabslisten viser hver rytters eget sted", () => {
  const half = (riderIds: string[], exactKm: number) => ({ type: "peloton_splits", km: 180, params: { group_id: "g", rider_ids: riderIds, exact_km: exactKm } });
  const events = [{ type: "stage_start", km: 0, params: {} }, half(["set"], 170.47), half(["late"], 180), { type: "finish", km: 180, params: {} }];
  const shown = lossEntriesWithFilmKm(events, [{ type: "drop", km: 180, riderId: "late" }, { type: "drop", km: 180, riderId: "set" }], V4);
  assert.deepEqual(shown.map((l) => [l.riderId, filmKmValue(l.shown, fmt)]), [["set", "170.47"], ["late", "180"]]);
});

test("#6350: hele kæden: egne ryttere fra hver halvdel af et split er to linjer med hver deres sted", () => {
  const split = (groupId: string, gap: number, exactKm: number, riderIds: string[], exactTime: number) => ({ km: 180, type: "peloton_splits", params: { group_id: groupId, source_group_id: "peloton-0", gap_seconds: gap, rider_ids: riderIds, exact_km: exactKm, exact_time: exactTime } });
  const log = (contact: boolean) => [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0, field_count: 20 } },
    { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["late-own"], exact_km: 10, exact_time: 900 } },
    { km: 170, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 91, exact_km: 170, exact_time: 17000 } },
    { km: 174.07, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ["late-own"], exact_km: 174.07 } },
    { km: 174.07, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ["late-own"], exact_km: 174.07 } },
    split("gruppetto-1", 53.09, 170.76, ["a"], 17609),
    split("gruppetto-2", 62.38, 170.71, ["b"], 17599),
    split("gruppetto-3", 302.73, 180, ["set-own", "late-own"], 19700),
    ...(contact ? [{ km: 180, type: "group_merged", params: { group_id: "gruppetto-3", into_group_id: "gruppetto-2", rider_ids: ["set-own", "late-own"], exact_km: 176 } }] : []),
    { km: 180, type: "finish", params: { exact_km: 180, top: [] } },
  ];
  const lines = (contact: boolean) => {
    const events = withEventPlaces(log(contact)) as Ev[];
    return lossEntriesWithFilmKm(events, buildOwnTimeLoss(events as never, { ownRiderIds: ["set-own", "late-own"] }), V4)
      .map((l) => [(l as { riderIds?: string[] }).riderIds, filmKmValue(l.shown, fmt)]);
  };
  const [setLine, lateLine] = lines(false);
  assert.deepEqual(setLine[0], ["set-own"]);
  assert.ok(Number(setLine[1]) > 170.4 && Number(setLine[1]) < 171, `sat ved km ${setLine[1]}`);
  assert.deepEqual(lateLine[0], ["late-own"]);
  assert.ok(Number(lateLine[1]) > 174.07 && Number(lateLine[1]) < 175, `#7734: tabet begynder efter kontakten, fik km ${lateLine[1]}`);
  assert.equal(lines(false).length, 2);
  assert.deepEqual(lines(true)[1], [["late-own"], "176"], "med gruppens kontakt står han på kontakten");
});

test("#6350: ryttere på samme sted er stadig én linje", () => {
  const events = [
    { km: 0, type: "stage_start", params: {} },
    { km: 100, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 10 } },
    { km: 180, type: "peloton_splits", params: { group_id: "g", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["x", "y"], exact_km: 170.47 } },
    { km: 180, type: "finish", params: {} },
  ];
  const entries = buildOwnTimeLoss(events as never, { ownRiderIds: ["x", "y"] });
  assert.equal(entries.length, 1);
  assert.deepEqual((entries[0] as { riderIds: string[] }).riderIds, ["x", "y"]);
});

/// ── #7965: angrebet på sidste stigning er to linjer: angrebet ved foden, udfaldet hvor motoren stemplede det ──

// Prod-form (Tour de l'Hexagone etape 11, mål ved km 170): all_out_gain stemplet ved toppen med
// ægte sluttid, all_out_cracked med det ÆGTE km og den ægte løbstid for knækket.
const climbFinish: Ev[] = [
  { km: 0, type: "stage_start", params: { distance_km: 170 } },
  { km: 60, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 90 } },
  { km: 140, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 60 } },
  { km: 170, type: "all_out_gain", params: { rider_id: "r1", exact_km: 170, exact_time: 17441.78 } },
  { km: 170, type: "all_out_cracked", params: { rider_id: "r2", exact_km: 160.05, exact_time: 15490.94 } },
  { km: 170, type: "finish", params: { top: [{ rider_id: "r1", rank: 1 }] } },
];
const finalClimb = [{ crest_km: 170, length_km: 14, name: "Col du Test" }];
type Part = Ev & { climb_phase?: "attack" | "outcome"; climb_name?: string; race_time_s?: number };
const part = (list: Ev[], type: string, phase: string) => (list as Part[]).find((e) => e.type === type && e.climb_phase === phase);

test("#7965 each all-out line on a summit finish becomes TWO lines: the attack at the foot, the outcome where the engine stamped it", () => {
  const shown = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  for (const type of ["all_out_gain", "all_out_cracked"]) {
    assert.equal(shown.filter((e) => e.type === type).length, 2, `${type}: two lines`);
    const attack = part(shown, type, "attack")!;
    assert.equal(attack.km, 156, "attack = foot = crest_km - length_km");
    assert.equal(attack.km_span, undefined, "no interval (owner 12/11)");
    assert.equal(attack.race_time_s, undefined, "the film has no true time for the foot: none is invented");
    assert.equal(attack.climb_name, "Col du Test");
    assert.equal(attack.recorded_km, 170, "the engine's stamp is kept for the task lookup");
    assert.equal(filmKmValue(attack, fmt), "156");
  }
});

test("#7965 the attack line carries none of the engine's exact contact data", () => {
  const shown = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  for (const type of ["all_out_gain", "all_out_cracked"]) {
    const attack = part(shown, type, "attack")!;
    assert.equal(attack.exact_km, undefined);
    assert.equal(attack.params?.exact_km, undefined);
    assert.equal(attack.params?.exact_time, undefined);
    assert.equal(attack.params?.rider_id, type === "all_out_gain" ? "r1" : "r2");
  }
});

test("#7965 cracked: the outcome stands at the engine's true km with its true race time", () => {
  const shown = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  const cracked = part(shown, "all_out_cracked", "outcome")!;
  assert.equal(cracked.km, 160.05);
  assert.equal(cracked.race_time_s, 15490.94);
  assert.equal(cracked.km_span, undefined);
  assert.equal(filmKmValue(cracked, fmt), "160.05");
});

test("#7965 held: the outcome stands at the top with the engine's true finish time", () => {
  const shown = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  const gain = part(shown, "all_out_gain", "outcome")!;
  assert.equal(gain.km, 170);
  assert.equal(gain.race_time_s, 17441.78);
  assert.equal(gain.km_span, undefined);
});

test("#7965 chronological: attack before outcome, outcome at or before the finish line, never an interval", () => {
  const shown = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  const at = (type: string, phase: string) => shown.indexOf(part(shown, type, phase)!);
  assert.ok(at("all_out_cracked", "attack") < at("all_out_cracked", "outcome"));
  assert.ok(at("all_out_gain", "attack") < at("all_out_gain", "outcome"));
  assert.ok(at("all_out_gain", "outcome") < shown.findIndex((e) => e.type === "finish"));
  assert.ok(at("all_out_cracked", "outcome") < at("all_out_gain", "outcome"));
  const kms = shown.map((e) => e.km);
  assert.deepEqual(kms, [...kms].sort((a, b) => a - b), "km never goes backwards");
  assert.ok(shown.every((e) => !e.km_span), "no line is shown as an interval");
});

test("#7965 a cracked line without exact km/time stands at the top with no invented time", () => {
  const old: Ev[] = climbFinish.map((e) => (e.type === "all_out_cracked" ? { km: 170, type: e.type, params: { rider_id: "r2" } } : e));
  const shown = honestTimelineEvents(old, { ...V4, climbs: finalClimb }) as Ev[];
  const cracked = part(shown, "all_out_cracked", "outcome")!;
  assert.equal(cracked.km, 170);
  assert.equal(cracked.race_time_s, undefined);
  assert.equal(part(shown, "all_out_cracked", "attack")!.km, 156);
});

test("#7965 an exact km at or before the foot is not trusted: the outcome stands at the top", () => {
  const odd: Ev[] = climbFinish.map((e) => (e.type === "all_out_cracked" ? { km: 170, type: e.type, params: { rider_id: "r2", exact_km: 150, exact_time: 1 } } : e));
  const cracked = part(honestTimelineEvents(odd, { ...V4, climbs: finalClimb }) as Ev[], "all_out_cracked", "outcome")!;
  assert.equal(cracked.km, 170);
  assert.equal(cracked.race_time_s, undefined);
});

test("#7965 the climb name falls back to the timeline's own summit marker, then to none", () => {
  const withKom: Ev[] = [...climbFinish.slice(0, 3), { km: 170, type: "kom_passage", params: { name: "Col Marker", category: "1" } }, ...climbFinish.slice(3)];
  assert.equal(part(honestTimelineEvents(withKom, { ...V4, climbs: [{ crest_km: 170, length_km: 14 }] }) as Ev[], "all_out_gain", "attack")!.climb_name, "Col Marker");
  assert.equal(part(honestTimelineEvents(climbFinish, { ...V4, climbs: [{ crest_km: 170, length_km: 14 }] }) as Ev[], "all_out_gain", "attack")!.climb_name, undefined);
});

test("#7965 without the climb in the profile the previous known point is the attack point (still two lines)", () => {
  const shown = honestTimelineEvents(climbFinish, V4) as Ev[];
  const attack = part(shown, "all_out_gain", "attack")!;
  assert.equal(attack.km, 140);
  assert.equal(attack.km_span, undefined);
  assert.equal(part(shown, "all_out_gain", "outcome")!.km, 170);
});

test("#7965 a stage whose profile has no climb ending at the finish is unchanged (one line each, as before)", () => {
  const flat = honestTimelineEvents(climbFinish, { ...V4, climbs: [] }) as Ev[];
  const wrongClimb = honestTimelineEvents(climbFinish, { ...V4, climbs: [{ crest_km: 120, length_km: 8 }] }) as Ev[];
  assert.deepEqual(wrongClimb, flat);
  assert.equal(flat.filter((e) => e.type.startsWith("all_out")).length, 2);
  assert.ok(flat.every((e) => !(e as Part).climb_phase));
});

test("#7965 an all-out line before a descent finish (not at the finish) and v3 timelines are unchanged", () => {
  const descent: Ev[] = [
    { km: 0, type: "stage_start", params: { distance_km: 182 } },
    { km: 150, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 60 } },
    { km: 160, type: "all_out_gain", params: { rider_id: "r1" } },
    { km: 182, type: "finish", params: {} },
  ];
  const shown = honestTimelineEvents(descent, { ...V4, climbs: [{ crest_km: 160, length_km: 9 }] }) as Ev[];
  assert.deepEqual(shown.find((e) => e.type === "all_out_gain"), descent[2]);
  const v3 = honestTimelineEvents(climbFinish, { timelineVersion: 1, climbs: finalClimb }) as Ev[];
  assert.equal(v3.filter((e) => e.type === "all_out_cracked").length, 1);
});

test("#7965 other event types and the rest of a summit finish stay as they were", () => {
  const withClimbs = honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb }) as Ev[];
  const without = honestTimelineEvents(climbFinish, { ...V4, climbs: [] }) as Ev[];
  const rest = (list: Ev[]) => list.filter((e) => !e.type.startsWith("all_out"));
  assert.deepEqual(rest(withClimbs), rest(without));
});

test("#7965 the resolver and the loss list give the outcome line (the knock), not the attack", () => {
  const resolve = honestKmResolver(climbFinish, { ...V4, climbs: finalClimb });
  const shown = resolve(climbFinish[4]) as Part;
  assert.equal(shown.km, 160.05);
  assert.equal(shown.climb_phase, "outcome");
  assert.equal(shown.race_time_s, 15490.94);
  const entries = lossEntriesWithFilmKm(climbFinish, [{ type: "event", km: 170, riderId: "r2", event: climbFinish[4] }], { ...V4, climbs: finalClimb });
  assert.equal(entries[0].shown.km_span, undefined);
  assert.equal(entries[0].shown.km, 160.05);
  assert.equal((entries[0].event as Part).climb_phase, "outcome");
});

test("#7965 split times (mellemtider) are unchanged and the raw timeline is never mutated", () => {
  const before = JSON.parse(JSON.stringify(buildSplitTimes(climbFinish as never, { ownRiderIds: [] })));
  const snapshot = JSON.parse(JSON.stringify(climbFinish));
  honestTimelineEvents(climbFinish, { ...V4, climbs: finalClimb });
  honestKmResolver(climbFinish, { ...V4, climbs: finalClimb })(climbFinish[3]);
  lossEntriesWithFilmKm(climbFinish, [{ type: "event", km: 170, riderId: "r2", event: climbFinish[4] }], { ...V4, climbs: finalClimb });
  assert.deepEqual(climbFinish, snapshot, "raw events are not mutated");
  assert.deepEqual(buildSplitTimes(climbFinish as never, { ownRiderIds: [] }), before);
  assert.ok(before.every((p: { km: number }) => p.km !== 156 && p.km !== 160.05), "no split point at the foot or at the knock");
});
