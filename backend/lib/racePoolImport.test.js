import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRacePoolCsv,
  buildExternalId,
  summarizePool,
  KATEGORI_TO_RACE_CLASS,
  TYPE_TO_RACE_TYPE,
  WORLD_TOUR_CLASSES,
} from "./racePoolImport.js";

const HEADER = "Dato,Løb,Etaper,Kategori,Type";

test("parseRacePoolCsv — parser en gyldig række", () => {
  const csv = `${HEADER}\n21/3,Milano-Sanremo,1,Monuments,Endagsløb`;
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    external_id: buildExternalId("Milano-Sanremo", "21/3"),
    name: "Milano-Sanremo",
    race_class: "Monuments",
    race_type: "single",
    stages: 1,
    date_text: "21/3",
  });
});

test("parseRacePoolCsv — håndterer quoted Kategori med komma (Giro, Vuelta)", () => {
  const csv = `${HEADER}\n8/5 - 31/5,Giro d'Italia,21,"Giro, Vuelta",Etapeløb`;
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].race_class, "GiroVuelta");
  assert.equal(rows[0].race_type, "stage_race");
  assert.equal(rows[0].stages, 21);
  assert.equal(rows[0].name, "Giro d'Italia");
});

test("parseRacePoolCsv — alle 9 frontend race_class-keys mappes", () => {
  const expectedKeys = [
    "TourFrance",
    "GiroVuelta",
    "Monuments",
    "OtherWorldTourA",
    "OtherWorldTourB",
    "OtherWorldTourC",
    "ProSeries",
    "Class1",
    "Class2",
  ];
  for (const key of expectedKeys) {
    const found = Object.values(KATEGORI_TO_RACE_CLASS).includes(key);
    assert.ok(found, `frontend-key ${key} skal være target i KATEGORI_TO_RACE_CLASS`);
  }
});

test("parseRacePoolCsv — fejler på ukendt Kategori uden at crashe", () => {
  const csv = `${HEADER}\n21/3,Foo Race,1,Cyklocross,Endagsløb`;
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /ukendt_kategori/);
});

test("parseRacePoolCsv — fejler på ugyldig Etaper", () => {
  const csv = `${HEADER}\n21/3,Foo,abc,Monuments,Endagsløb`;
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /ugyldig_etaper/);
});

test("parseRacePoolCsv — endagsløb skal have stages=1", () => {
  const csv = `${HEADER}\n21/3,Foo,5,Monuments,Endagsløb`;
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(rows.length, 0);
  assert.match(errors[0].reason, /endagsløb_skal_have_stages_1/);
});

test("parseRacePoolCsv — håndterer manglende kolonner i header", () => {
  const csv = "Dato,Løb,Etaper\n21/3,Foo,1";
  const { rows, errors } = parseRacePoolCsv(csv);
  assert.equal(rows.length, 0);
  assert.ok(errors.some((e) => /mangler_kolonne_kategori/.test(e.reason)));
});

test("buildExternalId — deterministisk + identisk for samme input", () => {
  const id1 = buildExternalId("Tour de France", "4/7 - 26/7");
  const id2 = buildExternalId("Tour de France", "4/7 - 26/7");
  assert.equal(id1, id2);
  assert.equal(id1.length, 16);
});

test("buildExternalId — case-insensitivt + whitespace-normaliseret", () => {
  const id1 = buildExternalId("Tour de France", "4/7 - 26/7");
  const id2 = buildExternalId("  TOUR  DE  FRANCE  ", "4/7 - 26/7");
  assert.equal(id1, id2);
});

test("buildExternalId — ændrer sig hvis dato ændrer sig", () => {
  const id1 = buildExternalId("Tour de France", "4/7 - 26/7");
  const id2 = buildExternalId("Tour de France", "5/7 - 27/7");
  assert.notEqual(id1, id2);
});

test("parseRacePoolCsv — re-parse af samme CSV giver identisk external_id (idempotency)", () => {
  const csv = `${HEADER}\n4/7 - 26/7,Tour de France,21,Tour de France,Etapeløb`;
  const a = parseRacePoolCsv(csv);
  const b = parseRacePoolCsv(csv);
  assert.equal(a.rows[0].external_id, b.rows[0].external_id);
});

test("summarizePool — tæller løb og løbsdage per klasse", () => {
  const pool = [
    { race_class: "Monuments", stages: 1 },
    { race_class: "Monuments", stages: 1 },
    { race_class: "ProSeries", stages: 5 },
    { race_class: "ProSeries", stages: 1 },
  ];
  const summary = summarizePool(pool);
  assert.deepEqual(summary.Monuments, { count: 2, raceDays: 2 });
  assert.deepEqual(summary.ProSeries, { count: 2, raceDays: 6 });
});

test("WORLD_TOUR_CLASSES dækker alle 6 WT-keys (alt undtagen ProSeries/Class1/Class2)", () => {
  const expected = [
    "TourFrance",
    "GiroVuelta",
    "Monuments",
    "OtherWorldTourA",
    "OtherWorldTourB",
    "OtherWorldTourC",
  ];
  assert.deepEqual([...WORLD_TOUR_CLASSES].sort(), expected.sort());
});

test("TYPE_TO_RACE_TYPE — kun 2 typer", () => {
  assert.equal(TYPE_TO_RACE_TYPE["Endagsløb"], "single");
  assert.equal(TYPE_TO_RACE_TYPE["Etapeløb"], "stage_race");
});
