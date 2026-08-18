import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAM_PROFILE_TABS, resolveTeamProfileTab } from "./teamProfileTabs.js";

// #3916: default-fane paa "andres hold"-siden skal vaere trup ("squad"),
// medmindre en gyldig ?tab= er til stede.

test("resolveTeamProfileTab: ingen tab-param -> squad (trup) er default", () => {
  assert.equal(resolveTeamProfileTab(null), "squad");
  assert.equal(resolveTeamProfileTab(undefined), "squad");
  assert.equal(resolveTeamProfileTab(""), "squad");
});

test("resolveTeamProfileTab: ugyldig tab-param -> falder tilbage til squad", () => {
  assert.equal(resolveTeamProfileTab("not-a-real-tab"), "squad");
  assert.equal(resolveTeamProfileTab("Squad"), "squad"); // case-sensitiv — ingen fuzzy-match
});

test("resolveTeamProfileTab: gyldig tab-param bevares", () => {
  for (const tab of TEAM_PROFILE_TABS) {
    assert.equal(resolveTeamProfileTab(tab), tab);
  }
});

// #3916 defekt 1: React Router genbruger TeamProfilePage-instansen ved
// navigation mellem to forskellige holds /teams/:id-sider (samme route,
// andet id) — komponentens id-skifte-effekt kalder resolveTeamProfileTab
// igen med DEN NYE sides ?tab=-param (typisk fravaerende ved et almindeligt
// hold-til-hold-link), saa denne test dokumenterer netop den kontrakt:
// et fravaerende/forkert tab-param for det NYE hold giver trup, uanset
// hvilken fane man kom fra.
test("resolveTeamProfileTab: simulerer hold-til-hold-navigation uden ?tab= -> nulstiller til squad", () => {
  const forrigeHoldsFane = resolveTeamProfileTab("results");
  assert.equal(forrigeHoldsFane, "results");

  // Naviger til et andet hold uden tab-param i URL'en (normalt link-mønster).
  const nytHoldsFane = resolveTeamProfileTab(null);
  assert.equal(nytHoldsFane, "squad");
});
