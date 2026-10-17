// #6666 — før/efter af akademi-faciliteten på Klub-siden. "Før" = flaget
// academy_intake_pull_enabled er slukket (kortet er en "Kommer snart"-teaser);
// "efter" = flaget er tændt (købeknap, kandidater om ugen, ingen chef-linje).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist og lukker den
// igen. Kræver et e2e-build (VITE_E2E=1 m.fl., se playwright-smoke.yml). Alle data
// er fiktive; priser/upkeep er de eksisterende facilitetstrapper.
//
//   node tests/e2e/6666-academy-facility.shots.ts [outDir]   (Node 24: native TS-stripping)

import { chromium } from "@playwright/test";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/6666"));
const DIST = join(__dirname, "..", "..", "dist");

type Viewport = { name: string; width: number; height: number };
const VIEWPORTS: Viewport[] = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];
const FIXED_NOW = new Date("2026-10-05T12:00:00Z");

const PRICE: Record<number, number> = { 1: 12_000, 2: 26_000, 3: 50_000, 4: 100_000, 5: 240_000 };
const UPKEEP: Record<number, number> = { 0: 0, 1: 1_500, 2: 3_500, 3: 8_000, 4: 15_000, 5: 30_000 };
const CANDIDATES: Record<number, number> = { 0: 2, 1: 2, 2: 3, 3: 3, 4: 4, 5: 4 };

function facility(track: string, tier: number, effectLive: boolean, extra: Record<string, unknown> = {}) {
  return {
    track, tier,
    upgradePrice: tier >= 5 ? null : PRICE[tier + 1],
    tierUpkeep: UPKEEP[tier],
    staff: null, staffList: [], staffSlotsUsed: 0, staffSlotsMax: 2,
    effectiveBonus: 0, nextTierBonus: 0, effectLive,
    ...extra,
  };
}

function payloadFor(variant: "before" | "after") {
  const live = variant === "after";
  const academyTier = 2;
  return {
    facilities: [
      facility("training", 2, true, { effectiveBonus: 0.0225, nextTierBonus: 0.037 }),
      facility("scouting", 1, true, { effectiveBonus: 0.0075, nextTierBonus: 0.016 }),
      facility("medical", 0, false),
      facility("academy", live ? academyTier : 0, live, {
        staffSlotsMax: 0,
        effectiveBonus: CANDIDATES[live ? academyTier : 0],
        nextTierBonus: CANDIDATES[(live ? academyTier : 0) + 1],
      }),
      facility("commercial", 0, false),
    ],
    seasonCost: { totalUpkeep: UPKEEP[2] + UPKEEP[1] + (live ? UPKEEP[academyTier] : 0), totalPayroll: 0, balance: 500_000 },
  };
}

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CZ_CHROMIUM ? { executablePath: process.env.CZ_CHROMIUM } : {});

async function shoot(vp: Viewport, variant: "before" | "after", lang: "en" | "da") {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/club/facilities", (route) => json(route, payloadFor(variant)));
  await stabilizePage(page);
  await page.clock.setFixedTime(FIXED_NOW);
  await login(page);
  await page.addInitScript((l) => window.localStorage.setItem("cz_lang", l), lang);
  await page.goto("/klub");
  await page.getByText(lang === "en" ? /Academy Expansion/ : /Akademi-udvidelse/).first().waitFor();
  await page.waitForTimeout(400);
  const path = join(OUT, `6666-facility-${variant}-${lang}-${vp.name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(path);
  await context.close();
}

try {
  for (const vp of VIEWPORTS) {
    await shoot(vp, "before", "en");
    await shoot(vp, "after", "en");
  }
  await shoot(VIEWPORTS[0], "after", "da");
} finally {
  await browser.close();
  server.close();
}
