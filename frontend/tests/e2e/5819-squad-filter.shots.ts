// #5819: maal og fotografer trup-filteret paa My Team (Senior / U23 / Junior).
// Ad-hoc capture-script, ikke en del af CI-suiten (testMatch fanger kun *.spec.*).
// Serverer en allerede bygget dist/ fra en sirv-server inde i processen; data er preview-mockens seed.
//
//   node tests/e2e/5819-squad-filter.shots.ts [outDir] [--before]
import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { PREVIEW_YOUTH_RIDERS } = await import(pathToFileURL(resolve(__dirname, "../../src/preview/youthSquadsMock.ts")).href);
const { wantsObject } = await import(pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href);

const { installOptOutMocks } = await import(pathToFileURL(resolve(__dirname, "5944-mocks.ts")).href);

const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => !a.startsWith("--")) || resolve(__dirname, "../../../pr-screens/5852"));
const PREFIX = args.includes("--before") ? "before" : "after";
const DIST = resolve(__dirname, "../../dist");
// Valgfri: peg paa en allerede installeret browser naar Playwright-versionen ikke matcher cachen.
const CHROME_EXE = args.find((a) => a.startsWith("--exe="))?.slice(6);

async function shoot(browser: Browser, base: string, { width, height, lang }: { width: number; height: number; lang: string }) {
  const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 1, locale: "en-US" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installOptOutMocks(page, { available: false, trainOnly: false, puts: [] });
  await page.addInitScript((l: string) => {
    window.localStorage.setItem("cz_lang", l);
    window.localStorage.setItem("cz-theme", "light");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, lang);
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in|log ind/i }).click();
  await page.waitForURL(/\/dashboard$/);
  const roster = [RIDERS.find((r) => r.id === "rider-1"), ...PREVIEW_YOUTH_RIDERS.map((r) => ({ ...r, pending_team_id: null }))];
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fallback();
    const url = request.url();
    const asSingle = (rows: unknown[]) => (wantsObject(request.headers().accept || "") ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle(roster));
    return route.fallback();
  });
  await page.goto("/team");
  const filter = page.getByTestId("squad-group-filter");
  await filter.waitFor();
  await page.waitForTimeout(400);
  const metrics = await filter.evaluate((el) => {
    const q = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { t: e.textContent, x: Math.round(r.x), y: Math.round(r.y * 10) / 10, w: Math.round(r.width), h: Math.round(r.height * 10) / 10, fs: cs.fontSize, ff: cs.fontFamily.slice(0, 30), fw: cs.fontWeight };
    };
    return [...el.children].map(q);
  });
  const box = await filter.boundingBox();
  if (!box) throw new Error("squad-group-filter har ingen bounding box");
  const pad = 14;
  const area = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: width - Math.max(0, box.x - pad), height: box.height + pad * 2 };
  await page.screenshot({ path: resolve(OUT, `${PREFIX}-filter-${lang}-${width}.png`), clip: area });
  await context.close();
  return metrics;
}

async function main() {
  if (!existsSync(DIST)) throw new Error(`Ingen dist/ i ${DIST}. Byg foerst.`);
  mkdirSync(OUT, { recursive: true });
  const handler = sirv(DIST, { single: true, etag: true, dev: true });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch(CHROME_EXE ? { executablePath: CHROME_EXE } : {});
  try {
    for (const [width, height] of [[1440, 900], [375, 812]]) {
      for (const lang of ["en", "da"]) {
        console.log(width, lang, JSON.stringify(await shoot(browser, base, { width, height, lang }), null, 0));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
