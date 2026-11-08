// Ved ikke på /roadmap (#7788). Guards: ét Ved ikke pr. punkt på Stem og Plan,
// tal vises ikke, et valgt tal slukker knappen, punktet er besvaret ved næste
// besøg, og 390 px uden vandret scroll.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath, TEST_USER } from "./fixtures.js";

const IDEA_ID = "7788-idea";
const PLANNED_ID = "7788-planned";
const OTHER_IDEA_ID = "7788-other";
const IDEA_TITLE = "Eksempel på en idé.";
const PLANNED_TITLE = "Eksempel på et planlagt punkt.";
const OTHER_IDEA_TITLE = "Eksempel på en anden idé.";

const roadmapItem = (id: string, status: string, title: string, sortOrder: number) => ({
  id, engine: "races", sort_order: sortOrder, title_en: title, title_da: title, approved: true, status,
  horizon: "season_5", beta_since: null, beta_soon: false, live_soon: false,
  created_at: "2026-10-01T08:00:00Z", shipped_at: null, issue_ref: null,
});
const ITEMS = [
  roadmapItem(PLANNED_ID, "planned", PLANNED_TITLE, 10),
  roadmapItem(IDEA_ID, "active", IDEA_TITLE, 20),
  roadmapItem(OTHER_IDEA_ID, "active", OTHER_IDEA_TITLE, 30),
];
const dontKnowRow = (itemId: string) => ({ item_id: itemId, idea_score: null, importance_score: null, user_id: TEST_USER.id });

type VotePost = Record<string, unknown>;
interface OpenOptions {
  tab: string;
  votes?: ReturnType<typeof dontKnowRow>[];
  posts?: VotePost[];
  fail?: boolean;
  onlyUnrated?: boolean;
}

async function open(page: Page, { tab, votes = [], posts = [], fail = false, onlyUnrated = false }: OpenOptions) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/roadmap_items*", route => json(route, ITEMS));
  await page.route("**/rest/v1/roadmap_votes*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      posts.push(Array.isArray(body) ? body[0] : body);
      if (fail) return json(route, { message: "null value in column importance_score" }, 400);
      return json(route, []);
    }
    return json(route, votes);
  });
  await page.addInitScript(value => window.localStorage.setItem("cz_roadmap_only_unrated", value), onlyUnrated ? "1" : "0");
  await login(page);
  await page.goto(`/roadmap?tab=${tab}`);
}

const row = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });
const dontKnow = (scope: Page | Locator) => scope.getByRole("button", { name: "Ved ikke" });

const shot = (page: Page, name: string) => page.screenshot({ path: evidenceShotPath(`pr-screens/7788/${name}.png`) });

test("Stem: Ved ikke gemmer én række uden tal og slukker kladden", async ({ page }) => {
  const posts: VotePost[] = [];
  await open(page, { tab: "vote", posts });
  const idea = row(page, IDEA_TITLE);

  // Et halvt svar: trin 2 folder ud, og intet er gemt endnu.
  await idea.getByRole("radiogroup", { name: "God idé?" }).getByRole("radio", { name: "5" }).click();
  await expect(idea.getByRole("radiogroup", { name: "Vigtigt for dig?" })).toBeVisible();
  expect(posts).toHaveLength(0);

  await dontKnow(idea).click();
  await expect(dontKnow(idea)).toHaveAttribute("aria-pressed", "true");
  await expect(idea.getByText("Gemt")).toBeVisible();
  await expect(idea.getByRole("radiogroup", { name: "Vigtigt for dig?" })).toHaveCount(0);
  await expect(idea.getByRole("radio", { checked: true })).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ item_id: IDEA_ID, user_id: TEST_USER.id, idea_score: null, importance_score: null });

  // Ét svar pr. punkt: et tryk mere sender ikke noget.
  await dontKnow(idea).click();
  expect(posts).toHaveLength(1);

  // Mangler dit svar tæller kun den anden idé nu.
  await expect(page.getByText("1 af 2 mangler dit svar")).toBeVisible();
});

test("Stem: et valgt tal slukker Ved ikke, og begge tal erstatter det", async ({ page }) => {
  const posts: VotePost[] = [];
  await open(page, { tab: "vote", posts, votes: [dontKnowRow(IDEA_ID)] });
  const idea = row(page, IDEA_TITLE);
  await expect(dontKnow(idea)).toHaveAttribute("aria-pressed", "true");

  await idea.getByRole("radiogroup", { name: "God idé?" }).getByRole("radio", { name: "4" }).click();
  await expect(dontKnow(idea)).toHaveAttribute("aria-pressed", "false");
  await idea.getByRole("radiogroup", { name: "Vigtigt for dig?" }).getByRole("radio", { name: "6" }).click();
  await expect(idea.getByText("Gemt")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ item_id: IDEA_ID, idea_score: 4, importance_score: 6 });
});

