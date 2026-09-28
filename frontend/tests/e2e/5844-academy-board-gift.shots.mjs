// #5844 — før/efter-screenshots af akademiet med bestyrelsens gave-kuld
// ("A thank-you from the board"): 10 tilbud (5 U23-alder + 5 junior-alder),
// gratis signing, 14 dages frist, egen sektion over det normale optag.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist og lukker den
// igen. Kræver et e2e-build (VITE_E2E=1 m.fl., se playwright-smoke.yml).
//
//   node tests/e2e/5844-academy-board-gift.shots.mjs [outDir]

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
const { SEED_ACADEMY } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens"));
const DIST = join(__dirname, "..", "..", "dist");

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

// Fiktive gave-kandidater (ingen prod-data). e2e-mocken kører sæson 1 (referenceår 2026):
// U23-alder 19-21 → født 2005-2007, junior-alder 16-18 → født 2008-2010.
const GIFT = [
  ["Mathias", "Holm", "2006-06-15", "dk", "climber", "gc", 3.5, 5.0, true],
  ["Rasmus", "Vinther", "2007-06-15", "dk", "sprinter", "rouleur", 1.5, 2.5, false],
  ["Pieter", "Claes", "2005-06-15", "be", "brostensrytter", "rouleur", 2.0, 3.0, false],
  ["Lorenzo", "Ferri", "2006-06-15", "it", "puncheur", "climber", 1.5, 2.0, false],
  ["Jonas", "Aas", "2007-06-15", "no", "tt", "rouleur", 1.0, 2.0, false],
  ["Oscar", "Lind", "2009-06-15", "dk", "climber", "puncheur", 2.5, 3.5, false],
  ["Noah", "Brandt", "2010-06-15", "dk", "sprinter", "baroudeur", 1.0, 1.5, false],
  ["Arne", "Peeters", "2008-06-15", "be", "rouleur", "tt", 1.5, 2.5, false],
  ["Elia", "Conti", "2009-06-15", "it", "gc", "climber", 2.0, 3.0, false],
  ["Magnus", "Dahl", "2010-06-15", "no", "baroudeur", "sprinter", 1.0, 2.0, false],
];
const now = Date.now();
const createdAt = new Date(now - 60 * 60 * 1000).toISOString();
const expiresAt = new Date(new Date(createdAt).getTime() + 14 * 86_400_000).toISOString();
const GIFT_INTAKE = GIFT.map(([firstname, lastname, birthdate, nat, p, s, lo, hi, serious], i) => ({
  intakeId: `gift-${i}`,
  riderId: `gift-r${i}`,
  is_serious: serious,
  status: "offered",
  source: "board_gift",
  created_at: createdAt,
  expiresAt,
  signingFee: 0,
  wagePreview: 6000,
  targetSquad: Number(birthdate.slice(0, 4)) >= 2008 ? "junior" : "u23",
  rider: {
    id: `gift-r${i}`, firstname, lastname, birthdate, nationality_code: nat,
    base_value: 60000, market_value: 60000, prize_earnings_bonus: 0, team_id: null,
    primary_type: p, secondary_type: s,
  },
  potentialEstimate: { lo, hi, exact: false, scoutLevel: 3 },
  // #5844 (ejer 28/9): potentiale som tal. Prod leverer båndet fra de afledte evner.
  potentialBand: {
    role: p,
    now: 12 + i,
    prog: { lo: Math.round(18 + lo * 8), hi: Math.round(22 + hi * 9) },
    ceil: { lo: Math.round(18 + lo * 8), hi: Math.round(22 + hi * 9) },
  },
}));

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

mkdirSync(OUT, { recursive: true });
// CZ_CHROMIUM: sti til en forudinstalleret Chromium (fx cloud-containere).
const browser = await chromium.launch(process.env.CZ_CHROMIUM ? { executablePath: process.env.CZ_CHROMIUM } : {});

async function shoot(vp, variant) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  const payload = {
    ...SEED_ACADEMY,
    intakePull: { enabled: false, pulledThisWeek: false },
    intake: variant === "after" ? [...GIFT_INTAKE, ...SEED_ACADEMY.intake] : SEED_ACADEMY.intake,
  };
  await page.route("**/api/academy/me**", (route) => json(route, payload));
  await stabilizePage(page);
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/academy");
  await page.getByText(/Intake candidates/i).first().waitFor();
  if (variant === "after") await page.getByTestId("academy-board-gift").waitFor();
  await page.waitForTimeout(400);
  const path = join(OUT, `5844-${variant}-${vp.name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(path);
  await context.close();
}

try {
  for (const vp of VIEWPORTS) {
    await shoot(vp, "before");
    await shoot(vp, "after");
  }
} finally {
  await browser.close();
  server.close();
}
