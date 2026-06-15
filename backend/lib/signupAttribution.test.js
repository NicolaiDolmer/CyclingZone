import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttributionRow } from "./signupAttribution.js";

test("buildAttributionRow returnerer null uden userId eller gyldig payload", () => {
  assert.equal(buildAttributionRow(null, { utm_source: "x" }), null);
  assert.equal(buildAttributionRow("u1", null), null);
  assert.equal(buildAttributionRow("u1", "nope"), null);
});

test("buildAttributionRow mapper + trimmer UTM, referrer og landing", () => {
  const row = buildAttributionRow("u1", {
    utm_source: "  reddit ",
    utm_medium: "social",
    referrer: "https://reddit.com/r/x",
    landing_path: "/login",
    first_seen_at: "2026-06-15T10:00:00.000Z",
    extra: "ignored",
  });
  assert.equal(row.user_id, "u1");
  assert.equal(row.utm_source, "reddit");
  assert.equal(row.utm_medium, "social");
  assert.equal(row.referrer, "https://reddit.com/r/x");
  assert.equal(row.landing_path, "/login");
  assert.equal(row.first_seen_at, "2026-06-15T10:00:00.000Z");
  assert.equal(row.utm_campaign, null);
  assert.equal("extra" in row, false);
});

test("buildAttributionRow gemmer direct-trafik (kun landing_path) men ikke en signal-løs payload", () => {
  const direct = buildAttributionRow("u1", {
    landing_path: "/",
    first_seen_at: "2026-06-15T10:00:00.000Z",
  });
  assert.equal(direct.landing_path, "/");
  assert.equal(direct.utm_source, null);
  assert.equal(buildAttributionRow("u1", { first_seen_at: "2026-06-15T10:00:00.000Z" }), null);
});

test("buildAttributionRow capper for lange værdier", () => {
  const long = "a".repeat(1000);
  const row = buildAttributionRow("u1", { utm_source: long, referrer: long });
  assert.equal(row.utm_source.length, 200);
  assert.equal(row.referrer.length, 500);
});
