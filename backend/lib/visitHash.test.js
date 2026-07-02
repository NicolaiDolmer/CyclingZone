import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVisitHash, dayString } from "./visitHash.js";

test("samme input → samme hash", () => {
  const a = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  const b = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  assert.equal(a, b);
});

test("anden dag → andet hash (unlinkable cross-day)", () => {
  const a = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  const b = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-07-01", secret: "s" });
  assert.notEqual(a, b);
});

test("anden besøgende → andet hash", () => {
  const a = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  const b = computeVisitHash({ ip: "9.9.9.9", ua: "x", day: "2026-06-30", secret: "s" });
  assert.notEqual(a, b);
});

test("ingen rå IP/UA i output; 32 hex", () => {
  const h = computeVisitHash({ ip: "1.2.3.4", ua: "secretUA", day: "2026-06-30", secret: "s" });
  assert.doesNotMatch(h, /1\.2\.3\.4|secretUA/);
  assert.match(h, /^[a-f0-9]{32}$/);
});

test("dayString formaterer YYYY-MM-DD i UTC", () => {
  assert.equal(dayString(new Date("2026-06-30T23:30:00Z")), "2026-06-30");
});
