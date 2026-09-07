// #4818 — screenshots af Roadmap-kategorien til ejer-review:
//   a) kategorilisten med Roadmap øverst,
//   b) Roadmap set som ikke-admin (ingen "New post" + forklaringslinjen),
//   c) Roadmap set som admin (knappen er der),
//   d) en roadmap-tråd med svar (alle må svare).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), samme opskrift som 5000-forum-stats.shots.mjs: kører mod en
// kørende preview/e2e-server med netværksmocks, og seedet bor i
// src/preview/mockHandlers.js så billederne viser den rigtige datashape.
//
//   node tests/e2e/4818-forum-roadmap-category.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, corsHeaders } = await import(
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

// ForumPage laeser rollen med supabase.from("users").select("role") — mocken
// registreres OVEN PAA installNetworkMocks (senest registrerede route vinder).
async function setRole(page, role) {
  await page.route("**/rest/v1/users**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    const row = { id: "e2e-user", role };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify(wantsObject ? row : [row]),
    });
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
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../..", "pr-screens/4818"));

// Ejeren tester på Android — 390px er den bredde han faktisk ser.
const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 950 },
  { name: "mobile-390", width: 390, height: 900 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  for (const role of ["user", "admin"]) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: "en-GB",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await setRole(page, role);
    await stabilizeEnglish(page);
    await loginEnglish(page);

    // a) Kategorilisten: Roadmap ligger øverst i fanerækken (kun én gang —
    //    "All"-fanen ser ens ud for begge roller).
    if (role === "user") {
      await page.goto("/forum");
      await page.getByText("Which feature should we build next?").first().waitFor();
      await page.screenshot({ path: resolve(OUT, `a-categories-${vp.name}.png`) });
    }

    // b/c) Roadmap-fanen som ikke-admin (ingen knap + forklaring) og som admin.
    await page.goto("/forum?category=roadmap");
    await page.getByText("What I am building next").first().waitFor();
    await page.screenshot({
      path: resolve(OUT, `${role === "admin" ? "c-roadmap-admin" : "b-roadmap-player"}-${vp.name}.png`),
    });

    // d) En roadmap-tråd med svar — alle må svare, uanset rolle.
    if (role === "user") {
      await page.goto("/forum/forum-roadmap-1");
      await page.getByRole("heading", { name: "What I am building next" }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(OUT, `d-roadmap-thread-${vp.name}.png`) });
    }

    await context.close();
  }
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
