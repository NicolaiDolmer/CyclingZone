import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2000 sidste faner — Historik-tabellen. Samme i18n-ærlighedsgarantier som
// Udvikling-fanen (#645-mønstret): rider-namespace, ingen hardcoded dansk,
// en/da key-parity for profile.history, ingen em-dash i nye keys.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderHistoryTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderHistoryTab bruger rider-namespacet", () => {
  assert.match(source, /useTranslation\("rider"\)/);
});

test("RiderHistoryTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(stripComments(source), /[æøåÆØÅ]/);
});

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("rider.json har profile.history-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  const en = load("en")?.profile?.history;
  const da = load("da")?.profile?.history;
  assert.ok(en, "en/rider.json mangler profile.history-sektionen");
  assert.ok(da, "da/rider.json mangler profile.history-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort());

  for (const key of ["loading", "loadError", "chipBid", "bidBy", "table.date", "table.type", "table.event", "table.amount"]) {
    assert.ok(flatKeys(en).includes(key), `en profile.history mangler ${key}`);
  }

  for (const [lngName, tree] of [["en", en], ["da", da]]) {
    for (const key of flatKeys(tree)) {
      const value = key.split(".").reduce((o, k) => o?.[k], tree);
      assert.ok(!String(value).includes("—"), `${lngName} profile.history.${key} indeholder em-dash`);
    }
  }
});
