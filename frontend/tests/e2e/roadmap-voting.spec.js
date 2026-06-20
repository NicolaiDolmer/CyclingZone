// Roadmap-voting (#954): /roadmap rendrer DB-items med dual-akse 1-6-voting.
// Guards: (1) items fra roadmap_items erstatter de statiske i18n-bullets,
// (2) der gemmes FØRST når begge akser er sat (upsert på user_id,item_id),
// (3) eksisterende stemme pre-selecter knapperne, (4) "Gemt"-kvittering vises.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  json,
  corsHeaders,
  ROADMAP_ITEMS,
  TEST_USER,
} from "./fixtures.js";

const EXISTING_VOTE = { item_id: "rm-market-1", idea_score: 2, importance_score: 3, user_id: TEST_USER.id };
const OTHER_USER_VOTE = { item_id: "rm-races-1", idea_score: 6, importance_score: 6, user_id: "99999999-9999-4999-8999-999999999999" };

async function setup(page, votePosts) {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Registreret EFTER installNetworkMocks → vinder routing for votes-tabellen.
  await page.route("**/rest/v1/roadmap_votes*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      votePosts.push(Array.isArray(body) ? body[0] : body);
      return json(route, []);
    }
    return json(route, [EXISTING_VOTE]);
  });

  await login(page);
  await page.goto("/roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
}

test("voting gemmer først når begge akser er sat, og kvitterer med Gemt (#954)", async ({ page }) => {
  const votePosts = [];
  await setup(page, votePosts);

  // DB-items rendres (DA-locale fra stabilizePage) — ikke det statiske fallback.
  const racesItem = page.locator("li", { hasText: ROADMAP_ITEMS[0].title_da });
  await expect(racesItem).toBeVisible();

  // Én akse alene udløser ingen save.
  await racesItem.getByRole("radiogroup", { name: "Hvor god en idé?" })
    .getByRole("radio", { name: "5", exact: true }).click();
  expect(votePosts).toHaveLength(0);

  // Anden akse → upsert med begge scores + kvittering.
  await racesItem.getByRole("radiogroup", { name: "Hvor vigtigt er det for dig?" })
    .getByRole("radio", { name: "6", exact: true }).click();
  await expect(racesItem.getByText("Gemt")).toBeVisible();

  expect(votePosts).toHaveLength(1);
  expect(votePosts[0]).toMatchObject({
    item_id: "rm-races-1",
    user_id: TEST_USER.id,
    idea_score: 5,
    importance_score: 6,
  });
});

test("eksisterende stemme pre-selecter begge akser (#954)", async ({ page }) => {
  const votePosts = [];
  await setup(page, votePosts);

  const marketItem = page.locator("li", { hasText: ROADMAP_ITEMS[1].title_da });
  await expect(marketItem).toBeVisible();

  await expect(
    marketItem.getByRole("radiogroup", { name: "Hvor god en idé?" })
      .getByRole("radio", { name: "2", exact: true })
  ).toBeChecked();
  await expect(
    marketItem.getByRole("radiogroup", { name: "Hvor vigtigt er det for dig?" })
      .getByRole("radio", { name: "3", exact: true })
  ).toBeChecked();

  // Engangs-bevis til ejer-verify (umasket, gitignored test-results/).
  await page.screenshot({ path: "test-results/roadmap-voting-proof.png", fullPage: true });
});

test("pre-selecter KUN egne stemmer — andres lækker ikke ind (#1599 privacy)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  let voteGetUrl = null;
  // Registreret EFTER installNetworkMocks → vinder routing for votes-tabellen.
  await page.route("**/rest/v1/roadmap_votes*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() === "POST") {
      return json(route, []);
    }
    // GET: simulér en backend (fx admin-RLS-undtagelse OR is_admin()) der
    // returnerer BÅDE egen og en ANDEN brugers stemme. Frontend må kun bruge egen.
    voteGetUrl = request.url();
    return json(route, [EXISTING_VOTE, OTHER_USER_VOTE]);
  });

  await login(page);
  await page.goto("/roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();

  // (1) Egen stemme (rm-market-1) pre-selecter korrekt (beviser at fetch+filter kørte).
  const marketItem = page.locator("li", { hasText: ROADMAP_ITEMS[1].title_da });
  await expect(
    marketItem.getByRole("radiogroup", { name: "Hvor god en idé?" })
      .getByRole("radio", { name: "2", exact: true })
  ).toBeChecked();

  // (2) Forsvars-lag 1: querien filtrerer på user_id.
  expect(voteGetUrl).toContain("user_id=eq.");

  // (3) Forsvars-lag 2: den ANDEN brugers stemme på rm-races-1 må IKKE pre-selecte.
  const racesItem = page.locator("li", { hasText: ROADMAP_ITEMS[0].title_da });
  await expect(
    racesItem.getByRole("radiogroup", { name: "Hvor god en idé?" })
      .getByRole("radio", { name: "6", exact: true })
  ).not.toBeChecked();
});
