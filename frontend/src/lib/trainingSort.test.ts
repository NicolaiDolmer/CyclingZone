import { test } from "node:test";
import assert from "node:assert/strict";
import { sortTrainingRiders, trainingRiderName, trainingReportRowName } from "./trainingSort.ts";

// #5682 — Traeningsrapporten skal vise ryttere i SAMME raekkefoelge som
// Daglig traening. Verificeret standard (ingen aktiv kolonne-sortering):
// navn (efternavn, fornavn), A->AA — se fil-kommentaren i trainingSort.ts.

test("trainingRiderName: 'efternavn fornavn', trimmet naar et navn mangler", () => {
  assert.equal(trainingRiderName({ firstname: "Mads", lastname: "Pedersen" }), "Pedersen Mads");
  assert.equal(trainingRiderName({ firstname: "Mads", lastname: null }), "Mads");
  assert.equal(trainingRiderName({ firstname: null, lastname: "Pedersen" }), "Pedersen");
  assert.equal(trainingRiderName({}), "");
});

test("trainingReportRowName: flytter sidste ord forrest som efternavns-approksimation", () => {
  assert.equal(trainingReportRowName({ name: "Mads Pedersen" }), "Pedersen Mads");
  assert.equal(trainingReportRowName({ name: "Pedersen" }), "Pedersen");
  assert.equal(trainingReportRowName({ name: "" }), "");
  assert.equal(trainingReportRowName({}), "");
  // Kendt begraensning: flerords-efternavn approksimeres via SIDSTE ord —
  // "Wout van Aert" -> "Aert van Wout" (naeste-bedste, ikke "van Aert Wout").
  assert.equal(trainingReportRowName({ name: "Wout van Aert" }), "Aert Wout van");
});

test("sortTrainingRiders: ingen sort-noegle (default) sorterer paa navn A->AA", () => {
  const riders = [
    { id: 1, firstname: "Wout", lastname: "van Aert" },
    { id: 2, firstname: "Tadej", lastname: "Pogacar" },
    { id: 3, firstname: "Jonas", lastname: "Vingegaard" },
  ];
  const sorted = sortTrainingRiders(riders, null);
  assert.deepEqual(sorted.map((r) => r.id), [2, 1, 3]);
});

test("sortTrainingRiders: 'name' opfoerer sig som default (ingen sort-noegle)", () => {
  const riders = [
    { id: 1, firstname: "B", lastname: "B" },
    { id: 2, firstname: "A", lastname: "A" },
  ];
  assert.deepEqual(
    sortTrainingRiders(riders, "name").map((r) => r.id),
    sortTrainingRiders(riders, null).map((r) => r.id),
  );
});

test("sortTrainingRiders: kendt noegle delegeres til den givne accessor, med retning", () => {
  const riders = [
    { id: 1, score: 10 },
    { id: 2, score: 30 },
    { id: 3, score: 20 },
  ];
  const accessors = { score: (r: { score: number }) => r.score };
  assert.deepEqual(
    sortTrainingRiders(riders, "score", "desc", accessors).map((r) => r.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    sortTrainingRiders(riders, "score", "asc", accessors).map((r) => r.id),
    [1, 3, 2],
  );
});

test("sortTrainingRiders: ukendt noegle falder tilbage paa navn i stedet for tilfaeldig raekkefoelge", () => {
  const riders = [
    { id: 1, firstname: "B", lastname: "B" },
    { id: 2, firstname: "A", lastname: "A" },
  ];
  assert.deepEqual(
    sortTrainingRiders(riders, "does-not-exist", "desc", {}).map((r) => r.id),
    [2, 1],
  );
});

test("sortTrainingRiders: rytterne selv muteres aldrig (input-array uaendret)", () => {
  const riders = [
    { id: 1, firstname: "B", lastname: "B" },
    { id: 2, firstname: "A", lastname: "A" },
  ];
  const copy = riders.map((r) => ({ ...r }));
  sortTrainingRiders(riders, null);
  assert.deepEqual(riders, copy);
});

test("sortTrainingRiders: en custom 'name'-accessor (rapport-raekker) overstyrer standarden", () => {
  const rows = [
    { rider_id: "a", name: "Bo Bertelsen" },
    { rider_id: "b", name: "Alice Andersen" },
    { rider_id: "c", name: "Cecilie Carlsen" },
  ];
  const sorted = sortTrainingRiders(rows, null, "asc", { name: trainingReportRowName });
  assert.deepEqual(sorted.map((r) => r.rider_id), ["b", "a", "c"]);
});

test("sortTrainingRiders: rapport-raekker (via trainingReportRowName) og roster-raekker (via trainingRiderName) giver SAMME raekkefoelge for de samme ryttere, i eetords-efternavn-tilfaelde", () => {
  const alice = { firstname: "Alice", lastname: "Andersen" };
  const bob = { firstname: "Bo", lastname: "Bertelsen" };
  const cecilie = { firstname: "Cecilie", lastname: "Carlsen" };

  // Daglig traenings roster-raekker: allerede alfabetisk fra queryen.
  const dailyOrder = [alice, bob, cecilie];
  // Rapportens raekker (DB-/genererings-raekkefoelge, IKKE alfabetisk),
  // samme personer, kun med det samlede navnefelt rapporten rent faktisk har.
  const reportRows = [
    { rider_id: "b", name: `${bob.firstname} ${bob.lastname}` },
    { rider_id: "c", name: `${cecilie.firstname} ${cecilie.lastname}` },
    { rider_id: "a", name: `${alice.firstname} ${alice.lastname}` },
  ];

  const sortedDaily = sortTrainingRiders(dailyOrder, null).map((r) => r.lastname);
  const sortedReport = sortTrainingRiders(reportRows, null, "asc", { name: trainingReportRowName })
    .map((r) => r.name.split(" ")[1]);

  assert.deepEqual(sortedDaily, ["Andersen", "Bertelsen", "Carlsen"]);
  assert.deepEqual(sortedReport, sortedDaily);
});
