// #5102 / D-047 — skaermbilleder af den nye mobilstandard for T2-tabeller.
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), samme moenster som 3521-transfers-menu-badge.shots.mjs: koerer mod
// en koerende preview/dev-server med e2e-netvaerksmocks og fixturens login.
//
//   node tests/e2e/5102-mobile-table-standard.shots.mjs [baseURL] [outDir]
//
// Fire billeder:
//   5102-mobile-default             375x812, Mit hold i standardtilstand
//                                   (navn + OVR + vaerdi + loen, ingen scroll)
//   5102-mobile-chip-swapped        375x812, en chip byttet ind
//   5102-mobile-full-table-abilities 375x812, "Fuld tabel" scrollet til evnerne
//   5102-desktop-unchanged          1280x800, desktop skal vaere uaendret

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5199";
const OUT = resolve(process.argv[3] || resolve(__dirname, "screenshots"));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function openTeam(viewport) {
  const context = await browser.newContext({ baseURL: BASE, viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await stabilizePage(page);
  await login(page);
  await page.goto("/team");
  await page.locator("table").first().waitFor();
  await page.waitForTimeout(400); // font/paint settle
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });

// ── Mobil ──────────────────────────────────────────────────────────────────
{
  const { context, page } = await openTeam({ width: 375, height: 812 });

  // 1) Standardtilstand: navnekolonnen + tre talkolonner, ingen vandret scroll.
  await shot(page, "5102-mobile-default");

  // 2) Byt en kolonne: foerste chip der IKKE allerede er valgt.
  const chips = page.locator('[role="group"] button');
  const chipCount = await chips.count();
  for (let i = 0; i < chipCount; i += 1) {
    const chip = chips.nth(i);
    if ((await chip.getAttribute("aria-pressed")) === "false") {
      await chip.click();
      break;
    }
  }
  await page.waitForTimeout(250);
  await shot(page, "5102-mobile-chip-swapped");

  // 3) "Fuld tabel" + swipe datablokken helt ud til evnerne. Mit holds evner
  // ligger i "Evner"-segmentet, saa det slaas til foerst.
  await page.getByRole("button", { name: /^(Evner|Abilities)$/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /fuld tabel|full table/i }).click();
  await page.waitForTimeout(300);
  const scroller = page.locator("div.overflow-x-auto").last();
  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(300);
  await shot(page, "5102-mobile-full-table-abilities");

  await context.close();
}

// ── Desktop (skal vaere uaendret) ──────────────────────────────────────────
{
  const { context, page } = await openTeam({ width: 1280, height: 800 });
  await shot(page, "5102-desktop-unchanged");
  await context.close();
}

await browser.close();
console.log(`[5102] Skaermbilleder skrevet til ${OUT}`);
