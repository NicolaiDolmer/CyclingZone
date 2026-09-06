import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, json, login, stabilizePage, TEST_TEAM } from "./fixtures.js";

// Regression for #792: hvis team-create-requesten fejler (CORS, backend nede,
// non-JSON-svar) må "Opret hold"-knappen ALDRIG hænge i loading-state. Den skal
// vise en tydelig fejl og blive klikbar igen.
test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);

  // Team uden manager_name → Layout's needsSetup bliver true → wizard'en tvinges
  // frem. Vi override'r kun Layout's "mit hold"-kald (id: user_id=eq.<uid>);
  // array-kald og writes falder igennem til de delte mocks.
  //
  // #4869: identificeres via user_id=eq.-filteret i URL'en, IKKE længere via
  // Accept-headeren — .maybeSingle() (Layout's team-load skiftede fra .single()
  // i #4869) sender ikke application/vnd.pgrst.object+json, så et rent
  // Accept-baseret tjek ramte aldrig denne gren og lækkede fallback()'s
  // ufiltrerede array igennem til Layout, som fejlagtigt konkluderede "intet
  // hold" og forsøgte en anden opsætnings-sti.
  await page.route("**/rest/v1/teams**", async (route) => {
    const request = route.request();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    const isMineQuery = request.method() === "GET" && /user_id=eq\.[^&]+/.test(request.url());
    if (isMineQuery) {
      const mine = { ...TEST_TEAM, manager_name: null };
      return json(route, wantsObject ? mine : [mine]);
    }
    return route.fallback();
  });
});

test("setup wizard surfaces an error and re-enables submit when team-create fails (#792)", async ({ page }) => {
  // Lad team-create-requesten afvise på netværksniveau (svarer til CORS/backend nede).
  await page.route("**/api/teams/my", (route) => route.abort("failed"));

  await login(page);

  // Wizard'en er fremme (DA-locale via stabilizePage).
  await expect(page.getByRole("heading", { name: "Velkommen til Cycling Zone" })).toBeVisible();

  const submit = page.getByRole("button", { name: /Opret hold og start/ });
  await page.getByPlaceholder("f.eks. Team Nordic").fill("Mit Nye Hold");
  await page.getByPlaceholder("f.eks. Lars Hansen").fill("Test Manager");
  await submit.click();

  // Tydelig fejl vises — ikke en evig spinner.
  await expect(
    page.getByText("Kunne ikke nå serveren. Tjek din forbindelse og prøv igen.")
  ).toBeVisible();

  // Knappen er klikbar igen (saving nulstillet i finally) og viser ikke loading-tekst.
  await expect(submit).toBeEnabled();
  await expect(submit).not.toHaveText(/Gemmer/);
});
