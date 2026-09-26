// #5748 — PR-screenshots (før/efter) for "Move squad"-dialogen. Ad-hoc capture-
// script (ikke en del af CI-suiten; testMatch fanger kun *.spec.*). Regressions-
// dækningen ligger i 5748-move-squad-dialog.spec.ts.
//
// Serverer en allerede bygget dist/ (e2e-env, som Playwright-webServeren bygger
// den) fra en sirv-server INDE i denne proces, så intet overlever scriptet.
// Data er preview-mockens seed (fixtures.js), ikke prod.
//
//   node tests/e2e/5748-move-squad-dialog.shots.mjs <before|after> <outDir>
//   node tests/e2e/5748-move-squad-dialog.shots.mjs composite <outDir>
//
// Tre sager, hver i 1440 og 390 px:
//   senior17  — senior i junior-alder (sæsonalder 17)
//   junior16  — juniorrytter (sæsonalder 16)
//   senior19  — senior på 19, hvor junior er for gammel

import { chromium } from "@playwright/test";
import http from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);
const { wantsObject } = await import(
  pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href
);

const MODE = process.argv[2] || "after";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));
const DIST = resolve(__dirname, "../../dist");

const OWN = RIDERS.find((r) => r.id === "rider-1");
const CASES = {
  senior17: { rider: { ...OWN, birthdate: "2009-04-12", squad: "senior", is_academy: false }, age: 17 },
  junior16: { rider: { ...OWN, birthdate: "2010-04-12", squad: "junior", is_academy: true }, age: 16 },
  senior19: { rider: { ...OWN, birthdate: "2007-04-12", squad: "senior", is_academy: false }, age: 19 },
};
const SIZES = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
    const css = "*, *::before, *::after { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; transition-duration: 0s !important; }";
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
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

async function mockRider(page, rider) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const pool = RIDERS.map((r) => (r.id === rider.id ? rider : r));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      return json(route, asSingle(pool.filter((r) => r.id === id)));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle(pool.filter((r) => r.team_id === TEST_TEAM.id)));
    }
    return json(route, asSingle(pool));
  });
}

async function mockQuote(page, age) {
  await page.route("**/api/riders/*/academy-demote-quote**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const squad = new URL(request.url()).searchParams.get("squad") || (age <= 18 ? "junior" : "u23");
    return json(route, {
      currentSalary: 17000, newSalary: 17000, keepsContract: true, racesCleared: 2, racesOngoing: 0,
      targetSquad: squad, squadUsed: 1, squadMax: squad === "u23" ? 12 : 10,
    });
  });
}

async function openDialog(page) {
  const trigger = MODE === "after"
    ? page.getByTestId("move-squad-button")
    : page.getByRole("button", { name: /Move to (U23|Junior)|Promote to senior squad/i }).first();
  await trigger.waitFor({ timeout: 20000 });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  // Tallene er landet, når løn-rækken ikke længere viser "...".
  await page.waitForFunction(() => {
    const d = document.querySelector("[role=dialog]");
    return d && !/\.\.\./.test(d.textContent || "");
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function capture() {
  if (!existsSync(DIST)) throw new Error(`Ingen dist/ i ${DIST}. Byg først (e2e-env).`);
  const handler = sirv(DIST, { single: true, etag: true, dev: true });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [name, { rider, age }] of Object.entries(CASES)) {
      for (const size of SIZES) {
        const context = await browser.newContext({
          baseURL: base, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, locale: "en-US",
        });
        const page = await context.newPage();
        await installNetworkMocks(page);
        await mockRider(page, rider);
        await mockQuote(page, age);
        await stabilizeEnglish(page);
        await login(page);
        await page.goto(`/riders/${rider.id}`);
        await openDialog(page);
        const file = resolve(OUT, `5748-${MODE}-${name}-${size.tag}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`  ${file}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((ok) => server.close(ok));
  }
}

// Ét samlet før/efter-billede: pr. sag én række med I DAG (1440) | ANBEFALET
// (1440) | ANBEFALET (390).
async function composite() {
  const img = (f) => `data:image/png;base64,${readFileSync(resolve(OUT, f)).toString("base64")}`;
  const rows = [
    ["senior17", "Senior rider, season age 17", "Today the button locks the target to Junior; U23 can never be picked. Now all three squads, Junior preselected (his natural squad), U23 allowed upward."],
    ["junior16", "Junior rider, season age 16", "Today the only action is the jump to the senior squad. Now the same dialog: U23 preselected, senior also possible."],
    ["senior19", "Senior rider, season age 19", "Junior is shown in grey with the reason (max 18) instead of being hidden."],
  ];
  const html = `<!doctype html><html><head><style>
    body{margin:0;background:#0e0f15;color:#ededf2;font-family:Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .wrap{padding:28px 32px;width:2200px}
    h1{font-family:"Bebas Neue",Impact,sans-serif;font-weight:400;font-size:40px;margin:0 0 4px;letter-spacing:.02em}
    .sub{color:#9da0b3;margin:0 0 20px;font-size:16px}
    .row{display:grid;grid-template-columns:900px 900px 300px;gap:20px;align-items:start;margin-bottom:28px}
    .cap{grid-column:1/-1;font-size:17px;color:#9da0b3;margin-bottom:-8px}
    .cap b{color:#ededf2}
    .col h2{font-family:"Bebas Neue",Impact,sans-serif;font-weight:400;font-size:24px;margin:0 0 6px;letter-spacing:.04em}
    .today{color:#9da0b3}.rec{color:rgb(255 217 102)}
    img{width:100%;border:1px solid #2a2d3a;border-radius:5px;display:block}
  </style></head><body><div class="wrap">
    <h1>#5748 Move squad: before / after</h1>
    <p class="sub">Local build of this branch with preview-mock seed data (not prod). Left: main today. Middle and right: this PR at 1440 and 390 px.</p>
    ${rows.map(([key, title, note]) => `
      <div class="row">
        <div class="cap"><b>${title}.</b> ${note}</div>
        <div class="col"><h2 class="today">Today (main) 1440</h2><img src="${img(`5748-before-${key}-1440.png`)}"></div>
        <div class="col"><h2 class="rec">This PR 1440</h2><img src="${img(`5748-after-${key}-1440.png`)}"></div>
        <div class="col"><h2 class="rec">This PR 390</h2><img src="${img(`5748-after-${key}-390.png`)}"></div>
      </div>`).join("")}
  </div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2264, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  const file = resolve(OUT, "5748-before-after.png");
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
  console.log(`  ${file}`);
}

mkdirSync(OUT, { recursive: true });
if (MODE === "composite") await composite();
else await capture();
