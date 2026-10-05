// #6137: gentagne ens hændelser på samme km samles til én filmlinje.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import IntlMessageFormat from "intl-messageformat";
import { describeGroupedEvent, groupRepeatedFeedEvents, isGroupedCopy } from "./stageTimelineGrouping.ts";
import { buildFilmTimeline, describeEvent } from "./stageTimelineFilm.js";

const locales = {
  en: JSON.parse(readFileSync(new URL("../../public/locales/en/races.json", import.meta.url), "utf8")),
  da: JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8")),
};
const copy = (lng: "en" | "da", key: string, params: Record<string, unknown>) =>
  new IntlMessageFormat(locales[lng].detail.film.event[key], lng).format(params as never);

const merged = (km: number, ...riders: string[]) => ({ km, type: "group_merged", params: { group_id: `g-${km}-${riders[0]}`, rider_ids: riders } });
const reaction = (km: number, team: string, protectedRider: string, status = "started", extra: Record<string, unknown> = {}) =>
  ({ km, type: "gc_reaction", params: { team_id: team, status, protected_rider_id: protectedRider, ...extra } });
const attack = (km: number, rider: string) => ({ km, type: "finale_attack", params: { rider_id: rider } });
// Indsnævrer en beskrevet linje til en samlet linje; fejler testen hvis den ikke er det.
function asGrouped(line: Parameters<typeof isGroupedCopy>[0]) {
  assert.ok(isGroupedCopy(line), "forventede en samlet linje");
  return line;
}
const names = new Map(Array.from({ length: 40 }, (_, i) => [`r${i}`, `Rider ${i}`]));
const lineOf = (e: Parameters<typeof describeEvent>[0]) => describeEvent(e, { riderNameById: names });
const nameOf = (id: unknown) => names.get(id as string) ?? null;

// Anker: etape med 21 group_merged + 2 gc_reaction + 3 finale_attack på samme km.
function anchorStage() {
  return [
    { km: 0, type: "stage_start", params: { field_count: 150, profile_type: "mountain", distance_km: 180 } },
    ...Array.from({ length: 21 }, (_, i) => merged(175, `r${i}`)),
    reaction(175, "t1", "r30"),
    reaction(175, "t2", "r31"),
    attack(175, "r1"),
    attack(175, "r2"),
    attack(175, "r3"),
    { km: 180, type: "finish", params: { top: [{ rider_id: "r1", rank: 1 }], win_type: "solo_win" } },
  ];
}

test("anker: 26 linjer på samme km bliver højst 5 (uden egne ryttere: 3)", () => {
  const built = buildFilmTimeline({ events: anchorStage(), distanceKm: 180 });
  const atKm = built.feedEvents.filter((e) => e.km === 175);
  assert.equal(atKm.length, 3);
  const lines = atKm.map((e) => describeEvent(e, { riderNameById: names }));
  assert.deepEqual(lines.map((l) => l?.key), ["group_merged_batch", "gc_reaction_batch_started", "finale_attack_named_batch"]);
  assert.equal(asGrouped(lines[0]).params.count, 21);
  assert.equal(asGrouped(lines[1]).params.count, 2);
  assert.equal(asGrouped(lines[2]).params.riders, "Rider 1, Rider 2, Rider 3");
  // Motoren/den rå liste er uændret.
  assert.equal(built.events.filter((e) => e.km === 175).length, 26);
});

test("én hændelse vises uændret", () => {
  const events = [merged(10, "r1"), reaction(10, "t1", "r30"), attack(10, "r2"), { km: 20, type: "group_merged", params: { rider_ids: ["r3"] } }];
  const out = groupRepeatedFeedEvents(events);
  assert.deepEqual(out, events);
  assert.equal(out.every((e) => !("grouped" in e)), true);
});

test("ikke samme km eller ikke samme status samles ikke", () => {
  const out = groupRepeatedFeedEvents([
    merged(10, "r1"), merged(11, "r2"),
    reaction(12, "t1", "r30", "started"), reaction(12, "t2", "r31", "stopped"),
    reaction(13, "t1", "r30", "stopped", { reason: "contained" }), reaction(13, "t2", "r31", "stopped"),
  ]);
  assert.equal(out.length, 6);
  assert.equal(out.some((e) => e.grouped), false);
});

