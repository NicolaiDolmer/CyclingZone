// #7947 W1 v2 (ejerens design 26/11): Program-fanens ugeplan, "Plan for" med Alle ryttere,
// indsats under passet, Gem plan fast i bunden og den egne Grupper-fane, bag training_w1_v2.
import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, RIDERS, stabilizePage, TEST_TEAM } from "./fixtures.js";

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const week = (session: string) => Object.fromEntries(days.map((day) => [day, { session }]));
const catalog = [["sprinter", "Sprinter"], ["climber", "Climber"]].map(([key, name]) => ({
  key, name: { en: name, da: name }, tagline: { en: `${name} week`, da: `${name} uge` }, targetTypes: [], audience: null,
  days: Object.fromEntries(days.map((day) => [day, "tempo"])),
}));
const squad = ["A", "B", "C", "D", "E"].map((suffix, index) => ({
  ...RIDERS[0], id: `rider-7947-${index + 1}`, firstname: "Rider", lastname: suffix, team_id: TEST_TEAM.id,
}));
const member = (riderId: string) => ({ riderId, followsGroup: true });

// Billeder til PR'en (390 og 1440 px), gemt i testens output-mappe.
async function shot(page: import("@playwright/test").Page, testInfo: import("@playwright/test").TestInfo, name: string) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.setViewportSize(testInfo.project.name.startsWith("mobile") ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

async function setup(page: import("@playwright/test").Page, flags: Record<string, boolean>, programsExtra: Record<string, unknown> = {}) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date("2026-11-23T12:00:00Z"));
  await installNetworkMocks(page);
  await page.route("**/api/feature-flags", (route) => json(route, {
    flags: { training_page_r5: true, training_groups: true, training_programs: true, training_program_cells: true, ...flags },
  }));
  await page.route("**/rest/v1/riders**", (route) => route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) })
    : json(route, squad));
  await page.route("**/api/training/me**", (route) => json(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, plans: {}, condition: {}, progress: {}, capped: {},
    trainability: {}, weekPlan: null, riderWeekPlans: { [squad[4].id]: week("endurance") }, racingToday: {}, effortLevels: true,
  }));
  let groups = [
    { id: "group-a", name: "Group A", programKey: "sprinter", days: week("tempo"), members: [member(squad[0].id), member(squad[1].id)] },
    { id: "group-b", name: "Group B", programKey: null as string | null, days: week("rest"), members: [member(squad[2].id)] },
  ];
  await page.route(/\/api\/training\/(programs|groups)(?:\/[^?]*)?(?:\?.*)?$/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path.endsWith("/forecast/week")) return json(route, { available: false, days: [] });
    if (req.method() === "GET") return json(route, path.endsWith("/groups")
      ? { enabled: true, groups }
      : { enabled: true, cellsEnabled: true, catalog, assigned: { [squad[4].id]: "climber" }, seeds: {}, ...programsExtra });
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    writes.push({ method: req.method(), path, body });
    if (req.method() === "PATCH") {
      const destination = groups.find((group) => path.endsWith("/" + group.id))!;
      const riderIds = body.riderIds as string[];
      groups = groups.map((group) => group === destination
        ? { ...group, members: riderIds.map(member) }
        : { ...group, members: group.members.filter((existing) => !riderIds.includes(existing.riderId)) });
    }
    return json(route, { ok: true, groups });
  });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  return writes;
}

test("W1 v2: the week fills Program, effort sits under each pass and Save plan sends it", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const writes = await setup(page, { training_w1_v2: true });
  await page.goto("/training?tab=weekplan");

  const root = page.getByTestId("program-w1");
  await expect(root).toBeVisible();
  // Ingen gruppe valgt foer: "Plan for" starter paa den foerste gruppe og viser hele ugen.
  await expect(page.getByTestId("program-w1-plan-for")).toHaveValue("group:group-a");
  await expect(page.getByTestId("program-w1-day")).toHaveCount(7);
  await expect(page.getByText("Race day 1").first()).toBeVisible();
  await expect(page.getByTestId("program-r5")).toHaveCount(0);

  // Gem plan er den eneste guldknap og staar i gem-linjen.
  const save = page.getByTestId("program-w1-save");
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("program-w1-savebar")).toBeVisible();

  // Tempo er Mellem; Haard paa mandagens foerste pas er en rettelse.
  const monday = page.locator('[data-testid="program-w1-day"][data-weekday="mon"]');
  const firstPass = monday.getByTestId("program-w1-pass").first();
  await expect(firstPass.getByTestId("program-w1-effort-normal")).toHaveAttribute("aria-pressed", "true");
  await firstPass.getByTestId("program-w1-effort-hard").click();
  await expect(firstPass.getByTestId("program-w1-effort-hard")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("program-w1-unsaved")).toContainText("1");
  await shot(page, testInfo, "after-week");

  await save.click();
  await expect.poll(() => writes.filter((w) => w.path.endsWith("/groups/group-a/cell")).length).toBe(1);
  const cell = writes.find((w) => w.path.endsWith("/groups/group-a/cell"))!;
  expect(cell.body).toMatchObject({ weekday: "mon", slotIndex: 0, session: "tempo", effort: "hard" });

  // Hvile viser "No effort".
  await page.getByTestId("program-w1-plan-for").selectOption("group:group-b");
  await expect(page.getByTestId("program-w1-no-effort").first()).toBeVisible();
  await expect(page.getByTestId("program-w1-effort")).toHaveCount(0);

  // Alle ryttere: en linje pr. rytter; et klik aabner rytterens uge.
  await page.getByTestId("program-w1-plan-for").selectOption("all");
  await expect(page.getByTestId("program-w1-all-row")).toHaveCount(squad.length);
  await shot(page, testInfo, "after-all-riders");
  await page.getByRole("button", { name: "Open the week for Rider E" }).click();
  await expect(page.getByTestId("program-w1-plan-for")).toHaveValue(`rider:${squad[4].id}`);
  await expect(page.getByTestId("program-w1-day")).toHaveCount(7);
});

