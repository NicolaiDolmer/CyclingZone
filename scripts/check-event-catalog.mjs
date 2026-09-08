#!/usr/bin/env node
// Event-katalog-guard (#5048) - hvert player_events-navn skal staa BEGGE steder.
//
// Problemet den loeser: `player_events` er den eneste kilde til produkt-tragten,
// men navnene er indtil nu kun defineret paa kaldsstedet. KNOWN_EVENTS i
// frontend/src/lib/logEvent.js driver Detector E's "deployed feature med 0
// brugere"-alarm, og docs/ANALYTICS_STACK.md §3 er den menneskelaesbare
// definition (hvad eventet betyder, om det er consent-gated). Et event der kun
// findes paa kaldsstedet er baade canary-blindt og udokumenteret - praecis den
// tilstand #1669 skulle rydde op i, og som kom igen med academy_*, facility_*,
// staff_*, training_*_week_plan_set og feature_rider_*_tab_opened.
//
// Hvad den scanner:
//   1. frontend/src/**  - logEvent("navn", ...) og logFirstEvent("navn", ...)
//      med et LITERAL navn. Dynamiske navne (variabler, template-strenge) kan
//      ikke verificeres statisk og springes over; de er i forvejen ikke i brug.
//      *.test.js/*.test.mjs springes over (fixtures, ikke rigtig instrumentering).
//   2. De to server-side inserts: backend/lib/billingCheckout.js og
//      backend/lib/aluntaWebhook.js skriver event_name: "..." direkte med
//      service-role uden om logEvent.js.
//
// Regler:
//   - Frontend-events skal staa i BAADE KNOWN_EVENTS og §3-tabellen.
//   - Server-events staar kun i §3-tabellen (de gaar aldrig gennem logEvent.js,
//     og KNOWN_EVENTS' formaal er impression-canaries for spilleradfaerd).
//   - Et navn i KNOWN_EVENTS uden en raekke i §3 er ogsaa en fejl.
//
// BRUG:
//   node scripts/check-event-catalog.mjs
//
// EXIT-CODES:
//   0 = kataloget er komplet
//   1 = mindst ét event mangler et sted (eller en kildefil kunne ikke laeses)

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_EVENT_FILE = path.join(ROOT, "frontend", "src", "lib", "logEvent.js");
const FRONTEND_SRC = path.join(ROOT, "frontend", "src");
const DOC_FILE = path.join(ROOT, "docs", "ANALYTICS_STACK.md");
const SERVER_FILES = [
  path.join(ROOT, "backend", "lib", "billingCheckout.js"),
  path.join(ROOT, "backend", "lib", "aluntaWebhook.js"),
];

const CALL_RE = /\blog(?:First)?Event\(\s*["']([a-z0-9_]+)["']/g;
const SERVER_RE = /event_name:\s*["']([a-z0-9_]+)["']/g;

// KNOWN_EVENTS laeses som tekst i stedet for via import: logEvent.js importerer
// ./supabase, som kraever Vite-env. Blokken er en frosset array-literal, saa en
// simpel udtraekning er baade tilstraekkelig og robust.
export function extractKnownEvents(source) {
  const start = source.indexOf("KNOWN_EVENTS = Object.freeze([");
  if (start === -1) return null;
  const end = source.indexOf("]);", start);
  if (end === -1) return null;
  const block = source.slice(start, end);
  return new Set([...block.matchAll(/["']([a-z0-9_]+)["']/g)].map((m) => m[1]));
}

// §3-tabellen: hver raekke starter med `| \`event_name\` |`. Vi laeser kun
// event-navnet, saa resten af raekken kan aendres frit uden at bryde guarden.
export function extractDocumentedEvents(markdown) {
  const section = markdown.split(/^##\s+3\./m)[1];
  if (section === undefined) return null;
  const body = section.split(/^##\s+/m)[0];
  return new Set([...body.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map((m) => m[1]));
}

export function collectCalls(source, re) {
  const found = new Set();
  for (const m of source.matchAll(re)) found.add(m[1]);
  return found;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.(js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function main() {
  const problems = [];

  const logEventSource = read(LOG_EVENT_FILE);
  if (logEventSource === null) {
    console.error(`Kunne ikke laese ${path.relative(ROOT, LOG_EVENT_FILE)}.`);
    return 1;
  }
  const known = extractKnownEvents(logEventSource);
  if (!known) {
    console.error("Fandt ikke KNOWN_EVENTS-blokken i logEvent.js. Er den omdoebt, skal denne guard opdateres.");
    return 1;
  }

  const doc = read(DOC_FILE);
  if (doc === null) {
    console.error(`Kunne ikke laese ${path.relative(ROOT, DOC_FILE)}. Event-kataloget er SSOT for §3.`);
    return 1;
  }
  const documented = extractDocumentedEvents(doc);
  if (!documented) {
    console.error("Fandt ikke sektion '## 3.' i docs/ANALYTICS_STACK.md. Er den omnummereret, skal denne guard opdateres.");
    return 1;
  }

  // 1. Frontend-kaldssteder.
  const frontendEvents = new Map(); // navn -> foerste fil
  for (const file of walk(FRONTEND_SRC)) {
    const src = read(file);
    if (src === null) continue;
    for (const name of collectCalls(src, CALL_RE)) {
      if (!frontendEvents.has(name)) frontendEvents.set(name, path.relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  for (const [name, file] of frontendEvents) {
    if (!known.has(name)) problems.push(`${name} (${file}) mangler i KNOWN_EVENTS i frontend/src/lib/logEvent.js`);
    if (!documented.has(name)) problems.push(`${name} (${file}) mangler en raekke i docs/ANALYTICS_STACK.md §3`);
  }

  // 2. Server-side inserts.
  for (const file of SERVER_FILES) {
    const src = read(file);
    if (src === null) continue;
    for (const name of collectCalls(src, SERVER_RE)) {
      if (!documented.has(name)) {
        problems.push(`${name} (${path.relative(ROOT, file).replace(/\\/g, "/")}) mangler en raekke i docs/ANALYTICS_STACK.md §3`);
      }
    }
  }

  // 3. KNOWN_EVENTS uden dokumentation.
  for (const name of known) {
    if (!documented.has(name)) problems.push(`${name} staar i KNOWN_EVENTS, men mangler en raekke i docs/ANALYTICS_STACK.md §3`);
  }

  if (problems.length > 0) {
    console.error("Event-katalog ude af sync:");
    for (const p of problems.sort()) console.error(`  - ${p}`);
    console.error("\nEt nyt event kraever BEGGE dele: en raekke i ANALYTICS_STACK.md §3 og (for frontend-events) et navn i KNOWN_EVENTS.");
    return 1;
  }

  console.log(`Event-katalog OK: ${frontendEvents.size} frontend-kaldssteder, ${known.size} i KNOWN_EVENTS, ${documented.size} dokumenterede.`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