test("start og stop samles hver for sig", () => {
  const out = groupRepeatedFeedEvents([
    reaction(50, "t1", "r30", "started"), reaction(50, "t2", "r31", "started"),
    reaction(50, "t3", "r32", "stopped"), reaction(50, "t4", "r33", "stopped"),
    reaction(50, "t5", "r34", "stopped", { reason: "contained" }), reaction(50, "t6", "r35", "stopped", { reason: "contained" }),
  ]);
  assert.deepEqual(out.map((e) => describeGroupedEvent(e, nameOf, lineOf)?.key), [
    "gc_reaction_batch_started", "gc_reaction_batch_stopped", "gc_reaction_batch_contained",
  ]);
  assert.deepEqual(out.map((e) => e.grouped?.count), [2, 2, 2]);
});

test("egne ryttere forsvinder aldrig: deres hændelser står som egne, uændrede linjer", () => {
  const events = [
    merged(175, "r1"), merged(175, "r2", "r5"), merged(175, "r3"),
    reaction(175, "t1", "r30"), reaction(175, "t2", "r31"), reaction(175, "t3", "r32"),
    attack(175, "r1"), attack(175, "r2"), attack(175, "r5"),
  ];
  const out = groupRepeatedFeedEvents(events, { ownRiderIds: ["r5", "r31"] });
  const lines = out.map((e) => ({ e, d: describeEvent(e, { riderNameById: names }) }));
  // Egne hændelser (r5 i en gruppe, GC-rytter r31, angriberen r5) er med uændret.
  assert.ok(out.includes(events[1]));
  assert.ok(out.includes(events[4]));
  assert.ok(out.includes(events[8]));
  assert.equal(describeEvent(events[4], { riderNameById: names })?.key, "gc_reaction_started");
  // De øvrige samles og tæller kun de øvrige.
  const batch = lines.filter(({ e }) => e.grouped);
  assert.deepEqual(batch.map(({ d }) => { const g = asGrouped(d); return [g.key, g.params.count, g.params.scope]; }), [
    ["group_merged_batch", 2, "others"],
    ["gc_reaction_batch_started", 2, "others"],
    ["finale_attack_batch", 2, "others"],
  ]);
});

test("egen rytter som trussel i en GC-reaktion beholder også sin linje", () => {
  const out = groupRepeatedFeedEvents(
    [reaction(60, "t1", "r30", "started", { rider_ids: ["r5"] }), reaction(60, "t2", "r31"), reaction(60, "t3", "r32")],
    { ownRiderIds: new Set(["r5"]) },
  );
  assert.equal(out.length, 2);
  const firstIds = out[0].params?.rider_ids;
  assert.ok(Array.isArray(firstIds));
  assert.equal(firstIds[0], "r5");
  assert.equal(out[1].grouped?.count, 2);
});

test("samlet linje står på første medlems plads; interleavede typer samles stadig", () => {
  const events = [
    merged(80, "r1"), reaction(80, "t1", "r30"), merged(80, "r2"), reaction(80, "t2", "r31"), merged(80, "r3"),
    { km: 90, type: "finale_attack", params: { kind: "stage_decided", rider_id: "r1" } },
  ];
  const out = groupRepeatedFeedEvents(events);
  assert.deepEqual(out.map((e) => [e.type, e.grouped?.count]), [["group_merged", 3], ["gc_reaction", 2], ["finale_attack", undefined]]);
});

test("andre typer samles aldrig: uheld, nedkørsels-angreb og afgørelse står som de er", () => {
  const events = [
    { km: 5, type: "incident", params: { rider_id: "r1", kind: "crash" } },
    { km: 5, type: "incident", params: { rider_id: "r2", kind: "crash" } },
    { km: 5, type: "finale_attack", params: { direction: "descent", rider_ids: ["r1"] } },
    { km: 5, type: "finale_attack", params: { direction: "descent", rider_ids: ["r2"] } },
  ];
  assert.deepEqual(groupRepeatedFeedEvents(events), events);
});

test("angreb navngives kun når alle navne kendes og listen er kort", () => {
  const five = groupRepeatedFeedEvents(["r1", "r2", "r3", "r4", "r5"].map((r) => attack(7, r)));
  assert.equal(describeGroupedEvent(five[0], nameOf, lineOf)?.key, "finale_attack_batch");
  // Et ukendt navn tæller ikke med (#4026): her er kun én tilbage, og den står som sin egen linje.
  const unknown = groupRepeatedFeedEvents([attack(7, "r1"), attack(7, "ghost")]);
  const d = describeGroupedEvent(unknown[0], nameOf, lineOf);
  assert.deepEqual(d, { key: "finale_attack", params: { rider: "Rider 1" } });
  assert.equal(JSON.stringify(d).includes("ghost"), false);
});

