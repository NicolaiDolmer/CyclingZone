#!/usr/bin/env node
// #5011 — kopiér @-tag-parseren fra backend til frontend.
//
// Backend er kilden: det er serveren der afgør hvem der får en notifikation,
// så en regel skal rettes DER først. Frontendens kopi bruges kun til at
// rendre de samme navne klikbare og til autocomplete — men den skal skære
// teksten præcis samme sted op, ellers kan et navn stå ulinket i teksten
// mens modtageren fik en besked (eller omvendt).
//
// Paritet håndhæves af frontend/src/lib/forumMentions.parity.test.js. Dette
// script er den hurtige vej til at gøre testen grøn igen efter en ændring.
//
//   node scripts/sync-forum-mentions-parser.mjs [--check]
//
// --check skriver ikke, men exit 1'er hvis blokkene er drevet fra hinanden
// (samme kontrakt som testen — brugbar i en pre-commit-hook).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(repoRoot, "backend", "lib", "forumMentions.js");
const FRONTEND = join(repoRoot, "frontend", "src", "lib", "forumMentions.js");

export const SHARED_BLOCK_RE =
  /\/\/ >>> SHARED MENTION PARSER \(#5011\)[\s\S]*?\/\/ <<< SHARED MENTION PARSER \(#5011\)/;

export function sharedBlock(source, label) {
  const match = source.match(SHARED_BLOCK_RE);
  if (!match) {
    throw new Error(
      `${label}: fandt ikke SHARED MENTION PARSER-blokken. Markørerne (">>> SHARED MENTION PARSER (#5011)" / "<<< SHARED MENTION PARSER (#5011)") skal stå uændret i begge filer.`,
    );
  }
  return match[0];
}

const checkOnly = process.argv.includes("--check");
const backendBlock = sharedBlock(readFileSync(BACKEND, "utf8"), "backend/lib/forumMentions.js");
const frontendSource = readFileSync(FRONTEND, "utf8");
const frontendBlock = sharedBlock(frontendSource, "frontend/src/lib/forumMentions.js");

if (backendBlock === frontendBlock) {
  console.log("forum-mention-parseren er i sync.");
  process.exit(0);
}

if (checkOnly) {
  console.error(
    "forum-mention-parseren er drevet fra hinanden (#5011).\n" +
      "Ret backend/lib/forumMentions.js og kør: node scripts/sync-forum-mentions-parser.mjs",
  );
  process.exit(1);
}

writeFileSync(FRONTEND, frontendSource.replace(SHARED_BLOCK_RE, () => backendBlock));
console.log("frontend/src/lib/forumMentions.js opdateret fra backend/lib/forumMentions.js.");
