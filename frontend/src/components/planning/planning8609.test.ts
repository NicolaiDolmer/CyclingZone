// #8609 · Brostens- og grussektorerne under etapeprofilen: listen bygges af etapens gemte sectors,
// i km-raekkefoelge, og udelader det samme som profilen (ingen placering eller laengde).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sectorRows } from "./stageSectorRows.ts";

const here = (p: string) => new URL(p, import.meta.url);
const routeSrc = readFileSync(here("./RouteProfile.tsx"), "utf8");
const listSrc = readFileSync(here("./StageSectorList.tsx"), "utf8");
const locale = (lng: string) => JSON.parse(readFileSync(here(`../../../public/locales/${lng}/planning.json`), "utf8"));

// Formen fra race_stage_profiles.sectors (kind, name, start_km, length_km), fiktive navne.
const COBBLED = {
  distance_km: 160,
  sectors: [
    { kind: "cobbles", name: "Sektor C", start_km: 145, length_km: 2.4 },
    { kind: "cobbles", name: "Sektor A", start_km: 68, length_km: 1.8 },
    { kind: "cobbles", name: " ", start_km: 82, length_km: 2 },
  ],
};

test("#8609 sectorRows: km-raekkefoelge, slut-km, laengde og km til maal", () => {
  const rows = sectorRows(COBBLED);
  assert.deepEqual(rows.map((r) => r.startKm), [68, 82, 145]);
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2]);
  assert.equal(rows[0].name, "Sektor A");
  assert.equal(rows[1].name, null, "tomt navn = ingen navn, listen viser underlaget");
  assert.equal(rows[2].endKm, 147.4);
  assert.equal(rows[2].lengthKm, 2.4);
  assert.equal(rows[2].kmToGo, 13);
  assert.ok(rows.every((r) => r.kind === "cobbles"));
});

test("#8609 sectorRows: grus genkendes, ubrugelige sektorer udelades som paa profilen", () => {
  const rows = sectorRows({
    distance_km: 200,
    sectors: [
      { kind: "gravel", name: "Hvid vej", start_km: 90, length_km: 3.8 },
      { kind: "gravel", start_km: 120, length_km: 0 },
      { kind: "cobbles", name: "uden placering", length_km: 1 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "gravel");
  assert.equal(rows[0].kmToGo, 106);
});

test("#8609 sectorRows: etape uden sektorer = tom liste (listen vises ikke)", () => {
  assert.deepEqual(sectorRows({ distance_km: 180, sectors: [] }), []);
  assert.deepEqual(sectorRows({ distance_km: 180 }), []);
  assert.deepEqual(sectorRows(null), []);
});

test("#8609 RouteProfile viser sektorlisten under begge profiltyper og markerer valgt sektor", () => {
  assert.equal((routeSrc.match(/<StageSectorList /g) ?? []).length, 2);
  assert.match(routeSrc, /overlay=\{sectorRow \?/);
  assert.match(listSrc, /title=\{full\}/, "fuld tekst i tooltip");
  assert.doesNotMatch(listSrc, /[\u{1F300}-\u{1FAFF}]/u, "ingen emoji");
});

test("#8609 sektorlistens tekster findes paa begge sprog", () => {
  for (const lng of ["da", "en"]) {
    const s = locale(lng).sectorList;
    for (const key of ["titleCobbles", "titleGravel", "titleMixed", "sector", "from", "length", "toFinish", "range", "showOnProfile", "mobileFacts", "full"]) {
      assert.equal(typeof s[key], "string", `${lng}.sectorList.${key}`);
    }
    assert.equal(typeof s.kind.cobbles, "string");
    assert.equal(typeof s.kind.gravel, "string");
  }
});
