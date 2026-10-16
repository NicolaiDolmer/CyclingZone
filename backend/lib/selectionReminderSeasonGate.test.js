// #5851 — trup-paamindelsen (GET /api/me/selection-reminder) maa kun minde om loeb
// i den AKTIVE saeson. Foer skiftet ligger naeste saesons foerste etape inde i
// 36-timers-vinduet, men udtagelse kan foerst gemmes naar saesonen er aktiv
// (#5405, seasonAllowsSelectionWrites). Uden gaten fik spilleren en advarsel han
// ikke kunne handle paa ("Get warning that I can't do anything about").
//
// Kilde-assert (samme recipe som selectionDeadlineReminder.test.js' PATCH-test):
// ruten har ingen egen harness, og pointen er netop at loeb-opslaget er
// saeson-scopet og at "ingen aktiv saeson" svarer tomt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seasonAllowsSelectionWrites } from "./raceSelection.js";

function reminderRouteSource() {
  const api = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  const start = api.indexOf('router.get("/me/selection-reminder"');
  assert.ok(start >= 0, "ruten skal findes");
  const block = api.slice(start);
  return block.slice(0, block.indexOf("\n});"));
}

test("#5851: paamindelsen slaar den aktive saeson op (samme 'active' som skrive-gaten)", () => {
  const route = reminderRouteSource();
  assert.match(route, /from\("seasons"\)\.select\("id"\)\.eq\("status", "active"\)/);
  // Skrive-gaten accepterer KUN 'active' — paamindelsen maa ikke vaere bredere.
  assert.equal(seasonAllowsSelectionWrites("active"), true);
  assert.equal(seasonAllowsSelectionWrites("upcoming"), false);
});

test("#5851: ingen aktiv saeson -> tomt svar, ingen loeb hentes", () => {
  const route = reminderRouteSource();
  const guard = route.indexOf("if (!reminderSeason?.id) return res.json(");
  const racesQuery = route.indexOf('.from("races")');
  assert.ok(guard > 0, "skal svare tomt uden aktiv saeson");
  assert.ok(racesQuery > guard, "gaten skal ligge FOER loeb-opslaget");
});

test("#5851: loeb-opslaget er scopet til den aktive saesons id", () => {
  const route = reminderRouteSource();
  const racesQuery = route.slice(route.indexOf('.from("races")'));
  const firstStatement = racesQuery.slice(0, racesQuery.indexOf(".order("));
  assert.match(firstStatement, /\.eq\("season_id", reminderSeason\.id\)/);
});
