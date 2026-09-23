// #4346 — "Report for review" på den enkelte gennemførte handel
// (TeamTransferHistoryTab → ReportTradeDialog). SEED_TRANSFER_HISTORY (#2400)
// har allerede en gennemført auktion med en rigtig modpart (RIVAL_TEAM) —
// den er hvad denne spec bruger som "mock en handel".
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  collectBrowserErrors,
  evidenceShotPath,
  json,
  corsHeaders,
} from "./fixtures.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

// Formen matcher hvad api.js rent faktisk returnerer (submitTradeReport, se
// backend/lib/feedbackInbox.js) — alreadyReported styrer hvilken af de to
// succes-tekster dialogen viser.
function mockReportRoute(page: Page, { alreadyReported = false } = {}) {
  return page.route("**/api/transfers/*/*/report", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { ok: true, id: "pf-4346-e2e", alreadyReported });
  });
}

async function openTeamHistoryTab(page: Page) {
  await login(page);
  await page.goto("/team");
  await page.getByRole("tab", { name: /Transferhistorik|Transfer history/ }).click();
  await expect(page.getByRole("heading", { name: /Transferhistorik|Transfer history/ })).toBeVisible();
}

test.describe("#4346 — report-for-review på en gennemført handel", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("åbner dialogen, sender en rapport, og viser en tak (ikke en anklage)", async ({ page }, testInfo) => {
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await mockReportRoute(page, { alreadyReported: false });
    await openTeamHistoryTab(page);

    // Sofie Lund (auction:tx-e2e-1) er en afsluttet auktion med en rigtig
    // modpart (RIVAL_TEAM) — den ene rapporterbare række fixturen giver.
    const row = page.locator("table[data-sortable]").first().locator("tbody tr").filter({ hasText: "Sofie Lund" });
    await expect(row).toBeVisible();
    const reportButton = row.getByRole("button", { name: /Report this trade for review|Rapportér denne handel til gennemsyn/i });
    await expect(reportButton).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/4346-team-history-report-button.png"), fullPage: true });
    }

    await reportButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Report this trade|Rapportér denne handel/)).toBeVisible();
    // Tone-kontrakt (#3139): "review"/"gennemsyn", ALDRIG et anklagende ord.
    await expect(dialog.getByText(/accusation|anklage/i)).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/4346-report-dialog-open.png"), fullPage: true });
    }

    await dialog.getByLabel(/What looked off\?|Hvad virkede forkert\?/).fill("The price looked far below market value for this rider.");
    await dialog.getByRole("button", { name: /Send report|Send rapport/i }).click();

    await expect(dialog.getByText(/Thanks\. I'll take a look\.|Tak\. Jeg kigger på den\./)).toBeVisible();

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/4346-report-dialog-sent.png"), fullPage: true });
    }

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("en dublet-rapport (samme handel, samme hold) viser 'allerede rapporteret', ikke en fejl", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Dedupe-stien er dækket én gang — dækket af desktop-testen ovenfor for resten.");
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await mockReportRoute(page, { alreadyReported: true });
    await openTeamHistoryTab(page);

    const row = page.locator("table[data-sortable]").first().locator("tbody tr").filter({ hasText: "Sofie Lund" });
    await row.getByRole("button", { name: /Report this trade for review|Rapportér denne handel til gennemsyn/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/What looked off\?|Hvad virkede forkert\?/).fill("Reporting this again to see what happens.");
    await dialog.getByRole("button", { name: /Send report|Send rapport/i }).click();

    await expect(dialog.getByText(/already reported this trade|allerede rapporteret denne handel/i)).toBeVisible();

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("mobil (390px): raekken og dialogen renderer korrekt", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Dækket af desktop-testen ovenfor.");

    await mockReportRoute(page, { alreadyReported: false });
    await openTeamHistoryTab(page);

    const row = page.locator("table[data-sortable]").first().locator("tbody tr").filter({ hasText: "Sofie Lund" });
    const reportButton = row.getByRole("button", { name: /Report this trade for review|Rapportér denne handel til gennemsyn/i });
    await expect(reportButton).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/4346-team-history-report-button-mobile-${testInfo.project.name}.png`), fullPage: true });

    await reportButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: evidenceShotPath(`pr-screens/4346-report-dialog-mobile-${testInfo.project.name}.png`), fullPage: true });
  });
});
