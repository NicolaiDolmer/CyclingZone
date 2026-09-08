// #4943 · Admin-fladen med spørgeskema-resultater (/admin/surveys/:slug).
//
// Smoke-guarden holder på det der gør fladen brugbar frem for en SQL-kørsel:
//   1) Fladen er admin-only: en manager-rolle sendes til dashboardet.
//   2) Overblikket står FØRST med svarprocenten, og de seks faner findes.
//   3) Idé-tabellen er sorteret efter prioritetsscore, ikke efter skemaets
//      egen rækkefølge, og rang 1 står øverst.
//   4) Et segment-skift ændrer faktisk tallene (Segmenter-fanen går fra en
//      vejledning til fire divisioner).
//   5) Fritekst-fanens søgefelt filtrerer svarene.
//
// Fixturen låser app'en til DA (stabilizePage → cz_lang=da), så assertions
// matcher public/locales/da/admin.json.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath } from "./fixtures.js";
import { installSurveyResultsRoutes } from "../../src/preview/surveyResultsMock.js";

const SLUG = "2026-09-features";
const SHOTS = "docs/drafts/survey-results-2026-09-08";

// Fra den deterministiske mock: den højeste prioritetsscore i seedet.
const TOP_IDEA = "Del træningsprogrammer og brug andre manageres programmer";

async function openResults(page, { isAdmin = true, query = "" } = {}) {
  await installNetworkMocks(page);
  await installSurveyResultsRoutes(page, { isAdmin });
  await stabilizePage(page);
  await login(page);
  await page.goto(`/admin/surveys/${SLUG}${query}`);
}

test("adgang: en manager uden admin-rollen sendes til dashboardet", async ({ page }) => {
  await openResults(page, { isAdmin: false });
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Spørgeskema-resultater" })).toHaveCount(0);
});

test("overblik først: svarprocenten står øverst, og de seks faner findes", async ({ page }) => {
  await openResults(page);

  await expect(page.getByRole("heading", { name: "Spørgeskema-resultater" })).toBeVisible();
  await expect(page.getByTestId("survey-total-invited")).toContainText("240");
  await expect(page.getByTestId("survey-total-started")).toContainText("96");
  await expect(page.getByTestId("survey-total-completed")).toContainText("71");
  // Gennemførte vises både som tal og som andel af dem der startede.
  await expect(page.getByTestId("survey-total-completed")).toContainText("74");

  for (const label of ["Overblik", "Idéerne", "Fungerer dårligst", "Fritekst", "Pro", "Segmenter"]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  // Overblikket bærer tilfredsheden og fog of war uden at man skal skifte fane.
  await expect(page.getByTestId("survey-satisfaction")).toBeVisible();
  await expect(page.getByTestId("survey-fog")).toBeVisible();
});

test("idéerne: tabellen er sorteret efter prioritetsscore med rang 1 øverst", async ({ page }) => {
  await openResults(page);
  await page.getByRole("tab", { name: "Idéerne" }).click();

  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toContainText(TOP_IDEA);
  await expect(firstRow).toContainText("1");

  // Prioritet falder ned gennem tabellen.
  const priorities = await page.locator("table tbody tr td:nth-child(5)").allInnerTexts();
  const numbers = priorities.map((cell) => Number(cell.replace(",", ".")));
  for (let i = 1; i < numbers.length; i += 1) {
    expect(numbers[i]).toBeLessThanOrEqual(numbers[i - 1]);
  }
});

test("segmenter: et segment-skift ændrer tallene fra en vejledning til fire divisioner", async ({ page }) => {
  await openResults(page);
  await page.getByRole("tab", { name: "Segmenter" }).click();
  await expect(page.getByTestId("survey-segments-hint")).toBeVisible();

  await page.getByTestId("survey-segment-select").selectOption("division");
  await expect(page.getByTestId("survey-segments-hint")).toHaveCount(0);
  await expect(page.getByTestId("survey-segment-satisfaction")).toContainText("Division 1");
  await expect(page.getByTestId("survey-segment-satisfaction")).toContainText("Division 4");
  // Opdelingen lever i URL'en, så den kan deles som link.
  await expect(page).toHaveURL(/segment=division/);
});

test("fritekst: søgefeltet filtrerer svarene", async ({ page }) => {
  await openResults(page);
  await page.getByRole("tab", { name: "Fritekst" }).click();

  const list = page.getByTestId("survey-text-list");
  await expect(list).toContainText("Live races");
  await page.getByTestId("survey-text-search").fill("U23");
  await expect(list).toContainText("U23-hold med egne løb.");
  await expect(list).not.toContainText("Live races");
});

test("screenshots til ejer-review (alle faner)", async ({ page }, testInfo) => {
  await openResults(page, { query: "?segment=division" });
  await expect(page.getByRole("heading", { name: "Spørgeskema-resultater" })).toBeVisible();

  const tabs = [
    ["overblik", "Overblik"],
    ["ideerne", "Idéerne"],
    ["daarligst", "Fungerer dårligst"],
    ["fritekst", "Fritekst"],
    ["pro", "Pro"],
    ["segmenter", "Segmenter"],
  ];
  for (const [file, label] of tabs) {
    await page.getByRole("tab", { name: label }).click();
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: evidenceShotPath(`${SHOTS}/4943-${file}-${testInfo.project.name}.png`),
      fullPage: true,
    });
  }
});
