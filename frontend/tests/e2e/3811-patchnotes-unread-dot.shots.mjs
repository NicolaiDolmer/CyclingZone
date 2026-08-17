// #3811 — screenshots af ulæst-prikken ved "Patch Notes" i navigationen.
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende preview/dev-server med e2e-netværksmocks —
// samme mønster som 3521-transfers-menu-badge.shots.mjs.
//
// stabilizePage() sætter ALDRIG cz_patchnotes_last_seen, så en frisk browser-
// context altid starter "aldrig set" → prikken er synlig by default. Prikkens
// datakilde (/patch-notes-meta.json) er en statisk build-asset (ikke mocket
// her) — scriptet forventer derfor en preview-server startet efter `npm run
// build` (samme krav som selve e2e-suiten).
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4636 --strictPort &
//   node tests/e2e/3811-patchnotes-unread-dot.shots.mjs http://127.0.0.1:4636

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:4636";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);

  const openSidebar = vp.name === "mobile"
    ? async () => { await page.getByRole("button", { name: "Åbn menu" }).click(); }
    : async () => {};

  // 1) Frisk login, aldrig besøgt /patch-notes → prikken skal være synlig.
  await openSidebar();
  const patchNotesLink = page.getByRole("link", { name: /^Patch Notes/ }).first();
  await patchNotesLink.waitFor();
  await patchNotesLink.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200); // patch-notes-meta.json-fetch + paint settle
  await page.locator("aside:visible").first().screenshot({
    path: resolve(OUT, `3811-${vp.name}-dot-unread.png`),
  });

  // 2) Åbn Patch Notes-siden → mark-as-read-effekten kører, prikken skal forsvinde.
  await patchNotesLink.click();
  await page.getByRole("heading", { name: "Patch Notes" }).waitFor();
  await page.getByText(/^Indlæser opdateringer…$/).waitFor({ state: "hidden" }).catch(() => {});
  await page.waitForTimeout(300);
  await openSidebar();
  const patchNotesLinkAfter = page.getByRole("link", { name: /^Patch Notes/ }).first();
  await patchNotesLinkAfter.scrollIntoViewIfNeeded();
  await page.locator("aside:visible").first().screenshot({
    path: resolve(OUT, `3811-${vp.name}-dot-cleared.png`),
  });

  await context.close();
}

await browser.close();
console.log(`[3811] Screenshots skrevet til ${OUT} (team ${TEST_TEAM.id})`);
