import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_CLUB_DNA, DNA_KEYS, dnaCopyPayload } from "./boardClubDna.js";

// #4734 · Klub-DNA'ets label/short/long var hardcodet DANSK prosa i backend og
// blev sendt som fallback til ALLE managers, ogsaa dem med users.language = "en"
// (frontend viser fallbacken naar noeglen mangler). Nu er backend-teksten EN og
// bundet til locale-filerne af testene her:
//   1. hver DNA baerer sine tre locale-noegler eksplicit,
//   2. noeglerne findes i BAADE en og da,
//   3. EN-fallbacken i koden er ORDRET den samme streng som en/board.json.
// (3) er den der faktisk holder de to fra at drive fra hinanden — samme rolle som
// scripts/build-backend-locales.mjs --check spiller for backendMessages.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = join(ROOT, "frontend", "public", "locales");

function loadBoard(lng) {
  return JSON.parse(readFileSync(join(LOCALES, lng, "board.json"), "utf8"));
}

function lookup(obj, path) {
  return path.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

const FIELDS = [
  ["label", "label_key"],
  ["short_description", "short_description_key"],
  ["long_description", "long_description_key"],
];

test("hver klub-DNA baerer sine tre locale-noegler eksplicit", () => {
  for (const key of DNA_KEYS) {
    const dna = BOARD_CLUB_DNA[key];
    assert.equal(dna.label_key, `dna.${key}.label`);
    assert.equal(dna.short_description_key, `dna.${key}.shortDescription`);
    assert.equal(dna.long_description_key, `dna.${key}.longDescription`);
    assert.equal(dna.tradition_goal.label_key, `dna.${key}.traditionGoalLabel`);
  }
});

test("alle DNA-noegler findes i baade en og da", () => {
  for (const lng of ["en", "da"]) {
    const board = loadBoard(lng);
    for (const key of DNA_KEYS) {
      const dna = BOARD_CLUB_DNA[key];
      for (const [, keyField] of FIELDS) {
        assert.equal(typeof lookup(board, dna[keyField]), "string", `${dna[keyField]} mangler i ${lng}/board.json`);
      }
      assert.equal(
        typeof lookup(board, dna.tradition_goal.label_key),
        "string",
        `${dna.tradition_goal.label_key} mangler i ${lng}/board.json`,
      );
    }
  }
});

test("backendens EN-fallback er ordret den samme streng som en/board.json", () => {
  const board = loadBoard("en");
  for (const key of DNA_KEYS) {
    const dna = BOARD_CLUB_DNA[key];
    for (const [textField, keyField] of FIELDS) {
      assert.equal(dna[textField], lookup(board, dna[keyField]), `${key}.${textField} er drevet fra ${dna[keyField]}`);
    }
    assert.equal(
      dna.tradition_goal.label,
      lookup(board, dna.tradition_goal.label_key),
      `${key}.tradition_goal.label er drevet fra ${dna.tradition_goal.label_key}`,
    );
  }
});

test("ingen dansk prosa tilbage i den DNA-copy API'et sender", () => {
  for (const key of DNA_KEYS) {
    const payload = dnaCopyPayload(BOARD_CLUB_DNA[key]);
    for (const field of ["label", "short_description", "long_description"]) {
      assert.doesNotMatch(payload[field], /[æøåÆØÅ]/, `${key}.${field} indeholder dansk tekst`);
    }
  }
});

// #4377 gjaldt oprindeligt den danske streng i koden. Nu hvor koden er EN, skal
// loeftet holde i BEGGE sprog: et kumulativt maal maa ikke love en per-saeson-
// nulstilling nogen steder.
test("#4377 · sprint-tradition-maalet lover ikke per-saeson-nulstilling i noget sprog", () => {
  const goal = BOARD_CLUB_DNA.sprint_kommerciel.tradition_goal;
  assert.equal(goal.cumulative, true);
  assert.doesNotMatch(lookup(loadBoard("en"), goal.label_key), /per season/i);
  assert.doesNotMatch(lookup(loadBoard("da"), goal.label_key), /pr\. sæson|per sæson/i);
});

test("dnaCopyPayload returnerer null for en ukendt DNA (samme som foer)", () => {
  assert.equal(dnaCopyPayload(null), null);
  assert.equal(dnaCopyPayload({}), null);
});
