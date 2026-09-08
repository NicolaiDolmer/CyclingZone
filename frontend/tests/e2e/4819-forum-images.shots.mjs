// #4819 — screenshots af billeder i forum-indlaeg til PR-review.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Koerer mod en koerende preview-server med e2e-netvaerksmocks;
// forum-seedet bor i src/preview/mockHandlers.js.
//
//   node tests/e2e/4819-forum-images.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { installForumImageMocks, FORUM_IMAGE_FIXTURE } = await import(
  pathToFileURL(resolve(__dirname, "forumImageMocks.js")).href
);

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

const BASE = process.argv[2] || "http://127.0.0.1:5250";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/4819"));

const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
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
  await installForumImageMocks(page);
  await stabilizeEnglish(page);
  await loginEnglish(page);

  // (c/d) Traad med 3 billeder paa opslaget og 1 paa foerste svar.
  await page.goto("/forum/forum-post-2");
  await page.getByRole("heading", { name: /Deadline Day/ }).waitFor();
  await page.locator("main img[src*='forum-images']").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-thread-images-${vp.name}.png`), fullPage: true });

  // (a) Editoren: Add image + forhaandsvisning + taeller.
  await page.goto("/forum");
  await page.getByRole("button", { name: "New post" }).click();
  await page.getByLabel("Title").fill("Look at this climb");
  await page.getByLabel("Message").fill("Two shots from the final kilometre.");
  await page.locator("input[type=file]").setInputFiles([FORUM_IMAGE_FIXTURE, FORUM_IMAGE_FIXTURE]);
  await page.getByText("2 of 3").waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-compose-images-${vp.name}.png`), fullPage: true });

  // (b) Fejltilstand: forkert filtype.
  await page.locator("input[type=file]").setInputFiles([{
    name: "not-an-image.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  }]);
  await page.getByText(/does not work here/).waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-compose-error-${vp.name}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log(`Screenshots -> ${OUT}`);
