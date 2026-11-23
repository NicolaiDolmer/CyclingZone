import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttributionRow, buildSignupAttributionRow } from "./signupAttribution.js";

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

test("buildAttributionRow: egen side som referrer med UTM i query henter UTM og nulstiller referrer (#6292)", () => {
  const row = buildAttributionRow("u1", {
    referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=social&utm_campaign=beta",
    landing_path: "/login",
  });
  assert.equal(row.referrer, null);
  assert.equal(row.utm_source, "reddit");
  assert.equal(row.utm_medium, "social");
  assert.equal(row.utm_campaign, "beta");
});

test("buildAttributionRow: egen side som referrer uden UTM giver referrer null (#6292)", () => {
  const row = buildAttributionRow("u1", {
    referrer: "https://cyclingzone.org/about",
    landing_path: "/login",
  });
  assert.equal(row.referrer, null);
  assert.equal(row.utm_source, null);
  assert.equal(row.landing_path, "/login");
});

test("buildAttributionRow: ekstern referrer bevares (#6292)", () => {
  const row = buildAttributionRow("u1", {
    referrer: "https://www.google.com/search?q=cycling+manager",
    landing_path: "/",
  });
  assert.equal(row.referrer, "https://www.google.com/search?q=cycling+manager");
});

test("buildAttributionRow capper for lange værdier", () => {
  const long = "a".repeat(1000);
  const row = buildAttributionRow("u1", { utm_source: long, referrer: long });
  assert.equal(row.utm_source.length, 200);
  assert.equal(row.referrer.length, 500);
});

test("hold-bootstrap bruger den første kontoattribution frem for den aktuelle browser", () => {
  const campaign = { utm_source: "example", utm_medium: "paid", utm_campaign: "first", utm_content: "creative" };
  const user = { id: "u1", user_metadata: { attribution: { ...campaign, landing_path: "/da", fbclid: "private" } } };
  const row = buildSignupAttributionRow(user, { landing_path: "/login", utm_source: "unrelated" });
  for (const [key, value] of Object.entries(campaign)) assert.equal(row[key], value);
  assert.equal(row.landing_path, "/da");
  assert.equal(Object.hasOwn(row, "fbclid"), false);
});

test("hold-bootstrap bevarer browser-fallback for ældre konti uden et brugbart snapshot", () => {
  const row = buildSignupAttributionRow({ id: "u1", user_metadata: { attribution: {} } }, { utm_source: "example", landing_path: "/signup" });
  assert.equal(row.utm_source, "example");
  assert.equal(row.landing_path, "/signup");
});
