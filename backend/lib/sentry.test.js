import test from "node:test";
import assert from "node:assert/strict";

import {
  monitorCron,
  captureCheckIn,
  toSentryError,
  normalizeMessageForGrouping,
  getEventGroupKey,
  createVolumeLimiter,
  normalizeEventMessages,
} from "./sentry.js";

// I test-env er Sentry disabled (ingen SENTRY_DSN) → monitorCron skal være en ren
// passthrough: kør fn, returnér dens resultat, re-throw dens fejl, uden overhead.

test("monitorCron (Sentry disabled) — kører fn og returnerer resultat", async () => {
  let ran = false;
  const wrapped = monitorCron("test-monitor", async () => {
    ran = true;
    return 42;
  }, { schedule: { type: "interval", value: 5, unit: "minute" } });
  const result = await wrapped();
  assert.equal(ran, true);
  assert.equal(result, 42);
});

test("monitorCron (Sentry disabled) — videresender argumenter", async () => {
  const wrapped = monitorCron("test-monitor", async (a, b) => a + b);
  assert.equal(await wrapped(2, 3), 5);
});

test("monitorCron (Sentry disabled) — re-thrower fn's fejl", async () => {
  const wrapped = monitorCron("test-monitor", async () => {
    throw new Error("boom");
  });
  await assert.rejects(() => wrapped(), /boom/);
});

test("captureCheckIn (Sentry disabled) — no-op, returnerer undefined", () => {
  assert.equal(captureCheckIn({ monitorSlug: "x", status: "ok" }), undefined);
});

// ── toSentryError (#2389 A3): normalisér non-Errors før capture ─────────────────

test("toSentryError — ægte Error passerer uændret igennem", () => {
  const original = new Error("boom");
  assert.equal(toSentryError(original), original);
});

test("toSentryError — Supabase plain-object bliver Error med besked + code, uden stack", () => {
  const err = toSentryError({ message: "duplicate key value", code: "23505", details: "Key (id)=..." });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "duplicate key value");
  assert.equal(err.code, "23505");
  assert.equal(err.details, "Key (id)=...");
  assert.equal(err.stack, "", "stack strippes så Sentry grupperer på besked, ikke wrap-site");
});

test("toSentryError — string og objekt uden message får brugbar titel", () => {
  assert.equal(toSentryError("noget gik galt").message, "noget gik galt");
  assert.equal(toSentryError({ status: 500 }).message, '{"status":500}');
  assert.equal(toSentryError(null).message, "Unknown error (non-Error captured)");
});

test("toSentryError — Cloudflare HTML-fejlside normaliseres til én læsbar linje", () => {
  const html = "<!DOCTYPE html><html><title>supabase.co | 522: Connection timed out</title></html>";
  assert.equal(toSentryError({ message: html }).message, "Supabase unavailable (522 Connection timed out)");
});

// ── #2900: volumen-guard — normalizeMessageForGrouping ──────────────────────
// Reproducerer CYCLINGZONE-31-mønstret: en per-hold-loop capturer "hold <id>
// fejlede: <besked>" for N forskellige hold uden fast fingerprint. Uden
// normalisering ville hver besked være en unik gruppe og guarden ville aldrig
// slå til.

test("normalizeMessageForGrouping — tal erstattes så per-id-beskeder grupperes ens", () => {
  const a = normalizeMessageForGrouping("hold 123 fejlede: timeout");
  const b = normalizeMessageForGrouping("hold 987654 fejlede: timeout");
  assert.equal(a, b);
  assert.equal(a, "hold <n> fejlede: timeout");
});

test("normalizeMessageForGrouping — UUID'er erstattes så per-id-beskeder grupperes ens", () => {
  const a = normalizeMessageForGrouping("team 3fa85f64-5717-4562-b3fc-2c963f66afa6 blocked");
  const b = normalizeMessageForGrouping("team 11111111-2222-3333-4444-555555555555 blocked");
  assert.equal(a, b);
  assert.equal(a, "team <uuid> blocked");
});

test("normalizeMessageForGrouping — håndterer null/undefined uden at kaste", () => {
  assert.equal(normalizeMessageForGrouping(null), "");
  assert.equal(normalizeMessageForGrouping(undefined), "");
});

// ── getEventGroupKey ─────────────────────────────────────────────────────────

test("getEventGroupKey — bruger fast fingerprint når call-site har sat en", () => {
  const event = { fingerprint: ["ai-trim-persistent-stall"], exception: { values: [{ type: "Error", value: "hold 1 fastlåst" }] } };
  assert.equal(getEventGroupKey(event), "fp:ai-trim-persistent-stall");
});

test("getEventGroupKey — falder tilbage til type+normaliseret besked uden fingerprint", () => {
  const eventA = { exception: { values: [{ type: "Error", value: "hold 123 fejlede: timeout" }] } };
  const eventB = { exception: { values: [{ type: "Error", value: "hold 456 fejlede: timeout" }] } };
  assert.equal(getEventGroupKey(eventA), getEventGroupKey(eventB));
});

test("getEventGroupKey — forskellige exception-typer grupperes forskelligt", () => {
  const eventA = { exception: { values: [{ type: "TypeError", value: "x" }] } };
  const eventB = { exception: { values: [{ type: "RangeError", value: "x" }] } };
  assert.notEqual(getEventGroupKey(eventA), getEventGroupKey(eventB));
});

