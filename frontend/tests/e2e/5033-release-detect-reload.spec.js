import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// #5033 — lag 3 af chunk-fejl-forsvaret (CYCLINGZONE-56).
//
// Scenariet der maales: en spiller har en fane aaben fra release A, der bliver
// deployet release B, og spilleren navigerer. Uden dette lag ville
// client-side-navigationen lazy-loade et chunk fra A's asset-graf, som ikke
// findes laengere. Med laget opdager appen B og laver et fuldt dokument-load.
//
// De "to mockede meta-versioner" fra issue-designet:
//   · dokumentets <meta name="cz-release"> = klientens EGEN release
//   · /version.json = den release edgen serverer lige nu
// Testen skruer paa de to uafhaengigt af hinanden.

const CLIENT_RELEASE = "e2e-release-a";

// Hver page-load taeller sig selv op i sessionStorage (som overlever et reload i
// samme fane). Det er den eneste maaling der skelner "fuldt dokument-load" fra
// "client-side navigation" uden at gaette paa timing.
const LOAD_COUNTER_KEY = "cz_e2e_document_loads";

async function setupReleaseHarness(page, { servedRelease }) {
  await page.addInitScript((key) => {
    try {
      const next = Number(window.sessionStorage.getItem(key) || 0) + 1;
      window.sessionStorage.setItem(key, String(next));
    } catch {
      // sessionStorage utilgaengelig — testen fejler paa assertionen i stedet.
    }
  }, LOAD_COUNTER_KEY);

  // Klientens egen release: injiceres i den serverede HTML, praecis som
  // `cz-release-meta`-pluginet goer i et rigtigt build (det lokale e2e-build har
  // ingen commit-sha, saa meta-tagget staar tomt).
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    const patched = html.includes('name="cz-release"')
      ? html.replace(/name="cz-release"\s+content="[^"]*"/, `name="cz-release" content="${CLIENT_RELEASE}"`)
      : html.replace("<head>", `<head><meta name="cz-release" content="${CLIENT_RELEASE}">`);
    return route.fulfill({ response, body: patched });
  });

  // Edgens release.
  await page.route("**/version.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ release: servedRelease }),
    }),
  );
}

async function documentLoads(page) {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) || 0), LOAD_COUNTER_KEY);
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("ny release ved navigation giver ét fuldt dokument-load", async ({ page }) => {
  await setupReleaseHarness(page, { servedRelease: "e2e-release-b" });

  await page.goto("/");
  await expect(page.locator("#root")).toBeVisible();
  expect(await documentLoads(page)).toBe(1);

  // Client-side navigation (react-router <Link>) — udloeser release-tjekket.
  await page.locator('a[href="/login"]').first().click();

  // Reloadet er assign() paa den URL brugeren netop navigerede til: samme rute,
  // men hentet som et nyt dokument med den nye asset-graf.
  await expect.poll(() => documentLoads(page), { timeout: 15_000 }).toBe(2);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("#root")).toBeVisible();

  // Loop-guarden er braendt for netop den maal-release.
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("cz:app-version-reload:e2e-release-b")),
  ).toBe("1");

  // Og den holder: version.json melder stadig release B, saa den nye side
  // opdager "en ny release" igen ved naeste navigation — men loop-guarden giver
  // ikke et reload nummer to. Uden den ville fanen genindlaese i ring.
  await page.locator('a[href="/privatlivspolitik"], a[href="/privacy-policy"]').first().click();
  await expect(page).toHaveURL(/privatlivspolitik|privacy-policy/);
  await page.waitForTimeout(2000);
  expect(await documentLoads(page)).toBe(2);
});

test("samme release ved navigation genindlaeser ikke", async ({ page }) => {
  await setupReleaseHarness(page, { servedRelease: CLIENT_RELEASE });

  await page.goto("/");
  await expect(page.locator("#root")).toBeVisible();

  await page.locator('a[href="/login"]').first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForTimeout(1500);

  expect(await documentLoads(page)).toBe(1);
  expect(
    await page.evaluate(() =>
      window.sessionStorage.getItem(`cz:app-version-reload:${"e2e-release-a"}`),
    ),
  ).toBe(null);
});
