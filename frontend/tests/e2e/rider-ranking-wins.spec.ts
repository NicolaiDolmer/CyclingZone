import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage } from "./fixtures.js";
import { RIDERS, SEED_RIDER_RANKINGS } from "../../src/preview/seedData.js";

test("#7137 compares all three win counts and restores the overview", async ({ page }) => {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 640;
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/rankings/riders?**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const params = new URL(request.url()).searchParams;
    if (params.has("top") || params.has("rider_ids")) return route.fallback();
    const [first, second] = SEED_RIDER_RANKINGS;
    return json(route, {
      data: [
        { ...first, gc_wins: 2, classic_wins: 1 },
        { ...second, gc_wins: 0, classic_wins: 4, mtn_wins: 2 },
      ],
    });
  });

  await login(page);
  await page.goto("/standings?tab=riders");
  const table = page.getByRole("table", { name: "Rytterrangliste" });
  const firstRider = table.locator("tbody tr").first().getByRole("link").first();
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-1");

  const titleBar = page.getByTestId("table-title-bar");
  const divisionLabel = titleBar.locator('label > span[title="Alle divisioner"]');
  await expect(divisionLabel).toHaveText("Alle divisioner", { useInnerText: true });
  if (mobile) {
    await page.getByTestId("table-columns-open").click();
    await page.getByRole("button", { name: "Samlet", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(table.getByRole("columnheader", { name: "Samlet", exact: true })).toBeVisible();
  }

  // Preserve a non-default overview sort when switching modes.
  // Choosing total wins also works when the points column was swapped out.
  const overviewWins = table.getByRole("columnheader", { name: "Sejre i alt", exact: true });
  await overviewWins.click();
  await expect(overviewWins).toHaveAttribute("aria-sort", "descending");
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-2");

  const view = page.getByRole("combobox", { name: "Visning", exact: true });
  await view.selectOption("wins");
  const gc = table.getByRole("columnheader", { name: "Samlet", exact: true });
  const classic = table.getByRole("columnheader", { name: "Klassikere", exact: true });
  const total = table.getByRole("columnheader", { name: "Sejre i alt", exact: true });
  for (const column of [gc, classic, total]) await expect(column).toBeVisible();
  await expect(total).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByText(/GC\s*=|Kla\s*=/)).toHaveCount(0);
  if (mobile) {
    expect(await table.evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-2");

  // 2 stage + 4 classic + 2 mountain wins; the GC field can be zero.
  const topCells = table.locator("tbody tr").first().getByRole("cell");
  await expect(topCells.nth(-3)).toHaveText("0");
  await expect(topCells.nth(-2)).toHaveText("4");
  await expect(topCells.nth(-1)).toHaveText("8");

  await gc.getByRole("button").press("Enter");
  await expect(gc).toHaveAttribute("aria-sort", "descending");
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-1");
  await classic.getByRole("button").click();
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-2");
  await total.getByRole("button").click();
  await total.getByRole("button").click();
  await expect(total).toHaveAttribute("aria-sort", "ascending");
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-1");

  if (mobile) await page.getByRole("button", { name: /søg rytternavn/i }).click();
  await page.getByRole("searchbox").fill(RIDERS[1].lastname);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-2");
  await page.getByRole("searchbox").fill("");
  if (mobile) await page.getByTestId("table-search-close").click();

  await view.selectOption("overview");
  await expect(overviewWins).toHaveAttribute("aria-sort", "descending");
  await expect(firstRider).toHaveAttribute("href", "/riders/rider-2");
  if (!mobile) return;
  await expect(table.getByRole("columnheader", { name: "Samlet", exact: true })).toBeVisible();

  async function expectReadableChoices(count: number) {
    const labels = titleBar.locator("label > span[title]");
    await expect(labels).toHaveCount(count);
    const clipped = await labels.evaluateAll(spans => spans
      .filter(span => span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 1)
      .map(span => span.getAttribute("title")));
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await expectReadableChoices(3);

  // Preserve full-table mode when entering and leaving the focused view.
  await page.getByTestId("table-columns-open").click();
  const fullTable = page.getByRole("button", { name: "Fuld tabel", exact: true });
  await fullTable.click();
  await page.keyboard.press("Escape");
  await view.selectOption("wins");
  await expect(table).toHaveCount(1);
  await expect(total).toHaveAttribute("aria-sort", "descending");
  await view.selectOption("overview");
  await page.getByTestId("table-columns-open").click();
  await expect(fullTable).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // Division with a pool has one more choice in the same title row.
  await titleBar.getByRole("combobox", { name: "Filtrér efter division" }).selectOption("2");
  await titleBar.getByRole("combobox", { name: "Filtrér efter pulje" }).selectOption("2");
  await titleBar.getByRole("combobox", { name: "Filtrér efter ejer" }).selectOption("manager");
  await expectReadableChoices(4);
  const selectedLabels = await titleBar.locator("label > span[title]").allInnerTexts();
  expect(selectedLabels.map(label => label.replace(/\s+/g, " "))).toEqual([
    "Overblik", "Division 2", "Division 2 — A", "Manager-ejede",
  ]);
});

test("#8651 keeps three full classification labels inside the phone table", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) > 640, "Mobile column picker");
  await page.setViewportSize({ width: 390, height: 844 });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.goto("/standings?tab=riders");
  const table = page.getByRole("table", { name: "Rytterrangliste" });
  await expect(table.locator("tbody tr").first()).toBeVisible();

  await page.getByTestId("table-columns-open").click();
  const labels = ["Pointklassement", "Bjergklassement", "Ungdomsklassement"];
  for (const label of labels) await page.getByRole("button", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");

  for (const label of labels) await expect(table.getByRole("columnheader", { name: label, exact: true })).toBeVisible();
  expect(await table.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
