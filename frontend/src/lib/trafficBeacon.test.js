import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEngagementTracker } from "./trafficBeacon.js";

test("engaged efter ≥2 pageviews, og kun én gang", () => {
  let fired = 0;
  const t = makeEngagementTracker(() => { fired += 1; });
  t.pageview();
  assert.equal(fired, 0);
  t.pageview();
  assert.equal(fired, 1);
  t.pageview();
  assert.equal(fired, 1); // ikke igen
});

test("engaged ved interaktion efter 10s", () => {
  let fired = 0;
  const t = makeEngagementTracker(() => { fired += 1; });
  t.interaction(5000);
  assert.equal(fired, 0);
  t.interaction(11000);
  assert.equal(fired, 1);
});

test("interaktion og pageviews dobbelt-fyrer ikke", () => {
  let fired = 0;
  const t = makeEngagementTracker(() => { fired += 1; });
  t.pageview();
  t.pageview();      // fire #1
  t.interaction(99999); // ingen ny fire
  assert.equal(fired, 1);
});
