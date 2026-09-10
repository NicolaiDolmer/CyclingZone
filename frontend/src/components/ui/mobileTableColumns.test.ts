import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_COLUMN_COUNT,
  applyMobileChipOrder,
  defaultMobileColumnKeys,
  mobileColumnLabel,
  mobileColumnsStorageKey,
  mobileSwappableColumns,
  normalizeMobileColumnKeys,
  orderMobileChips,
  orderMobileColumns,
  readMobileColumnKeys,
  swapMobileColumn,
  writeMobileColumnKeys,
} from "./mobileTableColumns.ts";

// D-047 (#5102) — mobilstandardens kolonnevalg. Reglerne der testes her er
// beslutningens egne: PRÆCIS tre kolonner, navnekolonnen er aldrig en af dem,
// visningsordenen er desktopens, og valget huskes pr. kolonnesæt.

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

test("chip-raekken viser de VALGTE tre foerst, saa de aldrig ruller ud af skaermen", () => {
  assert.deepEqual(
    orderMobileChips(COLUMNS, ["salary", "popularity", "type"]).map((c) => c.key),
    ["type", "salary", "popularity", "rating", "value"]
  );
});

test("visningsordenen er desktopens kolonneorden, ikke valg-raekkefoelgen", () => {
  assert.deepEqual(
    orderMobileColumns(COLUMNS, ["salary", "rating", "value"]).map((c) => c.key),
    ["rating", "value", "salary"]
  );
});

// Noeglen bygges paa KOLONNESAETTET, ikke paa det viste label: labelet er
// oversat ("Trup (1)" / "Squad (1)"), taeller raekker med, og to linser paa
// samme side deler det. Alle tre ville tabe eller blande spillerens valg.
test("localStorage-noeglen er pr. kolonnesaet, ikke pr. label", () => {
  const key = mobileColumnsStorageKey(COLUMNS);
  assert.match(key ?? "", /^cz:table-cols:v2:[0-9a-z]+$/);
  // Samme kolonner igen = samme noegle (sproget/raekketallet aendrer intet).
  assert.equal(mobileColumnsStorageKey([...COLUMNS]), key);
  // Et ANDET kolonnesaet paa samme side (Mit holds Overblik vs. Evner) faar sin
  // egen noegle, saa de to ikke stomper hinandens valg.
  const abilities = [
    { key: "name", sticky: true },
    { key: "rating", numeric: true },
    { key: "climbing", numeric: true },
    { key: "sprint", numeric: true },
  ];
  assert.notEqual(mobileColumnsStorageKey(abilities), key);
  assert.equal(mobileColumnsStorageKey([]), null);
});

test("valget huskes og laeses tilbage pr. kolonnesaet", () => {
  const store = new Map<string, string>();
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  try {
    writeMobileColumnKeys(COLUMNS, ["value", "salary", "popularity"]);
    assert.equal(
      store.get(mobileColumnsStorageKey(COLUMNS) as string),
      JSON.stringify(["value", "salary", "popularity"])
    );
    assert.deepEqual(readMobileColumnKeys(COLUMNS, ["rating", "value", "salary"]), [
      "value",
      "salary",
      "popularity",
    ]);
    // En tabel med et andet kolonnesaet deler ikke valget.
    const other = [
      { key: "team", sticky: true },
      { key: "points", numeric: true },
      { key: "wins", numeric: true },
      { key: "prize", numeric: true },
      { key: "u25", numeric: true },
    ];
    assert.deepEqual(readMobileColumnKeys(other, ["points", "wins", "prize"]), ["points", "wins", "prize"]);
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
    assert.deepEqual(readMobileColumnKeys(COLUMNS, ["rating", "value", "salary"]), [
      "rating",
      "value",
      "salary",
    ]);
    assert.doesNotThrow(() => writeMobileColumnKeys(COLUMNS, ["rating"]));
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

// Chip-ordenen fryses ved aabning: de valgte foerst, men raekken maa ikke
// omarrangere sig ved hvert tryk (fejlklik-generator paa mobil).
test("den frosne chip-orden holder raekken stabil, ogsaa naar valget skifter", () => {
  const frozen = orderMobileChips(COLUMNS, ["rating", "value", "salary"]).map((c) => c.key);
  assert.deepEqual(frozen, ["rating", "value", "salary", "type", "popularity"]);
  // Et byt aendrer IKKE ordenen — kun hvilke der er aktive.
  assert.deepEqual(applyMobileChipOrder(COLUMNS, frozen).map((c) => c.key), frozen);
  // Ukendte noegler ignoreres, og en kolonne der ikke stod i ordenen haenges bagpaa.
  assert.deepEqual(applyMobileChipOrder(COLUMNS, ["salary", "vaek", "rating"]).map((c) => c.key), [
    "salary",
    "rating",
    "type",
    "value",
    "popularity",
  ]);
});

test("chip-labelet er kolonnens header naar den er tekst, ellers mobileLabel", () => {
  assert.equal(mobileColumnLabel({ key: "value", header: "Value" }), "Value");
  assert.equal(mobileColumnLabel({ key: "rating", header: { type: "span" }, mobileLabel: "OVR" }), "OVR");
  assert.equal(mobileColumnLabel({ key: "rating", header: { type: "span" } }), "rating");
});
