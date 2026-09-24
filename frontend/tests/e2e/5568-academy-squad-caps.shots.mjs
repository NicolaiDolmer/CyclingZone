// #5568 — screenshots af loftet pr. ungdomstrup (U23 12 / junior 10) på de tre
// flader der før talte mod det flade akademi-loft på 8:
//   (a) budrummet på /auctions: ungdomsauktion, fuld seniortrup, 8 U23-ryttere
//       (bud tilladt -> "joins your U23 team") og 12 U23-ryttere (spærret med
//       U23-loftet),
//   (b) nedrykningsdialogen på rytterprofilen ("U23 team places 8 / 12 -> 9 / 12"),
//   (c) akademi-sidens trup-linje ("U23 8/12 · Junior 3/10").
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist i samme proces
// og lukker den igen, så intet overlever kørslen. Kræver et e2e-build
// (VITE_E2E=1 m.fl., se playwright-smoke.yml).
//
//   node tests/e2e/5568-academy-squad-caps.shots.mjs [outDir]

import { chromium } from "@playwright/test";
import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { AUCTIONS, RIDERS, TEST_TEAM } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens"));
const DIST = join(__dirname, "..", "..", "dist");

// Mock-scenarie (kun i denne proces): egen rytter er 21 (U23-alder) og kan
// rykkes ned; auktionsrytteren er 20 (lander på U23-holdet ved akademi-fallback).
RIDERS[0].birthdate = "2005-03-01";
RIDERS[1].birthdate = "2006-06-01";
const YOUTH_AUCTION = { ...AUCTIONS[0], is_youth: true, rider: RIDERS[1] };

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// HEAD-optællinger (head: true) på riders: seniortruppen fuld (30), U23 og junior
// efter scenariet. Alt andet går til den generiske mock.
async function mockCounts(page, { u23, junior }) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "HEAD") return route.fallback();
    const url = request.url();
    const n = url.includes("squad=eq.u23") ? u23
      : url.includes("squad=eq.junior") ? junior
        : url.includes("is_academy=eq.false") ? 30
          : null;
    if (n === null) return route.fallback();
    return json(route, Array.from({ length: n }, (_, i) => ({ id: `mock-${i}` })));
  });
}

async function newPage(vp, counts) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await mockCounts(page, counts);
  await page.route("**/rest/v1/auctions**", (route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.url().includes("status=eq.completed")) return route.fallback();
    return json(route, [YOUTH_AUCTION]);
  });
  await page.route("**/api/academy/me**", (route) => json(route, {
    enabled: true,
    squads: { u23: { used: counts.u23, max: 12 }, junior: { used: counts.junior, max: 10 } },
    seniorCount: 30,
    seniorMax: 30,
    roster: [],
    intake: [],
    graduations: [],
    intakePull: { enabled: false, pulledThisWeek: false },
  }));
  await page.route("**/api/riders/*/academy-demote-quote**", (route) => json(route, {
    currentSalary: 12000,
    newSalary: 12000,
    keepsContract: true,
    racesCleared: 0,
    racesOngoing: 0,
    targetSquad: "u23",
    squadUsed: counts.u23,
    squadMax: 12,
  }));
  await stabilizePage(page);
  await login(page);
  // EN først (spillertekst er EN-first). stabilizePage låser DA til login-flowet;
  // dette init-script kører efter det og vinder på de følgende sidevisninger.
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  return { context, page };
}

for (const vp of VIEWPORTS) {
  const visible = vp.name.startsWith("desktop") ? "table" : ".md\\:hidden";

  // (a1) 8 U23-ryttere: før #5568 spærret ("academy 8/8"), nu tilladt til U23.
  {
    const { context, page } = await newPage(vp, { u23: 8, junior: 3 });
    await page.goto("/auctions");
    await page.getByTestId("auctions-ticker").waitFor();
    await page.locator(visible).getByText(/joins your U23 team/).first().waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `5568-bid-room-u23-8-${vp.name}.png`) });
    await context.close();
  }

  // (a2) 12 U23-ryttere + fuld seniortrup: spærret med U23-loftet.
  {
    const { context, page } = await newPage(vp, { u23: 12, junior: 3 });
    await page.goto("/auctions");
    await page.getByTestId("auctions-ticker").waitFor();
    await page.locator(visible).getByText(/No room on your U23 team \(12\/12\)/).first().waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `5568-bid-room-u23-12-${vp.name}.png`) });
    await context.close();
  }

  // (b) nedrykningsdialogen på rytterprofilen.
  {
    const { context, page } = await newPage(vp, { u23: 8, junior: 3 });
    await page.goto(`/riders/${RIDERS[0].id}`);
    await page.getByRole("button", { name: "Move to academy" }).click();
    await page.getByRole("dialog").getByText("U23 team places").waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `5568-demote-dialog-${vp.name}.png`) });
    await context.close();
  }

  // (c) akademi-sidens trup-linje.
  {
    const { context, page } = await newPage(vp, { u23: 8, junior: 3 });
    await page.goto("/academy");
    await page.getByTestId("academy-squad-caps").waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, `5568-academy-header-${vp.name}.png`) });
    await context.close();
  }
}

await browser.close();
await new Promise((ok) => server.close(ok));
console.log(`[5568] screenshots -> ${OUT} (team ${TEST_TEAM.id})`);
