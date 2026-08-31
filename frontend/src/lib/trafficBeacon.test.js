import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEngagementTracker, captureVisitContext } from "./trafficBeacon.js";

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

// --- kanal-kontekst (#4320) -----------------------------------------------

test("captureVisitContext: plukker UTM, referrer og landing-path", () => {
  const ctx = captureVisitContext({
    search: "?utm_source=reddit&utm_medium=community&utm_campaign=beta",
    referrer: "https://www.reddit.com/r/cycling",
    path: "/",
  });
  assert.equal(ctx.utm_source, "reddit");
  assert.equal(ctx.utm_medium, "community");
  assert.equal(ctx.utm_campaign, "beta");
  assert.equal(ctx.referrer, "https://www.reddit.com/r/cycling");
  assert.equal(ctx.landingPath, "/");
});

test("captureVisitContext: utm_term og utm_content sendes IKKE", () => {
  // Annonce-niveau hører til i signup_attribution, ikke i en per-pageview-beacon.
  const ctx = captureVisitContext({
    search: "?utm_source=x&utm_term=cykel&utm_content=variant-b",
    referrer: "",
    path: "/",
  });
  assert.equal(ctx.utm_source, "x");
  assert.equal("utm_term" in ctx, false);
  assert.equal("utm_content" in ctx, false);
});

test("captureVisitContext: tomme felter udelades helt fra payload", () => {
  // Holder beacon-bodyen lille; serveren skriver null for det der mangler.
  const ctx = captureVisitContext({ search: "", referrer: "", path: "" });
  assert.deepEqual(ctx, {});
});

test("captureVisitContext: trunkerer som attribution.js", () => {
  const ctx = captureVisitContext({
    search: `?utm_source=${"s".repeat(400)}`,
    referrer: `https://e.example/${"a".repeat(900)}`,
    path: `/${"p".repeat(400)}`,
  });
  assert.equal(ctx.utm_source.length, 200);
  assert.equal(ctx.referrer.length, 500);
  assert.equal(ctx.landingPath.length, 200);
});

test("captureVisitContext: en ubrugelig query-streng kaster ikke", () => {
  const ctx = captureVisitContext({ search: "%%%", referrer: "https://a.example/", path: "/" });
  assert.equal(ctx.referrer, "https://a.example/");
});
