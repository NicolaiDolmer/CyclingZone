// #5000 — screenshots af forum-statistikken til ejer-review:
//   a) trådlisten med visningstal + seneste svars forfatter,
//   b) trådhovedet med visningstal,
//   c) managerprofilen med antal forumindlæg.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), samme opskrift som forum.shots.mjs (#3199): kører mod en kørende
// preview/e2e-server med netværksmocks, og seedet bor i
// src/preview/mockHandlers.js så billederne viser den rigtige datashape.
//
//   node tests/e2e/5000-forum-stats.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Egen stabilisering i stedet for fixtures.stabilizePage: den låser cz_lang til
// "da", og player-facing copy reviewes EN-first.
async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  });
}

async function loginEnglish(page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@email.com").waitFor();
  await page.getByPlaceholder("you@email.com").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /^Log in$/ }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4970";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/5000"));

// Ejeren tester på Android — 390px er den bredde han faktisk ser (#5000-brief).
const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 950 },
  { name: "mobile-390", width: 390, height: 900 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await loginEnglish(page);

  // a) Trådlisten: visningstal i højre kolonne, seneste svars forfatter +
  //    relativ tid i metalinjen (og opslagets egen dato på tråden uden svar).
  await page.goto("/forum");
  await page.getByText("Which feature should we build next?").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-list-${vp.name}.png`), fullPage: false });

  // b) Trådhovedet: visningstal på metalinjen ved siden af pinned-mærket.
  await page.goto("/forum/forum-pinned-1");
  await page.getByText("Race replays").first().waitFor();
  // #3451 scroller automatisk til foerste ulaeste svar — spol tilbage til
  // toppen, ellers er selve traadhovedet uden for billedet.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `forum-thread-header-${vp.name}.png`), fullPage: false });

  // c) Managerprofilen: "Forum posts" som nøgletal i heroet.
  await page.goto(`/managers/${TEST_TEAM.id}`);
  await page.getByText("Forum posts").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `manager-profile-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
