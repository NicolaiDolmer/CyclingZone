import { test } from "node:test";
import assert from "node:assert/strict";
import { pathMatchesNavItem } from "./navMatching.js";

const loc = (pathname, search = "") => ({ pathname, search });

// Nav-topologien efter #3102 etape 3: Planlægnings-hubben (/planning) og
// Resultat-hubben (/resultater) er hver ét nav-punkt der dækker alle deres
// faner; /races er opløst og har intet punkt længere.
const PLANNING = { to: "/planning" };
const RESULTS = { to: "/resultater" };
const CALENDAR = { to: "/calendar" };

function activeOf(location) {
  return [
    ["planning", PLANNING],
    ["results", RESULTS],
    ["calendar", CALENDAR],
  ].filter(([, item]) => pathMatchesNavItem(location, item)).map(([name]) => name);
}

// #3102 etape 3: hubbens tre faner deler ÉT nav-punkt (/planning uden query).
// Punktet skal lyse op på alle tre — testen fanger den dag nogen giver Formplan
// eller Strategi sit eget menupunkt: så skal excludeQuery på plads, præcis som
// på Transfers-parret nedenfor.
test("#3102 etape 3 /planning?tab=* → hub-punktet er aktivt på alle faner", () => {
  for (const search of ["", "?tab=form", "?tab=strategy", "?tab=form&view=season"]) {
    assert.deepEqual(activeOf(loc("/planning", search)), ["planning"], `fane ${search || "(default)"}`);
  }
});

// #3102 etape 2-låsen, videreført: Resultat-hubbens faner (nu inkl. verdens-
// kataloget under Arkiv) deler ét punkt.
test("#3102 /resultater?tab=* → hub-punktet er aktivt på alle faner", () => {
  for (const search of ["", "?tab=archive", "?tab=points"]) {
    assert.deepEqual(activeOf(loc("/resultater", search)), ["results"], `fane ${search || "(default)"}`);
  }
});

// #3102 etape 3: /races har intet nav-punkt længere — et løbs detalje-side
// (/races/:raceId) må ikke tænde hub-punkterne via prefix-match.
test("/races/:raceId → intet nav-punkt aktivt (ruten er opløst)", () => {
  assert.deepEqual(activeOf(loc("/races/abc-123")), []);
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

// excludePaths-mekanismen har ingen forbrugere efter etape 3, men bliver i
// koden (søskende-genveje opstår igen — Transfers-parret er mønsteret). Denne
// test holder kontrakten i live.
test("#3102 excludePaths deaktiverer et item på en navngiven underrute", () => {
  const item = { to: "/foo", excludePaths: ["/foo/bar"] };
  assert.equal(pathMatchesNavItem(loc("/foo"), item), true);
  assert.equal(pathMatchesNavItem(loc("/foo/baz"), item), true);
  assert.equal(pathMatchesNavItem(loc("/foo/bar"), item), false);
});
