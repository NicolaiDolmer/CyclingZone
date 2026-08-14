// #3767 — afvisninger er produktdata (player_events), ikke Sentry-issues.
//
// Kildekode-struktur-guard i stedet for direkte import: actionTelemetry.js
// importerer nu logEvent.js, som importerer supabase.ts (extensionless), og
// node --test kan ikke resolve den uden en TS-loader. Samme begrænsning og
// samme testform som logEvent.test.js — se noten i toppen af den fil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "actionTelemetry.js"), "utf8");
const logEventSource = readFileSync(join(__dirname, "logEvent.js"), "utf8");

test("afvisninger opretter IKKE længere et Sentry-issue (ingen captureMessage)", () => {
  assert.ok(
    !/Sentry\.captureMessage/.test(source),
    "captureMessage opretter et issue pr. afvisning — det var hele #3767's støjkilde",
  );
});

test("afvisninger logges til player_events via logEvent", () => {
  assert.match(source, /logEvent\(\s*"action_rejected"/);
  assert.match(source, /import \{ logEvent \} from "\.\/logEvent\.js"/);
});

test("action_rejected er registreret i KNOWN_EVENTS (Detector E's canary-liste)", () => {
  const match = logEventSource.match(/KNOWN_EVENTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "KNOWN_EVENTS-arrayet skal kunne findes — ellers tester regex'en intet");
  const events = [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(events.includes("action_rejected"));
});

test("afvisninger efterlader stadig en Sentry-breadcrumb (kontekst til en senere exception)", () => {
  assert.match(source, /Sentry\.addBreadcrumb/);
  assert.match(source, /category: "player_action"/);
});

test("kastede fejl går STADIG til Sentry som exception — uændret adfærd", () => {
  assert.match(source, /Sentry\.captureException\(cause/);
  assert.match(source, /player_action_kind: "threw"/);
});

test("logEvent kaldes uden for Sentry-DSN-gaten — analytics må ikke afhænge af Sentry", () => {
  const logEventIndex = source.indexOf('logEvent("action_rejected"');
  const breadcrumbGateIndex = source.lastIndexOf("if (!ENABLED) return;");
  assert.ok(logEventIndex > -1 && breadcrumbGateIndex > -1);
  assert.ok(
    logEventIndex < breadcrumbGateIndex,
    "logEvent skal kaldes FØR den sidste ENABLED-gate, ellers tabes analytics når VITE_SENTRY_DSN mangler",
  );
});

// Bevidst INGEN "ingen PII"-regex-test her. Første udgave scannede hele kilden
// og faldt over ordet "email" i den kommentar der dokumenterer PII-reglen —
// en test der flager sin egen dokumentation er ikke et værn. Feltvalget er
// eksplicit i koden ({action, reason, status} + spil-id'er fra kalderen) og
// dækkes af review, ikke af en tekstsøgning.
