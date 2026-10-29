// #7249: real contract, inbox and Help consumers with synthetic owned riders.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM, TEST_USER, RIDERS } from "./fixtures.js";
import { buildContractRosterNotification } from "../../../backend/lib/contractNoticeRoster.js";

const HELP = JSON.parse(readFileSync(new URL("../../public/locales/da/help.json", import.meta.url), "utf8")).sections.contracts.contractWarnings;
const LABELS = JSON.parse(readFileSync(new URL("../../public/locales/da/backendMessages.json", import.meta.url), "utf8")).notif.contractSquad;
const base = RIDERS.find(r => r.team_id === TEST_TEAM.id) || RIDERS[0];
const SQUADS = ["senior", "u23", "junior", "academy"] as const;
const OWN = SQUADS.map((squad, index) => ({
  ...base, id: "contract-" + squad, firstname: "Fixture", lastname: squad,
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  squad: squad === "academy" ? null : squad, is_academy: squad === "academy", is_retired: false,
  birthdate: "2010-01-01", contract_end_season: 1, salary: 100 + index, market_value: 1000 + index,
  pending_team_id: null,
}));
function quote(items: Array<{ riderId: string; seasons: number }>) {
  const riders = items.flatMap(item => {
    const r = OWN.find(row => row.id === item.riderId);
    return r ? [{ riderId: r.id, requestedSeasons: item.seasons, grantedSeasons: 1, maxSeasons: 1, capped: false, currentSalary: r.salary, newSalary: r.salary, currentEndSeason: 1, newEndSeason: 2 }] : [];
  });
  return { currentSeason: 1, maxSeason: 2, riders, errors: [], totals: { selectedSalaryBefore: 400, selectedSalaryAfter: 400, teamSalaryBefore: 406, teamSalaryAfter: 406 }, salaryCap: { active: true, withinCap: true, cap: null } };
}
test.beforeEach(async ({ page }, info) => {
  await stabilizePage(page);
  await page.clock.install({ time: new Date("2026-10-26T12:00:00.000Z") });
  await installNetworkMocks(page);
  if (info.project.name === "desktop-chromium") await page.setViewportSize({ width: 1440, height: 1000 });
});
test("#7249 contracts squads are independently selectable", async ({ page }, info) => {
  await page.route("**/rest/v1/riders**", route => {
    if (route.request().method() !== "GET") return json(route, {});
    const url = new URL(route.request().url());
    if (url.searchParams.get("pending_team_id") === "eq." + TEST_TEAM.id) return json(route, []);
    let rows = OWN.filter(row => url.searchParams.get("team_id") == null || url.searchParams.get("team_id") === "eq." + row.team_id);
    const academy = url.searchParams.get("is_academy");
    if (academy === "eq.false") rows = rows.filter(row => !row.is_academy);
    if (academy === "eq.true") rows = rows.filter(row => row.is_academy);
    const squad = url.searchParams.get("squad");
    if (squad?.startsWith("eq.")) rows = rows.filter(row => row.squad === squad.slice(3));
    return json(route, rows);
  });
  await page.route("**/api/riders/extend-contracts/quote", route => json(route, quote(route.request().postDataJSON()?.items ?? [])));
  await login(page);
  await page.goto("/team?tab=contracts");
  const tab = page.getByTestId("contracts-tab");
  await expect(tab).toBeVisible();
  await expect(tab.getByRole("link", { name: "Fixture senior", exact: true })).toBeVisible();
  if (process.env.CZ_7274_SHOT_BEFORE !== "1") {
    for (const squad of SQUADS) {
      const group = page.getByTestId("contracts-group-expiring-" + squad);
      await expect(group).toBeVisible();
      await expect(group.getByText(LABELS[squad] + " · Udløber denne sæson", { exact: true })).toBeVisible();
      await group.getByRole("checkbox").first().check();
    }
    await expect(page.getByTestId("contracts-extend")).toBeEnabled();
    await expect(page.getByTestId("contracts-bar")).toContainText("4");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (info.project.name !== "mobile-webkit") await tab.screenshot({ path: info.outputPath("7274-contracts-" + (process.env.CZ_7274_SHOT_BEFORE === "1" ? "before-" : "after-") + info.project.name + ".png") });
});
test("#7249 inbox localizes the backend's actual structured contract roster", async ({ page }, info) => {
  const notice = buildContractRosterNotification({ riders: OWN, seasonNumber: 1 });
  await page.route("**/rest/v1/notifications**", route => route.request().method() === "GET"
    ? json(route, [{ id: "contract-roster-notice", user_id: TEST_USER.id, type: notice.type, title: notice.title, message: notice.message, metadata: notice.metadata, related_id: null, is_read: false, created_at: "2026-10-26T11:59:00.000Z" }])
    : json(route, []));
  await login(page);
  await page.goto("/notifications");
  for (const squad of SQUADS) await expect(page.locator("main")).toContainText("Fixture " + squad + " (" + LABELS[squad] + ")");
  await expect(page.locator("main")).not.toContainText("[object Object]");
  await expect(page.locator("main")).not.toContainText("notif.contract");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (info.project.name !== "mobile-webkit") await page.locator("main").screenshot({ path: info.outputPath("7274-inbox-after-" + info.project.name + ".png") });
});
test("#7249 Help exposes the already-approved contract warning copy", async ({ page }, info) => {
  await login(page);
  await page.goto("/help?section=contracts");
  await expect(page.getByRole("heading", { name: HELP.title, exact: true })).toBeVisible();
  await expect(page.getByText(HELP.text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (info.project.name !== "mobile-webkit") await page.locator("main").screenshot({ path: info.outputPath("7274-help-after-" + info.project.name + ".png") });
});
