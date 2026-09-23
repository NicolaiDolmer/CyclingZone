// #5471/#4982 — en udfyldt division til ranglisten, delt af de to mobil-specs
// (standings-mobile-founder-mark + table-page-scroll-mobile). Core-fixturens
// season_standings er tom, saa uden dette tegnes ingen raekker.
//
// Fiktive holdnavne og tal (ingen rigtige spillerhold). Navnene er lange nok
// til at presse navnecellen, og praemiekolonnen har 7-cifrede beloeb, saa
// talkolonnerne er saa brede som de bliver midt i en saeson — med "0 CZ$"
// ville navnet faa mere plads end i virkeligheden, og specen ville maale heldet.
import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM } from "../fixtures.js";

export const DIV = 2;

export const TEAMS = [
  { id: "f-lead", name: "Skybound Racing Collective", pts: 1240, founder: 1 },
  { id: "r-2", name: "Vortex Pro Cycling", pts: 1180, founder: null },
  { id: TEST_TEAM.id, name: TEST_TEAM.name, pts: 1120, founder: 7 },
  { id: "r-4", name: "Crest Continental", pts: 1060, founder: null },
  { id: "f-5", name: "Northern Lights Velo Club", pts: 990, founder: 12 },
  { id: "r-6", name: "Granite Riders", pts: 930, founder: null },
  { id: "r-7", name: "Hollow Tactics", pts: 870, founder: null },
  { id: "r-8", name: "Meridian Cycling Team", pts: 810, founder: null },
  { id: "f-9", name: "Blue Ridge Development", pts: 760, founder: 23 },
  { id: "r-10", name: "Tailwind Syndicate", pts: 700, founder: null },
  { id: "r-11", name: "Lowland Sprinters", pts: 650, founder: null },
  { id: "f-12", name: "Coastal Breakaway Squad", pts: 600, founder: 31 },
];

export const FOUNDERS = TEAMS.filter((t) => t.founder != null).map((t) => ({
  team_id: t.id,
  founder_number: t.founder,
}));

const TEAM_ROWS = TEAMS.map((t) => ({ id: t.id, name: t.name, division: DIV }));
const STANDING_ROWS = TEAMS.map((t) => ({
  id: `ss-${t.id}`,
  team_id: t.id,
  season_id: "season-e2e",
  total_points: t.pts,
  penalty_points: 0,
  stage_wins: 3,
  podiums: 5,
  team: { id: t.id, name: t.name, division: DIV, is_ai: false },
}));
const EXT_ROWS = TEAMS.map((t, i) => ({
  team_id: t.id,
  comp_wins: 1,
  comp_podiums: 2,
  podiums: 5,
  prize_earned: 1_480_000 - i * 95_000,
}));

/** Logger ind og aabner /standings med divisionen ovenfor og (valgfrit) Founder-maerker. */
export async function openStandings(page: Page, { founders = true }: { founders?: boolean } = {}) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  // teams: listen -> alle hold; "mit hold"-opslaget (user_id=eq.) -> kun TEST_TEAM
  // (samme maade som standings-gold-leader.spec.js skelner de to kald, #4869).
  await page.route("**/rest/v1/teams*", (route: Route) => {
    const request = route.request();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    if (/user_id=eq\.[^&]+/.test(request.url())) {
      const mine = { ...TEST_TEAM, division: DIV };
      return json(route, wantsObject ? mine : [mine]);
    }
    if (wantsObject) return json(route, { ...TEST_TEAM, division: DIV });
    return json(route, TEAM_ROWS);
  });
  await page.route("**/rest/v1/season_standings*", (route: Route) => json(route, STANDING_ROWS));
  await page.route("**/rest/v1/team_standings_ext_mv*", (route: Route) => json(route, EXT_ROWS));
  await page.route("**/rest/v1/rpc/founder_public_list*", (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    return json(route, founders ? FOUNDERS : []);
  });
  await login(page);
  await page.goto("/standings");
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(TEAMS.length);
  // Maerket hentes asynkront (RPC) — vent til alle er tegnet.
  if (founders) await expect(page.getByText(/^Founder$/)).toHaveCount(FOUNDERS.length);
}
