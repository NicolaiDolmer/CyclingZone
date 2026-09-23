// #4982/#5471 — tabeller paa mobil scroller med SIDEN, ikke i en boks.
//
// Efter #4747 (sticky overskrifter) laa hver tabel i en boks med egen lodret
// scroll og `max-height: 100dvh - 240px`. Tre spillere ramte den: traeningssiden
// "i en boks der skal scrolles" (6/9), manglende luft til hoejre paa Mit hold >
// Evner (7/9), og i landscape "kun lige plads til to hold" paa ranglisten
// (21/9). Ejer 21/9: "det burde vaere saadan alle steder, at hele siden kan
// betjenes, hvor man bruger sin telefon paa 'standard' maaden".
//
// Specen vogter adfaerden i en rigtig browser, 390 px portraet og 844 x 390
// landscape:
//   1. ingen forfader til tabellen scroller lodret internt (ingen boks),
//   2. siden selv scroller, og sidste raekke kan naas ved at scrolle SIDEN,
//   3. portraet: overskriften foelger siden (sticky mod skaermens top),
//   4. Mit hold > Evner: den yderste evne-kolonne har luft til kortets kant,
//   5. traeningssiden (D-047-grenen, flaget training_mobile_table er slaaet
//      fra i mocken) har heller ingen boks.
// Siden kan aldrig scrolles vandret.
import { test, expect } from "./e2e-base.js";
import { corsHeaders, installNetworkMocks, json, login, stabilizePage, TEST_TEAM } from "./fixtures.js";
import { openStandings, TEAMS } from "./lib/standings-mobile-mock.ts";
import type { Page } from "@playwright/test";

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const VIEWPORTS = [
  { name: "portrait 390", ...PORTRAIT },
  { name: "landscape 844x390", ...LANDSCAPE },
];

/** Forfaedre til tabellen der scroller lodret internt — skal vaere tom. */
async function verticalBoxes(page: Page, tableSelector = "table"): Promise<string[]> {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    const boxes: string[] = [];
    for (let el = table?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      const scrolls = overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden";
      if (scrolls && el.scrollHeight > el.clientHeight + 1) {
        boxes.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 120)} (${el.clientHeight}/${el.scrollHeight})`);
      }
    }
    return boxes;
  }, tableSelector);
}

async function horizontalPageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("ranglisten", () => {
  for (const vp of VIEWPORTS) {
    test(`ingen boks, siden scroller til sidste hold (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openStandings(page, { founders: false });

      expect(await verticalBoxes(page)).toEqual([]);
      expect(await horizontalPageOverflow(page)).toBeLessThanOrEqual(1);

      // Siden er hoejere end skaermen, og sidste hold naas ved at scrolle SIDEN.
      const pageTaller = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
      expect(pageTaller).toBe(true);
      const lastRow = page.locator("table tbody tr").last();
      await expect(lastRow).toContainText(TEAMS[TEAMS.length - 1].name);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(lastRow).toBeInViewport();
    });
  }

  test("portraet: overskriften foelger siden mens man scroller", async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await openStandings(page, { founders: false });

    // Scroll saa tabellens top ligger 200 px over skaermen (tabellen er stadig
    // under overskriften), og maal hvor header-cellen staar.
    await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return;
      window.scrollTo(0, window.scrollY + table.getBoundingClientRect().top + 200);
    });
    const head = await page.evaluate(() => {
      const th = document.querySelector("table thead th");
      const table = document.querySelector("table");
      return {
        thTop: th?.getBoundingClientRect().top ?? NaN,
        tableTop: table?.getBoundingClientRect().top ?? NaN,
      };
    });
    expect(head.tableTop).toBeLessThan(-150);
    expect(Math.abs(head.thTop)).toBeLessThanOrEqual(1);
  });
});

test.describe("Mit hold > Evner", () => {
  for (const vp of VIEWPORTS) {
    test(`ingen boks, og yderste evne har luft til kanten (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await stabilizePage(page);
      await installNetworkMocks(page);
      await login(page);
      await page.goto("/team");
      await page.locator("table").first().waitFor();
      await page.getByRole("button", { name: "Evner", exact: true }).click();
      await expect(page.getByRole("button", { name: "Evner", exact: true })).toHaveAttribute("aria-pressed", "true");

      expect(await verticalBoxes(page)).toEqual([]);
      expect(await horizontalPageOverflow(page)).toBeLessThanOrEqual(1);

      // Den yderste celle i header og raekker: mindst 8 px til kortets kant
      // (compact-trinnet), ikke matrix-cellernes 4 px.
      const pads = await page.evaluate(() => {
        const table = document.querySelector("table");
        const lastTh = table?.querySelector("thead tr")?.lastElementChild;
        const lastTd = table?.querySelector("tbody tr")?.lastElementChild;
        return [lastTh, lastTd].map((el) => (el ? parseFloat(getComputedStyle(el).paddingRight) : NaN));
      });
      for (const pad of pads) expect(pad).toBeGreaterThanOrEqual(8);
    });
  }
});

// Traeningssiden, D-047-grenen (flaget training_mobile_table er IKKE sat i
// svaret — samme svar som en spiller der ikke er beta-tester faar, jf.
// 5124-training-mobile.spec.js). Den nye mobil-tabel (#3643) er ikke rort.
const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 2, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "vo2max", intensity: "hard" } },
  condition: { "rider-1": { form: 75, fatigue: 20, injured_until: null, risk: 0 } },
  progress: {},
  capped: {},
  trainability: {},
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

test.describe("traeningssiden", () => {
  for (const vp of VIEWPORTS) {
    test(`ingen boks om roster-tabellen (${vp.name})`, async ({ page }) => {
      await stabilizePage(page);
      await installNetworkMocks(page);
      await page.route("**/api/training/me**", (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
        return json(route, TRAINING_ME);
      });
      await login(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/training");
      await page.locator("table[data-sortable]").first().waitFor();

      expect(await verticalBoxes(page, "table[data-sortable]")).toEqual([]);
      expect(await horizontalPageOverflow(page)).toBeLessThanOrEqual(1);
    });
  }
});
