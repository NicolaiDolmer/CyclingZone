// Roadmap-voting (#954, Vote-fanen siden #6150): idéer har to 1-6-skalaer.
// Guards: (1) idéerne fra roadmap_items står på Vote-fanen, (2) skalaen kommer
// i to trin og der gemmes FØRST når begge er sat (upsert på user_id,item_id),
// (3) en eksisterende stemme pre-selecter knapperne, (4) "Gemt" vises,
// (5) kun egne stemmer bruges (#1599).
import { test, expect } from "./e2e-base.js";
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

const IDEA = "God idé?";
const IMPORTANCE = "Vigtigt for dig?";
const ONLY_UNRATED = "Kun det jeg ikke har bedømt";

async function setup(page, votePosts, votes = [EXISTING_VOTE]) {
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
      const body = JSON.parse(request.postData() || "{}");
      votePosts.push(Array.isArray(body) ? body[0] : body);
      return json(route, []);
    }
    voteGetUrl = request.url();
    return json(route, votes);
  });

  await login(page);
  await page.goto("/roadmap?tab=vote");
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  return { voteGetUrl: () => voteGetUrl };
}

test("idéer viser skalaen i to trin og gemmer først når begge er sat (#954, #6150)", async ({ page }) => {
  const votePosts = [];
  await setup(page, votePosts);

  const racesItem = page.locator("li", { hasText: ROADMAP_ITEMS[0].title_da });
  await expect(racesItem).toBeVisible();

  // Trin 1: kun "God idé?" står fremme.
  await expect(racesItem.getByRole("radiogroup", { name: IMPORTANCE })).toHaveCount(0);
  await racesItem.getByRole("radiogroup", { name: IDEA })
    .getByRole("radio", { name: "5", exact: true }).click();
  expect(votePosts).toHaveLength(0);

  // Trin 2 folder ud; anden akse → upsert med begge scores + kvittering.
  await racesItem.getByRole("radiogroup", { name: IMPORTANCE })
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

test("eksisterende stemme pre-selecter begge akser, når filteret er slået fra (#954)", async ({ page }) => {
  const votePosts = [];
  await setup(page, votePosts);

  // Filteret er slået til som standard og skjuler det allerede bedømte punkt.
  const marketItem = page.locator("li", { hasText: ROADMAP_ITEMS[1].title_da });
  await expect(marketItem).toHaveCount(0);
  await page.getByLabel(ONLY_UNRATED).uncheck();
  await expect(marketItem).toBeVisible();

  await expect(
    marketItem.getByRole("radiogroup", { name: IDEA }).getByRole("radio", { name: "2", exact: true })
  ).toBeChecked();
  await expect(
    marketItem.getByRole("radiogroup", { name: IMPORTANCE }).getByRole("radio", { name: "3", exact: true })
  ).toBeChecked();
});

test("pre-selecter KUN egne stemmer, andres lækker ikke ind (#1599 privacy)", async ({ page }) => {
  // GET: simulér en backend (fx admin-RLS-undtagelse OR is_admin()) der
  // returnerer BÅDE egen og en ANDEN brugers stemme. Frontend må kun bruge egen.
  const { voteGetUrl } = await setup(page, [], [EXISTING_VOTE, OTHER_USER_VOTE]);
  await page.getByLabel(ONLY_UNRATED).uncheck();

  // (1) Egen stemme (rm-market-1) pre-selecter korrekt (beviser at fetch+filter kørte).
  const marketItem = page.locator("li", { hasText: ROADMAP_ITEMS[1].title_da });
  await expect(
    marketItem.getByRole("radiogroup", { name: IDEA }).getByRole("radio", { name: "2", exact: true })
  ).toBeChecked();

  // (2) Forsvars-lag 1: querien filtrerer på user_id.
  expect(voteGetUrl()).toContain("user_id=eq.");

  // (3) Forsvars-lag 2: den ANDEN brugers stemme på rm-races-1 må IKKE pre-selecte,
  // og punktet står stadig i trin 1 (kun "God idé?").
  const racesItem = page.locator("li", { hasText: ROADMAP_ITEMS[0].title_da });
  await expect(
    racesItem.getByRole("radiogroup", { name: IDEA }).getByRole("radio", { name: "6", exact: true })
  ).not.toBeChecked();
  await expect(racesItem.getByRole("radiogroup", { name: IMPORTANCE })).toHaveCount(0);
});
