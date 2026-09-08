// Selvtest for scripts/check-event-catalog.mjs. Tester de rene udtraeks-
// funktioner, saa en fremtidig aendring i logEvent.js's eller ANALYTICS_STACK.md's
// form fejler her i stedet for at goere guarden tavst blind.
//
//   node --test scripts/check-event-catalog.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { extractKnownEvents, extractDocumentedEvents, collectCalls } from "./check-event-catalog.mjs";

const CALL_RE = /\blog(?:First)?Event\(\s*["']([a-z0-9_]+)["']/g;
const SERVER_RE = /event_name:\s*["']([a-z0-9_]+)["']/g;

test("extractKnownEvents: laeser navnene ud af den frosne array-literal og ignorerer kommentarer", () => {
  const src = [
    'export const KNOWN_EVENTS = Object.freeze([',
    '  // "kommentar_event" er kun en kommentar, men matcher moenstret bevidst',
    '  "signup",',
    "  'first_bid',",
    ']);',
    'const OTHER = ["ikke_med"];',
  ].join("\n");
  const got = extractKnownEvents(src);
  assert.ok(got.has("signup"));
  assert.ok(got.has("first_bid"));
  assert.ok(!got.has("ikke_med"), "navne uden for blokken maa ikke slippe med");
});

test("extractKnownEvents: returnerer null hvis blokken er omdoebt (guarden skal fejle hoejlydt)", () => {
  assert.equal(extractKnownEvents("export const EVENTS = [];"), null);
});

test("extractDocumentedEvents: laeser foerste kolonne i §3-tabellerne og stopper ved naeste sektion", () => {
  const md = [
    "## 2. Samtykke",
    "| `ikke_et_event` | ja |",
    "",
    "## 3. Event-katalog",
    "| Event | Kendt |",
    "|---|---|",
    "| `signup` | ja |",
    "| `checkout_started` | server |",
    "",
    "## 4. Definitioner",
    "| `heller_ikke` | ja |",
  ].join("\n");
  const got = extractDocumentedEvents(md);
  assert.deepEqual([...got].sort(), ["checkout_started", "signup"]);
});

test("extractDocumentedEvents: returnerer null hvis §3 er omnummereret", () => {
  assert.equal(extractDocumentedEvents("## 1. Noget\n## 2. Andet\n"), null);
});

test("collectCalls: fanger baade logEvent og logFirstEvent med literal navn", () => {
  const src = [
    'logEvent("auction_view");',
    'logFirstEvent("first_bid", { x: 1 });',
    "logEvent('training_run_today', {});",
    "logEvent(dynamicName, {});",
  ].join("\n");
  assert.deepEqual([...collectCalls(src, CALL_RE)].sort(), ["auction_view", "first_bid", "training_run_today"]);
});

test("collectCalls: server-moenstret fanger event_name i en insert", () => {
  const src = '.insert({ team_id: t, event_name: "checkout_started", event_data: {} })';
  assert.deepEqual([...collectCalls(src, SERVER_RE)], ["checkout_started"]);
});

test("integration: det aegte repo er i sync (samme kontrakt som selve guarden)", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const known = extractKnownEvents(readFileSync(path.join(root, "frontend", "src", "lib", "logEvent.js"), "utf8"));
  const documented = extractDocumentedEvents(readFileSync(path.join(root, "docs", "ANALYTICS_STACK.md"), "utf8"));
  assert.ok(known && known.size > 0, "KNOWN_EVENTS skal kunne laeses");
  assert.ok(documented && documented.size > 0, "§3-tabellen skal kunne laeses");
  const missing = [...known].filter((n) => !documented.has(n));
  assert.deepEqual(missing, [], "hvert KNOWN_EVENTS-navn skal have en raekke i ANALYTICS_STACK.md §3");
});
