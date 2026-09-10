// #5102 / D-047 — mobilstandarden for T2-tabeller, som ADFAERD.
//
// Kildetesten (src/components/ui/dataTable.source.test.js) vogter markuppen;
// denne spec vogter de fire loefter beslutningen giver spilleren, i en rigtig
// browser i mobil-viewportet:
//
//   1. ingen vandret scroll i standardtilstanden — heller ikke med et langt
//      rytternavn og et 8-cifret beloeb (review-fundet: "kun tilfaeldigt
//      opfyldt af testdata" med een raekke og et 13-tegns navn),
//   2. raekkens handling kan trykkes UDEN at aabne "Fuld tabel" foerst,
//   3. et chip-tryk flytter ikke chippen under fingeren,
//   4. "Fuld tabel" er neutral, aldrig gold (TASTE P3: een gold pr. view).
//
// Desktop-projekterne springer over: standardtilstanden findes kun <=640px.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const FULL_TABLE = /^(Full table|Fuld tabel)$/;
const SELL_BUTTON = /^(Sell \/ Auction|Sælg \/ Auktion)$/;

test.describe("D-047 mobilstandard for DataTable (#5102)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 640, "standardtilstanden findes kun <=640px");
    await stabilizePage(page);
    await installNetworkMocks(page);
    await login(page);
    await page.goto("/team");
    await page.locator("table").first().waitFor();
  });

  test("standardtilstanden scroller ikke vandret, heller ikke med et langt navn og et stort tal", async ({ page }) => {
    const overflow = async () =>
      page.evaluate(() => {
        const table = document.querySelector("table");
        const scroller = table?.parentElement;
        return {
          scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
          page: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

    const before = await overflow();
    expect(before.scroller).toBeLessThanOrEqual(1);
    expect(before.page).toBeLessThanOrEqual(1);

    // Presset: et urealistisk langt navn og et 8-cifret beloeb i samme raekke.
    // Fixturen har eet kort navn, saa uden dette maaler vi kun heldet.
    await page.evaluate(() => {
      const row = document.querySelector("table tbody tr");
      if (!row) return;
      const cells = row.querySelectorAll("td");
      const name = cells[0]?.querySelector("a") ?? cells[0];
      if (name) name.textContent = "Bartholomew Vandenbroucke-Villanueva";
      const last = cells[cells.length - 2];
      if (last) last.textContent = "99.999.999";
    });

    const after = await overflow();
    expect(after.scroller).toBeLessThanOrEqual(1);
    expect(after.page).toBeLessThanOrEqual(1);
  });

  test("raekkens handling kan trykkes uden at aabne Fuld tabel foerst", async ({ page }) => {
    const fullTable = page.getByRole("button", { name: FULL_TABLE });
    await expect(fullTable).toHaveAttribute("aria-pressed", "false");
    // Sidens primaere handling ER en af de tre standardkolonner (D-047).
    await expect(page.getByRole("button", { name: SELL_BUTTON }).first()).toBeVisible();
  });

  test("et chip-tryk aendrer valget, men ikke chip-raekkens raekkefoelge", async ({ page }) => {
    const chips = page.getByRole("group").getByRole("button");
    const before = await chips.allInnerTexts();
    expect(before.length).toBeGreaterThan(3);

    // Foerste chip der ikke allerede er valgt.
    let target = -1;
    for (let i = 0; i < before.length; i += 1) {
      if ((await chips.nth(i).getAttribute("aria-pressed")) === "false") {
        target = i;
        break;
      }
    }
    expect(target).toBeGreaterThan(-1);
    await chips.nth(target).click();

    await expect(chips.nth(target)).toHaveAttribute("aria-pressed", "true");
    // Raekkefoelgen er den samme: chippen man trykkede paa staar stadig samme
    // sted, saa naeste tryk paa samme skaermposition rammer samme kolonne.
    expect(await chips.allInnerTexts()).toEqual(before);
  });

  test("Fuld tabel er en neutral kontrol, ikke sidens gold primary", async ({ page }) => {
    const fullTable = page.getByRole("button", { name: FULL_TABLE });
    const cls = (await fullTable.getAttribute("class")) ?? "";
    expect(cls).not.toMatch(/cz-accent/);

    // Og den virker: to-lags-tilstanden aabner med navneblok + datablok.
    await fullTable.click();
    await expect(fullTable).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("table")).toHaveCount(2);
  });
});
