// #6666 — Klub-siden retning D (kort + niveau-trappe). Rå skærmbilleder af
// Faciliteter-fanen på desktop og 375 px, lys og mørk; samles bagefter til ét
// annoteret før/efter-billede (pr-screens/6666/klub-d.png).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist og lukker den
// igen. Kræver et e2e-build (VITE_E2E=1 m.fl., se playwright-smoke.yml). Alle data
// er fiktive; priser/drift/effekter er de eksisterende facilitetstrapper.
//
//   node tests/e2e/6666-klub-d.shots.ts <outDir> <label>   (Node 24: native TS-stripping)

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

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/6666/raw"));
const LABEL = process.argv[3] || "after";
const DIST = join(__dirname, "..", "..", "dist");

type Viewport = { name: string; width: number; height: number };
const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const FIXED_NOW = new Date("2026-10-05T12:00:00Z");

const PRICE: Record<number, number> = { 1: 12_000, 2: 26_000, 3: 50_000, 4: 100_000, 5: 240_000 };
const UPKEEP: Record<number, number> = { 0: 0, 1: 1_500, 2: 3_500, 3: 8_000, 4: 15_000, 5: 30_000 };
// Træning uden chef = halv udnyttelse af grundeffekten.
const TRAINING_NO_CHEF: Record<number, number> = { 0: 0, 1: 0.015, 2: 0.0225, 3: 0.037, 4: 0.055, 5: 0.0825 };
const CANDIDATES: Record<number, number> = { 0: 2, 1: 2, 2: 3, 3: 3, 4: 3, 5: 4 };
const ACADEMY_UNLOCK: Record<number, string | null> = { 1: "origin", 2: "stronger", 3: "type", 4: "extra", 5: "stronger" };

function ladder(track: string, bonusFor: (t: number) => number) {
  return [1, 2, 3, 4, 5].map((tier) => ({
    tier, price: PRICE[tier], upkeep: UPKEEP[tier], bonus: bonusFor(tier),
    ...(track === "academy" ? { unlock: ACADEMY_UNLOCK[tier] } : {}),
  }));
}

function facility(track: string, tier: number, effectLive: boolean, bonusFor: (t: number) => number, extra: Record<string, unknown> = {}) {
  return {
    track, tier,
    upgradePrice: tier >= 5 ? null : PRICE[tier + 1],
    tierUpkeep: UPKEEP[tier],
    staff: null, staffList: [], staffSlotsUsed: 0, staffSlotsMax: 2,
    effectiveBonus: bonusFor(tier), nextTierBonus: tier >= 5 ? null : bonusFor(tier + 1), effectLive,
    ladder: ladder(track, bonusFor),
    ...extra,
  };
}

function payload(academyLive: boolean) {
  const academyTier = academyLive ? 2 : 0;
  const scoutBonus = (t: number) => [0, 0.0075, 0.016, 0.035, 0.0725, 0.15][t];
  return {
    facilities: [
      facility("training", 2, true, (t) => TRAINING_NO_CHEF[t]),
      facility("scouting", 1, true, scoutBonus),
      facility("medical", 0, false, () => 0),
      facility("academy", academyTier, academyLive, (t) => CANDIDATES[t], { staffSlotsMax: 0 }),
      facility("commercial", 0, false, () => 0, { staffSlotsMax: 2 }),
    ],
    seasonCost: { totalUpkeep: UPKEEP[2] + UPKEEP[1] + UPKEEP[academyTier], totalPayroll: 0, balance: 500_000 },
  };
}

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CZ_CHROMIUM ? { executablePath: process.env.CZ_CHROMIUM } : {});

async function shoot(vp: Viewport, theme: "light" | "dark", academyLive: boolean, lang: "en" | "da") {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: theme,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/api/club/facilities", (route) => json(route, payload(academyLive)));
  await stabilizePage(page);
  await page.clock.setFixedTime(FIXED_NOW);
  await login(page);
  await page.addInitScript(([l, th]) => {
    window.localStorage.setItem("cz_lang", l);
    window.localStorage.setItem("cz-theme", th);
  }, [lang, theme]);
  await page.goto("/klub");
  await page.getByText(lang === "en" ? /Training Center/ : /Træningscenter/).first().waitFor();
  await page.waitForTimeout(500);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > vp.width) console.warn(`ADVARSEL: vandret side-scroll ${scrollWidth}px > ${vp.width}px (${vp.name})`);
  const path = join(OUT, `${LABEL}-${vp.name}-${theme}-${academyLive ? "on" : "off"}-${lang}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(path);
  await context.close();
}

try {
  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"] as const) await shoot(vp, theme, true, "en");
  }
  await shoot(VIEWPORTS[0], "light", false, "en");
  await shoot(VIEWPORTS[0], "light", true, "da");
} finally {
  await browser.close();
  server.close();
}
