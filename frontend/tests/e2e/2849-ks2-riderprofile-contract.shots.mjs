// #2849 kvalitetssession 2 (18/8) — PR-screenshots for rytterprofil-kontrakt-
// fixene: én gold-knap (akademi-tilfældet, Forlæng demoteret til secondary når
// Promovér er synlig), 5px radius overalt (rounded-cz/rounded-cz-pill), kanonisk
// SkeletonLines-loading, stroke-ikoner i stedet for glyffer (‹ › → ← ✓ ⇄).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks.
// Overrider riders-mocken med én akademi-rytter på TEST_TEAM (samme mønster
// som 3300-training-academy-status.shots.mjs) så promote-knappen faktisk
// bliver synlig ved siden af Forlæng — det tilfælde kontrakt-bruddet handlede om.
//
//   node tests/e2e/2849-ks2-riderprofile-contract.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const seniorRider = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

// Synteisk akademi-rytter på TEST_TEAM, uden at røre committede seedData.js
// (samme opskrift som 3300-training-academy-status.shots.mjs).
const academyRider = {
  ...seniorRider,
  id: "rider-shot-academy-ks2",
  firstname: "Anna",
  lastname: "Akademi",
  team_id: TEST_TEAM.id,
  team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
  is_academy: true,
  birthdate: "2007-05-01",
};

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

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// ── 1) Almindelig egen senior-rytter — back-link-chevron, switcher-chevroner,
//      afrundinger (radius) på handlings-knapperne. Desktop + mobil. ──────────
for (const vp of [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(`/riders/${seniorRider.id}`);
  await page.getByRole("tab", { name: /overview/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `quality-riderprofile-${vp.name}.png`), fullPage: true });
  await context.close();
}

// ── 2) Akademi-rytter — Forlæng (secondary/gray) ved siden af Promovér
//      (gold/primary): DEN dømmende screenshot for gold-demoveringen. ─────────
for (const vp of [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  // Registreret EFTER installNetworkMocks, så denne handler vinder (Playwright:
  // senest-tilføjede route matcher først) — samme mønster som 3300-shots.
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      const match = [academyRider, ...RIDERS].find((r) => r.id === id);
      return json(route, asSingle(match ? [match] : []));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle([academyRider, seniorRider]));
    return json(route, asSingle(RIDERS));
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(`/riders/${academyRider.id}`);
  await page.getByRole("tab", { name: /overview/i }).waitFor({ timeout: 20000 });
  // Forlæng-triggeren henter sin loft-quote stille ved mount (extendLoading) —
  // vent til den er landet, ellers fanger screenshottet BusyDot i stedet for
  // knappens endelige variant.
  await page.getByRole("button", { name: /extend/i }).first().waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, `quality-riderprofile-academy-${vp.name}.png`), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
