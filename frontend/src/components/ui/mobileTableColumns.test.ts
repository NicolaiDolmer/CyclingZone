import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_COLUMN_COUNT,
  defaultMobileColumnKeys,
  mobileColumnLabel,
  mobileColumnsStorageKey,
  mobileSwappableColumns,
  normalizeMobileColumnKeys,
  orderMobileColumns,
  readMobileColumnKeys,
  swapMobileColumn,
  writeMobileColumnKeys,
} from "./mobileTableColumns.ts";

// D-047 (#5102) — mobilstandardens kolonnevalg. Reglerne der testes her er
// beslutningens egne: PRÆCIS tre kolonner, navnekolonnen er aldrig en af dem,
// visningsordenen er desktopens, og valget huskes pr. tabel-label.

const COLUMNS = [
  { key: "nation", fold: true },
  { key: "name", sticky: true },
  { key: "rating", numeric: true },
  { key: "type" },
  { key: "age", numeric: true, fold: true },
  { key: "value", numeric: true },
  { key: "salary", numeric: true },
  { key: "popularity", numeric: true },
];

test("navnekolonnen og fold-kolonnerne er aldrig chips", () => {
  assert.deepEqual(
    mobileSwappableColumns(COLUMNS).map((c) => c.key),
    ["rating", "type", "value", "salary", "popularity"]
  );
});

test("sidens mobileDefaults vinder, og der vaelges praecis tre", () => {
  assert.deepEqual(defaultMobileColumnKeys(COLUMNS, ["rating", "value", "salary"]), ["rating", "value", "salary"]);
  assert.equal(defaultMobileColumnKeys(COLUMNS, ["rating", "value", "salary"]).length, MOBILE_COLUMN_COUNT);
});

test("uden mobileDefaults falder valget tilbage paa de tre foerste NUMERISKE kolonner", () => {
  // "type" staar foer "value" i kolonneorden, men er ikke numerisk — den maa
  // ikke stjæle en af de tre pladser fra et tal.
  assert.deepEqual(defaultMobileColumnKeys(COLUMNS, null), ["rating", "value", "salary"]);
});

test("ugyldige og dublerede defaults ignoreres, og der fyldes op", () => {
  assert.deepEqual(defaultMobileColumnKeys(COLUMNS, ["name", "nation", "salary", "salary"]), [
    "salary",
    "rating",
    "value",
  ]);
});

test("faerre end tre byttebare kolonner giver bare dem der findes", () => {
  const few = [{ key: "team", sticky: true }, { key: "division" }, { key: "score", numeric: true }];
  assert.deepEqual(defaultMobileColumnKeys(few, null), ["score", "division"]);
});

test("normalize kasserer ukendte nøgler og fylder op fra sidens defaults", () => {
  assert.deepEqual(normalizeMobileColumnKeys(["popularity", "vaerdi-fra-en-gammel-version"], COLUMNS, [
    "rating",
    "value",
    "salary",
  ]), ["popularity", "rating", "value"]);
  assert.deepEqual(normalizeMobileColumnKeys(null, COLUMNS, ["rating", "value", "salary"]), [
    "rating",
    "value",
    "salary",
  ]);
  assert.deepEqual(normalizeMobileColumnKeys("noget-vrøvl", COLUMNS, ["salary"]), ["salary", "rating", "value"]);
});

test("normalize kan aldrig give navnekolonnen tilbage, heller ikke fra localStorage", () => {
  assert.deepEqual(normalizeMobileColumnKeys(["name", "nation"], COLUMNS, ["rating", "value", "salary"]), [
    "rating",
    "value",
    "salary",
  ]);
});

test("et chip-tryk skubber den AELDSTE valgte ud, og antallet forbliver tre", () => {
  const start = ["rating", "value", "salary"];
  const next = swapMobileColumn(start, "popularity");
  assert.deepEqual(next, ["value", "salary", "popularity"]);
  assert.equal(next.length, MOBILE_COLUMN_COUNT);
  assert.deepEqual(swapMobileColumn(next, "type"), ["salary", "popularity", "type"]);
});

test("tryk paa en allerede valgt kolonne aendrer intet (standarden er TRE, ikke 'op til tre')", () => {
  assert.deepEqual(swapMobileColumn(["rating", "value", "salary"], "value"), ["rating", "value", "salary"]);
});

test("visningsordenen er desktopens kolonneorden, ikke valg-raekkefoelgen", () => {
  assert.deepEqual(
    orderMobileColumns(COLUMNS, ["salary", "rating", "value"]).map((c) => c.key),
    ["rating", "value", "salary"]
  );
});

test("localStorage-noeglen er pr. tabel-label, og et tabel uden tekst-label husker intet", () => {
  assert.equal(mobileColumnsStorageKey("Mit hold"), "cz:table-cols:Mit hold");
  assert.equal(mobileColumnsStorageKey("  "), null);
  assert.equal(mobileColumnsStorageKey(undefined), null);
  assert.equal(mobileColumnsStorageKey(42), null);
});

test("valget huskes og laeses tilbage pr. label", () => {
  const store = new Map<string, string>();
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  try {
    writeMobileColumnKeys("Trup", ["value", "salary", "popularity"]);
    assert.equal(store.get("cz:table-cols:Trup"), JSON.stringify(["value", "salary", "popularity"]));
    assert.deepEqual(readMobileColumnKeys("Trup", COLUMNS, ["rating", "value", "salary"]), [
      "value",
      "salary",
      "popularity",
    ]);
    // Et andet bord deler ikke valget.
    assert.deepEqual(readMobileColumnKeys("Ryttere", COLUMNS, ["rating", "value", "salary"]), [
      "rating",
      "value",
      "salary",
    ]);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test("en localStorage der kaster faelder ikke tabellen — den falder tilbage paa defaults", () => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    },
  };
  try {
    assert.deepEqual(readMobileColumnKeys("Trup", COLUMNS, ["rating", "value", "salary"]), [
      "rating",
      "value",
      "salary",
    ]);
    assert.doesNotThrow(() => writeMobileColumnKeys("Trup", ["rating"]));
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test("chip-labelet er kolonnens header naar den er tekst, ellers mobileLabel", () => {
  assert.equal(mobileColumnLabel({ key: "value", header: "Value" }), "Value");
  assert.equal(mobileColumnLabel({ key: "rating", header: { type: "span" }, mobileLabel: "OVR" }), "OVR");
  assert.equal(mobileColumnLabel({ key: "rating", header: { type: "span" } }), "rating");
});
