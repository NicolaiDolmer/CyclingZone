import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findRetiredRouteLinks, RETIRED_ROUTE_PATHS } from "./check-retired-route-links.mjs";

test("rejects legacy JSX links, navigation calls and static route config", () => {
  const source = [
    '<Link to="/races?tab=library">Results</Link>',
    '<a href={"https://cyclingzone.org/calendar/"}>Calendar</a>',
    'navigate("/planner#week")',
    'const item = { to: "/global-rank" };',
  ].join("\n");
  assert.deepEqual(findRetiredRouteLinks(source), [
    { line: 1, target: "/races?tab=library" },
    { line: 2, target: "https://cyclingzone.org/calendar/" },
    { line: 3, target: "/planner#week" },
    { line: 4, target: "/global-rank" },
  ]);
});

test("allows canonical detail paths, external links and explanatory comments", () => {
  const source = [
    '<Link to={`/races/${raceId}`}>Stage</Link>',
    '<Link to="/race-archive/example-event">History</Link>',
    '<a href="https://other.example/races">External</a>',
    '// Old usage: navigate("/global-rank")',
    '/* <Link to="/planner">old</Link> */',
    '<Link data-to="/races" to="/race-centre">Race Centre</Link>',
    '<Route path="races" element={<RacesLegacyRedirect />} />',
  ].join("\n");
  assert.deepEqual(findRetiredRouteLinks(source), []);
});

test("each guarded alias still exists as a redirect in the app router", () => {
  const app = readFileSync(new URL("../frontend/src/App.jsx", import.meta.url), "utf8");
  for (const path of RETIRED_ROUTE_PATHS) {
    const declaration = new RegExp(`<Route path="${path.slice(1)}" element=\\{<(?:Navigate|RacesLegacyRedirect|PlannerLegacyRedirect)\\b`);
    assert.match(app, declaration, `${path} must still redirect old bookmarks`);
  }
});

test("rejects static targets in conditional links and location assignments", () => {
  const source = [
    '<Link to={ready ? "/races" : "/dashboard"} />',
    'window.location.href = "/calendar";',
    'const menuItem = { "href": "/global-rank" };',
    'navigate(ready ? "/dashboard" : "/planner")',
    'const value = 42; // navigate("/races")',
  ].join("\n");
  assert.deepEqual(findRetiredRouteLinks(source), [
    { line: 1, target: "/races" },
    { line: 2, target: "/calendar" },
    { line: 3, target: "/global-rank" },
    { line: 4, target: "/planner" },
  ]);
});
