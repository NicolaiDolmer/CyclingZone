// #6970 — foer/efter-billede til PR-review (ad-hoc capture-script, ikke en del af
// CI-suiten; testMatch fanger kun *.spec.js). Samme moenster som
// 3200-manager-dm.shots.mjs.
//
//   node tests/e2e/6970-paused-race-banner.shots.mjs [baseURL] [outDir]
//
// Et annoteret billede: dashboardet FOER (gammel nedtaelling staar for et loeb der
// i virkeligheden er pauset) og EFTER ("Paused" + ny start, ingen gamle tider).

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../pr-screens/6970"));
mkdirSync(OUT, { recursive: true });

const HOUR = 3600 * 1000;
const NEW_START = new Date(Date.now() + 29 * HOUR);

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
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

async function mockPause(page, paused) {
  await page.route("**/rest/v1/race_stage_schedule**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([
        { race_id: "race-up-1", stage_number: 1, scheduled_at: new Date(Date.now() + 5 * HOUR).toISOString() },
        { race_id: "race-live-1", stage_number: 3, scheduled_at: new Date(Date.now() + 5 * HOUR).toISOString() },
      ]),
    });
  });
  await page.route("**/rest/v1/app_config?**race_pause_notice**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const asObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    const row = { value: { paused: true, new_start: NEW_START.toISOString() } };
    const body = paused ? (asObject ? row : [row]) : (asObject ? null : []);
    return route.fulfill({
      status: asObject && !paused ? 406 : 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  });
}

const browser = await chromium.launch();
const shots = {};
for (const paused of [false, true]) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-GB",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await mockPause(page, paused);
  await loginEnglish(page);
  await page.getByText("Upcoming races").first().waitFor();
  if (paused) await page.getByText("Paused.").first().waitFor();
  await page.waitForTimeout(600);
  const key = paused ? "after" : "before";
  shots[key] = await page.screenshot({ path: resolve(OUT, `${key}-dashboard.png`) });

  // Loebsdetalje: banneret staar over hero-kortet naar der er en pause.
  await page.goto("/races/race-up-1");
  await page.getByRole("heading", { name: "Tour de Preview" }).waitFor();
  if (paused) await page.getByText("Paused.").first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `${key}-race-detail.png`) });
  await context.close();
}

// Samlet, annoteret billede: to kolonner (foer/efter), tekst-annotationer.
const b64 = (buf) => buf.toString("base64");
const ctx = await browser.newContext({ viewport: { width: 2640, height: 800 }, deviceScaleFactor: 1 });
const sheet = await ctx.newPage();
await sheet.setContent(`<!doctype html><html><body style="margin:0;background:#111;font-family:system-ui,sans-serif;color:#fff">
<div style="display:flex;gap:24px;padding:24px">
  ${[["before", "BEFORE: a paused race still counts down to its old start"], ["after", "AFTER: banner says Paused + new start; old times hidden"]].map(([k, label]) => `
  <div style="flex:1">
    <div style="font-size:26px;font-weight:700;padding:0 0 12px;color:${k === "after" ? "#e8c04a" : "#ff8a80"}">${label}</div>
    <img src="data:image/png;base64,${b64(shots[k])}" style="width:100%;border:3px solid ${k === "after" ? "#e8c04a" : "#ff8a80"}">
  </div>`).join("")}
</div></body></html>`);
await sheet.screenshot({ path: resolve(OUT, "before-after-6970.png"), fullPage: true });
await browser.close();
console.log("OK", OUT);
