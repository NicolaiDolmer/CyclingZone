import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login } from "./fixtures.js";

// Forward-guard for #2795-opfoelgningen.
//
// Markeringen "det her er dit hold" laa foer som
//   inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)
// paa selve <tr>. Den var i praksis usynlig af to grunde, og ingen af dem var
// farven: box-shadow paa en <tr> males ikke paalideligt i en border-collapse-
// tabel, og .sticky-name-cell maler sin egen ugennemsigtige baggrund praecis
// dér hvor venstre kant skulle staa.
//
// Testen laaser TO ting, saa fejlen ikke kan snige sig tilbage:
//   1. raekken for eget hold baerer .cz-me (ikke en inline box-shadow)
//   2. foerste celle har en faktisk box-shadow i beregnet stil - altsaa at
//      markeringen naar hele vejen til rendering, ikke bare til klassenavnet
// og at en fremmed raekke IKKE har nogen af delene.

test.describe("Egen-hold-markering sidder paa cellerne (#2795)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("rytterranglisten markerer egne ryttere synligt", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellen; mobil bruger kort.");

    await login(page);
    await page.goto("/standings?tab=riders");
    await expect(page.locator("main")).toBeVisible();

    // Ada Pedersen koerer for E2E Racing (testholdet); Mikkel Hansen goer ikke.
    const mine = page.locator("table tbody tr", { hasText: "Ada Pedersen" }).first();
    const theirs = page.locator("table tbody tr", { hasText: "Mikkel Hansen" }).first();

    await expect(mine).toHaveClass(/cz-me/);
    await expect(theirs).not.toHaveClass(/cz-me/);

    // Selve renderingen, ikke bare klassenavnet: foerste celle SKAL have en
    // box-shadow. Var markeringen stadig paa <tr>, ville den her vaere "none".
    const shadow = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
    expect(shadow.trim()).not.toBe("");

    const theirShadow = await theirs.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(theirShadow).toBe("none");
  });

  test("stillingen markerer eget hold uden at spise leder-guldet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellen.");

    await login(page);
    await page.goto("/standings");
    await expect(page.locator("main")).toBeVisible();

    const mine = page.locator("table tbody tr", { hasText: "E2E Racing" }).first();
    const leader = page.locator("table tbody tr", { hasText: "Regression VC" }).first();

    await expect(mine).toHaveClass(/cz-me/);

    const shadow = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");

    // Lederen beholder sin guld-tint. Er lederen OGSAA eget hold, skifter
    // kaldestedet til .cz-me-bar netop for ikke at daekke guldet - saa en
    // leder-raekke maa aldrig baere den toningsgivende .cz-me.
    const leaderIsMine = await leader.evaluate(el => el.className.includes("cz-me"));
    if (leaderIsMine) {
      await expect(leader).toHaveClass(/cz-me-bar/);
      await expect(leader).not.toHaveClass(/cz-me(?!-bar)/);
    }
  });
});
