// #5631: kontrakt-test på kildeteksten. .tsx-komponenter kan ikke renderes af
// node --test (ingen JSX-stripping), så testen holder fast i at trup-siden
// GENBRUGER My Teams byggesten i stedet for egne kopier, og at Youth races har
// en rute. Adfærden i browseren dækkes af e2e-testen for fanerne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const squadPage = read("SquadPage.tsx");
const squadTable = read("../components/squad/YouthSquadTable.tsx");
const statsTab = read("../components/TeamStatsTab.jsx");
const teamPage = read("TeamPage.jsx");
const app = read("../App.jsx");

test("trup-siden har My Teams Stats-fane (TeamStatsTab, ingen kopi) og en Standings-fane med data", () => {
  assert.match(squadPage, /TAB_ORDER: SquadTabKey\[\] = \["squad", "calendar", "results", "standings", "development", "stats"\]/);
  assert.match(squadPage, /import TeamStatsTab from "\.\.\/components\/TeamStatsTab\.jsx"/);
  assert.match(squadPage, /<YouthStandingsTab squad=\{squad\}/);
  // Standings er ikke længere en tom tilstand uden data.
  assert.doesNotMatch(squadPage, /tab === "standings"\) && \(\s*<YouthRacesEmptyState/);
});

test("Squad-fanen har My Teams to kolonne-tilstande med de delte evne-kolonner", () => {
  assert.match(squadTable, /useAbilityColumns<Row>\(\)/);
  assert.match(squadTable, /value: "abilities", label: t\("squad\.mode\.abilities"\)/);
  for (const key of ["popularity", "badges"]) assert.match(squadTable, new RegExp(`key: "${key}"`));
});

test("My Team og Stats-fanen deler ét gruppe-filter (Senior / U23 / Junior)", () => {
  assert.match(teamPage, /const squadFilter = useSquadGroupFilter\(\);/);
  assert.match(teamPage, /squadGroupFilterToolbar\(squadFilter, viewRiders\)/);
  assert.match(statsTab, /squadGroupFilterToolbar\(squadFilter, riders\)/);
  assert.doesNotMatch(teamPage + statsTab, /AcademySquadFilter/);
});

test("Youth races har en rute bag I18nReadyGate", () => {
  assert.match(app, /<Route path="youth-races" element=\{<I18nReadyGate ns="squad"><YouthRacesPage \/><\/I18nReadyGate>\} \/>/);
});
