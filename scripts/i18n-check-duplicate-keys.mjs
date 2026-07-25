#!/usr/bin/env node
// i18n duplikat-nøgle-guard — Refs #2917.
//
// `JSON.parse` accepterer dubletter i tavshed og beholder den SIDSTE. En
// locale-fil med to `"noAchievements"` i samme objekt er derfor gyldig JSON,
// og hverken key-coverage-guarden (som parser først) eller eslint kan se den.
//
// Bug-klassen der motiverede guarden (#2917, 2026-07-25): to parallelle
// branches tilføjede hver sin `manager.noAchievements` til `team.json` — én til
// Achievements-fanens EmptyState (#2876), én til "Senest låst op"-kortet. Hver
// branch var grøn for sig; først PR-merge-committen indeholdt begge, og så
// vandt den sidste. Symptomet var en test der fejlede KUN i CI, med en tekst
// der ikke fandtes i nogen af de to brancher hver for sig.
//
// Guarden læser den RÅ tekst (ikke det parsede objekt) og rapporterer enhver
// nøgle der optræder mere end én gang i det samme objekt.
//
// Brug:
//   node scripts/i18n-check-duplicate-keys.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = "frontend/public/locales";

/**
 * Find nøgler der optræder to gange i det samme JSON-objekt.
 *
 * Minimal scanner frem for en fuld parser: vi følger streng-/escape-tilstand og
 * en stak af objekt-/array-rammer, og registrerer en streng som NØGLE når den
 * afsluttes mens vi står i et objekt og venter på en nøgle.
 *
 * @param {string} raw  Rå JSON-tekst (skal være gyldig JSON)
 * @returns {Array<{path: string, key: string}>} dubletter i fundet-rækkefølge
 */
export function findDuplicateKeys(raw) {
  const duplicates = [];
  const stack = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  // I et objekt veksler vi mellem "venter på nøgle" og "venter på værdi".
  let expectKey = false;
  let pendingKey = null;

  const top = () => stack[stack.length - 1];
  const childPrefix = () => {
    const frame = top();
    if (!frame) return "";
    if (frame.type === "array") return `${frame.prefix}[${frame.index}]`;
    return frame.prefix ? `${frame.prefix}.${pendingKey}` : String(pendingKey);
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') {
        inString = false;
        const text = raw.slice(stringStart + 1, i);
        const frame = top();
        if (frame && frame.type === "object" && expectKey) {
          if (frame.keys.has(text)) {
            duplicates.push({
              path: frame.prefix ? `${frame.prefix}.${text}` : text,
              key: text,
            });
          }
          frame.keys.add(text);
          pendingKey = text;
          expectKey = false;
        }
      }
      continue;
    }

    switch (ch) {
      case '"':
        inString = true;
        stringStart = i;
        break;
      case "{":
        stack.push({ type: "object", keys: new Set(), prefix: stack.length ? childPrefix() : "" });
        expectKey = true;
        pendingKey = null;
        break;
      case "[":
        stack.push({ type: "array", index: 0, prefix: stack.length ? childPrefix() : "" });
        expectKey = false;
        break;
      case "}":
      case "]":
        stack.pop();
        expectKey = false;
        break;
      case ",": {
        const frame = top();
        if (frame && frame.type === "object") expectKey = true;
        else if (frame && frame.type === "array") frame.index += 1;
        break;
      }
      default:
        break;
    }
  }

  return duplicates;
}

function walkJson(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function runCheck() {
  const violations = [];
  let files = 0;
  for (const file of walkJson(join(ROOT, LOCALES_DIR))) {
    files += 1;
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    for (const dup of findDuplicateKeys(readFileSync(file, "utf8"))) {
      violations.push(`${rel} → "${dup.path}"`);
    }
  }

  if (violations.length) {
    console.error(`i18n-check-duplicate-keys: ${violations.length} duplikat-nøgle(r) — JSON.parse beholder den SIDSTE og taber den første i tavshed:\n`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      "\nTo call-sites må ikke dele nøgle med hver sin ordlyd. Giv den ene sin egen nøgle" +
      "\n(fx manager.noRecentAchievements vs manager.noAchievements), eller slå dem sammen til én.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`i18n-check-duplicate-keys: OK — ingen duplikat-nøgler i ${files} locale-filer.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCheck();
}
