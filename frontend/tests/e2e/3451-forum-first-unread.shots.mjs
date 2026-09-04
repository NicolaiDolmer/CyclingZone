// #3451 — screenshots af "åbn direkte ved første ulæste svar"-tråden
// (PR-review). Ad-hoc capture-script (samme mønster som
// forum-mark-all-read.shots.mjs, ikke en del af CI-suiten; testMatch fanger
// kun *.spec.js). forum-pinned-1 har en seedet viewer_last_read_at mellem
// svar r2 og r3 (src/preview/mockHandlers.js), så tråden viser den fulde
// fold+scroll-adfærd: 2 tidligere svar foldet sammen, r3 markeret som det
// første ulæste.
//
//   node tests/e2e/3451-forum-first-unread.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
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
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/3451-unread"));

// Ejer-krav: desktop 1280px + Android-bredde 412px.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
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

  // forum-pinned-1: viewer_last_read_at ligger mellem r2 og r3 → r1+r2 foldes
  // til "2 earlier replies", r3 er det første ulæste (accent-kant + scroll-mål).
  await page.goto("/forum/forum-pinned-1");
  await page.getByText(/earlier repl(y|ies)/).first().waitFor();
  // Vent på at scroll-animationen (smooth scrollIntoView mod #reply-<id>) er
  // faldet til ro, så skærmbilledet ikke fanger en mellemtilstand.
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, `forum-unread-fold-collapsed-${vp.name}.png`), fullPage: true });

  // Fold ud, så begge tidligere svar + det markerede ulæste svar ses i ét billede.
  await page.getByText(/earlier repl(y|ies)/).first().click();
  await page.getByText("Great initiative. My vote went to race replays, the finale deserves it.").first().waitFor();
  await page.screenshot({ path: resolve(OUT, `forum-unread-fold-expanded-${vp.name}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
