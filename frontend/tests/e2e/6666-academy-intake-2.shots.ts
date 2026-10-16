// #6666 — før/efter af akademiet med Optag 2.0 (hent ugens kandidater,
// potentiale læres gennem træning, akademiets profil via faciliteten).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Starter SELV en statisk server over frontend/dist og lukker den
// igen. Kræver et e2e-build (VITE_E2E=1 m.fl., se playwright-smoke.yml).
// "Før" = det spillerne ser i dag (flaget academy_intake_pull_enabled er off);
// "efter" = samme side med Optag 2.0 tændt. Alle data er fiktive.
//
//   node tests/e2e/6666-academy-intake-2.shots.ts [outDir]   (Node 24: native TS-stripping)

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
const { SEED_ACADEMY } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/seedData.js")).href
);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/6666"));
const DIST = join(__dirname, "..", "..", "dist");

type Viewport = { name: string; width: number; height: number };
const VIEWPORTS: Viewport[] = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

// Fast ur (som oevrige shots): fixtur og browserur deler samme instant, saa billederne kan genskabes.
const FIXED_NOW = new Date("2026-10-05T12:00:00Z");
const createdAt = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000).toISOString();
const expiresAt = new Date(new Date(createdAt).getTime() + 7 * 86_400_000).toISOString();
// Display-safe nuvaerende evner (kun registry-noegler), fiktive vaerdier.
const ABILITIES = [
  { climbing: 62, tempo: 55, endurance: 58, punch: 44, sprint: 31, flat: 40, recovery: 52 },
  { climbing: 57, tempo: 49, punch: 53, endurance: 50, sprint: 38, flat: 42, recovery: 47 },
  { flat: 60, cobblestone: 64, tempo: 56, endurance: 54, sprint: 45, punch: 48, positioning: 51 },
];
type PulledRow = [string, string, string, string, string, string, number];
const PULLED = ([
  ["Mathias", "Holm", "2009-06-15", "dk", "climber", "gc", 3200],
  ["Oskar", "Lind", "2008-06-15", "se", "climber", "puncheur", 2100],
  ["Pieter", "Claes", "2007-06-15", "be", "rouleur", "brostensrytter", 4400],
] as PulledRow[]).map(([firstname, lastname, birthdate, nat, p, s, value], i) => ({
  intakeId: `pull-${i}`,
  riderId: `pull-r${i}`,
  is_serious: false,
  status: "offered",
  source: "pull",
  created_at: createdAt,
  expiresAt,
  signingFee: Math.round(value * 0.25),
  wagePreview: 6000,
  targetSquad: Number(birthdate.slice(0, 4)) >= 2008 ? "junior" : "u23",
  rider: {
    id: `pull-r${i}`, firstname, lastname, birthdate, nationality_code: nat,
    base_value: value, market_value: value, prize_earnings_bonus: 0, team_id: null,
    primary_type: p, secondary_type: s,
  },
  potentialEstimate: null,
  potentialBand: null,
  potentialLearned: true,
  rider_derived_abilities: ABILITIES[i],
}));

const ROSTER_PROGNOSIS = [
  { stage: "broad", daysOnTeam: 14, nextStageDays: 16, band: { role: "climber", lo: 41, hi: 63 } },
  { stage: "learning", daysOnTeam: 4, nextStageDays: 6, band: null },
];

const PROFILE = {
  tier: 3,
  candidatesPerWeek: 3,
  slots: { origins: 1, types: 1, extra: 0 },
  active: { origins: ["region:nordic"], types: ["climber"], effectiveFrom: "2026-10-01T10:00:00Z" },
  pending: null,
  options: {
    nations: ["FR", "IT", "BE", "ES", "NL", "CO", "CN", "GB", "US", "DE", "DK", "AU", "JP", "NO", "PT", "PL", "AR", "CZ", "KR", "NZ", "CA", "CH", "AT", "SE", "SI", "DZ", "ER", "RW", "MA", "BR"],
    regions: ["nordic", "benelux", "iberia", "german_speaking", "central_europe", "english_speaking", "latin_america", "east_asia", "africa"],
    types: ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"],
    delayDays: 14,
  },
};

function payloadFor(variant: "before" | "after") {
  if (variant === "before") return { ...SEED_ACADEMY, intakePull: { enabled: false, pulledThisWeek: false } };
  return {
    ...SEED_ACADEMY,
    intake: PULLED,
    roster: SEED_ACADEMY.roster.map((r: Record<string, unknown>, i: number) => ({ ...r, prognosis: ROSTER_PROGNOSIS[i % ROSTER_PROGNOSIS.length] })),
    intakePull: { enabled: true, pulledThisWeek: true },
    academyProfile: PROFILE,
  };
}

const serve = sirv(DIST, { single: "app.html", etag: true, dev: true });
const server = http.createServer(serve);
server.keepAliveTimeout = 0;
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CZ_CHROMIUM ? { executablePath: process.env.CZ_CHROMIUM } : {});

async function shoot(vp: Viewport, variant: "before" | "after", extra = "") {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  const payload = extra === "not-pulled"
    ? { ...payloadFor("after"), intake: [], intakePull: { enabled: true, pulledThisWeek: false } }
    : payloadFor(variant);
  await page.route("**/api/academy/me**", (route) => json(route, payload));
  await stabilizePage(page);
  await page.clock.setFixedTime(FIXED_NOW);
  await login(page);
  await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  await page.goto("/academy");
  await page.getByText(/Academy roster/i).first().waitFor();
  if (variant === "after") await page.getByTestId("academy-profile").waitFor();
  await page.waitForTimeout(400);
  const path = join(OUT, `6666-${variant}${extra ? `-${extra}` : ""}-${vp.name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(path);
  await context.close();
}

try {
  for (const vp of VIEWPORTS) {
    await shoot(vp, "before");
    await shoot(vp, "after");
    await shoot(vp, "after", "not-pulled");
  }
} finally {
  await browser.close();
  server.close();
}
