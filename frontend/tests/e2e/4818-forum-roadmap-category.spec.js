// #4818 (ejer-direktiv 4/9 + afklaring 8/9: "kun jeg opretter, alle svarer")
// · Roadmap-kategorien paa forummet. Denne spec daekker praecis det gaten
// tilfoejer, og som ingen anden spec rammer:
//
//   1. Roadmap ligger OEVERST i fanerraekken (efter "All").
//   2. Som ikke-admin: ingen "New post"-knap paa roadmap-fanen, men en kort
//      forklaringslinje i stedet — og knappen er der stadig paa alle andre faner.
//   3. Som admin: knappen er synlig paa roadmap-fanen, og roadmap staar oeverst
//      i compose-modalens kategori-vaelger.
//   4. Som ikke-admin er roadmap slet ikke et valg i compose-modalen.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

// ForumPage laeser rollen med supabase.from("users").select("role") — mocken
// registreres OVEN PAA installNetworkMocks (senest registrerede route vinder).
async function setRole(page, role) {
  await page.route("**/rest/v1/users**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    const row = { id: "e2e-user", role };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify(wantsObject ? row : [row]),
    });
  });
}

const NEW_POST = /^(New post|Nyt opslag)$/;
const ROADMAP_TAB = /^Roadmap$/;

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("roadmap ligger oeverst i fanerraekken", async ({ page }) => {
  await setRole(page, "user");
  await login(page);
  await page.goto("/forum");

  // Scoped paa fanerraekkens eget aria-label: paa desktop findes ogsaa
  // sidebarens <nav>, og en unavngiven getByRole("navigation") ramte den.
  const tabs = page
    .getByRole("navigation", { name: /^(Category|Kategori)$/ })
    .getByRole("button");
  await expect(tabs.first()).toHaveText(/^(All|Alle)$/);
  // Foerste rigtige kategori efter "All" skal vaere Roadmap (#4818).
  await expect(tabs.nth(1)).toHaveText(ROADMAP_TAB);
});

test("ikke-admin: ingen 'New post' paa roadmap-fanen, men en forklaring", async ({ page }) => {
  await setRole(page, "user");
  await login(page);
  await page.goto("/forum");

  // Paa "All" er knappen der — gaten maa ikke laase hele siden.
  await expect(page.getByRole("button", { name: NEW_POST })).toBeVisible();

  await page.getByRole("button", { name: ROADMAP_TAB }).click();
  await expect(page).toHaveURL(/category=roadmap/);
  await expect(page.getByRole("button", { name: NEW_POST })).toHaveCount(0);
  await expect(page.getByText(/Only I post here|Kun jeg slår op her/)).toBeVisible();
  // Kategori-beskrivelsen staar for alle, ogsaa naar reglen er skjult (admin).
  await expect(page.getByText(/Where the game is going|Hvor spillet er på vej hen/)).toBeVisible();

  // Tilbage paa en aaben kategori er knappen tilbage.
  await page.getByRole("button", { name: /^(General|Generelt)$/ }).click();
  await expect(page.getByRole("button", { name: NEW_POST })).toBeVisible();
});

test("ikke-admin: roadmap kan ikke vaelges i compose-modalen", async ({ page }) => {
  await setRole(page, "user");
  await login(page);
  await page.goto("/forum");

  await page.getByRole("button", { name: NEW_POST }).click();
  const picker = page.getByRole("group", { name: /^(Category|Kategori)$/ });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: ROADMAP_TAB })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: /^(General|Generelt)$/ })).toBeVisible();
});

test("admin: knappen er synlig paa roadmap-fanen og kategorien kan vaelges", async ({ page }) => {
  await setRole(page, "admin");
  await login(page);
  await page.goto("/forum?category=roadmap");

  await expect(page.getByRole("button", { name: NEW_POST })).toBeVisible();
  await expect(page.getByText(/Only I post here|Kun jeg slår op her/)).toHaveCount(0);
  // Beskrivelsen bliver staaende for ejeren — det er kategoriens undertekst,
  // ikke en begraensning rettet mod spilleren.
  await expect(page.getByText(/Where the game is going|Hvor spillet er på vej hen/)).toBeVisible();

  await page.getByRole("button", { name: NEW_POST }).click();
  const picker = page.getByRole("group", { name: /^(Category|Kategori)$/ });
  // Modalen aabner PAA roadmap, fordi fanen var roadmap.
  const roadmapChoice = picker.getByRole("button", { name: ROADMAP_TAB });
  await expect(roadmapChoice).toBeVisible();
  await expect(roadmapChoice).toHaveAttribute("aria-pressed", "true");
});

test("alle kan svare i en roadmap-traad", async ({ page }) => {
  await setRole(page, "user");
  await login(page);
  await page.goto("/forum/forum-roadmap-1");

  await expect(page.getByRole("heading", { name: "What I am building next" })).toBeVisible();
  // Svar-feltet er UAENDRET i roadmap-kategorien — det er hele pointen i
  // ejer-afklaringen 8/9 ("alle svarer").
  await expect(page.getByRole("button", { name: /^(Reply|Svar)$/ })).toBeVisible();
});
