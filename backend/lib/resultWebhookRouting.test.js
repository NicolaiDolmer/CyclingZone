import test from "node:test";
import assert from "node:assert/strict";

import { computeResultWebhookUrls } from "./resultWebhookRouting.js";

test("gruppekanal konfigureret → kun gruppe-URL (samlekanal droppet, #4999)", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "g", defaultUrl: "d" }),
    ["g"],
  );
});

test("Division 1 (kun én pulje, gruppekanal = puljens eneste kanal) → præcis én URL", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "d1-group", defaultUrl: "d" }),
    ["d1-group"],
  );
});

test("ingen gruppekanal konfigureret → fallback til default", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, defaultUrl: "d" }),
    ["d"],
  );
});

test("intet konfigureret overhovedet → tom liste (ingen throw)", () => {
  assert.deepEqual(computeResultWebhookUrls({}), []);
  assert.deepEqual(computeResultWebhookUrls(), []);
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, defaultUrl: null }),
    [],
  );
});

test("en evt. summaryUrl-parameter ignoreres (division-samlekanalen er droppet, #4999)", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, summaryUrl: "s", defaultUrl: "d" }),
    ["d"],
  );
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "g", summaryUrl: "s", defaultUrl: "d" }),
    ["g"],
  );
});
