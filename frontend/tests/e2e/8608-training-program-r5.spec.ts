import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, RIDERS, stabilizePage, TEST_TEAM } from "./fixtures.js";

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const catalog = [
  ["sprinter", "Sprinter"],
  ["puncheur", "Puncheur"],
  ["rouleur", "Rouleur"],
  ["time_trial", "Time trial"],
  ["cobbles", "Cobbles"],
  ["climber", "Climber"],
].map(([key, name]) => ({
  key, name: { en: name, da: name }, tagline: { en: "", da: "" }, targetTypes: [], audience: null,
  days: Object.fromEntries(days.map((day) => [day, "tempo"])),
}));
const squad = ["A", "B", "C", "D", "E"].map((suffix, index) => ({
  ...RIDERS[0], id: `rider-8608-${index + 1}`, firstname: "Rider", lastname: suffix, team_id: TEST_TEAM.id,
}));
const member = (riderId: string) => ({ riderId, followsGroup: true });

test("Program R5 requires a catalog choice and confirms rider and group assignments", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const writes: { path: string; body: unknown }[] = [];
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date("2026-11-23T12:00:00Z"));
  await installNetworkMocks(page);
  await page.route("**/api/feature-flags", (route) => json(route, {
    flags: { training_page_r5: true, training_groups: true, training_programs: true, training_program_cells: true },
  }));
  await page.route("**/rest/v1/riders**", (route) => route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) })
    : json(route, squad));
  await page.route("**/api/training/me**", (route) => json(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, plans: {}, condition: {}, progress: {}, capped: {},
    trainability: {}, weekPlan: null, riderWeekPlans: {}, racingToday: {},
  }));
  let rejectNextMove = true;
  let groups = [
    { id: "group-a", name: "Group A", programKey: "sprinter", members: [member(squad[0].id)] },
    { id: "group-b", name: "Group B", programKey: null as string | null, members: [member(squad[1].id)] },
  ];
  await page.route(/\/api\/training\/(programs|groups)(?:\/[^?]*)?(?:\?.*)?$/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path.endsWith("/forecast/week")) {
      return json(route, {
        available: true,
        days: [
          { date: "2026-11-23", weekday: "mon", available: true, races: [] },
          { date: "2026-11-24", weekday: "tue", available: true, races: [] },
        ],
      });
    }
    if (req.method() === "GET") return json(route, path.endsWith("/groups")
      ? { enabled: true, groups }
      : { enabled: true, cellsEnabled: true, catalog, assigned: {}, seeds: {} });
    const body = req.postDataJSON();
    writes.push({ path, body });
    if (req.method() === "PATCH") {
      if (rejectNextMove) {
        rejectNextMove = false;
        return json(route, { error: "test_rejected_write" }, 409);
      }
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
  await page.goto("/training");
  await page.getByRole("tab", { name: "Program", exact: true }).click();

  const copy = page.getByTestId("program-r5-copy");
  const openLibrary = async () => {
    if (isMobile) await page.getByTestId("program-r5-change").click();
    return page.getByTestId("program-r5-library");
  };
  const addTarget = page.getByTestId("program-r5-add-target");
  await expect(copy).toBeDisabled();
  let library = await openLibrary();
  await expect(library.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(addTarget).toHaveCount(0);
  if (isMobile) await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByTestId("program-r5-open-groups").click();
  const groupsDialog = page.getByRole("dialog", { name: "Groups", exact: true });
  await expect(groupsDialog.getByTestId("program-r5-group")).toHaveCount(2);
  await groupsDialog.getByRole("button", { name: "Group B Own week", exact: true }).click();
  await expect(groupsDialog).toHaveCount(0);
  await expect(page.getByTestId("program-r5-save")).toBeInViewport();
  if (!isMobile) {
    await page.getByTestId("program-r5-open-programs").click();
    await page.getByRole("dialog", { name: "Change program" }).getByRole("button", { name: "Close", exact: true }).last().click();
  }
  library = await openLibrary();
  await library.getByTestId("program-r5-group").filter({ hasText: "Group A" })
    .getByRole("button", { name: "Group A Sprinter", exact: true }).click();
  await expect(copy).toBeDisabled();
  await openLibrary();
  await expect(addTarget).toBeDisabled();
  await library.getByRole("button", { name: /^Climber/ }).click();
  await expect(copy).toBeEnabled();

  const copySelection = async () => {
    await copy.click();
    await page.getByRole("checkbox", { name: "Rider C" }).check();
    await page.getByRole("checkbox", { name: "Rider D" }).check();
    await page.getByTestId("program-r5-copy-go").click();
    await expect(page.getByRole("dialog", { name: "Apply Climber to 2 riders?" })).toBeVisible();
  };
  await copySelection();
  expect(writes).toEqual([]);
  await page.getByRole("dialog").getByText("Cancel", { exact: true }).click();
  expect(writes).toEqual([]);
  await copySelection();
  await page.getByTestId("program-r5-copy-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual([
    { path: "/api/training/programs/apply", body: { programKey: "climber", target: squad[2].id } },
    { path: "/api/training/programs/apply", body: { programKey: "climber", target: squad[3].id } },
  ]);

  await openLibrary();
  await addTarget.selectOption(`rider:${squad[4].id}`);
  await expect(page.getByRole("dialog", { name: "Apply Climber to 1 rider?" })).toBeVisible();
  await page.getByRole("dialog").getByText("Cancel", { exact: true }).click();
  expect(writes).toHaveLength(2);
  await openLibrary();
  await addTarget.selectOption("group:group-b");
  await expect(page.getByRole("dialog", { name: "Apply Climber to group Group B?" })).toBeVisible();
  expect(writes).toHaveLength(2);
  await page.getByTestId("program-r5-add-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes[2]).toEqual({ path: "/api/training/groups/group-b/program", body: { programKey: "climber" } });

  library = await openLibrary();
  const groupA = library.getByTestId("program-r5-group").filter({ hasText: "Group A" });
  const groupB = library.getByTestId("program-r5-group").filter({ hasText: "Group B" });
  await expect(groupB.getByRole("button", { name: "Members", exact: true })).toBeVisible();
  await groupA.getByTestId("program-r5-rider").getByRole("button", { name: "Move to group" }).click();
  await page.getByTestId("program-r5-move-target").selectOption("group-b");
  expect(writes).toHaveLength(3);
  await page.getByTestId("program-r5-move-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByTestId("program-r5-move-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const move = { path: "/api/training/groups/group-b", body: { riderIds: [squad[1].id, squad[0].id] } };
  expect(writes.slice(3)).toEqual([move, move]);

  await openLibrary();
  await expect(groupA.getByText("Rider A")).toHaveCount(0);
  await expect(groupB.getByText("Rider A")).toBeVisible();
  const freeRider = library.getByTestId("program-r5-rider").filter({ hasText: "Rider E" });
  await freeRider.getByRole("button", { name: "Add to group" }).click();
  await page.getByTestId("program-r5-move-target").selectOption("group-b");
  await page.getByTestId("program-r5-move-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes[5]).toEqual({ path: "/api/training/groups/group-b", body: { riderIds: [squad[1].id, squad[0].id, squad[4].id] } });

  if (isMobile) {
    await page.goto("/training");
    await page.getByTestId("r5-day-picker-day").nth(1).click();
    await page.getByTestId("r5-day-ahead-edit").click();
    await expect(library).toBeVisible();
    await expect(library.getByRole("button", { pressed: true })).toHaveCount(0);
    await library.getByRole("button", { name: /^Climber/ }).click();
    await expect(page.getByTestId("program-r5-dayview").getByRole("heading", { name: "Tuesday" })).toBeVisible();
  }
});

test("W1 keeps a failed effort draft and saves the selected effort and recovery for the group", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const riders = Array.from({ length: 28 }, (_, index) => ({
    ...squad[0], id: "w1-" + index, lastname: String(index).padStart(2, "0"),
  }));
  const writeAttempts: {
    weekday: string;
    slotIndex: number;
    session: string;
    effort?: string | null;
    weekBlock?: { slots: string[]; slotEfforts: (string | null)[]; lockSlot: number | null };
  }[] = [];
  const weekDays = Object.fromEntries(days.map((day) => [day, {
    session: "sprint", slots: Array<string | null>(5).fill(null), slotEfforts: Array<string | null>(5).fill(null), lockSlot: null as number | null,
  }]));
  const groups = [
    { id: "small", name: "Small group", programKey: "sprinter", days: weekDays, members: [member(riders[0].id)] },
    { id: "large", name: "Large group", programKey: "sprinter", days: weekDays, members: riders.slice(1).map((rider) => member(rider.id)) },
  ];
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date("2026-11-23T12:00:00Z"));
  await installNetworkMocks(page);
  await page.route("**/api/feature-flags", (route) => json(route, {
    flags: { training_page_r5: true, training_groups: true, training_programs: true, training_program_cells: true },
  }));
  await page.route("**/rest/v1/riders**", (route) => route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: corsHeaders(route.request()) }) : json(route, riders));
  await page.route("**/api/training/me**", (route) => json(route, {
    enabled: true, betaTester: true, teamId: TEST_TEAM.id, plans: {}, condition: {}, progress: {},
    capped: {}, trainability: {}, weekPlan: null, riderWeekPlans: {}, racingToday: {}, effortLevels: true,
  }));
  await page.route("**/api/training/programs", (route) => json(route, { enabled: true, cellsEnabled: true, catalog, assigned: {}, seeds: {} }));
  await page.route("**/api/training/groups", (route) => json(route, { enabled: true, groups }));
  await page.route("**/api/training/groups/large/cell", (route) => {
    const entry = route.request().postDataJSON() as (typeof writeAttempts)[number];
    writeAttempts.push(entry);
    if (writeAttempts.length === 1) return json(route, { error: "test_rejected_write" }, 409);
    const day = weekDays[entry.weekday];
    if (entry.weekBlock) Object.assign(day, entry.weekBlock);
    else {
      day.slots[entry.slotIndex] = entry.session;
      if (entry.effort !== undefined) day.slotEfforts[entry.slotIndex] = entry.effort;
    }
    return json(route, { ok: true, groups });
  });
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/training");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const save = page.getByTestId("program-r5-save");
  if (!isMobile) {
    await page.getByTestId("program-r5-library").getByRole("button", { name: "Rider 27", exact: true }).scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
  }
  const openGroups = page.getByTestId("program-r5-open-groups");
  const dialog = page.getByRole("dialog", { name: "Groups", exact: true });
  const largeGroup = dialog.getByTestId("program-r5-group").filter({ hasText: "Large group" });
  await openGroups.click();
  await expect(dialog.getByTestId("program-r5-group").filter({ hasText: "Small group" }).getByTestId("program-r5-rider")).toHaveCount(1);
  await expect(largeGroup.getByTestId("program-r5-rider")).toHaveCount(riders.length - 1);
  await largeGroup.getByRole("button", { name: "Rider 27", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openGroups.click();
  await largeGroup.getByRole("button", { name: "Large group Sprinter", exact: true }).click();

  const pass = page.getByTestId("program-r5-cell").first();
  await expect(pass).toHaveValue("sprint");
  for (const level of ["easy", "normal", "hard"]) {
    await expect(pass.locator('option[value="sprint:' + level + '"]')).toHaveCount(1);
  }
  await pass.selectOption("sprint:easy");
  expect(writeAttempts).toHaveLength(0);
  await expect(save).toBeInViewport();
  await save.click();
  const error = page.getByRole("status").filter({ hasText: /could not be saved/i });
  await expect(error).toBeVisible();
  await expect(pass).toHaveValue("sprint:easy");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled();
  expect(writeAttempts.slice(0, 2)).toEqual([
    expect.objectContaining({ session: "sprint", effort: "easy" }),
    expect.objectContaining({ session: "sprint", effort: "easy" }),
  ]);
  await pass.selectOption("recovery");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writeAttempts.at(-1)).toEqual(expect.objectContaining({ session: "recovery" }));
  await page.route("**/api/training/programs", (route) => json(route, {
    enabled: true, cellsEnabled: true, weekPriorityEnabled: true, catalog, assigned: {}, seeds: {},
  }));
  await page.reload();
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await openGroups.click();
  await largeGroup.getByRole("button", { name: "Large group Sprinter", exact: true }).click();
  await expect(pass).toHaveValue("recovery");

  const priorityPass = page.getByTestId("program-r5-week-block-pass").first();
  await expect(priorityPass).toHaveValue("recovery");
  await priorityPass.selectOption("tempo:hard");
  await save.click();
  await expect(save).toBeDisabled();
  expect(writeAttempts.at(-1)?.weekBlock).toEqual(expect.objectContaining({
    slots: ["tempo", "sprint", "sprint", "sprint", "sprint"],
    slotEfforts: ["hard", null, null, null, null],
  }));
  await expect(pass).toHaveValue("tempo:hard");
  await pass.selectOption("tempo");
  await page.getByRole("button", { name: "Lock field 1", exact: true }).click();
  await save.click();
  await expect(save).toBeDisabled();
  expect(writeAttempts.at(-1)?.weekBlock).toEqual(expect.objectContaining({
    lockSlot: 0, slotEfforts: [null, null, null, null, null],
  }));
});
