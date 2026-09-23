// #5519: kontakten, ruterne og menupunkterne for U23 team- og Junior team-siderne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  YOUTH_SQUADS,
  YOUTH_SQUAD_PATHS,
  isYouthSquad,
  youthSquadPath,
  youthSquadNavItems,
  riderIdsForSquad,
  isYouthSquadPagesOn,
  setYouthSquadPages,
  subscribeYouthSquadPages,
} from "./youthSquadPages.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const t = (key: string) => `t(${key})`;

test("#5519: U23 team står før Junior team (HANDOFF 3a)", () => {
  assert.deepEqual([...YOUTH_SQUADS], ["u23", "junior"]);
});

test("#5519: kun de to ungdomstrupper er gyldige side-parametre", () => {
  assert.equal(isYouthSquad("u23"), true);
  assert.equal(isYouthSquad("junior"), true);
  for (const bad of ["senior", "U23", "", null, undefined, 23]) assert.equal(isYouthSquad(bad), false);
});

test("#5519: ruterne ligger UDEN for /team, så My Team ikke lyser op sammen med dem", () => {
  assert.equal(youthSquadPath("u23"), "/squads/u23");
  assert.equal(youthSquadPath("junior"), "/squads/junior");
  for (const path of YOUTH_SQUAD_PATHS) assert.ok(!path.startsWith("/team/"), path);
});

test("#5519: menupunkterne findes kun når kontakten er tændt", () => {
  assert.deepEqual(youthSquadNavItems(false, t), []);
  assert.deepEqual(youthSquadNavItems(true, t), [
    { to: "/squads/u23", label: "t(nav.item.u23Team)" },
    { to: "/squads/junior", label: "t(nav.item.juniorTeam)" },
  ]);
});

test("#5519: rytter-id'er læses defensivt ud af /api/youth-squads", () => {
  const payload = { squads: { u23: { riderIds: ["a", "b", 7, ""] }, junior: { riderIds: ["c"] } } };
  assert.deepEqual(riderIdsForSquad(payload, "u23"), ["a", "b"]);
  assert.deepEqual(riderIdsForSquad(payload, "junior"), ["c"]);
  assert.deepEqual(riderIdsForSquad(null, "u23"), []);
  assert.deepEqual(riderIdsForSquad({ squads: { u23: { riderIds: "nope" } } }, "u23"), []);
});

test("#5519: kontakten er OFF som default og giver besked når den flipper", () => {
  assert.equal(isYouthSquadPagesOn(), false);
  let calls = 0;
  const off = subscribeYouthSquadPages(() => { calls += 1; });
  setYouthSquadPages(true);
  assert.equal(isYouthSquadPagesOn(), true);
  setYouthSquadPages(true); // samme værdi: ingen ny besked
  setYouthSquadPages(false);
  off();
  setYouthSquadPages(true);
  assert.equal(calls, 2);
  setYouthSquadPages(false);
});

test("#5519 wiring: Layout sætter menupunkterne lige efter My Team og deler display-flags-hentningen", () => {
  const layout = read("../components/Layout.jsx");
  const teamIdx = layout.indexOf('to: "/team"');
  const youthIdx = layout.indexOf("...youthSquadNavItems(youthSquadPagesEnabled, t)");
  const trainingIdx = layout.indexOf('to: "/training"');
  assert.ok(teamIdx > 0 && youthIdx > teamIdx && trainingIdx > youthIdx, "U23/Junior skal stå mellem My Team og Training");
  assert.match(layout, /useYouthSquadPagesSync\(\)/);
  assert.match(layout, /\.\.\.YOUTH_SQUAD_PATHS\]/, "trup-siderne er T2 og skal være wide-content-ruter");

  const gate = read("../components/rider/RiderRatingModeGate.jsx");
  assert.match(gate, /loadDisplayFlags\(\)/, "rating-kontakten skal bruge den delte hentning (ét kald pr. sideload)");
  assert.doesNotMatch(gate, /apiFetch\(/);
});

test("#5519 wiring: Academy mister Youth squads-kortet når kontakten er tændt", () => {
  const academy = read("../pages/AcademyPage.jsx");
  const gateIdx = academy.indexOf("{!youthSquadPagesOn && (");
  const cardIdx = academy.indexOf('t("youthSquads.title")');
  assert.ok(gateIdx > 0 && cardIdx > gateIdx, "kortet skal ligge inde i !youthSquadPagesOn-grenen");
});

test("#5519 wiring: ruten er route-gatet på squad-namespacet", () => {
  const app = read("../App.jsx");
  assert.match(app, /path="squads\/:squad" element=\{<I18nReadyGate ns="squad"><SquadPage \/><\/I18nReadyGate>\}/);
});
