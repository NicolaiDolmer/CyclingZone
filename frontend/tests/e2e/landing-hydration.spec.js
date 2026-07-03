import { expect, test } from "@playwright/test";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// Hydration-guard for den prerendrede landing (dist/index.html).
//
// prerender.mjs renderer ALTID landing på engelsk (render("/", "en")). En
// da-besøgende har cz_lang="da" i localStorage FØR boot, så i18next's
// LanguageDetector vælger dansk før React monterer. Uden hydration-fixet
// renderer klientens hydrerings-pass derfor dansk mod engelsk server-HTML →
// React #418 (hydration failed) / #422 (Suspense → client render) / #425 (text
// content mismatch) logges i konsollen, og prerender-gevinsten smides væk for
// præcis de brugere.
//
// stabilizePage() sætter cz_lang="da" (samme init-script som resten af suiten),
// så denne test reproducerer prod-scenariet 1:1 mod preview-buildet (statisk
// dist/, prerendret index.html). Fixet skal hydrere mod EN og skifte til den
// besøgendes sprog FØRST efter hydration → ren konsol.

const HYDRATION_ERROR = /Minified React error #(418|422|423|425)|Hydration failed|hydrat|did not match|server[- ]rendered/i;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("prerendered landing hydrates cleanly for a Danish visitor (no #418/#422/#425)", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  // Landing hydrerede uden at blæse op (hero-overskrift synlig) …
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // … og skiftede til dansk EFTER hydration (post-hydration language-switch).
  await expect(page.locator("header")).toContainText("Log ind");
  await expect(page.getByText("Sådan spiller du")).toBeVisible();

  // Giv en evt. mismatch tid til at nå konsollen før vi asserter.
  await page.waitForTimeout(300);

  const hydrationErrors = errors.filter((e) => HYDRATION_ERROR.test(e));
  expect(
    hydrationErrors,
    `landing loggede hydration-fejl:\n${hydrationErrors.join("\n") || "(ingen)"}`,
  ).toEqual([]);
});
