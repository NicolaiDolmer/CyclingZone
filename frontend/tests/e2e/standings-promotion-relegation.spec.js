// #1760 forward-guard: per-pulje op-/nedrykningszoner (top 2 op, bund 4 ned) der
// matcher binær-træ-engine (#1152, PROMOTION_SLOTS=2 / RELEGATION_SLOTS=4). Den gamle
// visning tog top-2/bund-2 af den samlede tier-liste; denne spec pinner per-pulje
// top-2/bund-4, at antallet summer i "Alle" (N puljer × 2 op, N × 4 ned), at en enkelt
// pulje kun viser sin egen zone, og at en dormant Div4 viser udskydelses-noten.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM } from "./fixtures.js";

const POOL_A = "div3-pool-a";
const POOL_B = "div3-pool-b";
const POOLS = [
  { id: POOL_A, tier: 3, pool_index: 0, label: "Pool A" },
  { id: POOL_B, tier: 3, pool_index: 1, label: "Pool B" },
];

// 8 hold pr. pulje, faldende point. TEST_TEAM ligger midt i Pool A (plads 4), så
// "dig"-badget og zone-badges lander på forskellige rækker.
function poolTeams(poolId, prefix, basePts, includeMe) {
  return Array.from({ length: 8 }, (_, i) => {
    const isMe = includeMe && i === 3;
    return {
      id: isMe ? TEST_TEAM.id : `${prefix}-${i}`,
      name: isMe ? TEST_TEAM.name : `${prefix} ${i + 1}`,
      division: 3,
      league_division_id: poolId,
      is_ai: false,
      pts: basePts - i * 40,
    };
  });
}
const TEAMS = [...poolTeams(POOL_A, "Alpha", 1200, true), ...poolTeams(POOL_B, "Bravo", 1190, false)];

const TEAM_ROWS = TEAMS.map(t => ({
  id: t.id, name: t.name, division: t.division, league_division_id: t.league_division_id,
}));
const STANDING_ROWS = TEAMS.map(t => ({
  id: `ss-${t.id}`,
  team_id: t.id,
  season_id: "season-e2e",
  total_points: t.pts,
  penalty_points: 0,
  stage_wins: 0,
  podiums: 0,
  league_division_id: t.league_division_id,
  team: { id: t.id, name: t.name, division: t.division, is_ai: t.is_ai, league_division_id: t.league_division_id },
  pool: POOLS.find(p => p.id === t.league_division_id),
}));

async function setup(page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/teams*", route => {
    const accept = route.request().headers().accept || "";
    if (accept.includes("vnd.pgrst.object")) {
      return json(route, { ...TEST_TEAM, division: 3, league_division_id: POOL_A });
    }
    return json(route, TEAM_ROWS);
  });
  await page.route("**/rest/v1/season_standings*", route => json(route, STANDING_ROWS));
  await page.route("**/rest/v1/league_divisions*", route => json(route, POOLS));

  await login(page);
  await page.goto("/standings");
  await expect(page.getByRole("table")).toBeVisible();
  // #2849 bølge 1: division-vælgeren er nu ét Select i sidehovedets actions-slot
  // (T2 action-cluster-kontrakt) i stedet for en fane-knap-række.
  await page.getByRole("combobox", { name: "Division" }).selectOption("3");
}

test("Alle-fanen markerer top 2 op + bund 4 ned i HVER pulje (#1760)", async ({ page }) => {
  await setup(page);
  // 2 puljer × top 2 = 4 op-badges; 2 puljer × bund 4 = 8 ned-badges.
  await expect(page.getByText(/↑ (Up|Op)/)).toHaveCount(4);
  await expect(page.getByText(/↓ (Down|Ned)/)).toHaveCount(8);
});

test("en enkelt pulje viser kun dén puljes zone (#1760)", async ({ page }) => {
  await setup(page);
  // Pulje-vælgeren er fortsat et eget Select i filter-baren (kun vist når tieren
  // har flere puljer) — vælg via dens value (poolens id), ikke label-teksten.
  await page.getByRole("combobox", { name: /^(Pool|Pulje)$/ }).selectOption(POOL_A);
  await expect(page.getByText(/↑ (Up|Op)/)).toHaveCount(2);
  await expect(page.getByText(/↓ (Down|Ned)/)).toHaveCount(4);
});

test("dormant Division 4 viser udskydelses-note (#1760)", async ({ page }) => {
  await setup(page);
  // Ingen Div4-hold i standings → Div3 relegerer reelt ikke endnu.
  await expect(page.getByText(/Division 4 (opens|åbner)/)).toBeVisible();
});
