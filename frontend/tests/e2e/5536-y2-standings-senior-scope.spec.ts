// #5648 (Y2, delissue af #5536) — beviser at StandingsPage bruger
// seniorScope.ts's filtre: en ungdomspulje (squad "u23") i SAMME tier som
// testholdets senior-pulje må hverken give en ekstra pulje-fane eller lække
// point ind i seniorstillingen, og et ungdomsløb må ikke tælle med i
// "løb spillet"-tælleren.
//
// Mock-league_divisions/-races er FILTER-BEVIDSTE (samme mønster som
// race-centre.spec.js's filterRaceResults): kun når requesten faktisk sender
// PostgREST-filteret (or=(squad.is.null,squad.eq.senior)) fjernes
// ungdomsrækken. Glemmer StandingsPage filteret, lækker ungdomsdata ind — og
// testen fejler synligt i stedet for at "se grøn ud" af en mock der selv
// filtrerer.
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json, evidenceShotPath, TEST_TEAM, RIVAL_TEAM, ACTIVE_SEASON,
} from "./fixtures.js";
import type { Page, Route } from "@playwright/test";

const SENIOR_POOL = { id: 2, tier: 2, pool_index: 0, label: "Division 2 — A", squad: "senior" };
// Samme tier som SENIOR_POOL — hvis den IKKE filtreres væk, får tier 2 to
// puljer, og pulje-vælgeren (kun vist ved >1 pulje pr. tier) dukker op.
const YOUTH_POOL = { id: 3, tier: 2, pool_index: 1, label: "Division 2 — Ungdom", squad: "u23" };
const DIVISIONS = [SENIOR_POOL, YOUTH_POOL];

const SENIOR_RACE = { id: "race-senior", name: "Senior Classic", edition_year: 2026, squad: "senior", pool_race: { date_text: "12. maj" } };
const YOUTH_RACE = { id: "race-youth", name: "U23 Nations Cup", edition_year: 2026, squad: "u23", pool_race: { date_text: "18. maj" } };
const RACES = [SENIOR_RACE, YOUTH_RACE];

// RIVAL_TEAM's ægte stilling (senior-puljen). Den ANDEN række (samme hold, men
// via en ungdomspulje) har et urealistisk stort pointtal, netop så et lækket
// tal er umuligt at forveksle med et ægte.
const SENIOR_STANDING = {
  id: "ss-senior-rival", season_id: ACTIVE_SEASON.id, team_id: RIVAL_TEAM.id, total_points: 120, stage_wins: 1, gc_wins: 0,
  team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, division: 2, is_ai: false, league_division_id: 2 },
  pool: { ...SENIOR_POOL },
};
const YOUTH_LEAK_STANDING = {
  id: "ss-youth-leak", season_id: ACTIVE_SEASON.id, team_id: RIVAL_TEAM.id, total_points: 424242, stage_wins: 9, gc_wins: 9,
  team: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name, division: 2, is_ai: false, league_division_id: 3 },
  pool: { ...YOUTH_POOL },
};
const STANDINGS = [SENIOR_STANDING, YOUTH_LEAK_STANDING];

/** Efterligner PostgREST's server-side filtrering — KUN når requesten selv
 *  sender or=(squad.is.null,squad.eq.senior) fjernes ungdomsrækkerne. */
function filterBySeniorSquadParam<T extends { squad: string }>(dataset: T[], requestUrl: string): T[] {
  const search = decodeURIComponent(new URL(requestUrl).search);
  if (!search.includes("squad.is.null") || !search.includes("squad.eq.senior")) return dataset;
  return dataset.filter((row) => row.squad === "senior");
}

async function installStandingsSeniorScopeMocks(page: Page) {
  await page.route("**/rest/v1/league_divisions**", (route: Route) =>
    json(route, filterBySeniorSquadParam(DIVISIONS, route.request().url())));
  await page.route("**/rest/v1/races**", (route: Route) =>
    json(route, filterBySeniorSquadParam(RACES, route.request().url())));
  // season_standings: squad-dommen er client-side (JS) i StandingsPage, IKKE et
  // SQL-filter (season_standings har ingen egen squad-kolonne) — mocken
  // returnerer derfor altid begge rækker, uanset query.
  await page.route("**/rest/v1/season_standings**", (route: Route) => json(route, STANDINGS));
}

test("standings: ungdomspulje/-løb filtreres væk, ingen point lækker ind (desktop 1440)", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installStandingsSeniorScopeMocks(page);
  await login(page);

  await page.goto("/standings");
  await expect(page.getByRole("table").first()).toBeVisible();

  // Ingen ekstra pulje-fane: kun senior-puljen er tilbage i tier 2.
  await expect(page.getByRole("combobox", { name: "Pulje" })).toHaveCount(0);
  await expect(page.getByText("Division 2 — Ungdom")).toHaveCount(0);

  // Ungdomsløbet er IKKE talt med i "løb spillet".
  await expect(page.getByText("1 løb spillet")).toBeVisible();
  await expect(page.getByText("U23 Nations Cup")).toHaveCount(0);

  // Ungdomsrækkens point (424.242) er IKKE lækket ind i RIVAL_TEAM's stilling.
  await expect(page.getByText("424.242")).toHaveCount(0);
  await expect(page.locator("table tbody")).toContainText("120");

  await page.screenshot({
    path: evidenceShotPath("pr-screens/5536-y2-standings-senior-scope-1440x900.png"),
    fullPage: true,
  });
});

test("standings: ungdomspulje/-løb filtreres væk, ingen point lækker ind (mobil 390)", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installStandingsSeniorScopeMocks(page);
  await login(page);

  await page.goto("/standings");
  await expect(page.getByRole("table").first()).toBeVisible();

  await expect(page.getByRole("combobox", { name: "Pulje" })).toHaveCount(0);
  await expect(page.getByText("Division 2 — Ungdom")).toHaveCount(0);
  await expect(page.getByText("1 løb spillet")).toBeVisible();
  await expect(page.getByText("424.242")).toHaveCount(0);

  await page.screenshot({
    path: evidenceShotPath("pr-screens/5536-y2-standings-senior-scope-390x844.png"),
    fullPage: true,
  });
});
