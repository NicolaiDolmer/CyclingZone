// #5944 — ét annoteret før/efter-billede til PR'en (pr-screens/5944/before-after.png).
// Ad-hoc capture-script, ikke en del af CI-suiten (testMatch fanger kun *.spec.*).
// Regressions-dækningen ligger i 5944-youth-race-opt-out.spec.ts.
//
// Serverer en allerede bygget dist/ (e2e-env, som Playwright-webServeren bygger
// den) fra en sirv-server INDE i denne proces, så intet overlever scriptet.
// Data er preview-mockens seed + 5944-mocks.ts, ikke prod.
//
//   node tests/e2e/5944-youth-race-opt-out.shots.mjs [outDir]
//
// "I dag" = valget findes ikke (available=false, præcis dagens UI).
// "Efter" = U23-truppen sat til Train only, 1440 og 390 px.
import { chromium } from "@playwright/test";
import http from "node:http";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { installOptOutMocks } = await import(pathToFileURL(resolve(__dirname, "5944-mocks.ts")).href);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/5944"));
const DIST = resolve(__dirname, "../../dist");

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; transition-duration: 0s !important; caret-color: transparent !important; }";
    const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
    else inject();
  });
}

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder(/email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function shoot(browser, base, { available, trainOnly, width, height, file }) {
  const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 1, locale: "en-US" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installOptOutMocks(page, { available, trainOnly, puts: [] });
  await stabilizeEnglish(page);
  await login(page);
  await page.goto("/squads/u23");
  await page.getByTestId("squad-page-u23").waitFor();
  await page.getByRole("tablist").getByRole("tab", { name: /Calendar/ }).click();
  await page.getByTestId(/youth-race-row-/).first().waitFor();
  await page.waitForTimeout(400);
  const boxes = {};
  for (const id of ["youth-race-opt-out-header", "youth-race-opt-out-mobile", "youth-race-opt-out-note"]) {
    const loc = page.getByTestId(id);
    if (await loc.count() && await loc.isVisible()) boxes[id] = await loc.boundingBox();
  }
  const row = page.getByTestId(/youth-race-row-/).first();
  boxes.row = await row.boundingBox();
  const main = page.getByTestId("squad-page-u23");
  const clip = await main.boundingBox();
  const pad = 16;
  const area = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: Math.min(width, clip.width + pad * 2), height: Math.min(boxes.row.y + boxes.row.height * 3.4 - clip.y + pad * 2, height) };
  await page.screenshot({ path: resolve(OUT, file), clip: area });
  await context.close();
  const rel = {};
  for (const [k, b] of Object.entries(boxes)) if (b) rel[k] = { x: b.x - area.x, y: b.y - area.y, w: b.width, h: b.height };
  return { file, area, boxes: rel };
}

function pin(n, x, y) {
  return `<div class="pin" style="left:${x - 13}px;top:${y - 13}px">${n}</div>`;
}

async function composite(browser, shots) {
  const img = (s) => `data:image/png;base64,${readFileSync(resolve(OUT, s.file)).toString("base64")}`;
  const [before, after, phone] = shots;
  const a = after.boxes;
  const p = phone.boxes;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#111418;color:#e8e6e1;font:14px/1.45 system-ui,sans-serif;padding:28px;width:${before.area.width * 2 + 84}px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#a7a39b;margin:0 0 20px}
    .row{display:flex;gap:28px;align-items:flex-start} .col h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
    .col h2.after{color:#d8b45a} .frame{position:relative;border:1px solid #2e3238;border-radius:5px;overflow:hidden}
    .frame img{display:block} .pin{position:absolute;width:26px;height:26px;border-radius:50%;background:#d8b45a;color:#111;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #111}
    .legend{margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;max-width:${before.area.width * 2}px} .legend b{color:#d8b45a}
    .bottom{display:flex;gap:28px;margin-top:28px;align-items:flex-start}
  </style></head><body>
    <h1>#5944 · Opt out of U23/Junior races per squad</h1>
    <p class="sub">Real UI from this branch (preview data, not prod). U23 team page, Calendar tab, 1100 px and phone 390 px.</p>
    <div class="row">
      <div class="col"><h2>Today · no way to opt out</h2><div class="frame"><img src="${img(before)}"></div></div>
      <div class="col"><h2 class="after">After · set to Train only</h2><div class="frame"><img src="${img(after)}">
        ${a["youth-race-opt-out-header"] ? pin(1, a["youth-race-opt-out-header"].x - 6, a["youth-race-opt-out-header"].y + 4) : ""}
        ${a["youth-race-opt-out-note"] ? pin(2, a["youth-race-opt-out-note"].x - 6, a["youth-race-opt-out-note"].y + 4) : ""}
        ${a.row ? pin(3, a.row.x + a.row.w - 18, a.row.y + 14) : ""}
      </div></div>
    </div>
    <div class="bottom">
      <div class="col"><h2 class="after">Phone 390 px</h2><div class="frame"><img src="${img(phone)}">
        ${p["youth-race-opt-out-mobile"] ? pin(1, p["youth-race-opt-out-mobile"].x + p["youth-race-opt-out-mobile"].w - 16, p["youth-race-opt-out-mobile"].y + 4) : ""}
        ${p["youth-race-opt-out-note"] ? pin(2, p["youth-race-opt-out-note"].x + p["youth-race-opt-out-note"].w - 16, p["youth-race-opt-out-note"].y + 4) : ""}
      </div></div>
      <div class="legend">
        <div><b>1</b> One choice per youth squad in the page header: Enter races (default, as today) / Train only. On the phone it spans the full width under the title.</div>
        <div><b>2</b> A short note while the squad trains only: the assistant won't enter it, you can't enter it by hand, and the first race day it applies to. Links to Help.</div>
        <div><b>3</b> Upcoming youth races show "Not entered · training" instead of disappearing.</div>
        <div><b>Rules</b> Only race days that aren't locked change. Riders entered for a locked day keep that race. Switching back lets the assistant enter the squad from the next unlocked day. Seniors are not affected.</div>
      </div>
    </div>
  </body></html>`;
  const htmlPath = resolve(OUT, "composite.html");
  writeFileSync(htmlPath, html);
  const page = await browser.newPage({ viewport: { width: before.area.width * 2 + 140, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, "before-after.png"), fullPage: true });
  await page.close();
}

async function main() {
  if (!existsSync(DIST)) throw new Error(`Ingen dist/ i ${DIST}. Byg først (e2e-env).`);
  mkdirSync(OUT, { recursive: true });
  const handler = sirv(DIST, { single: true, etag: true, dev: true });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const shots = [
      await shoot(browser, base, { available: false, trainOnly: false, width: 1100, height: 900, file: "before-1100.png" }),
      await shoot(browser, base, { available: true, trainOnly: true, width: 1100, height: 900, file: "after-1100.png" }),
      await shoot(browser, base, { available: true, trainOnly: true, width: 390, height: 844, file: "after-390.png" }),
    ];
    await composite(browser, shots);
    console.log(`Skrevet: ${resolve(OUT, "before-after.png")}`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
