// #4009 (ejer-ja 20/8) — PR-screenshots for akademi-fyring. Akademi-ryttere
// kunne hidtil KUN forlade akademiet via graduerings-vinduet (ryttere >=22 med
// en pending academy_graduation-row) — workaround var promote-til-senior ->
// fyr. Dette script viser de to nye UI-overflader:
//   1) Akademi-rosteret (AcademyPage) — ny Fyr-knap ved siden af Promover.
//   2) Fyr-bekraeftelsen (AcademyReleaseConfirmModal) — buyout-gebyret som
//      speed-bump foer bekraeftelse (mocket /api/riders/:id/academy-release-quote).
//   3) Rytterprofilen (RiderManageActions) for en akademi-rytter — samme
//      delte Release-panel som senior-ryttere nu bruger for akademiet.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en koerende dev/preview-server med e2e-netvaerksmocks.
//
//   node tests/e2e/4009-academy-release.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);
const { SEED_ACADEMY } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const BASE = process.argv[2] || "http://localhost:4173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Jonas Svensson — SEED_ACADEMY.roster[0]: salary 12.000, contract_end_season 3.
// currentSeason=1 (ACTIVE_SEASON) => fee = round(12000 * (3-1+1) * 0.5) = 18.000.
const academyRosterRider = SEED_ACADEMY.roster.find((r) => r.id === "acad-r1");
const RELEASE_QUOTE = { fee: 18000, balance: TEST_TEAM.balance, affordable: true };

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

async function mockReleaseQuote(page) {
  // Registreret EFTER installNetworkMocks, så denne handler vinder.
  await page.route("**/api/riders/*/academy-release-quote**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, RELEASE_QUOTE);
  });
}

const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// ── 1) + 2) Akademi-rosteret: Fyr-knap ved siden af Promover, derefter
//      fyr-bekraeftelsen med gebyret. ──────────────────────────────────────
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await mockReleaseQuote(page);
  await stabilizeEnglish(page);
  await login(page);
  await page.goto("/academy");
  // #4009: scopet til akademi-ROSTERETS Release-knap (Jonas Svenssons række) —
  // "Release" findes OGSÅ som en almindelig graduerings-knap i "Graduating
  // riders"-sektionen ovenfor (uden bekræftelses-dialog), så en ubetinget
  // .first() ramte den forkerte knap og trigger'ede aldrig min nye modal.
  const rosterRow = page.getByRole("row", { name: /Jonas Svensson/i });
  const releaseBtn = rosterRow.getByRole("button", { name: /release/i });
  await releaseBtn.waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `4009-academy-roster-${vp.name}.png`), fullPage: false });

  await releaseBtn.click();
  await page.getByText(/buyout fee/i).first().waitFor();
  // Vent til gebyret er landet (ikke "..." fra den stille loading-state).
  await page.getByText(/18[.,]000/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `4009-academy-release-confirm-${vp.name}.png`), fullPage: false });
  await context.close();
}

// ── 3) Rytterprofilen for samme akademi-rytter — RiderManageActions' delte
//      Release-panel, udvidet (viser samme gebyr som speed-bump). ───────────
{
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await mockReleaseQuote(page);
  // Samme mønster som 2849-ks2-riderprofile-contract.shots.mjs: rytterprofilen
  // slår op i "riders" REST-tabellen, som IKKE kender SEED_ACADEMY.roster —
  // overrid med rytteren injiceret ved siden af RIDERS.
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
      const match = [academyRosterRider, ...RIDERS].find((r) => r.id === id);
      return json(route, asSingle(match ? [match] : []));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle([academyRosterRider]));
    return json(route, asSingle(RIDERS));
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(`/riders/${academyRosterRider.id}`);
  await page.getByRole("tab", { name: /overview/i }).waitFor({ timeout: 20000 });
  const releaseBtn = page.getByRole("button", { name: /release rider/i }).first();
  await releaseBtn.waitFor({ timeout: 20000 });
  await releaseBtn.click();
  await page.getByText(/18[.,]000/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, "4009-riderprofile-academy-release-desktop.png"), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
