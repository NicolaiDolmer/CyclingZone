// #5848: fotograferer /board/meeting (desktop 1440 + mobil 375). Ad-hoc capture-script, ikke en del af CI-suiten.
// Serverer en allerede bygget dist/; /api/board/* leveres af preview-mockens boardMeetingMock.
//
//   node tests/e2e/5848-board-meeting.shots.ts [outDir] [--before] [--exe=<chrome>]
import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);

// Mocken importerer en .json uden import-attribut, hvilket node ikke tillader. Laes fixturen selv.
const mockSrc = resolve(__dirname, "../../src/preview/boardMeetingMock.js");
const fixturePath = resolve(__dirname, "../../src/pages/boardroom/__fixtures__/boardRoom.json");
const patched = readFileSync(mockSrc, "utf8").replace(
  /import boardRoomFixture from [^;]+;/,
  `import { readFileSync } from "node:fs"; const boardRoomFixture = JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, "utf8"));`,
);
const patchedPath = resolve(__dirname, "../../node_modules/.cache/boardMeetingMock.patched.mjs");
mkdirSync(dirname(patchedPath), { recursive: true });
writeFileSync(patchedPath, patched);
const { boardMeetingMockRoute } = await import(pathToFileURL(patchedPath).href);

const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => !a.startsWith("--")) || resolve(__dirname, "../../../pr-screens/5852"));
const PREFIX = args.includes("--before") ? "before" : "after";
const DIST = resolve(__dirname, "../../dist");
const CHROME_EXE = args.find((a) => a.startsWith("--exe="))?.slice(6);

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
    const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 1, locale: "en-US" });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await page.route("**/api/board/**", async (route) => {
      const request = route.request();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const out = boardMeetingMockRoute(request.method(), new URL(request.url()).pathname, request.postDataJSON?.() ?? null);
      if (!out) return route.fallback();
      return route.fulfill({ status: out.status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(out.body) });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("cz_lang", "en");
      window.localStorage.setItem("cz-theme", "light");
      window.localStorage.setItem("cz_consent_v1", JSON.stringify({
        version: 1, necessary: true, analytics: false, marketing: false,
        email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
      }));
    });
    await page.goto("/login");
    await page.getByPlaceholder(/email/i).waitFor();
    await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
    await page.getByPlaceholder("••••••••").fill("playwright-password");
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard$/);
    await page.goto("/board/meeting");
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForTimeout(600);
    const sidebar = await page.locator("nav, aside").first().isVisible().catch(() => false); // catch-ok
    console.log(width, "url", page.url(), "sidebar-or-nav visible:", sidebar);
    await page.screenshot({ path: resolve(OUT, `${PREFIX}-board-meeting-${width}.png`), clip: { x: 0, y: 0, width, height: width >= 768 ? 520 : height } });
    await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
