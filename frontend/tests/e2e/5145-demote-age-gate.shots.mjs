// #5145 — PR-screenshots for nedryknings-gaten på rytterprofilen.
//
// To ryttere på TEST_TEAM, identiske bortset fra fødselsåret:
//   • sæson-alder 21 → "Move to academy" er aktiv (uændret adfærd).
//   • sæson-alder 22 → knappen er DEAKTIVERET med en kort forklaring under
//     handlingsrækken. Det er den tilstand #5145 indfører.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; playwright testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks —
// samme mønster som 2849-ks2-riderprofile-contract.shots.mjs, hvis riders-route-
// override den her genbruger.
//
//   node tests/e2e/5145-demote-age-gate.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, ACTIVE_SEASON, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);
const { LAUNCH_REFERENCE_YEAR } = await import(
  pathToFileURL(resolve(__dirname, "../../src/lib/riderAge.js")).href
);

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Sæsonens referenceår i mock-data (season_number 1 → LAUNCH_REFERENCE_YEAR).
const SEASON_YEAR = LAUNCH_REFERENCE_YEAR + (ACTIVE_SEASON.season_number - 1);
const bornFor = (age) => `${SEASON_YEAR - age}-04-11`;

const seniorRider = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];

function syntheticSenior({ id, firstname, lastname, age }) {
  return {
    ...seniorRider,
    id,
    firstname,
    lastname,
    team_id: TEST_TEAM.id,
    team: { id: TEST_TEAM.id, name: TEST_TEAM.name },
    is_academy: false,
    birthdate: bornFor(age),
  };
}

const CASES = [
  { key: "allowed-21", age: 21, rider: syntheticSenior({ id: "rider-5145-age21", firstname: "Elias", lastname: "Enogtyve", age: 21 }) },
  { key: "blocked-22", age: 22, rider: syntheticSenior({ id: "rider-5145-age22", firstname: "Tobias", lastname: "Toogtyve", age: 22 }) },
];

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

for (const testCase of CASES) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, locale: "en-US",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  // Registreret EFTER installNetworkMocks, så denne handler vinder (Playwright:
  // senest-tilføjede route matcher først) — samme mønster som 2849-shots.
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
      const match = [testCase.rider, ...RIDERS].find((r) => r.id === id);
      return json(route, asSingle(match ? [match] : []));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle([testCase.rider, seniorRider]));
    return json(route, asSingle(RIDERS));
  });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto(`/riders/${testCase.rider.id}`);
  await page.getByRole("tab", { name: /overview/i }).waitFor({ timeout: 20000 });
  // Forlæng-triggeren henter sin loft-quote stille ved mount — vent til den er
  // landet, ellers fanger screenshottet BusyDot i stedet for den endelige række.
  await page.getByRole("button", { name: /extend/i }).first().waitFor();
  await page.waitForTimeout(1000);

  const demote = page.getByRole("button", { name: /move to academy/i }).first();
  const visible = await demote.isVisible().catch(() => false);
  const disabled = visible ? await demote.isDisabled() : null;
  const hint = await page.getByText(/riders leave the academy at 22/i).first().isVisible().catch(() => false);
  console.log(`[${testCase.key}] alder ${testCase.age}: knap synlig=${visible} disabled=${disabled} forklaring=${hint}`);

  await page.screenshot({ path: resolve(OUT, `5145-demote-${testCase.key}.png`), fullPage: false });
  await context.close();
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