test("Plan: Ved ikke virker på et planlagt punkt og kan skiftes til et tal", async ({ page }) => {
  const posts: VotePost[] = [];
  await open(page, { tab: "plan", posts });
  const planned = row(page, PLANNED_TITLE);

  await dontKnow(planned).click();
  await expect(dontKnow(planned)).toHaveAttribute("aria-pressed", "true");
  expect(posts[0]).toMatchObject({ item_id: PLANNED_ID, idea_score: null, importance_score: null });

  await planned.getByRole("radio", { name: "3" }).click();
  await expect(dontKnow(planned)).toHaveAttribute("aria-pressed", "false");
  expect(posts[1]).toMatchObject({ item_id: PLANNED_ID, importance_score: 3 });
  expect("idea_score" in posts[1]).toBe(false);
});

test("Et gemt Ved ikke er besvaret: punktet er væk fra kun ubedømte ved næste besøg", async ({ page }) => {
  await open(page, { tab: "vote", onlyUnrated: true, votes: [dontKnowRow(IDEA_ID), dontKnowRow(PLANNED_ID)] });
  await expect(row(page, OTHER_IDEA_TITLE)).toBeVisible();
  await expect(row(page, IDEA_TITLE)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /^Plan/ })).toHaveText(/^\D+$/);
});

test("Fejler gemningen, står svaret ikke som valgt", async ({ page }) => {
  await open(page, { tab: "vote", fail: true });
  const idea = row(page, IDEA_TITLE);
  await dontKnow(idea).click();
  await expect(idea.getByText("Din stemme blev ikke gemt. Prøv igen.")).toBeVisible();
  await expect(dontKnow(idea)).toHaveAttribute("aria-pressed", "false");
});

test("Fra desktop står Ved ikke på linje med skalaen", async ({ page }) => {
  await open(page, { tab: "vote", votes: [dontKnowRow(IDEA_ID)] });
  const idea = row(page, IDEA_TITLE);
  const scale = await idea.getByRole("radiogroup", { name: "God idé?" }).boundingBox();
  const button = await dontKnow(idea).boundingBox();
  expect(Math.abs((button?.x ?? 0) - (scale?.x ?? 1000))).toBeLessThanOrEqual(1);
  await shot(page, "stem-desktop");
});

test("Admin ser antallet pr. punkt og samlet, og et punkt med lutter Ved ikke står på Stemmer", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const score = (id: string, title: string, votes: number, dontKnowCount: number) => ({
    item_id: id, engine: "races", approved: true, title_en: title, title_da: title, status: "planned", horizon: "next_week",
    sort_order: 10, votes, avg_importance: votes ? 4 : null, steering_score: null, sd_importance: 0, dont_know: dontKnowCount,
  });
  await page.route(/\/rest\/v1\/(users|roadmap_item_scores|roadmap_items|known_issue_scores|known_issue_updates)/, route => {
    const url = route.request().url();
    if (url.includes("/users")) {
      const user = { ...TEST_USER, role: "admin", username: "Admin fixture" };
      return json(route, (route.request().headers().accept || "").includes("vnd.pgrst.object") ? user : [user]);
    }
    if (url.includes("/roadmap_item_scores")) return json(route, [score("a", "Punkt med tal", 3, 2), score("b", "Lutter Ved ikke", 0, 4)]);
    return json(route, []);
  });
  await page.route("**/api/admin/roadmap/stats", route => json(route, {
    stats: { voters: 3, voters_14d: 3, votes_total: 3, voted_all: 1, managed_teams: 10 },
  }));
  await page.route("**/api/admin/feature-flags*", route => json(route, { flags: [] }));
  await login(page);
  await page.goto("/admin/growth?tab=roadmap&view=votes");

  await expect(page.getByText("6 Ved ikke", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ved ikke" })).toBeVisible();
  await expect(page.getByText("Lutter Ved ikke", { exact: true })).toBeVisible();
  await shot(page, "admin-stemmer");
});

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Ved ikke står under skalaen, uden vandret scroll og med en trykflade på mindst 34 px", async ({ page }) => {
    await open(page, { tab: "vote" });
    const idea = row(page, IDEA_TITLE);
    await idea.getByRole("radiogroup", { name: "God idé?" }).getByRole("radio", { name: "5" }).click();
    await shot(page, "stem-390-kladde");
    await dontKnow(idea).click();
    await expect(dontKnow(idea)).toHaveAttribute("aria-pressed", "true");
    await shot(page, "stem-390-ved-ikke");

    const box = await dontKnow(idea).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(34);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto("/roadmap?tab=plan");
    await expect(dontKnow(row(page, PLANNED_TITLE))).toBeVisible();
    await shot(page, "plan-390");
  });
});
