import { test } from "node:test";
import assert from "node:assert/strict";
import { pathMatchesNavItem } from "./navMatching.js";

const loc = (pathname, search = "") => ({ pathname, search });

// De tre menupunkter der deler /races-prefixet (#3102 etape 1). Ét og kun ét
// må være aktivt ad gangen — ellers lyser to grupper op samtidig i sidebaren.
const RACES = { to: "/races", excludeQuery: "tab=calendar", excludePaths: ["/races/strategy"] };
const TEAM_SELECTION = { to: "/races?tab=calendar" };
const STRATEGY = { to: "/races/strategy" };

function activeOf(location) {
  return [
    ["races", RACES],
    ["teamSelection", TEAM_SELECTION],
    ["strategy", STRATEGY],
  ].filter(([, item]) => pathMatchesNavItem(location, item)).map(([name]) => name);
}

test("/races → kun Løb er aktiv", () => {
  assert.deepEqual(activeOf(loc("/races")), ["races"]);
});

// #3102 etape 2: ?tab=library findes ikke længere på /races (fanen flyttede til
// Resultat-hubben og ruten redirecter), men et gammelt bogmærke rammer stadig
// URL'en før redirecten kører. Løb skal være det aktive punkt i det øjeblik.
test("/races?tab=library → kun Løb er aktiv", () => {
  assert.deepEqual(activeOf(loc("/races", "?tab=library")), ["races"]);
});

// #3102 etape 2: hubbens tre faner deler ÉT nav-punkt (/resultater uden query).
// Punktet må lyse op på alle tre — og de gamle /races-punkter må ikke gøre det.
// Testen fanger den dag nogen giver Arkiv eller Point sit eget menupunkt: så
// skal excludeQuery på plads, præcis som på Transfers-parret nedenfor.
test("#3102 etape 2 /resultater?tab=* → hub-punktet er aktivt på alle faner", () => {
  const results = { to: "/resultater" };
  for (const search of ["", "?tab=archive", "?tab=points"]) {
    assert.equal(pathMatchesNavItem(loc("/resultater", search), results), true, `fane ${search || "(default)"}`);
    assert.deepEqual(activeOf(loc("/resultater", search)), []);
  }
});

test("#1681 /races?tab=calendar → kun Holdudtagelse er aktiv", () => {
  assert.deepEqual(activeOf(loc("/races", "?tab=calendar")), ["teamSelection"]);
});

test("#3102 /races/strategy → kun Holdstrategi er aktiv (Løb må ikke prefix-matche)", () => {
  assert.deepEqual(activeOf(loc("/races/strategy")), ["strategy"]);
});

test("#3102 /races/:raceId beholder Løb som aktiv (drill-down mister ikke gruppen)", () => {
  assert.deepEqual(activeOf(loc("/races/abc-123")), ["races"]);
});

test("exact: true matcher ikke underruter", () => {
  assert.equal(pathMatchesNavItem(loc("/admin/waitlist"), { to: "/admin", exact: true }), false);
  assert.equal(pathMatchesNavItem(loc("/admin"), { to: "/admin", exact: true }), true);
});

test("#987 transfers-parret: kun ét item ad gangen", () => {
  const transfers = { to: "/transfers", excludeQuery: "tab=market" };
  const list = { to: "/transfers?tab=market" };
  assert.equal(pathMatchesNavItem(loc("/transfers"), transfers), true);
  assert.equal(pathMatchesNavItem(loc("/transfers"), list), false);
  assert.equal(pathMatchesNavItem(loc("/transfers", "?tab=market"), transfers), false);
  assert.equal(pathMatchesNavItem(loc("/transfers", "?tab=market"), list), true);
});
