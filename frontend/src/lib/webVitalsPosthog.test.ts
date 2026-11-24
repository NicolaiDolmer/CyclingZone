import test from "node:test";
import assert from "node:assert/strict";
import { buildWebVitalProperties, type WebVitalSample } from "./webVitalsPosthog.ts";

const sample: WebVitalSample = {
  name: "LCP",
  value: 1234.56,
  id: "v6-test-1",
  navigationType: "navigate",
  navigationURL: "https://cyclingzone.org/riders/8e617955-0000-4000-8000-d00000000000?tab=training&source=private#detail",
};

test("uses the metric's own navigation URL and sends only the route template", () => {
  assert.deepEqual(buildWebVitalProperties(sample), {
    metric_name: "LCP",
    metric_value: 1234.56,
    metric_id: "v6-test-1",
    route_template: "/riders/:id",
    navigation_scope: "document",
    navigation_type: "navigate",
    $current_url: "https://cyclingzone.org/riders/:id",
    $pathname: "/riders/:id",
    $referrer: "",
  });
});

test("keeps soft navigations and document loads separate, preserving the CLS fraction", () => {
  const result = buildWebVitalProperties({
    ...sample, name: "CLS", value: 0.0375, navigationType: "soft-navigation",
    navigationURL: "https://cyclingzone.org/races/a-public-race-id/?stage=4",
  });
  assert.equal(result?.route_template, "/races/:raceId");
  assert.equal(result?.navigation_scope, "spa");
  assert.equal(result?.metric_value, 0.0375);
});

test("allows measured zero and omits unsupported metrics, corrupt readings and out-of-scope paths", () => {
  assert.equal(buildWebVitalProperties({ ...sample, name: "CLS", value: 0 })?.metric_value, 0);
  for (const changes of [
    { name: "TTFB" }, { value: -1 }, { value: NaN }, { value: Infinity }, { id: "" },
    { navigationURL: undefined }, { navigationURL: "invalid" },
    { navigationURL: "https://preview.vercel.app/dashboard" },
    { navigationURL: "https://cyclingzone.org/admin/users" },
    { navigationURL: "https://cyclingzone.org/reset-password?token=private" },
    { navigationURL: "https://cyclingzone.org/races/strategy" },
    { navigationURL: "https://cyclingzone.org/unknown-user-segment" },
  ]) {
    assert.equal(buildWebVitalProperties({ ...sample, ...changes }), null);
  }
});
