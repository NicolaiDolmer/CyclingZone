// #5495 — skaermbilleder af den nye Explore-footer paa landing ("/") til
// PR-body. Ad-hoc capture-script (ikke i CI-suiten; testMatch fanger kun
// *.spec.js), samme moenster som 5449-tailwind-content.shots.mjs: scriptet
// starter selv den statiske server (kraever 'npm run build' foerst) paa
// worktreets egen port og lukker den igen.
//
//   node tests/e2e/5495-footer-links.shots.mjs <outDir>

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, "../..");
const { resolveRuntimePort } = await import(pathToFileURL(resolve(FRONTEND, "playwright.ports.js")).href);

const OUT = resolve(process.argv[2] || resolve(__dirname, "screenshots-5495"));
const PORT = resolveRuntimePort(FRONTEND);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`static server kom aldrig op paa ${url}`);
}

mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  [resolve(FRONTEND, "scripts/e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: FRONTEND, stdio: "inherit" },
);

let browser;
try {
  await waitForServer(`${BASE}/app.html`);
  browser = await chromium.launch();

  const VIEWPORTS = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("cz_lang", "en");
      // Undertrykker cookie-consent-banneret, som ellers overlejrer footeren.
      window.localStorage.setItem("cz_consent_v1", JSON.stringify({
        version: 1, necessary: true, analytics: false, marketing: false,
        email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
      }));
    });
    await page.goto("/");
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await footer.screenshot({ path: resolve(OUT, `5495-landing-footer-${vp.name}.png`) });
    await context.close();
  }

  console.log(`[5495] Screenshots -> ${OUT}`);
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill();
  }
}
