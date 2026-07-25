import test from "node:test";
import assert from "node:assert/strict";

import { serializeByUrl, __resetWebhookQueueForTests } from "./discordWebhookQueue.js";

test.beforeEach(() => __resetWebhookQueueForTests());

// Kerne-invarianten fra #2882: to kald mod SAMME url må aldrig overlappe —
// den 2. må ikke starte før den 1. er afsluttet, selvom kalderen selv fyrer
// dem "samtidig" (ingen await imellem).
test("serializeByUrl — to kald mod samme URL kører sekventielt, ikke overlappende", async () => {
  const events = [];
  const url = "https://discord.com/api/webhooks/1/tier3-summary";

  const p1 = serializeByUrl(url, async () => {
    events.push("start-1");
    await new Promise((r) => setTimeout(r, 20));
    events.push("end-1");
    return "r1";
  });
  const p2 = serializeByUrl(url, async () => {
    events.push("start-2");
    await new Promise((r) => setTimeout(r, 5));
    events.push("end-2");
    return "r2";
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "r1");
  assert.equal(r2, "r2");
  // start-2 skal komme EFTER end-1, aldrig imellem start-1 og end-1.
  assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2"]);
});

// Forskellige URLs (fx gruppe-kanal vs. tier-samlekanal for samme løb) er
// forskellige rate-limit-buckets hos Discord og skal IKKE vente på hinanden.
test("serializeByUrl — forskellige URLs kører uafhængigt (ikke serialiseret på tværs)", async () => {
  const events = [];
  const p1 = serializeByUrl("https://discord.com/api/webhooks/1/group", async () => {
    events.push("start-group");
    await new Promise((r) => setTimeout(r, 20));
    events.push("end-group");
  });
  const p2 = serializeByUrl("https://discord.com/api/webhooks/1/summary", async () => {
    events.push("start-summary");
    await new Promise((r) => setTimeout(r, 5));
    events.push("end-summary");
  });

  await Promise.all([p1, p2]);
  // summary (kort) skal nå at slutte FØR group (langt) — kun muligt hvis de
  // kørte parallelt frem for at være kø'et bag hinanden.
  assert.deepEqual(events, ["start-group", "start-summary", "end-summary", "end-group"]);
});

// Et fejlet forsøg må ikke låse alle efterfølgende poster til samme URL fast —
// og selve fejlen skal stadig nå den ægte kalder uændret.
test("serializeByUrl — et fejlet kald blokerer ikke det næste kald til samme URL", async () => {
  const url = "https://discord.com/api/webhooks/1/tier3-summary";
  await assert.rejects(
    serializeByUrl(url, async () => { throw new Error("boom"); }),
    /boom/
  );
  const result = await serializeByUrl(url, async () => "ok-after-failure");
  assert.equal(result, "ok-after-failure");
});
