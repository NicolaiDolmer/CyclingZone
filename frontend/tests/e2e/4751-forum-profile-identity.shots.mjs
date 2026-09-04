// #4751 — screenshots af profil-identiteten i forummet (klikbart manager- og
// holdnavn, avatar, auto-signatur) til PR-review.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Koerer mod en koerende preview-server med e2e-netvaerksmocks;
// forum-seedet bor i src/preview/mockHandlers.js.
//
//   node tests/e2e/4751-forum-profile-identity.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

// Player-facing copy reviewes EN-first, saa sproget laases til engelsk.
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
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/4751"));

// 1280 = dommer-tjeklistens desktop-bredde (TASTE §4). 412 = ejerens
// Android-bredde (ikke iOS: webkit er CI-only).
const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "android-412", width: 412, height: 915 },
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

  // Traad med 3 svar: opslag + svar baerer avatar, klikbart manager-/holdnavn
  // og auto-signatur (holdnavn + division).
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-thread-${vp.name}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
