import test from "node:test";
import assert from "node:assert/strict";

import { buildUciMenRacePointRows } from "./uciRacePointDefaults.js";
import {
  masterClassFor,
  buildModelFromRows,
  generateRows,
} from "./racePointModel.js";

function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      a.race_class.localeCompare(b.race_class) ||
      a.result_type.localeCompare(b.result_type) ||
      a.rank - b.rank,
  );
}

test("masterClassFor: endags-typer → Monuments, resten → TourFrance", () => {
  assert.equal(masterClassFor("Klassiker"), "Monuments");
  assert.equal(masterClassFor("KlassikerHold"), "Monuments");
  assert.equal(masterClassFor("Klassement"), "TourFrance");
  assert.equal(masterClassFor("Etapeplacering"), "TourFrance");
  assert.equal(masterClassFor("Pointtroje"), "TourFrance");
});

test("REGRESSION: generate(seed(defaults)) reproducerer defaults bit-for-bit", () => {
  const rows = buildUciMenRacePointRows();
  const model = buildModelFromRows(rows);
  const regenerated = generateRows(model);

  assert.equal(regenerated.length, rows.length, "samme antal rækker");
  const a = sortRows(rows);
  const b = sortRows(regenerated);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(
      { rc: b[i].race_class, rt: b[i].result_type, rk: b[i].rank, p: b[i].points },
      { rc: a[i].race_class, rt: a[i].result_type, rk: a[i].rank, p: a[i].points },
      `mismatch @ ${a[i].race_class}/${a[i].result_type}/#${a[i].rank}: ${b[i].points} ≠ ${a[i].points}`,
    );
  }
});

test("seed: master-faktorer = 1 (master reproducerer sig selv)", () => {
  const rows = buildUciMenRacePointRows();
  const { cascades } = buildModelFromRows(rows);
  // TourFrance Klassement = master → factor 1; Monuments Klassiker = master → factor 1
  const tdfGc = cascades.find((c) => c.race_class === "TourFrance" && c.result_type === "Klassement");
  const monKlassiker = cascades.find((c) => c.race_class === "Monuments" && c.result_type === "Klassiker");
  assert.ok(tdfGc && Math.abs(tdfGc.factor - 1) < 1e-9, "TdF GC-faktor = 1");
  assert.ok(monKlassiker && Math.abs(monKlassiker.factor - 1) < 1e-9, "Monuments Klassiker-faktor = 1");
});

test("akse-2: edit af master-anker skalerer ALLE kategorier der deler result_type", () => {
  const rows = buildUciMenRacePointRows();
  const model = buildModelFromRows(rows);
  const before = generateRows(model);

  // Fordobl GC-master-ankeret (TourFrance Klassement rank-1).
  const gcMaster = model.masters.find((m) => m.result_type === "Klassement");
  gcMaster.anchor = gcMaster.anchor * 2;
  const after = generateRows(model);

  const pick = (rows, rc) => rows.find((r) => r.race_class === rc && r.result_type === "Klassement" && r.rank === 1).points;
  // Master + alle afledte GC fordobles (±1 afrunding).
  for (const rc of ["TourFrance", "GiroVuelta", "ProSeries", "Class2"]) {
    assert.ok(Math.abs(pick(after, rc) - pick(before, rc) * 2) <= 1, `${rc} GC fordoblet`);
  }
  // En anden result-type (Etapeplacering) er uændret.
  const stageBefore = before.find((r) => r.race_class === "GiroVuelta" && r.result_type === "Etapeplacering" && r.rank === 1).points;
  const stageAfter = after.find((r) => r.race_class === "GiroVuelta" && r.result_type === "Etapeplacering" && r.rank === 1).points;
  assert.equal(stageAfter, stageBefore, "Etapeplacering urørt af GC-anker-edit");
});

test("akse-2: edit af én faktor ændrer KUN den (kategori × result-type)-kurve", () => {
  const rows = buildUciMenRacePointRows();
  const model = buildModelFromRows(rows);
  const before = generateRows(model);

  const f = model.cascades.find((c) => c.race_class === "ProSeries" && c.result_type === "Klassement");
  f.factor = f.factor * 2;
  const after = generateRows(model);

  const diff = (rc, rt) => {
    const b = before.find((r) => r.race_class === rc && r.result_type === rt && r.rank === 1).points;
    const a = after.find((r) => r.race_class === rc && r.result_type === rt && r.rank === 1).points;
    return [b, a];
  };
  const [pb, pa] = diff("ProSeries", "Klassement");
  assert.ok(Math.abs(pa - pb * 2) <= 1, "ProSeries GC fordoblet");
  // Andre kategoriers GC + ProSeries' andre typer urørt.
  const [gb, ga] = diff("GiroVuelta", "Klassement");
  assert.equal(ga, gb, "GiroVuelta GC urørt");
  const [sb, sa] = diff("ProSeries", "Etapeplacering");
  assert.equal(sa, sb, "ProSeries Etapeplacering urørt");
});
