// Roadmap-hub (#5387, spor 2 #6150): /roadmap i fem faner.
// Guards: fane i URL + dyb-link, filteret og tælleren, Plan sender kun
// importance_score, "Rammer også mig" slår til og fra, udlogget ser ingen
// skalaer, /help?section=knownIssues viderestiller, og 375 px uden vandret scroll.
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

const PLANNED_TITLE = "Eksempel på et planlagt punkt.";
const CONFIRMED_TITLE = "Eksempel på en bekræftet fejl.";
const IMPORTANCE = "Vigtigt for dig?";

async function routeVotes(page, { posts = [], votes = [] } = {}) {
  await page.route("**/rest/v1/roadmap_votes*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      posts.push(Array.isArray(body) ? body[0] : body);
      return json(route, []);
    }
    return json(route, votes);
  });
}

async function routeReports(page, calls) {
  await page.route("**/rest/v1/known_issue_reports*", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "GET") return json(route, []);
    calls.push({ method: request.method(), url: request.url(), body: request.postData() });
    return route.fulfill({ status: 201, headers: corsHeaders(request), body: "" });
  });
}

async function loggedIn(page, opts = {}) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await routeVotes(page, opts);
  await login(page);
}

test("fane-skift opdaterer URL'en, og et dyb-link åbner den rigtige fane", async ({ page }) => {
  await loggedIn(page);
  await page.goto("/roadmap?tab=issues");
  await expect(page.getByRole("tab", { name: /Kendte fejl/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(CONFIRMED_TITLE)).toBeVisible();

  await page.getByRole("tab", { name: /Færdigt/ }).click();
  await expect(page).toHaveURL(/[?&]tab=done/);
  await expect(page.getByText("Eksempel på et færdigt punkt.")).toBeVisible();

  await page.getByRole("tab", { name: /Beta/ }).click();
  await expect(page).toHaveURL(/[?&]tab=beta/);
  await expect(page.getByText("Eksempel på et punkt i beta.")).toBeVisible();
  // I beta står kun på Beta-fanen, ikke under "I gang".
  await page.getByRole("tab", { name: /Plan/ }).click();
  await expect(page.getByText("Eksempel på et punkt i beta.")).toHaveCount(0);
  await expect(page.getByText("Eksempel på et punkt i gang.")).toBeVisible();
});

test("Plan sender kun importance_score, og filteret skjuler et besvaret punkt ved næste besøg", async ({ page }) => {
  const posts = [];
  await loggedIn(page, { posts });
  await page.goto("/roadmap");
  await expect(page.getByText("Bedømt 0 af 4")).toBeVisible();

  const row = page.locator("li", { hasText: PLANNED_TITLE });
  await row.getByRole("radiogroup", { name: IMPORTANCE }).getByRole("radio", { name: "4", exact: true }).click();
  await expect(row.getByText("Gemt")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ item_id: "rm-plan-1", user_id: TEST_USER.id, importance_score: 4 });
  expect("idea_score" in posts[0]).toBe(false);
  // Tælleren falder med det samme; punktet bliver stående resten af besøget.
  await expect(page.getByText("Bedømt 1 af 4")).toBeVisible();
});

test("et allerede bedømt planlagt punkt er skjult af filteret, og fanetallet falder", async ({ page }) => {
  await loggedIn(page, { votes: [{ item_id: "rm-plan-1", idea_score: null, importance_score: 5, user_id: TEST_USER.id }] });
  await page.goto("/roadmap");
  await expect(page.getByText("Bedømt 1 af 4")).toBeVisible();
  await expect(page.locator("li", { hasText: PLANNED_TITLE })).toHaveCount(0);
  await page.getByLabel("Kun det jeg ikke har bedømt").uncheck();
  await expect(page.locator("li", { hasText: PLANNED_TITLE })).toBeVisible();
});

test("\"Rammer også mig\" slår til og fra", async ({ page }) => {
  const calls = [];
  await loggedIn(page);
  await routeReports(page, calls);
  await page.goto("/roadmap?tab=issues");

  const row = page.locator("li", { hasText: CONFIRMED_TITLE });
  await row.getByRole("button", { name: "Rammer også mig" }).click();
  await expect(row.getByRole("button", { name: "Meldt" })).toBeVisible();
  await row.getByRole("button", { name: "Meldt" }).click();
  await expect(row.getByRole("button", { name: "Rammer også mig" })).toBeVisible();

  expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  expect(JSON.parse(calls[0].body)).toMatchObject({ issue_id: "ki-confirmed-2", user_id: TEST_USER.id });
  expect(calls[1].url).toContain("user_id=eq.");
});

test("12 indmeldte fejl: 8 rækker ses, og folden \"4 flere\" viser resten", async ({ page }) => {
  await loggedIn(page);
  const checking = Array.from({ length: 12 }, (_, i) => ({
    id: `ki-many-${i}`, area: "club", status: "checking", title_en: `Reported issue ${i}.`, title_da: `Indmeldt fejl nummer ${i}.`,
    sort_order: 100 + i, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null,
  }));
  await page.route("**/rest/v1/known_issues*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, checking);
  });
  await page.goto("/roadmap?tab=issues");
  const rows = page.locator("li", { hasText: /Indmeldt fejl nummer/ });
  await expect(page.getByText("Indmeldt fejl nummer 0.")).toBeVisible();
  await expect(page.getByText("Indmeldt fejl nummer 7.")).toBeVisible();
  await expect(page.getByText("Indmeldt fejl nummer 8.")).toBeHidden();
  const fold = page.locator("summary", { hasText: "4 flere" });
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(page.getByText("Indmeldt fejl nummer 11.")).toBeVisible();
  await expect(rows).toHaveCount(12);
});

