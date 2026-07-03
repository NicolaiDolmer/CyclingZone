import test from "node:test";
import assert from "node:assert/strict";

import { computeResultWebhookUrls } from "./resultWebhookRouting.js";

test("gruppe + samle → begge, i rækkefølge", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "g", summaryUrl: "s", defaultUrl: "d" }),
    ["g", "s"],
  );
});

test("kun gruppe (ingen samle) → kun gruppe, IKKE default", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "g", summaryUrl: null, defaultUrl: "d" }),
    ["g"],
  );
});

test("kun samle → kun samle", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, summaryUrl: "s", defaultUrl: "d" }),
    ["s"],
  );
});

test("gruppe == samle (Division 1) → dedupliceret til én", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: "same", summaryUrl: "same", defaultUrl: "d" }),
    ["same"],
  );
});

test("intet division-specifikt → fallback til default", () => {
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, summaryUrl: null, defaultUrl: "d" }),
    ["d"],
  );
});

test("intet konfigureret overhovedet → tom liste (ingen throw)", () => {
  assert.deepEqual(computeResultWebhookUrls({}), []);
  assert.deepEqual(computeResultWebhookUrls(), []);
  assert.deepEqual(
    computeResultWebhookUrls({ groupUrl: null, summaryUrl: null, defaultUrl: null }),
    [],
  );
});
