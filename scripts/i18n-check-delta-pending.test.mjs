import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findPendingKeys,
  formatPendingMessage,
  flattenEntries,
  selectTargetLngs,
  runDeltaPending,
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

// #6806: uregistrerede locale-mapper er work in progress, samme filter som key-coverage.
test("selectTargetLngs: kun registrerede sprog er maalsprog, resten er WIP", () => {
  const r = selectTargetLngs(["en", "da", "nl", "en-XA", "fr"], ["en", "da", "fr"]);
  assert.deepEqual(r.targets, ["da", "fr"]);
  assert.deepEqual(r.skipped, ["nl"]);
});

test("selectTargetLngs: kildesproget og pseudo-locale er hverken maal eller WIP", () => {
  const r = selectTargetLngs(["en", "en-XA"], ["en"]);
  assert.deepEqual(r, { targets: [], skipped: [] });
});

function makeRoot(t, registered, locales) {
  const root = mkdtempSync(join(tmpdir(), "i18n-delta-pending-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "frontend/src/i18n"), { recursive: true });
  writeFileSync(
    join(root, "frontend/src/i18n/languages.js"),
    "export const LANGUAGES = [\n" + registered.map((c) => `  { code: "${c}", label: "${c}" },`).join("\n") + "\n];\n",
  );
  for (const [lng, namespaces] of Object.entries(locales)) {
    const dir = join(root, "frontend/public/locales", lng);
    mkdirSync(dir, { recursive: true });
    for (const [ns, data] of Object.entries(namespaces)) writeFileSync(join(dir, `${ns}.json`), JSON.stringify(data));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  return { status: r.status, output: r.stdout + r.stderr };
}

const EN = { common: { hello: "Hello", bye: "Bye" } };

test("runDeltaPending: uoversat WIP-mappe blokerer ikke og meldes som info (#6806)", (t) => {
  const root = makeRoot(t, ["en", "da"], {
    en: EN,
    da: { common: { hello: "Hej", bye: "Farvel" } },
    nl: { common: { hello: "Hallo" } }, // uregistreret og ufaerdig
  });
  const r = runDeltaPending({ root });
  assert.equal(r.ok, true, r.failures.join("\n"));
  assert.deepEqual(r.targets, ["da"]);
  assert.deepEqual(r.skipped, ["nl"]);
  assert.match(r.info.join("\n"), /uregistrerede[^\n]*nl/);

  const cli = run(root);
  assert.equal(cli.status, 0, cli.output);
  assert.match(cli.output, /springer uregistrerede locale-mapper over[^\n]*nl/);
  assert.match(cli.output, /i18n delta-pending OK/);
});

test("runDeltaPending: registreret sprog med manglende noegler blokerer stadig (#6806)", (t) => {
  const root = makeRoot(t, ["en", "da", "nl"], {
    en: EN,
    da: { common: { hello: "Hej", bye: "Farvel" } },
    nl: { common: { hello: "Hallo" } },
  });
  const r = runDeltaPending({ root });
  assert.equal(r.ok, false);
  assert.equal(r.pendingTotal, 1);
  assert.match(r.failures.join("\n"), /nl\/common/);

  const cli = run(root);
  assert.equal(cli.status, 1, cli.output);
  assert.match(cli.output, /Manglende oversaettelser: 1 noegler i nl\/common/);
});

test("runDeltaPending: kun WIP-mapper og ingen registrerede maalsprog er groent (#6806)", (t) => {
  const root = makeRoot(t, ["en"], { en: EN, nl: { common: {} } });
  const cli = run(root);
  assert.equal(cli.status, 0, cli.output);
  assert.match(cli.output, /nl/);
});

test("runDeltaPending: pseudo-locale en-XA med mappe bliver aldrig et maalsprog", (t) => {
  const root = makeRoot(t, ["en"], { en: EN, "en-XA": { common: {} } });
  const r = runDeltaPending({ root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.targets, []);
  assert.deepEqual(r.skipped, []);
});

// Integration: guarden skal være GRØN på repoets egne locale-filer, ellers er
// den ikke klar til at blokere. Kører scriptet som entrypoint, præcis som CI.
test("guarden er groen paa de rigtige locale-filer", () => {
  const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /i18n delta-pending OK/);
});
