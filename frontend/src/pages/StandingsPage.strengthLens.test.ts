import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #6322 — styrke-linsen hang på "…": fetch-effekten satte selv strengthLoading, som
// stod i dens deps. Re-run'et kørte cleanup (cancelled=true) og kasserede resultatet,
// og det nye run returnerede straks (strengthLoading=true). Kildekode-guard (repoet
// kører node --test uden DOM-renderer).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "StandingsPage.jsx"), "utf8");
const start = source.indexOf("Lazy squad-styrke-fetch");
const end = source.indexOf("?compare=1 deep-link");
const block = source.slice(start, end);

test("#6322 styrke-effekten har ikke strengthLoading i deps", () => {
  assert.ok(start > 0 && end > start, "fandt ikke effekt-blokken");
  assert.match(block, /\}, \[lens, strength\]\);/);
  assert.doesNotMatch(block, /\[lens, strength, strengthLoading\]/);
});

test("#6322 effekten annullerer ikke sit eget resultat via cleanup", () => {
  assert.doesNotMatch(block, /cancelled/);
  assert.doesNotMatch(block, /return \(\) => \{ cancelled/);
  assert.match(block, /strengthFetchStarted\.current/);
  assert.match(block, /strengthMounted\.current/);
});

test("#6322 fejlet fetch efterlader ikke linsen i loading", () => {
  assert.match(block, /catch \(err\)/);
  assert.match(block, /setStrength\(agg\); setStrengthLoading\(false\)/);
  assert.match(block, /strengthFetchStarted\.current = false;/, "fejl skal tillade nyt forsøg");
  assert.match(block, /strengthMounted\.current = true;/, "StrictMode-replay skal genaktivere mounted-ref");
});
