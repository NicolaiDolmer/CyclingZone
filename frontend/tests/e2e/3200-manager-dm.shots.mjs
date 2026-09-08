// #3200 — screenshots af DM v1 til PR-review (ad-hoc capture-script, ikke en
// del af CI-suiten; testMatch fanger kun *.spec.js). Samme moenster som
// 3451-forum-first-unread.shots.mjs.
//
//   node tests/e2e/3200-manager-dm.shots.mjs [baseURL] [outDir]
//
// Fem billeder, ejer-krav: desktop 1280px + Android 390px.
//   a-messages-tab   Beskeder-fanen med samtalelisten
//   b-thread         en traad med beskeder begge veje
//   c-profile-button Message-knappen paa en fremmed managerprofil
//   d-thread-menu    tre-prik-menuen med Bloker / Anmeld / Skjul
//   e-deal-quote     "Skriv til modparten" paa et transfertilbud + citatet

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

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/3200-dm"));

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "android-390", width: 390, height: 844 },
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

  const state = await installMessagesMocks(page, { seedOffer: true });
  await loginEnglish(page);

  // (a) Beskeder-fanen med samtalelisten.
  await page.goto("/notifications?tab=messages");
  await page.getByRole("button", { name: /Visual Tester/ }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `a-messages-tab-${vp.name}.png`), fullPage: false });

  // (b) Traad med beskeder begge veje.
  await page.goto("/notifications?tab=messages&c=dm-conv-1");
  await page.getByText(/Make it 165k and we have a deal/).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `b-thread-${vp.name}.png`), fullPage: false });

  // (d) Tre-prik-menuen. Tages foer profil-billedet, saa traaden allerede er
  // aaben og menuen kan foldes ud paa staaende flade.
  await page.getByRole("button", { name: /^More$/ }).click();
  await page.getByRole("menuitem", { name: /Block manager/ }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `d-thread-menu-${vp.name}.png`), fullPage: false });
  await page.keyboard.press("Escape");

  // (c) Message-knappen paa en fremmed managerprofil.
  await page.goto("/managers/team-rival");
  await page.getByRole("button", { name: /Message Visual Tester/ }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `c-profile-button-${vp.name}.png`), fullPage: false });

  // (e) "Skriv til modparten" paa et transfertilbud + det citerede tilbud.
  await page.goto("/transfers");
  const dealButton = page.getByRole("button", { name: /Message Regression VC/ }).first();
  await dealButton.waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `e1-deal-button-${vp.name}.png`), fullPage: false });

  await dealButton.click();
  await page.getByRole("textbox", { name: /Write a message/ }).waitFor();
  await page.getByRole("textbox", { name: /Write a message/ }).fill("Can you stretch to 165k? I will cover the salary this season.");
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `e2-deal-quote-${vp.name}.png`), fullPage: false });

  // Send den, saa den citerede foerste besked ogsaa ses i selve traaden.
  await page.getByRole("button", { name: /^Send$/ }).last().click();
  await page.waitForURL(/tab=messages/);
  // Traadens beskedtekst, ikke samtalelistens forhaandsvisning (som paa 390px
  // er skjult og derfor aldrig bliver synlig).
  await page.locator("p.whitespace-pre-wrap", { hasText: /Can you stretch to 165k/ }).first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `e3-deal-quote-in-thread-${vp.name}.png`), fullPage: false });

  console.log(`${vp.name}: sendt kontekst = ${JSON.stringify(state.sent.at(-1)?.context)}`);
  await context.close();
}

await browser.close();
console.log(`Screenshots skrevet til ${OUT}`);
