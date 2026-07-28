import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findDuplicateKeys } from "./i18n-check-duplicate-keys.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");

test("ren fil → ingen fund", () => {
  const raw = `{ "manager": { "a": "1", "b": "2" }, "other": { "a": "3" } }`;
  assert.deepEqual(findDuplicateKeys(raw), []);
});

test("fanger #2917-mønstret: samme nøgle to gange i samme objekt", () => {
  // Præcis den form to parallelle branches producerede i team.json.
  const raw = `{
    "manager": {
      "recentlyUnlocked": "Senest låst op",
      "noAchievements": "Intet låst op endnu.",
      "tabSeason": "Sæsonhistorik",
      "noAchievements": "Ingen achievements endnu"
    }
  }`;
  const dups = findDuplicateKeys(raw);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].path, "manager.noAchievements");
});

test("samme nøglenavn i FORSKELLIGE objekter er lovligt", () => {
  const raw = `{ "manager": { "title": "A" }, "rider": { "title": "B" } }`;
  assert.deepEqual(findDuplicateKeys(raw), []);
});

test("dubletter på rod-niveau fanges også", () => {
  const raw = `{ "manager": { "a": "1" }, "manager": { "b": "2" } }`;
  const dups = findDuplicateKeys(raw);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].path, "manager");
});

test("nøgle-tekst i en VÆRDI forveksles ikke med en nøgle", () => {
  // Værdien indeholder noget der ligner et nøgle-par; scanneren må ikke bide på.
  const raw = `{ "manager": { "a": "\\"a\\": ignoreres", "b": "a" } }`;
  assert.deepEqual(findDuplicateKeys(raw), []);
});

test("arrays forstyrrer ikke objekt-rammerne", () => {
  const raw = `{
    "help": {
      "rows": [["Kategori", "Eksempler"], ["Sæson", "Podium"]],
      "title": "T",
      "title": "T2"
    }
  }`;
  const dups = findDuplicateKeys(raw);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].path, "help.title");
});

test("escapede anførselstegn afslutter ikke strengen for tidligt", () => {
  const raw = `{ "a": "han sagde \\"hej\\"", "b": "ok" }`;
  assert.deepEqual(findDuplicateKeys(raw), []);
});

// Integration: de ægte locale-filer skal være fri for dubletter.
test("ingen duplikat-nøgler i de rigtige locale-filer", () => {
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".json")) files.push(p);
    }
  };
  walk(LOCALES_DIR);
  assert.ok(files.length > 0, "forventede locale-filer");

  const offenders = [];
  for (const file of files) {
    for (const dup of findDuplicateKeys(readFileSync(file, "utf8"))) {
      offenders.push(`${file} → ${dup.path}`);
    }
  }
  assert.deepEqual(offenders, []);
});
