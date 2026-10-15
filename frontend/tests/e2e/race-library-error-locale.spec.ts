import { test, expect } from "./e2e-base.js";
import { prepareLibrary } from "./race-library.fixture.ts";
for (const language of ["da", "en"] as const) {
  test("library error title uses the active " + language + " locale", async ({ page }) => {
    await prepareLibrary(page, { fail: true });
    await page.goto("/resultater?tab=archive");
    await expect(page.getByRole("alert")).toBeVisible();
    if (language === "en") {
      await page.evaluate(async () => {
        await (
          window as unknown as { __i18n: { changeLanguage: (locale: string) => Promise<void> } }
        ).__i18n.changeLanguage("en");
      });
      await expect(page.getByRole("heading", { name: "Race library", exact: true })).toBeVisible();
    }
    await expect(page.getByRole("alert").locator("p").first()).toHaveText(
      language === "da" ? "Fejl" : "Error"
    );
  });
}
