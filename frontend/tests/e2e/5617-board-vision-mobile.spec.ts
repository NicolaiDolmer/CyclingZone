// #5617 — Vision-fanen i bestyrelsen (beta) på mobil.
//
// Før: milepælene stod i ét vandret gitter med én kolonne pr. milepæl
// (`repeat(n, 1fr)`) på alle bredder. Efter #5472 (23/9) er hver milepæl en hel
// sætning ("Finish ahead of at least 12 other managers in the division"), og på
// 390 px blev fire kolonner à ca. 70 px til smalle søjler med ét-to ord pr.
// linje. Nu er milepælene en lodret liste på mobil og det vandrette gitter fra
// sm og op (desktop uændret).
//
// Guarden holder på det rettelsen LOVER, ikke på pixels:
//   1) Mobil 390: hver milepæls titel er mindst halvdelen af kortets bredde
//      (ikke en smal søjle), og milepælene står under hinanden.
//   2) Desktop 1440: milepælene står stadig side om side på én række.
//   3) Ingen vandret scroll på siden på mobil.
//
// Testene sætter selv viewport, så alle tre Playwright-projekter kører de samme
// assertions.
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath } from "./fixtures.js";

const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);

// Milepæle som backend sender dem efter #5472: maaltype + target, så titlen
// bliver den fulde sætning (resolveGoalTitle), ikke korttitlen.
const VISION = {
  ...boardRoomFixture.vision,
  milestones: [
    { id: "m1", seasonNumber: 3, labelKey: "goalType.top_n_finish", type: "top_n_finish", target: 40, status: "achieved", isCurrentSeason: false },
    { id: "m2", seasonNumber: 4, labelKey: "goalType.relative_rank", type: "relative_rank", target: 12, status: "current", isCurrentSeason: true },
    { id: "m3", seasonNumber: 5, labelKey: "goalType.top_n_finish", type: "top_n_finish", target: 12, status: "upcoming", isCurrentSeason: false },
    { id: "m4", seasonNumber: 6, labelKey: "goalType.top_n_finish", type: "top_n_finish", target: 6, status: "upcoming", isCurrentSeason: false },
  ],
};

async function installBoardroomMocks(page: Page) {
  await page.route("**/api/board/room", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...boardRoomFixture, vision: VISION, bonusOffer: null }),
    });
  });
  await page.route("**/api/board/meeting", (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) })
      : route.fallback(),
  );
  await page.route("**/api/board/dna-suggestions", (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ already_chosen: true, can_rechoose: false, suggestions: [] }),
        })
      : route.fallback(),
  );
}

async function openVision(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardroomMocks(page);
  await login(page);
  await page.goto("/board?tab=vision");
  await expect(page.getByRole("tab", { name: "Vision" })).toHaveAttribute("aria-selected", "true");
  const list = page.getByTestId("vision-milestones");
  await expect(list).toBeVisible();
  return list;
}

test("mobil 390 × 844: milepælene står under hinanden i fuld bredde, ingen smalle søjler", async ({ page }) => {
  const list = await openVision(page, 390, 844);
  const items = list.getByTestId("vision-milestone");
  await expect(items).toHaveCount(4);

  const listBox = (await list.boundingBox())!;
  const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => (await items.nth(i).boundingBox())!));
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y, "milepælene står under hinanden på mobil").toBeGreaterThan(boxes[i - 1].y + boxes[i - 1].height - 1);
  }
  const titles = list.getByTestId("vision-milestone-title");
  for (let i = 0; i < 4; i += 1) {
    const b = (await titles.nth(i).boundingBox())!;
    expect(b.width, "titlen må ikke klemmes ned i en smal søjle").toBeGreaterThan(listBox.width / 2);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "ingen vandret scroll").toBeLessThanOrEqual(0);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5617-vision-390.png"), fullPage: true });
});

test("desktop 1440 × 900: milepælene står stadig side om side", async ({ page }) => {
  const list = await openVision(page, 1440, 900);
  const items = list.getByTestId("vision-milestone");
  await expect(items).toHaveCount(4);
  const first = (await items.nth(0).boundingBox())!;
  const last = (await items.nth(3).boundingBox())!;
  expect(Math.abs(last.y - first.y), "én række på desktop").toBeLessThan(2);
  expect(last.x).toBeGreaterThan(first.x);
  await page.screenshot({ path: evidenceShotPath("pr-screens/5617-vision-1440.png") });
});
