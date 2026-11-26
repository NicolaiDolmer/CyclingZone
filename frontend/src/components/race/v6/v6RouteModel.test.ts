// #8253 · Én fælles rute i v6: rutens punkter, teksten ved mærkerne og
// reglen for etiketter uden overlap (smal og bred). Opdigtede stigninger.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  V6_ROUTE_NARROW_BELOW, v6ClimbTag, v6LayoutLabels, v6RouteCategory, v6RouteLabelPlan, v6RoutePoints,
  v6RouteSize, v6SprintTag, v6SummitFinish, v6TextWidth, type V6LabelItem, type V6LabelMarker,
} from "./v6RouteModel.ts";
import type { StageProfile } from "../stagePageV2/stagePageV2Model.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const mountainStage: StageProfile = {
  stage_number: 3,
  profile_type: "mountain",
  distance_km: 160,
  elevation_gain_m: 3200,
  climbs: [
    { name: "Col Sud", category: "1", crest_km: 120, length_km: 12, avg_gradient: 7 },
    { name: "Côte Nord", category: "3", crest_km: 56, length_km: 4, avg_gradient: 5 },
    { name: "Mont Final", category: "hc", crest_km: 159.6, length_km: 14, avg_gradient: 8 },
    { name: "Bad", category: "2", crest_km: 80, length_km: 0, avg_gradient: 6 },
  ],
  sprints: [
    { name: "Ville", km: 90, kind: "intermediate" },
    { name: "Bourg", km: 42, kind: "intermediate" },
    { name: "Finish", km: 160, kind: "finish" },
  ],
};

test("rutens punkter: bjergpriser nummereres efter top-km, kun mellemspurter, sidste 10 km", () => {
  const p = v6RoutePoints(mountainStage);
  assert.deepEqual(p.climbs.map((c) => [c.number, c.name, c.cat, c.km]), [
    [1, "Côte Nord", "3", 56],
    [2, "Col Sud", "1", 120],
    [3, "Mont Final", "HC", 159.6],
  ]);
  assert.deepEqual(p.sprints, [{ number: 1, km: 42 }, { number: 2, km: 90 }]);
  assert.equal(p.finishKm, 160);
  assert.equal(p.finalKmFrom, 150);
  assert.equal(v6SummitFinish(p), true);
  assert.equal(v6RoutePoints({ distance_km: 8 }).finalKmFrom, null, "en kort enkeltstart har ingen sidste 10 km-markering");
  assert.equal(v6SummitFinish(v6RoutePoints({ distance_km: 100, climbs: [{ crest_km: 60, length_km: 5, avg_gradient: 6, category: "2" }] })), false);
});

test("kategori-mærket skriver som Etape-fanen", () => {
  assert.equal(v6RouteCategory("hc"), "HC");
  assert.equal(v6RouteCategory("2"), "2");
  assert.equal(v6RouteCategory(null), "?");
});

test("to størrelser: smal under Etape-fanens grænse, ellers bred", () => {
  assert.equal(v6RouteSize(390), "narrow");
  assert.equal(v6RouteSize(400), "narrow");
  assert.equal(v6RouteSize(V6_ROUTE_NARROW_BELOW - 1), "narrow");
  assert.equal(v6RouteSize(V6_ROUTE_NARROW_BELOW), "wide");
  assert.equal(v6RouteSize(0), "wide", "ukendt bredde tegnes ikke smalt");
});

test("teksten ved mærket: bred = nummer + km, smal = kun nummer (km i listen)", () => {
  assert.equal(v6ClimbTag({ number: 2, km: 56.4 }, "wide"), "#2 · km 56");
  assert.equal(v6ClimbTag({ number: 2, km: 56.4 }, "narrow"), "#2");
  assert.equal(v6SprintTag({ km: 41.6 }, "wide"), "km 42");
  assert.equal(v6SprintTag({ km: 41.6 }, "narrow"), null);
});

