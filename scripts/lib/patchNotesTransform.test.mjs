import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitLang, normalizeCategory, getTopic, classifyAudience, parseRefs, deriveTitle,
} from "./patchNotesTransform.mjs";

test("splitLang skiller EN·/DA·-præfiks", () => {
  assert.deepEqual(splitLang("EN · Hello world"), { lang: "en", body: "Hello world" });
  assert.deepEqual(splitLang("DA · Hej verden"), { lang: "da", body: "Hej verden" });
});

test("splitLang detekterer dansk for legacy-streng uden præfiks", () => {
  assert.equal(splitLang("Ryttersøgning matcher nu fulde navne").lang, "da");
});

test("normalizeCategory mapper top-level til enum", () => {
  assert.equal(normalizeCategory("Fixed · Mobile", ""), "fixed");
  assert.equal(normalizeCategory("Forbedringer", ""), "improved");
  assert.equal(normalizeCategory("Nyt", ""), "new");
  assert.equal(normalizeCategory("Added · Race results", ""), "new");
});

test("normalizeCategory falder tilbage på indhold for emne-kategori", () => {
  assert.equal(normalizeCategory("Auktioner", "Rettet en fejl hvor bud crashede"), "fixed");
});

test("getTopic returnerer delen efter ·", () => {
  assert.equal(getTopic("Improved · Getting started"), "Getting started");
  assert.equal(getTopic("Nyt"), "");
});

test("classifyAudience markerer interne kategorier + signaler", () => {
  assert.equal(classifyAudience("Infra · CI-guard", "x"), "internal");
  assert.equal(classifyAudience("Admin · PCM-import", "x"), "internal");
  assert.equal(classifyAudience("S-02a", "x"), "internal");
  assert.equal(classifyAudience("Fixed · Mobile", "GRANT SELECT on riders"), "internal");
  assert.equal(classifyAudience("Improved · Getting started", "Hover the balance to learn"), "player");
});

test("parseRefs trækker issue-numre ud og renser body", () => {
  const r = parseRefs("Live balance in the header. Refs #46");
  assert.deepEqual(r.refs, [46]);
  assert.equal(r.body, "Live balance in the header.");
});

test("deriveTitle bruger topic hvis kort, ellers første klausul", () => {
  assert.equal(deriveTitle("Getting started", "A long body here"), "Getting started");
  assert.equal(deriveTitle("", "Mobile tables no longer clip, and more"), "Mobile tables no longer clip");
});