// ── createVolumeLimiter ──────────────────────────────────────────────────────
// Kernekontrakten (#2900): (1) FØRSTE forekomst af enhver gruppe slipper altid
// igennem — vi må aldrig tabe den første forekomst af en ny fejl (kontrakt-
// krav). (2) Gentagelser ud over loftet i SAMME vindue droppes. (3) Nyt vindue
// nulstiller tælleren, så guarden er en rate-limit, ikke en permanent mute.

test("createVolumeLimiter — første event i en gruppe slipper altid igennem", () => {
  const limiter = createVolumeLimiter({ maxPerWindow: 3, windowMs: 1000 });
  const result = limiter.check("group-a", 0);
  assert.equal(result.allow, true);
});

test("createVolumeLimiter — tillader op til maxPerWindow, dropper derefter i samme vindue", () => {
  const limiter = createVolumeLimiter({ maxPerWindow: 3, windowMs: 1000 });
  const results = [1, 2, 3, 4, 5].map((i) => limiter.check("group-a", i));
  assert.deepEqual(results.map((r) => r.allow), [true, true, true, false, false]);
  assert.equal(results[3].suppressedInWindow, 1);
  assert.equal(results[4].suppressedInWindow, 2);
});

test("createVolumeLimiter — en anden gruppe rammes ikke af en gruppes loft (CYCLINGZONE-31-scenariet: mange forskellige hold)", () => {
  const limiter = createVolumeLimiter({ maxPerWindow: 2, windowMs: 1000 });
  // Simulér 10 forskellige hold der hver kun fejler ÉN gang — ingen af dem
  // bør nogensinde droppes, uanset hvor mange DISTINKTE grupper der findes.
  for (let teamId = 0; teamId < 10; teamId += 1) {
    const result = limiter.check(`team-${teamId}`, 0);
    assert.equal(result.allow, true, `hold ${teamId} skulle IKKE droppes (kun 1. forekomst)`);
  }
});

test("createVolumeLimiter — nyt vindue nulstiller tælleren (rate-limit, ikke permanent mute)", () => {
  const limiter = createVolumeLimiter({ maxPerWindow: 2, windowMs: 1000 });
  limiter.check("group-a", 0);
  limiter.check("group-a", 100);
  const dropped = limiter.check("group-a", 200);
  assert.equal(dropped.allow, false, "3. event i samme vindue skal droppes");
  const afterWindow = limiter.check("group-a", 1500);
  assert.equal(afterWindow.allow, true, "event i NYT vindue skal slippe igennem igen");
});

test("createVolumeLimiter — maxTrackedKeys begrænser hukommelsesforbrug (FIFO-eviction af ældste gruppe)", () => {
  const limiter = createVolumeLimiter({ maxPerWindow: 5, windowMs: 1000, maxTrackedKeys: 2 });
  limiter.check("a", 0);
  limiter.check("b", 0);
  assert.equal(limiter.size(), 2);
  limiter.check("c", 0); // skal evicte "a" (ældste)
  assert.equal(limiter.size(), 2);
});

// ── normalizeEventMessages (#3052 / CYCLINGZONE-3X) ──────────────────────────

// Cloudflares fejlside som den lander i error.message. Forkortet, men med de
// markører normaliseringen leder efter (title + Ray ID).
const CF_522_PAGE = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head>
<title>supabase.co | 522: Connection timed out</title>
</head><body><div id="cf-error-details">
Cloudflare Ray ID: a214d8d2cc4034b7
</div></body></html>`;

test("normalizeEventMessages — koger HTML-fejlside i exception-value ned, bevarer call-site-præfiks", () => {
  const event = {
    exception: { values: [{ type: "Error", value: `stall-watchdog seasons: ${CF_522_PAGE}` }] },
  };
  normalizeEventMessages(event);
  assert.equal(
    event.exception.values[0].value,
    "stall-watchdog seasons: Supabase unavailable (522 Connection timed out)"
  );
});

test("normalizeEventMessages — normaliserer også event.message (captureMessage-stien)", () => {
  const event = { message: CF_522_PAGE };
  normalizeEventMessages(event);
  assert.equal(event.message, "Supabase unavailable (522 Connection timed out)");
});

test("normalizeEventMessages — almindelige fejl passerer uændret igennem", () => {
  const event = {
    message: "noget gik galt",
    exception: { values: [{ type: "Error", value: 'permission denied for table "riders"' }] },
  };
  normalizeEventMessages(event);
  assert.equal(event.message, "noget gik galt");
  assert.equal(event.exception.values[0].value, 'permission denied for table "riders"');
});

test("normalizeEventMessages — tåler events uden message/exception", () => {
  assert.doesNotThrow(() => normalizeEventMessages({}));
  assert.doesNotThrow(() => normalizeEventMessages(null));
  assert.doesNotThrow(() => normalizeEventMessages({ exception: { values: [{}] } }));
});

// Den egentlige gevinst: to udfald af SAMME outage bærer forskellige Ray ID'er og
// tidsstempler i den rå HTML, så de ville få hver sin grupperingsnøgle. Efter
// normalisering (som beforeSend kører FØR getEventGroupKey) grupperer de sammen.
test("normalizeEventMessages — to udfald af samme outage får samme grupperingsnøgle", () => {
  const build = (rayId) => ({
    exception: {
      values: [{
        type: "Error",
        value: `stall-watchdog seasons: ${CF_522_PAGE.replace("a214d8d2cc4034b7", rayId)}`,
      }],
    },
  });
  const a = normalizeEventMessages(build("aaaaaaaaaaaaaaaa"));
  const b = normalizeEventMessages(build("bbbbbbbbbbbbbbbb"));
  assert.equal(getEventGroupKey(a), getEventGroupKey(b));
});