function boxOf(it: V6LabelItem, side: "left" | "right"): [number, number] {
  return side === "right" ? [it.x + it.gap, it.x + it.gap + it.width] : [it.x - it.gap - it.width, it.x - it.gap];
}

function assertNoOverlap(width: number, markers: V6LabelMarker[], items: V6LabelItem[], sides: Array<"left" | "right" | null>) {
  const boxes: Array<[number, number]> = [];
  items.forEach((it, i) => {
    const side = sides[i];
    if (!side) return;
    const b = boxOf(it, side);
    assert.ok(b[0] >= 0 && b[1] <= width, `etiket ${i} står uden for tegningen`);
    for (const m of markers) {
      if (Math.abs(m.x - it.x) <= 0.5) continue;
      assert.ok(!(m.x + m.half > b[0] && m.x - m.half < b[1]), `etiket ${i} dækker et andet mærke`);
    }
    for (const o of boxes) assert.ok(!(o[0] < b[1] && o[1] > b[0]), `etiket ${i} overlapper en anden etiket`);
    boxes.push(b);
  });
}

test("smal regel: tætte stigninger overlapper aldrig; hårdeste kategori får pladsen først", () => {
  const W = 400, D = 180;
  const x = (km: number) => (km / D) * W;
  const profile: StageProfile = {
    distance_km: D,
    climbs: [
      { name: "A", category: "3", crest_km: 100, length_km: 3, avg_gradient: 5 },
      { name: "C", category: "2", crest_km: 104, length_km: 6, avg_gradient: 6 },
      { name: "B", category: "HC", crest_km: 108, length_km: 10, avg_gradient: 8 },
    ],
    sprints: [{ km: 102, kind: "intermediate" }],
  };
  const points = v6RoutePoints(profile);
  const plan = v6RouteLabelPlan(points, "narrow", W, x);
  assert.deepEqual(plan.climbs.map((c) => c.tag), ["#1", "#2", "#3"]);
  assert.ok(plan.climbs[2].side, "HC-stigningen har sit nummer på profilen");
  assert.equal(plan.climbs[1].side, null, "den klemte midterste etiket udelades (står i listen)");
  assert.ok(plan.sprints.every((s) => s.side === null && s.tag === null), "smal: spurten har kun mærket");
});

test("reglen overlapper aldrig, heller ikke i tilfældige tætte ruter (smal og bred)", () => {
  let seed = 8253;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let run = 0; run < 300; run++) {
    const narrow = run % 2 === 0;
    const W = narrow ? 360 + Math.floor(rnd() * 270) : 640 + Math.floor(rnd() * 600);
    const D = 40 + Math.floor(rnd() * 200);
    const n = 1 + Math.floor(rnd() * 8);
    const climbs = Array.from({ length: n }, (_, i) => ({
      name: `Climb ${i} ${"x".repeat(Math.floor(rnd() * 14))}`,
      category: ["HC", "1", "2", "3", "4"][Math.floor(rnd() * 5)],
      crest_km: Math.round(rnd() * D * 10) / 10,
      length_km: 1 + rnd() * 10,
      avg_gradient: 5,
    }));
    const sprints = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ km: Math.round(rnd() * D), kind: "intermediate" }));
    const points = v6RoutePoints({ distance_km: D, climbs, sprints });
    const x = (km: number) => (km / D) * W;
    const size = narrow ? "narrow" : "wide";
    const finishW = v6SummitFinish(points) ? 0 : v6TextWidth("Finish · 1,234 m", 11);
    const plan = v6RouteLabelPlan(points, size, W, x, { finishLabelWidth: finishW });
    // Genskab de samme intervaller som planen brugte, og tjek dem.
    const markers = [
      ...points.climbs.map((c) => ({ x: x(c.km), half: 11 })),
      ...points.sprints.map((s) => ({ x: x(s.km), half: 8 })),
    ];
    const items: V6LabelItem[] = [];
    const sides: Array<"left" | "right" | null> = [];
    points.climbs.forEach((c, i) => {
      const p = plan.climbs[i];
      const w = Math.max(v6TextWidth(p.tag, 11), p.name ? v6TextWidth(p.name, 12) : 0);
      items.push({ x: x(c.km), width: w, gap: narrow ? 13 : 16 });
      sides.push(p.side);
      if (narrow) assert.equal(p.name, null, "smal: intet navn på profilen");
    });
    points.sprints.forEach((s, i) => {
      const p = plan.sprints[i];
      items.push({ x: x(s.km), width: p.tag ? v6TextWidth(p.tag, 11) : 0, gap: 11 });
      sides.push(p.side);
    });
    assertNoOverlap(W, markers, items, sides);
    // Målets tekst øverst til højre får heller aldrig en etiket oven i sig.
    if (finishW > 0) {
      items.forEach((it, i) => {
        const side = sides[i];
        if (side) assert.ok(boxOf(it, side)[1] <= W - 6 - finishW, `etiket ${i} rører målets tekst`);
      });
    }
  }
});

