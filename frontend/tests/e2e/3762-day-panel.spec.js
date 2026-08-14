// #3762 — dagstype før session. Guarden her holder på de tre ting modellen
// findes for, målt mod prod 14/8:
//   1) 623 planer stod på fokus + hvile, hvor motoren gav 0 vækst. En hviledag
//      skal derfor LÆSES som en hviledag, uanset hvilket fokus rækken bærer.
//   2) Kombinationer der ikke findes må ikke kunne vælges: en hviledag har
//      ingen session, og en færdighedsdag tilbyder ikke Sprint.
//   3) Fladen må sende DAGEN til serveren, ikke en intensitet — ellers kan den
//      bede om et par modellen ikke tilbyder.

import { test, expect } from "@playwright/test";
import { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } from "./fixtures.js";

const squad = [
  { ...RIDERS[0], id: "rider-3762-a", firstname: "Elias", lastname: "Andersen", team_id: TEST_TEAM.id, primary_type: "sprinter", secondary_type: "puncheur" },
  // Bærer stadig et fokus PÅ en hviledag — den umigrerede tilstand fra prod.
  { ...RIDERS[0], id: "rider-3762-b", firstname: "Nuno", lastname: "Duran", team_id: TEST_TEAM.id, primary_type: "rouleur", secondary_type: "baroudeur" },
];

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 2, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero", "tempo"],
  intensities: ["rest", "recovery", "easy", "normal", "hard"],
  plans: {
    "rider-3762-a": { focus: "sprint", intensity: "hard" },
    "rider-3762-b": { focus: "vo2max", intensity: "rest" },
  },
  condition: Object.fromEntries(squad.map((r) => [r.id, { form: 60, fatigue: 30, injured_until: null, risk: 0 }])),
  progress: {},
  capped: {},
  trainability: {},
  smartDefaultFocus: {},
  weekPlan: null,
  riderWeekPlans: {},
  racingToday: {},
  todayRun: null,
};

async function setup(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  });
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, squad);
    return json(route, [...squad, ...RIDERS]);
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, TRAINING_ME);
  });
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto("/training");
  await page.locator("table[data-sortable]").waitFor();
}

async function openPanel(page, name) {
  await page.evaluate(() => {
    const scroller = document.querySelector("table[data-sortable]")?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.locator(`tr:has-text("${name}") button[aria-label*="${name}"]`).first().evaluate((el) => el.click());
  await page.getByRole("dialog").waitFor();
}

test("en hviledag med et gammelt fokus i kolonnen læses som Hvile, ikke som fokusset", async ({ page }) => {
  await setup(page);
  const row = page.locator("tbody tr", { hasText: "Nuno Duran" }).first();
  // Rækken bærer focus=vo2max + intensity=rest. Før #3762 stod der "VO2max".
  await expect(row.getByText("Rest", { exact: true }).first()).toBeVisible();
  await expect(row.getByText("VO2max")).toHaveCount(0);
});

test("hviledagen har ingen session, og færdighedsdagen tilbyder ikke Sprint", async ({ page }) => {
  await setup(page);
  await openPanel(page, "Elias Andersen");
  const dialog = page.getByRole("dialog");

  // Træningsdag: sessionerne findes, grupperet efter niveau.
  await expect(dialog.getByRole("radio", { name: "Sprint" })).toBeVisible();
  await expect(dialog.getByText("2 · Which session?")).toBeVisible();

  // Hvile: trin 2 forsvinder helt — der er ingen kombination at vælge forkert.
  await dialog.getByRole("radio", { name: "Rest", exact: true }).click();
  await expect(dialog.getByText("2 · Which session?")).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Sprint" })).toHaveCount(0);

  // Færdighedsdag: kun færdigheds-sessioner.
  await dialog.getByRole("radio", { name: "Skill day", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Technique" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Sprint" })).toHaveCount(0);
});

test("fladen sender dagen til serveren, ikke en intensitet", async ({ page }) => {
  await setup(page);
  let body = null;
  await page.route("**/api/training/rider-3762-a", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    body = JSON.parse(request.postData() || "{}");
    return json(route, { ok: true, riderId: "rider-3762-a", plan: { focus: "technique", intensity: "easy" }, slots: TRAINING_ME.slots });
  });

  await openPanel(page, "Elias Andersen");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Skill day", exact: true }).click();
  await dialog.getByRole("radio", { name: "Technique" }).click();
  await page.getByRole("button", { name: "Save day" }).click();

  await expect.poll(() => body).not.toBeNull();
  expect(body).toEqual({ dayType: "skill", session: "technique" });
  expect(body).not.toHaveProperty("intensity");
});
