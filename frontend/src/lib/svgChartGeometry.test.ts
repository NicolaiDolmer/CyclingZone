// #6165: ren geometri til de egne SVG-grafer.
import test from "node:test";
import assert from "node:assert/strict";
import {
  donutSegments,
  linearScale,
  linePath,
  nearestIndex,
  niceTicks,
  ringSegmentPath,
  xTickIndices,
} from "./svgChartGeometry.ts";

test("donutSegments: andele summer til 100 og vinkler dækker en hel omgang uden mellemrum", () => {
  const segs = donutSegments([50, 30, 20], 100, 100, 50, 80, 0);
  assert.equal(segs.length, 3);
  assert.ok(Math.abs(segs.reduce((s, x) => s + x.pct, 0) - 100) < 1e-9);
  assert.ok(Math.abs(segs[0].pct - 50) < 1e-9);
  assert.ok(Math.abs(segs[2].endAngle - Math.PI * 2) < 1e-9);
  assert.ok(segs.every((s) => s.path.startsWith("M")));
});

test("donutSegments: mellemrum skiller stykkerne, men kun når der er mere end ét", () => {
  const two = donutSegments([1, 1], 0, 0, 10, 20, 4);
  assert.ok(two[1].startAngle > two[0].endAngle);
  const one = donutSegments([5, 0], 0, 0, 10, 20, 4);
  assert.equal(one[0].startAngle, 0);
  assert.ok(Math.abs(one[0].pct - 100) < 1e-9);
});

test("donutSegments: nul, negative og ugyldige værdier giver tomt stykke", () => {
  const segs = donutSegments([10, 0, -3, Number.NaN], 0, 0, 10, 20, 2);
  assert.equal(segs[1].path, "");
  assert.equal(segs[2].path, "");
  assert.equal(segs[3].path, "");
  assert.equal(segs[1].pct, 0);
  const empty = donutSegments([0, 0], 0, 0, 10, 20, 2);
  assert.ok(empty.every((s) => s.path === "" && s.pct === 0));
});

test("ringSegmentPath: en hel ring bevarer baade ydre og indre kant og er ikke tom", () => {
  const p = ringSegmentPath(100, 100, 50, 80, 0, Math.PI * 2);
  // To halvbuer pr. kant, og den indre kant lander paa to forskellige punkter.
  assert.equal((p.match(/A80 80/g) || []).length, 2);
  assert.equal((p.match(/A50 50/g) || []).length, 2);
  assert.ok(p.includes("A50 50 0 1 0 100 150"));
  assert.ok(p.endsWith("Z"));
  assert.equal(ringSegmentPath(0, 0, 10, 20, 1, 1), "");
});

test("donutSegments: ét stykke paa 100 pct med produktionsradier giver en hel ring med hul", () => {
  const [seg] = donutSegments([100], 100, 100, 50, 80, 2);
  assert.ok(seg.path.includes("A50 50"));
  assert.ok(Math.abs(seg.endAngle - seg.startAngle - Math.PI * 2) < 1e-9);
});

test("donutSegments: en meget lille kategori forsvinder ikke af mellemrummet", () => {
  const segs = donutSegments([999, 1], 100, 100, 50, 80, 2);
  assert.ok(segs[1].path.startsWith("M"));
  assert.ok(segs[1].endAngle > segs[1].startAngle);
  assert.ok(segs[1].startAngle >= segs[0].endAngle);
  assert.ok(segs[1].endAngle <= Math.PI * 2 + 1e-9);
});

test("ringSegmentPath: kvart omgang starter kl. 12 og slutter kl. 3 på ydre radius", () => {
  const p = ringSegmentPath(100, 100, 50, 80, 0, Math.PI / 2);
  assert.ok(p.startsWith("M100 20 A80 80 0 0 1 180 100"));
});

test("linearScale: mapper domæne til område og håndterer fladt domæne", () => {
  const s = linearScale(0, 10, 100, 200);
  assert.equal(s(0), 100);
  assert.equal(s(10), 200);
  assert.equal(s(5), 150);
  assert.equal(linearScale(3, 3, 0, 100)(3), 50);
});

test("niceTicks: pæne trin der dækker data", () => {
  assert.deepEqual(niceTicks(0, 100, 4), [0, 20, 40, 60, 80, 100]);
  const t = niceTicks(3, 47, 4);
  assert.ok(t[0] <= 3 && t[t.length - 1] >= 47);
  assert.deepEqual(niceTicks(0, 0), [0, 1]);
  assert.deepEqual(niceTicks(Number.NaN, 5), [0, 1]);
  const flat = niceTicks(7, 7);
  assert.ok(flat.length >= 2 && flat[0] < 7 && flat[flat.length - 1] > 7);
});

test("niceTicks: ingen flydende-komma-støj", () => {
  assert.deepEqual(niceTicks(0, 0.6, 3), [0, 0.2, 0.4, 0.6]);
});

test("xTickIndices: alle når der er plads, ellers jævnt fordelt med sidste punkt", () => {
  assert.deepEqual(xTickIndices(3, 400), [0, 1, 2]);
  assert.deepEqual(xTickIndices(1, 400), [0]);
  assert.deepEqual(xTickIndices(0, 400), []);
  const idx = xTickIndices(30, 280, 56);
  assert.equal(idx[0], 0);
  assert.equal(idx[idx.length - 1], 29);
  assert.ok(idx.length <= 6);
  for (let i = 1; i < idx.length; i += 1) assert.ok(idx[i] > idx[i - 1]);
});

test("linePath: bridger huller med connectNulls, ellers bryder den linjen", () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: null },
    { x: 20, y: 30 },
  ];
  assert.equal(linePath(pts, true), "M0 10L20 30");
  assert.equal(linePath(pts, false), "M0 10M20 30");
  assert.equal(linePath([], true), "");
  assert.equal(linePath([{ x: 0, y: Number.NaN }], true), "");
});

test("nearestIndex: finder nærmeste punkt og tåler tom liste", () => {
  assert.equal(nearestIndex([0, 10, 20], 12), 1);
  assert.equal(nearestIndex([0, 10, 20], 99), 2);
  assert.equal(nearestIndex([], 5), -1);
});
