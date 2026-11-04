// #7643: indlæser de anonymiserede sandhedsvagt-fixtures (Giro della Penisola,
// eksporteret read-only 4/11; rytter- og hold-id'er er aliaser, navne fjernet).
import fs from "node:fs";

export const FIXTURE_RACE_ID = "fixture-giro";

function rowsOf(table) {
  return (table?.rows ?? []).map((row) => Object.fromEntries(table.columns.map((column, i) => [column, row[i]])));
}

export function loadFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
}

/** Fixture -> checkStage-input (samme form som vagtens egen indlæsning). */
export function stageInput(name) {
  const data = loadFixture(name);
  return {
    raceId: FIXTURE_RACE_ID,
    stageNumber: data.stage_number,
    timelineVersion: data.timeline_version,
    events: data.events,
    raceRows: rowsOf(data.results),
    passages: rowsOf(data.passages),
    moments: data.moments,
    incidents: data.incidents ?? [],
  };
}