test("målets tekst: en lav stigning under den får sin etiket, en høj ved siden af gør ikke", () => {
  const W = 400, D = 180;
  const x = (km: number) => (km / D) * W;
  const points = v6RoutePoints({ distance_km: D, climbs: [{ name: "Low", category: "4", crest_km: 150, length_km: 2, avg_gradient: 4 }] });
  const finish = { finishLabelWidth: v6TextWidth("Finish · 90 m", 11), finishLabelY: [3, 17] as [number, number] };
  // Profilens top er y = 48 i den smalle tegning; en lav stigning ligger langt under målets tekst.
  assert.ok(v6RouteLabelPlan(points, "narrow", W, x, { ...finish, y: () => 190 }).climbs[0].side, "lav stigning: plads under målets tekst");
  assert.equal(v6RouteLabelPlan(points, "narrow", W, x, { ...finish, y: () => 50 }).climbs[0].side, null, "høj stigning: etiketten ville ramme målets tekst");
  assert.equal(v6RouteLabelPlan(points, "narrow", W, x, { finishLabelWidth: finish.finishLabelWidth }).climbs[0].side, null, "uden højder regnes målets felt i hele højden");
});

test("v6LayoutLabels: prøver den anden side, og udelader hellere end at overlappe", () => {
  const markers = [{ x: 100, half: 11 }, { x: 140, half: 11 }];
  const items = [{ x: 100, width: 30, gap: 13 }, { x: 140, width: 30, gap: 13 }];
  const sides = v6LayoutLabels({ width: 400, markers, items });
  assert.deepEqual(sides, ["left", "right"]);
  const crowded = v6LayoutLabels({ width: 400, markers: [{ x: 100, half: 11 }, { x: 115, half: 11 }, { x: 130, half: 11 }], items: [
    { x: 115, width: 30, gap: 13 }, { x: 100, width: 30, gap: 13 }, { x: 130, width: 30, gap: 13 },
  ] });
  assert.equal(crowded[0], null, "midterste mærke har ingen plads på nogen side");
});

test("kontrakt: én rute i v6 bygget på Etape-fanens profil, ingen ny tekst", () => {
  const route = read("./V6Route.tsx");
  const panel = read("./V6RouteProfile.tsx");
  assert.match(route, /from "\.\.\/stagePageV2\/StageProfileV2\.tsx"/);
  assert.match(route, /<GradientLegend profile=\{profile\} \/>/); // #8259: forklaringen viser brosten/grus
  assert.match(route, /climbText=\{false\}/);
  assert.match(panel, /<V6Route profile=\{profile\} \/>/);
  assert.doesNotMatch(panel, /StageProfileGraph/);
  // Alle tekster findes allerede i races-navnerummet (en + da); ingen nye nøgler.
  const keys = [...route.matchAll(/t\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 4);
  for (const lng of ["en", "da"]) {
    const json = JSON.parse(read(`../../../../public/locales/${lng}/races.json`));
    for (const k of keys) {
      const v = k.split(".").reduce<unknown>((o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined), json);
      assert.equal(typeof v, "string", `${lng}: ${k} mangler`);
    }
  }
});