const split = (km: number, ...riders: string[]) => ({ km, type: "peloton_splits", params: { rider_ids: riders } });

test("peloton_splits på samme km samles til én linje", () => {
  const out = groupRepeatedFeedEvents([split(120, "r1", "r2"), split(120, "r3"), split(120, "r4")]);
  assert.equal(out.length, 1);
  const g = asGrouped(lineOf(out[0]));
  assert.equal(g.key, "peloton_split_batch");
  assert.equal(g.params.count, 3);
  assert.equal(g.params.scope, "all");
});

test("status exhausted og unavailable samles hver for sig", () => {
  const out = groupRepeatedFeedEvents([
    reaction(140, "t1", "r30", "exhausted"), reaction(140, "t2", "r31", "exhausted"),
    reaction(140, "t3", "r32", "unavailable"), reaction(140, "t4", "r33", "unavailable"),
  ]);
  const lines = out.map((e) => asGrouped(lineOf(e)));
  assert.deepEqual(lines.map((l) => [l.key, l.params.count]), [
    ["gc_reaction_batch_exhausted", 2],
    ["gc_reaction_batch_no_workers", 2],
  ]);
});

test("tom og null-input giver en tom liste", () => {
  assert.deepEqual(groupRepeatedFeedEvents([]), []);
  assert.deepEqual(groupRepeatedFeedEvents(null), []);
  assert.deepEqual(groupRepeatedFeedEvents(undefined), []);
  assert.deepEqual(groupRepeatedFeedEvents(null, { ownRiderIds: null }), []);
  assert.deepEqual(buildFilmTimeline({ events: [], distanceKm: 100 }).feedEvents, []);
});

test("hændelser uden km blandes ikke med km 0", () => {
  const noKm = (rider: string) => ({ type: "group_merged", params: { rider_ids: [rider] } });
  const out = groupRepeatedFeedEvents([noKm("r1"), noKm("r2"), merged(0, "r3")]);
  assert.equal(out.length, 2);
  assert.equal(out[0].km, undefined);
  assert.equal(out[0].grouped?.count, 2);
  assert.equal(out[1].km, 0);
  assert.equal(out[1].grouped, undefined);
});

test("egen rytter genkendes også når id-typen er forskellig (tal mod streng)", () => {
  const numeric = [
    { km: 30, type: "group_merged", params: { rider_ids: [7] } },
    { km: 30, type: "group_merged", params: { rider_ids: [8] } },
    { km: 30, type: "group_merged", params: { rider_ids: [9] } },
  ];
  const out = groupRepeatedFeedEvents(numeric, { ownRiderIds: ["7"] });
  assert.ok(out.includes(numeric[0]), "egen rytter med tal-id skal stå på egen linje");
  assert.deepEqual(out.map((e) => [e.grouped?.count, e.grouped?.scope]), [[undefined, undefined], [2, "others"]]);

  const strings = [attack(31, "7"), attack(31, "8"), attack(31, "9")];
  const back = groupRepeatedFeedEvents(strings, { ownRiderIds: [7] });
  assert.ok(back.includes(strings[0]), "egen rytter med streng-id skal stå på egen linje");
  assert.equal(back[1].grouped?.count, 2);
});

test("hændelser uden navne bliver ikke til en samlet linje", () => {
  // Hver for sig skjules de (#4026); samlet må de heller ikke dukke op.
  const hidden = [
    reaction(150, "t1", "ghost-1"), reaction(150, "t2", "ghost-2"),
    { km: 150, type: "group_merged", params: { group_id: "g1" } },
    { km: 150, type: "group_merged", params: { group_id: "g2", rider_ids: ["ghost-3"] } },
    split(150, "ghost-4"), split(150),
    attack(150, "ghost-5"), attack(150, "ghost-6"),
  ];
  assert.deepEqual(hidden.map(lineOf), Array(hidden.length).fill(null));
  const built = buildFilmTimeline({ events: hidden, distanceKm: 180 });
  assert.deepEqual(built.feedEvents.map(lineOf).filter(Boolean), []);
});

