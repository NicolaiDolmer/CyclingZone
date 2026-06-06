// #481 PR-3 forward-guard: "gold = the leader" (PF2, variant B).
// The default core-smoke fixture returns an empty season_standings, so the
// standings rows never render — this spec injects a populated division so the
// gold-leader chip + the neutral (non-gold) "you" marker are actually exercised.
// Guards against a regression back to "you = gold" (which made gold mean two things).
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM } from "./fixtures.js";

// Six human teams in division 2 (TEST_TEAM's division). RIVAL is the leader;
// TEST_TEAM sits mid-table so the leader chip and the "you" badge land on
// different rows and can be asserted independently.
const DIV = 2;
const TEAMS = [
  { id: "lead-1",       name: "Skybound Racing",    division: DIV, pts: 1240 },
  { id: "rival-2",      name: "Vortex Pro Cycling", division: DIV, pts: 1180 },
  { id: TEST_TEAM.id,   name: TEST_TEAM.name,       division: DIV, pts: 1020 },
  { id: "mid-4",        name: "Crest Continental",  division: DIV, pts: 940 },
  { id: "tail-5",       name: "Granite Riders",     division: DIV, pts: 760 },
  { id: "tail-6",       name: "Hollow Tactics",     division: DIV, pts: 690 },
];

const TEAM_ROWS = TEAMS.map(t => ({ id: t.id, name: t.name, division: t.division }));
const STANDING_ROWS = TEAMS.map(t => ({
  id: `ss-${t.id}`,
  team_id: t.id,
  season_id: "season-e2e",
  total_points: t.pts,
  penalty_points: 0,
  stage_wins: 0,
  podiums: 0,
  team: { id: t.id, name: t.name, division: t.division, is_ai: false },
}));

async function setup(page, theme) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.addInitScript(t => window.localStorage.setItem("cz-theme", t), theme);

  // teams: list query → all six; single() (my-team lookup) → TEST_TEAM object.
  await page.route("**/rest/v1/teams*", route => {
    const accept = route.request().headers().accept || "";
    if (accept.includes("vnd.pgrst.object")) {
      return json(route, { ...TEST_TEAM, division: DIV });
    }
    return json(route, TEAM_ROWS);
  });
  await page.route("**/rest/v1/season_standings*", route => json(route, STANDING_ROWS));

  await login(page);
  await page.goto("/standings");
  await expect(page.getByRole("table")).toBeVisible();
}

test("gold = leader chip on rank 1; you = neutral badge, never gold (#481 PR-3)", async ({ page }) => {
  await setup(page, "dark");

  const rows = page.getByRole("row");
  // Rank 1 (leader) carries the maillot chip; mid-table rows do not.
  const leaderRow = rows.filter({ hasText: "Skybound Racing" });
  await expect(leaderRow.getByText(/^(Leader|Fører)$/)).toBeVisible();

  // TEST_TEAM gets the "you" badge and must NOT carry the leader chip.
  const youRow = rows.filter({ hasText: TEST_TEAM.name });
  await expect(youRow.getByText(/^(You|Dig)$/)).toBeVisible();
  await expect(youRow.getByText(/^(Leader|Fører)$/)).toHaveCount(0);

  // Exactly one leader chip in the whole division table.
  await expect(page.getByText(/^(Leader|Fører)$/)).toHaveCount(1);
});
