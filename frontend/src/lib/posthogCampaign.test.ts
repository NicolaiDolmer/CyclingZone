import assert from "node:assert/strict";
import test from "node:test";
import { captureFirstTouch, getAttributionForBackend, resolveSignupAttribution } from "./attribution.js";
import { buildPosthogEventProperties } from "./posthogClient.js";

const utms = {
  utm_source: "campaign-source",
  utm_medium: "paid",
  utm_campaign: "example-campaign",
  utm_content: "example-creative",
};

test("signup milestones use the account's first touch instead of the current query", () => {
  const attribution = { ...utms, utm_term: "term", fbclid: "private", referrer: "https://example.org/" };
  const search = "?utm_source=other&utm_campaign=later&fbclid=private";
  for (const name of ["signup", "team_created", "first_training"]) {
    const properties = buildPosthogEventProperties(name, { via: "test" }, attribution, search);
    assert.deepEqual(properties, { via: "test", ...utms, $set_once: utms });
    assert.deepEqual(buildPosthogEventProperties(name, {}, null, search), {});
  }
});

test("email confirmation keeps the account first touch ahead of the local browser", () => {
  const storage = { getItem: () => JSON.stringify({ landing_path: "/login", utm_source: "another-visit" }) };
  assert.deepEqual(resolveSignupAttribution({ ...utms, fbclid: "private" }, storage), utms);
  assert.deepEqual(resolveSignupAttribution(null, storage), { landing_path: "/login", utm_source: "another-visit" });
});

test("blocked storage retains the first touch in memory for signup in the same page", () => {
  const storage = { getItem() { throw new Error("storage blocked"); }, setItem() { throw new Error("storage blocked"); } };
  const context = { referrer: "", path: "/login", origin: "https://example.org", storage, now: () => "2026-11-23T08:00:00.000Z" };
  captureFirstTouch({ ...context, search: "?" + new URLSearchParams({ ...utms, fbclid: "private" }) });
  captureFirstTouch({ ...context, search: "?utm_source=other" });

  const attribution = getAttributionForBackend(storage);
  assert.equal(attribution.utm_campaign, utms.utm_campaign);
  assert.equal(attribution.utm_content, utms.utm_content);
  assert.equal(Object.hasOwn(attribution, "fbclid"), false);
});

test("legacy same-site referrers recover the same first touch as the database writer", () => {
  const attribution = {
    utm_medium: "old",
    referrer: "https://www.cyclingzone.org/da?" + new URLSearchParams(utms),
  };
  assert.deepEqual(buildPosthogEventProperties("team_created", {}, attribution, ""), { ...utms, $set_once: utms });
  assert.deepEqual(buildPosthogEventProperties("team_created", {}, { referrer: attribution.referrer.replace("www.cyclingzone.org", "www.cyclingzone.org.example.com") }, ""), {});
});
