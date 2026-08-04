// #3243 — funnel-event der lukker målehullet på "resultat eksponeret på
// dashboard" (før kun aflæseligt via teams.my_result_seen_race_id, en rå
// kolonne, ikke et queryable player_events-event).
//
// Kildekode-struktur-guard i stedet for et direkte import: logEvent.js
// importerer supabase.ts (extensionless), som node --test ikke kan resolve
// uden en TS-loader — samme begrænsning der gør at INGEN eksisterende test i
// repoet importerer logEvent.js direkte (alle andre lib/*.js-filer med
// supabase-afhængighed testes samme vej, fx MyLatestResultCard.seenServerFlag.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "logEvent.js"), "utf8");

function extractKnownEvents(src) {
  const match = src.match(/KNOWN_EVENTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) return [];
  return [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

test("#3243 first_race_result_shown er registreret i KNOWN_EVENTS (canary-liste)", () => {
  const events = extractKnownEvents(source);
  assert.ok(
    events.includes("first_race_result_shown"),
    "detector-E'en for 0-impression-features kræver eventet i master-listen",
  );
});

test("KNOWN_EVENTS-udtrækket har ingen dubletter (guard mod copy-paste-fejl i selve testen/listen)", () => {
  const events = extractKnownEvents(source);
  assert.ok(events.length > 0, "udtrækket skal finde mindst nogle events — ellers tester regex'en intet");
  assert.equal(new Set(events).size, events.length);
});
