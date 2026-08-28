// #3808 · Løbspræmier under Økonomi → Overblik sorteres nu default nyeste
// først (dato) og har sorterbare kolonner (Dato/Præmie), samme kanoniske
// SortableTh/useTableSort-mønster som resten af appen (#1755/#2290/#3188).
//
// Backend-mocken leverer bevidst rækkerne i BELØBS-orden (den gamle bug —
// se backend/routes/api.js .order("amount", ...) FØR denne fix) for at bevise
// at klienten selv retter rækkefølgen til dato-orden, uanset hvad API'et
// sender. Screenshots dokumenterer default-sortering + omvendt (klik på
// Dato-headeren igen → ældste øverst).
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  json,
  stabilizePage,
  corsHeaders,
  collectBrowserErrors,
  evidenceShotPath,
} from "./fixtures.js";

const CONSOLE_NOISE = [/WebSocket connection to .*supabase\.co.*failed/i, /ERR_NAME_NOT_RESOLVED/i];

const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

// Arrival-orden = beløb-descending (den gamle default-sortering, #3808).
// Dato-orden (nyeste først) skal blive: Vuelta Fjord (2d) → Classic Havn (10d)
// → Giro Nord (20d).
const PRIZE_ROWS = [
  { id: "prz-c", amount: 65000, race_id: "race-c", description: "Prize", created_at: daysAgo(10), race_name: "Classic Havn" },
  { id: "prz-a", amount: 42000, race_id: "race-a", description: "Prize", created_at: daysAgo(20), race_name: "Giro Nord" },
  { id: "prz-b", amount: 8000, race_id: "race-b", description: "Prize", created_at: daysAgo(2), race_name: "Vuelta Fjord" },
];

async function installFinanceReportMock(page) {
  await page.route("**/api/teams/*/finance-report**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, {
      prizes: {
        season_total: 115000,
        race_count: PRIZE_ROWS.length,
        all_time_total: 115000,
        rows: PRIZE_ROWS,
      },
    });
  });
}

test.describe("#3808 finance præmie-sortering", () => {
  test("Løbspræmier-tabellen defaulter til nyeste-først og kan sorteres om via kolonne-headers", async ({ page }, testInfo) => {
    const capture = testInfo.project.name === "desktop-chromium";
    const { pageErrors, consoleErrors } = collectBrowserErrors(page, testInfo, { consoleNoise: CONSOLE_NOISE });

    await stabilizePage(page);
    await installNetworkMocks(page);
    await installFinanceReportMock(page);

    await login(page);
    await page.goto("/finance");

    await expect(page.getByText("Løbspræmier")).toBeVisible();

    const raceCells = page.locator("table[data-sortable] tbody tr td:first-child");
    await expect(raceCells).toHaveCount(3);

    // ── Default: dato, nyeste først ─────────────────────────────────────────
    await expect(raceCells.nth(0)).toHaveText("Vuelta Fjord");
    await expect(raceCells.nth(1)).toHaveText("Classic Havn");
    await expect(raceCells.nth(2)).toHaveText("Giro Nord");

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3808-prize-list-default-newest-first.png"), fullPage: true });
    }

    // ── Omvendt: klik Dato-headeren igen → ældste først ─────────────────────
    await page.getByRole("columnheader", { name: "Dato" }).click();
    await expect(raceCells.nth(0)).toHaveText("Giro Nord");
    await expect(raceCells.nth(1)).toHaveText("Classic Havn");
    await expect(raceCells.nth(2)).toHaveText("Vuelta Fjord");

    if (capture) {
      await page.screenshot({ path: evidenceShotPath("pr-screens/3808-prize-list-date-reversed.png"), fullPage: true });
    }

    // ── Præmie-kolonnen er også sorterbar (klik-cyklus starter faldende) ────
    await page.getByRole("columnheader", { name: "Præmie" }).click();
    await expect(raceCells.nth(0)).toHaveText("Classic Havn"); // 65.000
    await expect(raceCells.nth(1)).toHaveText("Giro Nord"); // 42.000
    await expect(raceCells.nth(2)).toHaveText("Vuelta Fjord"); // 8.000

    expect(pageErrors, `pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console.error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});
