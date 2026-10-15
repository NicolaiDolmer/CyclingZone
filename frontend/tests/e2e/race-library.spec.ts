import { test, expect } from "./e2e-base.js";
import { prepareLibrary, id, races } from "./race-library.fixture.ts";
test("upcoming is the default and searches the reported accent/name variants", async ({ page }) => {
  await prepareLibrary(page);
  await page.goto("/resultater?tab=archive");
  await expect(page.getByRole("heading", { name: "Løbsbibliotek", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Kommende løb", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.getByRole("searchbox", { name: "Søg løb" }).fill("vueltaiberica");
  await expect(page.getByText("Vuelta Ibérica", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tour de l'Hexagone", { exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Søg løb" }).fill("Tour d’Hexagone");
  await expect(page.getByText("Tour de l'Hexagone", { exact: true }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Søg løb" }).fill("");
  await page.getByRole("tab", { name: "Historik", exact: true }).click();
  await expect(page.getByText("Giro della Penisola", { exact: true }).first()).toBeVisible();
});
test("empty filters can be cleared and a future season has an honest empty state", async ({
  page,
}) => {
  await prepareLibrary(page);
  await page.goto("/resultater?tab=archive");
  await page.getByRole("searchbox", { name: "Søg løb" }).fill("no-such-race");
  await expect(page.getByText("Ingen løb matcher filtrene")).toBeVisible();
  await page.getByRole("button", { name: "Ryd filtre", exact: true }).click();
  await expect(page.getByText("Vuelta Ibérica", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Sæson", exact: true }).selectOption("12");
  await expect(page.getByText("Intet løbsprogram at vise")).toBeVisible();
});
test("edition navigation keeps season and final-winner semantics separate", async ({ page }) => {
  await prepareLibrary(page);
  await page.goto(
    "/race-archive/" +
      encodeURIComponent("L'Enfer du Nord") +
      "?raceId=" +
      id(3) +
      "&season=4&division=2&pool=2"
  );
  await expect(page.getByRole("heading", { name: "L'Enfer du Nord", exact: true })).toBeVisible();
  await expect(page.getByText("Rytter 1", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Udgaver", exact: true }).click();
  await page.getByRole("button", { name: "Åbn sæson 3", exact: true }).click();
  await expect(page.getByText("Rytter 1", { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/season=3/);
});
test("mobile and desktop preserve chrome, targets and overflow in light and dark", async ({
  page,
}, testInfo) => {
  await prepareLibrary(page);
  await page.goto("/resultater?tab=archive");
  await expect(page.getByText("Vuelta Ibérica", { exact: true }).first()).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
      localStorage.setItem("cz_theme", value);
    }, theme);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBeTruthy();
    const open = page.getByRole("button", { name: /^Åbn Vuelta/ }).first();
    const box = await open.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath("library-" + theme + ".png"),
      fullPage: true,
    });
  }
});
test("failed read retains filters and has a retry", async ({ page }) => {
  await prepareLibrary(page, { fail: true });
  await page.goto("/resultater?tab=archive");
  await expect(page.getByRole("heading", { name: "Løbsbibliotek", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Søg løb" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prøv igen", exact: true })).toBeVisible();
});

test("query/back navigation restores filters and full table mode", async ({ page }) => {
  await prepareLibrary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resultater?tab=archive&q=vuelta");
  await page.getByRole("button", { name: "Fuld tabel", exact: true }).click();
  await expect(page).toHaveURL(/table=full/);
  await page.getByRole("button", { name: "Åbn Vuelta Ibérica", exact: true }).first().click();
  await page.getByRole("link", { name: "Løbsbibliotek", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Søg løb" })).toHaveValue("vuelta");
  await expect(page).toHaveURL(/table=full/);
  await expect(page.getByRole("button", { name: "Fuld tabel", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
test("a late response for an old season cannot replace the selected season", async ({ page }) => {
  await prepareLibrary(page, { delaySeason: 3 });
  await page.goto("/resultater?tab=archive");
  const oldRequest = page.waitForRequest(
    (r) =>
      r.url().includes("/rest/v1/races") &&
      new URL(r.url()).searchParams.get("season_id") === "eq." + id(102)
  );
  await page.getByRole("combobox", { name: "Sæson", exact: true }).selectOption("3");
  await oldRequest;
  await page.getByRole("combobox", { name: "Sæson", exact: true }).selectOption("4");
  await expect(page.getByText("Vuelta Ibérica", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sæson", exact: true })).toHaveValue("4");
  await page.waitForTimeout(350);
  await expect(page.getByText("Vuelta Ibérica", { exact: true }).first()).toBeVisible();
});

test("opening from a scrolled list starts the edition at the top and returns to the same position", async ({
  page,
}) => {
  await prepareLibrary(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto("/resultater?tab=archive");
  const open = page.getByRole("button", { name: "Åbn Vuelta Ibérica", exact: true }).first();
  await open.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await open.click();
  await expect(page.getByRole("heading", { name: "Vuelta Ibérica", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await page.getByRole("link", { name: "Løbsbibliotek", exact: true }).click();
  await expect(open).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 40);
});

test("legacy name lookup opens a completed edition and an invalid ID stays an explicit empty state", async ({
  page,
}) => {
  await prepareLibrary(page);
  await page.goto("/race-archive/" + encodeURIComponent("Giro della Penisola"));
  await expect(page.getByText("Rytter 1", { exact: true }).first()).toBeVisible();
  await page.goto(
    "/race-archive/" + encodeURIComponent("Giro della Penisola") + "?raceId=" + id(999)
  );
  await expect(page.getByText("Denne løbsudgave er ikke tilgængelig")).toBeVisible();
  await expect(page.getByRole("link", { name: "Løbsbibliotek", exact: true })).toBeVisible();
});
test("statistics are lazy and missing elevation never draws an invented curve", async ({
  page,
}, testInfo) => {
  await prepareLibrary(page);
  const completeResults: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.endsWith("/race_results") && !url.searchParams.has("rank"))
      completeResults.push(url.pathname);
  });
  await page.goto(
    "/race-archive/" +
      encodeURIComponent("L'Enfer du Nord") +
      "?raceId=" +
      id(3) +
      "&season=4&division=2&pool=2"
  );
  await expect(page.getByText("255 km", { exact: false }).first()).toBeVisible();
  await expect(page.locator('svg[aria-label="Rute"]')).toHaveCount(0);
  await expect(page.getByText("1,3 km", { exact: true })).toBeVisible();
  expect(completeResults).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("edition.png"), fullPage: true });
  await page.getByRole("tab", { name: "Historiske tal", exact: true }).click();
  await expect(page.getByText("Rytter 1", { exact: true }).first()).toBeVisible();
  expect(completeResults.length).toBeGreaterThan(0);
});
test("missing persisted profile remains actionable and does not replace chrome", async ({
  page,
}) => {
  await prepareLibrary(page);
  await page.route("**/rest/v1/race_stage_profiles**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.goto("/race-archive/" + encodeURIComponent("L'Enfer du Nord") + "?raceId=" + id(3));
  await expect(page.getByText("Ruteprofil mangler")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Udgaver", exact: true })).toBeVisible();
});
test("English at 320px keeps long race names inside the viewport", async ({ page }) => {
  await prepareLibrary(page);
  await page.addInitScript(() => localStorage.setItem("cz_lang", "en"));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/resultater?tab=archive");
  await expect(page.getByRole("heading", { name: "Race library", exact: true })).toBeVisible();
  await expect(page.getByText("Ronde van Noord-Frankrijk", { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBeTruthy();
});

test("completed editions retain a link to their existing results", async ({ page }) => {
  await prepareLibrary(page);
  await page.goto(
    "/race-archive/" + encodeURIComponent("Giro della Penisola") + "?raceId=" + id(4)
  );
  await expect(page.getByRole("link", { name: "Se resultater", exact: true })).toHaveAttribute(
    "href",
    "/races/" + id(4)
  );
});
test("all-division browsing identifies the concrete division and pool", async ({ page }) => {
  await prepareLibrary(page);
  await page.goto("/resultater?tab=archive&division=all&pool=all");
  await page.locator("summary").filter({ hasText: "Flere filtre" }).click();
  const pool = page.getByRole("combobox", { name: "Pulje", exact: true });
  await expect(pool.locator("option[value='2']")).toHaveText("Division 2 · Pulje 1");
  await expect(pool.locator("option[value='3']")).toHaveText("Division 3 · Pulje 1");
  await page.getByRole("button", { name: "Åbn Vuelta Ibérica", exact: true }).first().click();
  await expect(page.getByText("Division 2 · Pulje 1", { exact: true }).first()).toBeVisible();
});
test("unknown stage total offers only recorded sparse stage numbers", async ({ page }) => {
  await prepareLibrary(page);
  await page.route("**/rest/v1/races**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...races[0], stages: null }]),
    })
  );
  await page.route("**/rest/v1/race_stage_profiles**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { race_id: id(1), stage_number: 3, distance_km: 130, elevation_profile: null },
        { race_id: id(1), stage_number: 5, distance_km: 150, elevation_profile: null },
      ]),
    })
  );
  await page.route("**/rest/v1/race_stage_schedule**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.goto("/race-archive/" + encodeURIComponent("Vuelta Ibérica") + "?raceId=" + id(1));
  const stage = page.getByRole("combobox", { name: "Etape", exact: true });
  await expect(stage.locator("option")).toHaveText(["Etape 3", "Etape 5"]);
  await expect(stage).toHaveValue("3");
  await stage.selectOption("5");
  await expect(page.getByText("Distance: 150 km", { exact: true })).toBeVisible();
});

test("invalid edition scope offers a working route back to a valid library", async ({ page }) => {
  await prepareLibrary(page);
  await page.goto("/race-archive/" + encodeURIComponent("Giro della Penisola") + "?season=999");
  await expect(
    page.getByText("Sæsonen eller puljen er ikke tilgængelig. Vælg en anden visning.", {
      exact: true,
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Løbsbibliotek", exact: true }).click();
  await expect(page).toHaveURL(/\/resultater\?tab=archive$/);
  await expect(page.getByRole("tab", { name: "Kommende løb", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("empty editions finish loading and offer return navigation", async ({ page }) => {
  await prepareLibrary(page);
  await page.route("**/rest/v1/races**", async (route) => {
    if (new URL(route.request().url()).searchParams.has("name")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else await route.fallback();
  });
  await page.goto(
    "/race-archive/" +
      encodeURIComponent("Vuelta Ibérica") +
      "?raceId=" +
      id(1) +
      "&detail=editions"
  );
  await expect(page.getByRole("heading", { name: "Vuelta Ibérica", exact: true })).toBeVisible();
  await expect(
    page.getByText("Denne løbsudgave er ikke tilgængelig", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Løbsbibliotek", exact: true }).click();
  await expect(page).toHaveURL(/\/resultater\?tab=archive$/);
});
