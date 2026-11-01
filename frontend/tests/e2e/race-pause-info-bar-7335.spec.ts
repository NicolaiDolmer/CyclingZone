// #7335 — blaa info-bjaelke naar loebene er sat paa pause, AUTOMATISK.
//
// Ejer 31/10: bjaelken skal komme af sig selv, naar loebene pauses, uden at nogen
// skal huske at saette `race_pause_notice`. Loebene pauses med kontakten
// `stage_scheduler_enabled` (28/10), saa den er hovedkilden; noticen er valgfri og
// giver kun en ny starttid. Den rene afgoerelse er unit-testet i
// src/lib/racePause.test.ts; HER bevises det spilleren ser:
//   1) kontakten slukket: bjaelken staar, uden starttid
//   2) notice med ny start: bjaelken viser starttiden
//   3) saesonskifte-banneret staar paa: ingen pause-bjaelke (ingen dobbelt blaa)
//   4) ingen pause: ingen bjaelke
//   5) loebssiden: kun EN besked (det gamle Pauset-banner er vaek)
//   6) dashboardet: global bjaelke skjult, dashboardets egen Pauset-flade staar
//
// PR-billeder: CZ_WRITE_COMMITTED_SHOTS=1 skriver til pr-screens/7335/.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

const HOUR = 3600 * 1000;
// Fast ur (AGENTS.md regel 16): browserens ur og fixture-tiderne deler samme nu.
const FIXED_NOW = Date.parse("2026-10-28T12:00:00Z");
const SIZES = [
  { label: "desktop 1440", slug: "1440", width: 1440, height: 900 },
  { label: "mobil 390", slug: "390", width: 390, height: 844 },
];

const SWITCH_OFF = { stage_scheduler_enabled: "off" };
const NO_PAUSE = { stage_scheduler_enabled: "on" };

// Pausens to app_config-noegler laeses i EN forespoergsel (key=in.(...)). Andre
// app_config-laesninger falder igennem til den generelle mock.
async function mockPauseConfig(page: Page, rows: Record<string, unknown>) {
  await page.route("**/rest/v1/app_config?**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET" || !request.url().includes("stage_scheduler_enabled")) return route.fallback();
    return json(route, Object.entries(rows).map(([key, value]) => ({ key, value })));
  });
}

async function mockSeasonChangeNotice(page: Page) {
  await page.route("**/rest/v1/ops_notices?**", (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, [{
      id: "ops-season-change",
      severity: "info",
      title_en: "Season change in progress",
      title_da: "Sæsonskifte i gang",
      body_en: "The game is changing season.",
      body_da: "Spillet skifter sæson.",
      active: true,
      starts_at: new Date(FIXED_NOW - HOUR).toISOString(),
      ends_at: null,
      created_at: new Date(FIXED_NOW - HOUR).toISOString(),
    }]);
  });
}

async function open(
  page: Page,
  { path, width = 1440, height = 900, lang = "en" }: { path: string; width?: number; height?: number; lang?: "en" | "da" },
) {
  await login(page);
  // login-helperen kraever danske placeholders; sproget flyttes EFTER login (som #1140).
  await page.addInitScript((value) => window.localStorage.setItem("cz_lang", value), lang);
  await page.setViewportSize({ width, height });
  const pauseRead = page.waitForResponse((res) => res.url().includes("/rest/v1/app_config") && res.url().includes("stage_scheduler_enabled"));
  await page.goto(path);
  await pauseRead;
}

const bar = (page: Page) => page.getByRole("status", { name: "Race status" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await installNetworkMocks(page);
  await stabilizePage(page);
});

for (const size of SIZES) {
  test(`${size.label}: kontakten slukket = bjaelken kommer af sig selv, uden starttid`, async ({ page }) => {
    await mockPauseConfig(page, SWITCH_OFF);
    await open(page, { path: "/race-centre", width: size.width, height: size.height });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveText("Races are paused. I will announce the new start time here.");
    await page.waitForTimeout(300);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/7335/after-${size.slug}.png`) });
  });

  test(`${size.label}: ingen pause = ingen bjaelke`, async ({ page }) => {
    await mockPauseConfig(page, NO_PAUSE);
    await open(page, { path: "/race-centre", width: size.width, height: size.height });
    await page.waitForTimeout(300);
    await expect(bar(page)).toHaveCount(0);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/7335/before-${size.slug}.png`) });
  });
}

test("notice med ny start = bjaelken viser starttiden (ogsaa naar kontakten er taendt)", async ({ page }) => {
  await mockPauseConfig(page, {
    stage_scheduler_enabled: "on",
    race_pause_notice: { paused: true, new_start: new Date(FIXED_NOW + 3 * HOUR).toISOString() },
  });
  await open(page, { path: "/race-centre" });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText("Races are paused.");
  await expect(bar(page)).toContainText("New start ");
  await expect(bar(page)).not.toContainText("I will announce");
});

test("saesonskifte staar paa = ingen pause-bjaelke, kun saesonskiftets egen bjaelke", async ({ page }) => {
  await mockPauseConfig(page, SWITCH_OFF);
  await mockSeasonChangeNotice(page);
  await open(page, { path: "/race-centre" });
  await expect(page.getByText("Season change in progress")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("loebssiden: kun EN pause-besked (det gamle Pauset-banner er vaek)", async ({ page }) => {
  await mockPauseConfig(page, SWITCH_OFF);
  await open(page, { path: "/races/race-up-1" });
  await expect(page.getByRole("heading", { name: "Tour de Preview" })).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(page.getByText("Races are paused.")).toHaveCount(1);
  await expect(page.getByText("Paused.", { exact: true })).toHaveCount(0);
});

test("dashboardet: global bjaelke skjult, dashboardets egen Pauset-flade staar (automatisk)", async ({ page }) => {
  await mockPauseConfig(page, SWITCH_OFF);
  await open(page, { path: "/dashboard" });
  await expect(page.getByText("Paused.", { exact: true })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("dansk: godkendt tekst uden starttid", async ({ page }) => {
  await mockPauseConfig(page, SWITCH_OFF);
  await open(page, { path: "/race-centre", lang: "da" });
  await expect(page.getByRole("status", { name: "Løbsstatus" })).toHaveText(
    "Løbene er sat på pause. Jeg melder den nye starttid ud her.",
  );
});
