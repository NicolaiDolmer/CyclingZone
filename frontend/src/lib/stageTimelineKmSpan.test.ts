// #6294 + #6350: løbsfilmen viser hvad motoren regnede. Ingen falsk
// indhentning ved en samling af udbruddet, og hændelser stemplet ved et
// tjekpunkt står med det ærlige spænd "km A-B".
import { test } from "node:test";
import assert from "node:assert/strict";
import { honestTimelineEvents, honestKmResolver, lossEntriesWithFilmKm, filmKmValue, exactEventKm } from "./stageTimelineKmSpan.ts";
import { buildFilmTimeline, eventsPlayedUpTo } from "./stageTimelineFilm.js";
import { catchActorCopy, findMorningCatch } from "./raceCatchActor.ts";

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
