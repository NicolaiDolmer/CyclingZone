// #3199 — screenshots af Forum v1 til PR-review (liste + tråd m. poll).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks;
// forum-seedet bor i src/preview/mockHandlers.js (pinned ejer-poll + tre
// spiller-opslag), så billederne viser det ejeren faktisk får.
//
//   node tests/e2e/forum.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Egen stabilisering i stedet for fixtures.stabilizePage: den låser cz_lang til
// "da" på HVER navigation, og player-facing copy reviewes EN-first.
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

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/3199"));

const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 950 },
  { name: "mobile-393", width: 393, height: 900 },
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

  // 1) Forum-listen (pinned + seneste opslag).
  await page.goto("/forum");
  await page.getByText("Which feature should we build next?").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-list-${vp.name}.png`), fullPage: false });

  // 2) Nyt opslag-modalen.
  await page.getByRole("button", { name: /^New post$/ }).click();
  await page.getByRole("heading", { name: /^New post$/ }).waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-compose-${vp.name}.png`), fullPage: false });
  await page.keyboard.press("Escape");

  // 3) Tråd-detalje med ejer-poll + svar.
  await page.goto("/forum/forum-pinned-1");
  await page.getByText("Race replays").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-post-poll-${vp.name}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
