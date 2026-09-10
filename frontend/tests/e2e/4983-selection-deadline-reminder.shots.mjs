// #4983 — screenshots af den synlige udtagelses-påmindelse i begge tilstande:
// gul (fristen inden for #2180's 36-timers vindue) og rød (inden for
// assistentens late fill-horisont, 24 t). Ad-hoc capture-script, ikke en del af
// CI-suiten (testMatch fanger kun *.spec.js).
//
// /api/me/selection-reminder overrides KUN i dette scripts egen browser-context.
// Den delte mockHandlers.js svarer bevidst "tone: none", så resten af
// skærmbillede-korpuset (hvor nav-prikken ville dukke op på HVER side) er
// uændret — samme lagdeling som 3521-transfers-menu-badge.shots.mjs bruger for
// badge-tallet.
//
//   node tests/e2e/4983-selection-deadline-reminder.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json, corsHeaders, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4476";
const OUT = resolve(process.argv[3] || resolve(__dirname, "screenshots"));

// Samme shape som backend/lib/selectionDeadlineReminder.js returnerer.
// GUL: begge løb over 24-timers-grænsen, altså inde i 36-timers vinduet.
const REMINDER_WARNING = {
  enabled: true,
  tone: "warning",
  count: 2,
  races: [
    {
      id: "wp-1", name: "Tour de Preview", race_class: "TourFrance",
      deadline_at: "2026-09-12T09:00:00.000Z", hours_until: 30,
      entry_count: 0, target_size: 8, tone: "warning",
    },
    {
      id: "wp-3", name: "Omloop Preview", race_class: "ProSeries",
      deadline_at: "2026-09-12T13:00:00.000Z", hours_until: 34,
      entry_count: 4, target_size: 6, tone: "warning",
    },
  ],
  window_hours: 36,
  urgent_hours: 24,
};

// RØD: det nærmeste løb er inde i late fill-horisonten. Ét rødt løb gør hele
// markeringen rød (aggregateReminderTone) — nav-prikken følger med.
const REMINDER_URGENT = {
  ...REMINDER_WARNING,
  tone: "urgent",
  races: [
    { ...REMINDER_WARNING.races[0], hours_until: 6, tone: "urgent" },
    { ...REMINDER_WARNING.races[1], hours_until: 18, tone: "urgent" },
  ],
};

async function installReminderMock(page, payload) {
  await page.route("**/api/me/selection-reminder**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, payload);
  });
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

const STATES = [
  { name: "warning", payload: REMINDER_WARNING },
  { name: "urgent", payload: REMINDER_URGENT },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const state of STATES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await installReminderMock(page, state.payload);
    await stabilizePage(page);
    await login(page);

    // 1) Nav-markeringen. Desktop: den permanente sidebar. Mobil: samme
    //    SidebarContent i hamburger-drawer'en.
    if (vp.name === "desktop") {
      await page.getByRole("button", { name: "Planlægning" }).click();
      await page.getByRole("link", { name: /^Planlægning/ }).first().waitFor();
      await page.waitForTimeout(200);
      await page.locator("aside:visible").first()
        .screenshot({ path: resolve(OUT, `4983-nav-${state.name}-desktop.png`) });
    } else {
      await page.getByRole("button", { name: "Åbn menu" }).click();
      await page.getByRole("button", { name: "Planlægning" }).click();
      await page.getByRole("link", { name: /^Planlægning/ }).first().waitFor();
      await page.waitForTimeout(200);
      await page.locator("aside:visible").first()
        .screenshot({ path: resolve(OUT, `4983-nav-${state.name}-mobile.png`) });
    }

    // 2) Boksen på planlægningssiden.
    await page.goto("/planning");
    await page.getByRole("status").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, `4983-box-${state.name}-${vp.name}.png`) });

    await context.close();
  }
}

await browser.close();
console.log(`[4983] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
