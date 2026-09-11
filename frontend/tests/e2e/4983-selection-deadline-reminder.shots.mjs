// #4983 — screenshots af den synlige udtagelses-påmindelse i begge tilstande:
// gul (truppen er ikke fuld inde i #2180's 36-timers vindue) og rød (truppen er
// UNDER deltagelses-gulvet på 6 inde i assistentens late fill-horisont, 24 t —
// ejer-beslutning 10/9). Ad-hoc capture-script, ikke en del af CI-suiten
// (testMatch fanger kun *.spec.js).
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
//
// Tallene ER de fire tilfælde ejer-beslutningen 10/9 handler om, så billedet kan
// læses uden at kende koden:
//
//   GUL   6/8 med KUN 6 timer til start — over gulvet på 6, altså et hold der
//         stiller op (bare ikke i fuld styrke). Bliver aldrig rødt. Det er hele
//         pointen i beslutningen.
//   GUL   1/8 med 30 timer til start — under gulvet, men uden for de 24 timer.
//   RØD   0/7 og 5/8 inde i horisonten — begge under gulvet, altså hold der
//         IKKE stiller op.
//
// Løbsnavnene er valgt så de ikke kolliderer med DET BOARD der står længere nede
// på samme side (Løbsdag 13 i mockHandlers viser "Tour de Preview 1 / 8" og
// "Critérium Preview 0 / 7"): 1/8-løbet ER Tour de Preview og 0/7-løbet ER
// Critérium Preview, mens de to nye tal ligger på "Giro di Preview", som slet
// ikke står på boardet. Ellers ville skærmbilledet vise to forskellige tal for
// det samme løb og ligne en regnefejl.
const REMINDER_WARNING = {
  enabled: true,
  tone: "warning",
  count: 2,
  races: [
    {
      id: "wp-2", name: "Giro di Preview", race_class: "GiroVuelta",
      deadline_at: "2026-09-11T15:00:00.000Z", hours_until: 6,
      entry_count: 6, target_size: 8, min_size: 6, will_not_start: false, tone: "warning",
    },
    {
      id: "wp-1", name: "Tour de Preview", race_class: "TourFrance",
      deadline_at: "2026-09-12T09:00:00.000Z", hours_until: 30,
      entry_count: 1, target_size: 8, min_size: 6, will_not_start: true, tone: "warning",
    },
  ],
  window_hours: 36,
  urgent_hours: 24,
};

// RØD: begge løb er under gulvet OG inde i late fill-horisonten. Ét rødt løb gør
// hele markeringen rød (aggregateReminderTone) — nav-prikken følger med.
const REMINDER_URGENT = {
  ...REMINDER_WARNING,
  tone: "urgent",
  races: [
    {
      id: "wp-4", name: "Critérium Preview", race_class: "ProSeries",
      deadline_at: "2026-09-11T15:00:00.000Z", hours_until: 6,
      entry_count: 0, target_size: 7, min_size: 6, will_not_start: true, tone: "urgent",
    },
    {
      id: "wp-2", name: "Giro di Preview", race_class: "GiroVuelta",
      deadline_at: "2026-09-12T03:00:00.000Z", hours_until: 18,
      entry_count: 5, target_size: 8, min_size: 6, will_not_start: true, tone: "urgent",
    },
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
      // 1a) PASSIV synlighed på mobil (#4983-fund): den LUKKEDE flade, før
      //     menuen åbnes. Nav-prikken bor inde i drawer'en, så hamburger-knappen
      //     bærer samme tone — ellers ser en mobil-manager intet, og accept-
      //     kriteriet "uden at skulle opdage det ved et tilfælde" er kun opfyldt
      //     på desktop. Klip til topbaren; resten af siden er ikke pointen.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: resolve(OUT, `4983-topbar-${state.name}-mobile.png`),
        clip: { x: 0, y: 0, width: vp.width, height: 96 },
      });

      await page.getByRole("button", { name: /^Åbn menu/ }).click();
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

    // 3) Kontakten på Profil. De to timetal i hjælpeteksten INTERPOLERES fra
    //    /api/me/assistant-settings (window = 36, urgent =
    //    app_config.assistant_late_fill_hours) — de må ikke stå i copy, fordi
    //    horisonten er runtime-konfiguration. Ét billede er nok: kortet er ens i
    //    begge tilstande, så kun gul-desktop-gennemløbet tager det.
    if (state.name === "warning" && vp.name === "desktop") {
      await page.goto("/profile");
      const reminderToggle = page.getByText("Påmind mig før udtagelsesfristen").first();
      await reminderToggle.waitFor();
      await page.waitForTimeout(300);
      await reminderToggle.locator("xpath=ancestor::div[1]/..")
        .screenshot({ path: resolve(OUT, "4983-profile-toggle-desktop.png") });
    }

    await context.close();
  }
}

await browser.close();
console.log(`[4983] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
