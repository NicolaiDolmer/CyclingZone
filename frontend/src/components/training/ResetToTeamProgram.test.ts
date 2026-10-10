import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-guard (samme mønster som AssistantSuggestionsPanel.test.js): 10/10 crashede
// hele træningssiden, fordi klassen `${ min-h-6 }` blev læst som JS (min - h - 6).
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ResetToTeamProgram.tsx"), "utf8");

test("#6123 klasse-interpolationer indeholder kun gyldige udtryk, aldrig bare Tailwind-klasser", () => {
  const bare = [...src.matchAll(/\$\{\s*([a-z][a-z0-9-]*-[a-z0-9-]+)\s*\}/g)].map((m) => m[1]);
  assert.deepEqual(bare, [], `bare Tailwind-klasser i \${...}: ${bare.join(", ")}`);
});

test("#6123 knappen har et tryk-venligt mål på telefon (compact) og 24 px på desktop", () => {
  assert.match(src, /compact \? "min-h-10" : "min-h-6"/);
});