test("udlogget kan læse alt, men ser ingen skalaer og ingen tryk-knapper", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.goto("/roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  await expect(page.getByText(PLANNED_TITLE)).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log ind" }).first()).toBeVisible();

  await page.getByRole("tab", { name: /Kendte fejl/ }).click();
  await expect(page.getByText(CONFIRMED_TITLE)).toBeVisible();
  await expect(page.getByRole("button", { name: "Rammer også mig" })).toHaveCount(0);
});

test("/help?section=knownIssues lander på /roadmap?tab=issues", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.goto("/help?section=knownIssues");
  await expect(page).toHaveURL(/\/roadmap\?tab=issues$/);
  await expect(page.getByRole("tab", { name: /Kendte fejl/ })).toHaveAttribute("aria-selected", "true");
});

test("375 px: ingen vandret scroll på nogen fane", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loggedIn(page);
  for (const tab of ["plan", "beta", "vote", "issues", "done"]) {
    await page.goto(`/roadmap?tab=${tab}`);
    await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
    await expect(page.locator('[role="tabpanel"]')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `fanen ${tab}`).toBeLessThanOrEqual(375);
  }
});

// Fund 1 (PR #6160): på 375 px skal fanerækken og Vote-fanens områdefilter
// hver stå på ÉN linje og scrolle vandret inde i rækken, så "Færdigt" kan nås.
// Idéer i alle fem områder, så filteret har seks valg som i prod.
test("375 px: fanerækken scroller til Færdigt, og fanerække og områdefilter står på én linje", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loggedIn(page);
  const extra = ["races", "training", "youth", "market", "club"].map((engine, i) => ({
    id: `rm-extra-${i}`, engine, sort_order: 50 + i, title_en: `Idea ${i}.`, title_da: `Idé nummer ${i}.`,
    approved: true, status: "active", horizon: "next", beta_since: null, beta_soon: false, live_soon: false,
    created_at: "2026-09-20T00:00:00Z", shipped_at: null,
  }));
  await page.route("**/rest/v1/roadmap_items*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, [...ROADMAP_ITEMS, ...extra]);
  });
  await page.goto("/roadmap?tab=vote");
  const areas = page.getByRole("group", { name: /område/i });
  await expect(areas).toBeVisible();

  // Én linje: alle elementer i rækken har samme top og samme højde (ingen brudte labels).
  const oneLine = (selector) => page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
    return {
      tops: Math.max(...els.map((r) => r.top)) - Math.min(...els.map((r) => r.top)),
      heights: Math.max(...els.map((r) => r.height)) - Math.min(...els.map((r) => r.height)),
      count: els.length,
    };
  }, selector);
  const tabs = await oneLine('[role="tablist"] [role="tab"]');
  expect(tabs.count).toBe(5);
  expect(tabs.tops).toBeLessThanOrEqual(1);
  expect(tabs.heights).toBeLessThanOrEqual(1);
  const segs = await oneLine('main [role="group"] > button');
  expect(segs.count).toBe(6);
  expect(segs.tops).toBeLessThanOrEqual(1);
  expect(segs.heights).toBeLessThanOrEqual(1);

  // Fanerækken kan scrolles, til "Færdigt" står helt inden for rækken og skærmen.
  const done = page.getByRole("tab", { name: /Færdigt/ });
  await page.locator('[role="tablist"]').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const fit = await done.evaluate((el) => {
    const t = el.getBoundingClientRect();
    const l = el.closest('[role="tablist"]').getBoundingClientRect();
    return { tabRight: t.right, listRight: l.right, tabLeft: t.left, listLeft: l.left };
  });
  expect(fit.tabRight).toBeLessThanOrEqual(fit.listRight + 1);
  expect(fit.tabLeft).toBeGreaterThanOrEqual(fit.listLeft - 1);
  expect(fit.listRight).toBeLessThanOrEqual(375);
  await done.click();
  await expect(page).toHaveURL(/[?&]tab=done/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