test("W1 v2: Skift program asks before it puts a program on the group", async ({ page }) => {
  test.setTimeout(120_000);
  const writes = await setup(page, { training_w1_v2: true });
  await page.goto("/training?tab=weekplan");
  await page.getByTestId("program-w1-change-program").click();
  await page.getByTestId("program-w1-catalog-item").filter({ hasText: "Climber" }).click();
  await page.getByTestId("program-w1-change-confirm").click();
  await expect.poll(() => writes.filter((w) => w.path.endsWith("/groups/group-a/program")).length).toBe(1);
  expect(writes.find((w) => w.path.endsWith("/groups/group-a/program"))!.body).toMatchObject({ programKey: "climber" });
});

test("W1 v2: the Groups tab keeps every group action (move rider, members, new group)", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const writes = await setup(page, { training_w1_v2: true });
  await page.goto("/training?tab=groups");
  await expect(page.getByTestId("groups-v2")).toBeVisible();
  await expect(page.getByTestId("groups-v2-group")).toHaveCount(2);
  await expect(page.getByTestId("groups-v2-new")).toBeVisible();
  await expect(page.getByTestId("groups-v2-ungrouped")).toBeVisible();
  await shot(page, testInfo, "after-groups");

  await page.getByTestId("groups-v2-group").filter({ hasText: "Group A" }).getByTestId("groups-v2-move").first().click();
  await page.getByTestId("program-r5-move-target").selectOption("group-b");
  await page.getByTestId("program-r5-move-confirm").click();
  await expect.poll(() => writes.filter((w) => w.method === "PATCH" && w.path.endsWith("/groups/group-b")).length).toBe(1);

  // Et klik paa gruppens navn aabner dens uge i Program.
  await page.getByRole("button", { name: "Open the week for Group A" }).click();
  await expect(page.getByTestId("program-w1-plan-for")).toHaveValue("group:group-a");
});

// #8813 (Codex paa #8780): kopimenuen aabner mod kortets indre og klippes ikke af dagens kort.
test("W1 v2: the copy-day menu opens inside the day card", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setup(page, { training_w1_v2: true });
  await page.goto("/training?tab=weekplan");
  const monday = page.locator('[data-testid="program-w1-day"][data-weekday="mon"]');
  await expect(monday.getByTestId("program-w1-pass").first()).toBeVisible();
  await shot(page, testInfo, "after-copy-menu-closed");
  await monday.getByTestId("program-w1-copy-day").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Telefonen: inden for dagens kort (det klipper). Computeren: inden for ugens gitter (dagens
  // kolonne er smallere end menuen, som derfor laegger sig ind over nabodagen).
  const clip = testInfo.project.name.startsWith("mobile") ? monday : page.getByTestId("program-w1-week");
  const card = (await clip.boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(card.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(card.y + card.height + 1);
  // Det oeverste og nederste punkt kan klikkes (intet ligger over menuen eller klipper den).
  await expect(menu.getByRole("menuitem").first()).toBeInViewport();
  await menu.getByRole("menuitem").last().scrollIntoViewIfNeeded();
  await expect(menu.getByRole("menuitem").last()).toBeVisible();
  await monday.getByTestId("program-w1-copy-day").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("after-copy-menu-open.png") });
  await testInfo.attach("after-copy-menu-open", { path: testInfo.outputPath("after-copy-menu-open.png"), contentType: "image/png" });
});

// #8813 (Codex paa #8780): en rettet indsats flyttes med passet i Field priority og bevares ved laas.
test("W1 v2: a changed effort moves with its pass and survives a lock", async ({ page }) => {
  test.setTimeout(120_000);
  const writes = await setup(page, { training_w1_v2: true }, { weekPriorityEnabled: true });
  await page.goto("/training?tab=weekplan");
  const monday = page.locator('[data-testid="program-w1-day"][data-weekday="mon"]');
  const passes = monday.getByTestId("program-w1-pass");
  await passes.first().getByTestId("program-w1-effort-hard").click();
  await expect(passes.first().getByTestId("program-w1-effort-hard")).toHaveAttribute("aria-pressed", "true");

  const priority = page.getByTestId("program-r5-week-priority");
  await priority.getByRole("button", { name: "Lower priority of field 1" }).click();
  await priority.getByRole("button", { name: "Lock field 2" }).click();
  // Indsatsen fulgte passet til felt 2; felt 1 er tilbage paa sessionens standard.
  await expect(passes.nth(1).getByTestId("program-w1-effort-hard")).toHaveAttribute("aria-pressed", "true");
  await expect(passes.first().getByTestId("program-w1-effort-normal")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("program-w1-save").click();
  await expect.poll(() => writes.filter((w) => w.path.endsWith("/groups/group-a/cell")).length).toBeGreaterThan(0);
  const block = writes.find((w) => w.path.endsWith("/groups/group-a/cell") && w.body.weekBlock)!;
  expect(block.body).toMatchObject({ weekday: "mon", weekBlock: { lockSlot: 1, slotEfforts: [null, "hard", null, null, null] } });
});

test("W1 v2 off: Program is R5 as before and there is no Groups tab", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setup(page, {});
  await page.goto("/training?tab=groups");
  await expect(page.getByRole("tab", { name: "Groups", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.getByTestId("program-r5")).toBeVisible();
  await expect(page.getByTestId("program-w1")).toHaveCount(0);
  await shot(page, testInfo, "before-program-r5");
});
