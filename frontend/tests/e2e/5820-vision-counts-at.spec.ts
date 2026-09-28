// #5820 — Hver visions-milepæl viser ÉN kort linje om hvornår den tælles.
//
// Spiller-feedback 26/9: et langsigtet mål ("3 overall wins") lignede et
// inaktivt mål midt i sæsonen, fordi kortet ikke sagde at milepæle gøres op
// ved sæsonafslutning. Nu står "Counts at the end of season N · can be met
// early" under hver åben milepæl, "Achieved"/"Missed" under afgjorte.
//
// Guarden holder på linjen (tekst + sæsontal), på at den står i fuld bredde på
// mobil, og at siden ikke får vandret scroll. Samme mock som #5617.
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

for (const [name, width, height] of [["mobil", 390, 844], ["desktop", 1440, 900]] as const) {
  test(`${name} ${width}: hver milepæl viser hvornår den tælles (#5820)`, async ({ page }) => {
    const list = await openVision(page, width, height);
    const lines = list.getByTestId("vision-milestone-counts");
    await expect(lines).toHaveCount(4);
    await expect(lines.nth(0)).toHaveText(/^(Achieved|Nået)$/);
    await expect(lines.nth(1)).toHaveText(/^(Counts at the end of season 4 · can be met early|Tælles ved udgangen af sæson 4 · kan nås før tid)$/);
    await expect(lines.nth(2)).toContainText(/season 5|sæson 5/);
    await expect(lines.nth(3)).toContainText(/season 6|sæson 6/);
    // Forklaringen under milepælene siger ikke længere "bedømmes i målsæsonen"
    // uden undtagelsen for tidlig opfyldelse.
    await expect(page.getByText(/Reach it sooner|Når du den før/)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "ingen vandret scroll").toBeLessThanOrEqual(0);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/5820-vision-${width}.png`), fullPage: width < 640 });
  });
}
