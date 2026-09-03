import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findPendingKeys,
  formatPendingMessage,
  flattenEntries,
  IGNORED_LNGS,
  PLACEHOLDER,
} from "./i18n-check-delta-pending.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "i18n-check-delta-pending.mjs");

test("fuldt oversat namespace giver ingen fund", () => {
  const en = { page: { title: "Auctions", empty: "No auctions" } };
  const da = { page: { title: "Auktioner", empty: "Ingen auktioner" } };
  assert.deepEqual(findPendingKeys(en, da), []);
});

test("nøgle der mangler i målsproget fanges", () => {
  const en = { page: { title: "Auctions", empty: "No auctions" } };
  const da = { page: { title: "Auktioner" } };
  assert.deepEqual(findPendingKeys(en, da), ["page.empty"]);
});

test("__MISSING__ er en FEJL her (til forskel fra i18n-check-keys)", () => {
  const en = { page: { title: "Auctions" } };
  const da = { page: { title: PLACEHOLDER } };
  assert.deepEqual(findPendingKeys(en, da), ["page.title"]);
});

test("nøgle der kun findes i målsproget er IKKE denne guards bord", () => {
  // Retningen er EN → andre. Overskydende DA-nøgler er key-coverage's opgave;
  // duplikeres de her, fejler to jobs på samme fund med to forskellige beskeder.
  const en = { page: { title: "Auctions" } };
  const da = { page: { title: "Auktioner", legacy: "Gammel" } };
  assert.deepEqual(findPendingKeys(en, da), []);
});

test("manglende målfil = hele namespacet er uoversat", () => {
  const en = { a: "1", b: { c: "2" } };
  assert.deepEqual(findPendingKeys(en, null), ["a", "b.c"]);
});

test("arrays er blad-værdier, ikke nøgle-træer", () => {
  // help.json's tabeller er arrays; de skal tælle som ÉN nøgle, ikke som
  // rows.0, rows.1 ... (ellers driver antallet i fejlbeskeden fra virkeligheden).
  const en = { help: { rows: [["Kategori", "Eksempler"]] } };
  assert.deepEqual([...flattenEntries(en).keys()], ["help.rows"]);
  assert.deepEqual(findPendingKeys(en, { help: {} }), ["help.rows"]);
});

test("tom streng tæller som oversat (bevidst tom label)", () => {
  const en = { sep: "" };
  assert.deepEqual(findPendingKeys(en, { sep: "" }), []);
});

test("fejlbeskeden peger på kommandoen der loeser problemet", () => {
  const msg = formatPendingMessage("da", "auctions", ["page.title", "page.empty"]);
  assert.equal(
    msg,
    "Manglende oversaettelser: 2 noegler i da/auctions. " +
      "Koer `infisical run --env=dev -- npm run i18n:translate` " +
      "(scripts/i18n-translate-delta.mjs, PR1 paa #4733) eller udfyld manuelt.",
  );
});

test("pseudo-locale en-XA er aldrig et maalsprog", () => {
  // en-XA genereres på runtime i frontend/src/i18n/index.js og har ingen filer.
  assert.ok(IGNORED_LNGS.has("en-XA"));
});

// Integration: guarden skal være GRØN på repoets egne locale-filer, ellers er
// den ikke klar til at blokere. Kører scriptet som entrypoint, præcis som CI.
test("guarden er groen paa de rigtige locale-filer", () => {
  const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /i18n delta-pending OK/);
});