test("kun beskrivelige medlemmer tæller; én tilbage vises som den enkelte linje", () => {
  // Én navngiven + én uden navn: den navngivne står som sin egen, uændrede linje.
  const one = groupRepeatedFeedEvents([reaction(160, "t1", "r30"), reaction(160, "t2", "ghost")]);
  assert.equal(one.length, 1);
  assert.deepEqual(lineOf(one[0]), lineOf(reaction(160, "t1", "r30")));
  // Uden navn står først: linjen er stadig den navngivne rytters.
  const first = groupRepeatedFeedEvents([attack(161, "ghost"), attack(161, "r2")]);
  assert.deepEqual(lineOf(first[0]), { key: "finale_attack", params: { rider: "Rider 2" } });
  // Tre medlemmer, ét uden navn: antallet er 2.
  const three = groupRepeatedFeedEvents([merged(162, "r1"), { km: 162, type: "group_merged", params: {} }, merged(162, "r2")]);
  const g = asGrouped(lineOf(three[0]));
  assert.equal(g.key, "group_merged_batch");
  assert.equal(g.params.count, 2);
  // Samme regel ved direkte kald.
  assert.equal(describeGroupedEvent(groupRepeatedFeedEvents([attack(163, "ghost"), attack(163, "ghost-2")])[0], nameOf, lineOf), null);
});

test("egne ryttere står fortsat på egen linje, når de øvrige mangler navne", () => {
  const events = [reaction(170, "t1", "r30"), reaction(170, "t2", "ghost-1"), reaction(170, "t3", "ghost-2")];
  const out = groupRepeatedFeedEvents(events, { ownRiderIds: ["r30"] });
  assert.ok(out.includes(events[0]));
  const lines = out.map(lineOf).filter(Boolean);
  assert.deepEqual(lines, [lineOf(events[0])]);
});

test("buildFilmTimeline: egne ryttere gives videre, uden dem samles der stadig", () => {
  const withOwn = buildFilmTimeline({ events: anchorStage(), distanceKm: 180, ownRiderIds: ["r2", "r31"] });
  assert.equal(withOwn.feedEvents.filter((e) => e.km === 175).length, 3 + 3);
});

test("tekster: alle nøgler findes på EN og DA og bøjes korrekt", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["group_merged_batch", { count: 21, scope: "all" }],
    ["peloton_split_batch", { count: 3, scope: "all" }],
    ["finale_attack_batch", { count: 6, scope: "others" }],
    ["finale_attack_named_batch", { riders: "A, B", count: 2 }],
    ["gc_reaction_batch_started", { count: 11, scope: "all" }],
    ["gc_reaction_batch_contained", { count: 3, scope: "others" }],
    ["gc_reaction_batch_stopped", { count: 11, scope: "all" }],
    ["gc_reaction_batch_exhausted", { count: 2, scope: "all" }],
    ["gc_reaction_batch_no_workers", { count: 2, scope: "all" }],
  ];
  for (const lng of ["en", "da"] as const) {
    for (const [key, params] of cases) {
      const text = String(copy(lng, key, params));
      assert.ok(text.length > 0 && !text.includes("{") && !text.includes("—"), `${lng}.${key}: ${text}`);
    }
  }
  assert.equal(copy("en", "group_merged_batch", { count: 21, scope: "all" }), "21 groups came back together.");
  assert.equal(copy("da", "group_merged_batch", { count: 21, scope: "all" }), "21 grupper samlet igen.");
  assert.equal(copy("en", "gc_reaction_batch_started", { count: 11, scope: "all" }), "11 teams reacted.");
  assert.equal(copy("da", "gc_reaction_batch_started", { count: 11, scope: "all" }), "11 hold reagerede.");
  assert.equal(copy("en", "group_merged_batch", { count: 20, scope: "others" }), "20 other groups came back together.");
  assert.equal(copy("da", "group_merged_batch", { count: 20, scope: "others" }), "20 andre grupper samlet igen.");
  assert.equal(copy("en", "gc_reaction_batch_exhausted", { count: 2, scope: "all" }), "2 teams spent what they could on the reaction this stage and stopped working.");
  assert.equal(copy("da", "gc_reaction_batch_exhausted", { count: 2, scope: "all" }), "2 hold brugte det, de kunne, på reaktionen på denne etape og stoppede arbejdet.");
});
