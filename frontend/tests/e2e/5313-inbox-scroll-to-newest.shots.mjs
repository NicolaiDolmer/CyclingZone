// #5313 — screenshots til PR-review (ad-hoc capture-script, ikke en del af
// CI-suiten; testMatch fanger kun *.spec.js). Samme moenster som
// 3200-manager-dm.shots.mjs.
//
//   node tests/e2e/5313-inbox-scroll-to-newest.shots.mjs [baseURL] [outDir]
//
// Ét billede pr. viewport, ejer-krav for denne opgave: desktop 1440 + mobil 390.
//   thread-newest-visible   traad med 30 beskeder, aabnet - nyeste besked synlig

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, installMessagesMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
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

// Samme 30-beskeders opfyldning som messages-thread-scroll.spec.js — se den
// fil for hvorfor de 3 seedede fra fixtures.js ikke er nok til at bevise noget
// om scroll (traaden overflower aldrig sin max-h-[52vh]).
function seedThirtyMessages(state) {
  const CONVERSATION_ID = state.conversations[0].id;
  const base = Date.parse("2026-09-07T11:00:00.000Z");
  for (let i = 4; i <= 30; i += 1) {
    state.messages.push({
      id: `dm-msg-${i}`,
      conversationId: CONVERSATION_ID,
      fromMe: i % 2 === 0,
      body: `Message ${i} in the negotiation thread.`,
      createdAt: new Date(base + i * 60_000).toISOString(),
      context: null,
    });
  }
}

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/5313-inbox-scroll-to-newest"));

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
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
  await stabilizeEnglish(page);

  const state = await installMessagesMocks(page);
  seedThirtyMessages(state);
  await loginEnglish(page);

  await page.goto("/notifications?tab=messages&c=dm-conv-1");
  await page.getByText("Message 30 in the negotiation thread.").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `thread-newest-visible-${vp.name}.png`), fullPage: false });

  await context.close();
}

await browser.close();
console.log(`Screenshots skrevet til ${OUT}`);
