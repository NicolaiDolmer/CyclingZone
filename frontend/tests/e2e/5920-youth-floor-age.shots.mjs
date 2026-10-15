// #5907 + #5920: ét annoteret før/efter-billede til PR'en (pr-screens/5920/before-after.png).
// Ad-hoc capture-script, ikke en del af CI-suiten (testMatch fanger kun *.spec.*).
//
// Serverer en allerede bygget dist/ fra en sirv-server inde i denne proces.
// Data er preview-mockens seed + 5944-mocks.ts, ikke prod.
//
//   node tests/e2e/5920-youth-floor-age.shots.mjs [outDir]
//
// "I dag" = filteret uden alder og et løb med 3 ryttere uden advarsel (baseline: UI'et
// ændres via ?before=1-stub, så billedet bruger SAMME build: de to nye linjer skjules med CSS).
// "Efter" = alder i filteret + advarsel under Dit hold, 1440 og 390 px.
import { chromium } from "@playwright/test";
import http from "node:http";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { PREVIEW_YOUTH_RIDERS } = await import(pathToFileURL(resolve(__dirname, "../../src/preview/youthSquadsMock.ts")).href);
const { wantsObject } = await import(pathToFileURL(resolve(__dirname, "../../src/preview/mockHandlers.js")).href);
const { installOptOutMocks, RACES } = await import(pathToFileURL(resolve(__dirname, "5944-mocks.ts")).href);

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/5920"));
const DIST = resolve(__dirname, "../../dist");
const LOW_RACE = RACES[1].id;

async function stabilizeEnglish(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz-theme", "light");
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

async function setup(browser, base, { width, height }) {
  const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 1, locale: "en-US" });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installOptOutMocks(page, { available: false, trainOnly: false, puts: [] });
  // Ét løb med kun 3 manuelt udtagne ryttere; de øvrige har 6.
  await page.route("**/rest/v1/race_entries*", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    const url = decodeURIComponent(route.request().url());
    if (!url.includes(RACES[0].id)) return route.fallback();
    return json(route, RACES.flatMap((r) =>
      Array.from({ length: r.id === LOW_RACE ? 3 : 6 }, () => ({ race_id: r.id, is_auto_filled: r.id !== LOW_RACE }))));
  });
  await stabilizeEnglish(page);
  await login(page);
  return { context, page };
}

async function shootCalendar(browser, base, { width, height, file, before }) {
  const { context, page } = await setup(browser, base, { width, height });
  await page.goto("/squads/u23");
  await page.getByTestId("squad-page-u23").waitFor();
  await page.getByRole("tablist").getByRole("tab", { name: /Calendar/ }).click();
  await page.getByTestId(/youth-race-row-/).first().waitFor();
  if (before) await page.addStyleTag({ content: '[data-testid^="youth-race-below-floor-"]{display:none !important}' });
  await page.waitForTimeout(400);
  const warn = page.getByTestId(`youth-race-below-floor-${LOW_RACE}`);
  const row = page.getByTestId(`youth-race-row-${LOW_RACE}`);
  const rowBox = await row.boundingBox();
  const warnBox = before ? null : await warn.boundingBox();
  const main = page.getByTestId("squad-page-u23");
  const clip = await main.boundingBox();
  const pad = 16;
  const area = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: Math.min(width, clip.width + pad * 2), height: Math.min(rowBox.y + rowBox.height * 2.2 - clip.y + pad * 2, height) };
  await page.screenshot({ path: resolve(OUT, file), clip: area });
  await context.close();
  return { file, area, warn: warnBox ? { x: warnBox.x - area.x, y: warnBox.y - area.y, w: warnBox.width, h: warnBox.height } : null };
}

async function shootFilter(browser, base, { width, height, file, before }) {
  const { context, page } = await setup(browser, base, { width, height });
  const roster = [RIDERS.find((r) => r.id === "rider-1"), ...PREVIEW_YOUTH_RIDERS.map((r) => ({ ...r, pending_team_id: null }))];
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fallback();
    const url = request.url();
    const asSingle = (rows) => (wantsObject(request.headers().accept || "") ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, asSingle(roster));
    return route.fallback();
  });
  await page.goto("/team");
  const filter = page.getByTestId("squad-group-filter");
  await filter.waitFor();
  if (before) {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('[data-testid="squad-group-filter"] button')) {
        b.textContent = b.textContent.replace(/ · max age \d+/, "");
      }
    });
  }
  await page.waitForTimeout(300);
  const box = await filter.boundingBox();
  const pad = 14;
  const area = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: width - Math.max(0, box.x - pad), height: box.height + pad * 2 };
  await page.screenshot({ path: resolve(OUT, file), clip: area });
  const bt = await filter.getByRole("button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, t: e.textContent }; }));
  await context.close();
  const rel = bt.map((b) => ({ ...b, x: b.x - area.x, y: b.y - area.y }));
  return { file, area, buttons: rel };
}

function pin(n, x, y) {
  return `<div class="pin" style="left:${x - 13}px;top:${y - 13}px">${n}</div>`;
}

async function composite(browser, s) {
  const img = (f) => `data:image/png;base64,${readFileSync(resolve(OUT, f)).toString("base64")}`;
  const w = s.calBefore.area.width;
  const w2 = s.fltBefore.area.width;
  const u23 = s.fltAfter.buttons.find((b) => /U23/.test(b.t));
  const jun = s.fltAfter.buttons.find((b) => /Junior/.test(b.t));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f4f2ee;color:#1d1f23;font:14px/1.45 system-ui,sans-serif;padding:28px;width:${w * 2 + 84}px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#5c5a55;margin:0 0 20px}
    h3{font-size:15px;margin:22px 0 8px}
    .row{display:flex;gap:28px;align-items:flex-start} .col h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
    .col h2.after{color:#8a6a10} .frame{position:relative;border:1px solid #cfcbc3;border-radius:5px;overflow:hidden;background:#fff}
    .frame img{display:block} .pin{position:absolute;width:26px;height:26px;border-radius:50%;background:#c9a23a;color:#111;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
    .legend{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;max-width:${w * 2}px} .legend b{color:#8a6a10}
    .bottom{display:flex;gap:28px;margin-top:20px;align-items:flex-start}
  </style></head><body>
    <h1>#5907 + #5920 · Under-6 warning and age limit on U23 / Junior</h1>
    <p class="sub">Real UI from this branch (preview data, not prod). Light theme. Desktop 1440 and phone 390.</p>
    <h3>A. Youth races, Calendar: a race with fewer than 6 riders picked (U23 team page)</h3>
    <div class="row">
      <div class="col"><h2>Today</h2><div class="frame"><img src="${img(s.calBefore.file)}"></div></div>
      <div class="col"><h2 class="after">After</h2><div class="frame"><img src="${img(s.calAfter.file)}">
        ${s.calAfter.warn ? pin(1, s.calAfter.warn.x - 16, s.calAfter.warn.y + s.calAfter.warn.h / 2) : ""}
      </div></div>
    </div>
    <h3>B. My Team: age limit in the squad filter</h3>
    <div class="row">
      <div class="col"><h2>Today</h2><div class="frame"><img src="${img(s.fltBefore.file)}"></div></div>
      <div class="col"><h2 class="after">After</h2><div class="frame"><img src="${img(s.fltAfter.file)}">
        ${u23 ? pin(2, u23.x + 4, u23.y - 2) : ""}${jun ? pin(3, jun.x + 4, jun.y - 2) : ""}
      </div></div>
    </div>
    <div class="bottom">
      <div class="col"><h2 class="after">Phone 390 px · after</h2><div class="frame"><img src="${img(s.calPhone.file)}">
        ${s.calPhone.warn ? pin(1, s.calPhone.warn.x - 20, s.calPhone.warn.y + s.calPhone.warn.h / 2) : ""}
      </div>
      <h2 class="after" style="margin-top:16px">Phone 390 px · filter</h2><div class="frame" style="width:${w2 * 0 + s.fltPhone.area.width}px"><img src="${img(s.fltPhone.file)}"></div></div>
      <div class="legend">
        <div><b>1</b> An open youth race with under 6 riders picked now says so under Your team: "Under 6: add riders". Warning colour, no new control. A race with 6 or more shows nothing extra.</div>
        <div><b>2, 3</b> The filter names the age limit: U23 max age 22, Juniors max age 18. Same constants as the move-squad rules, no new rule.</div>
        <div><b>Help</b> New item under U23 team &amp; Junior team: how many riders a youth race needs (6), what happens below it, and that saving fewer is never blocked.</div>
        <div><b>Not changed</b> The race page's selection panel already warns below 6 for every race, youth included.</div>
      </div>
    </div>
  </body></html>`;
  const htmlPath = resolve(OUT, "composite.html");
  writeFileSync(htmlPath, html);
  const page = await browser.newPage({ viewport: { width: w * 2 + 140, height: 900 }, deviceScaleFactor: 1 });
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
    const s = {
      calBefore: await shootCalendar(browser, base, { width: 1440, height: 900, file: "cal-before.png", before: true }),
      calAfter: await shootCalendar(browser, base, { width: 1440, height: 900, file: "cal-after.png", before: false }),
      calPhone: await shootCalendar(browser, base, { width: 390, height: 844, file: "cal-phone.png", before: false }),
      fltBefore: await shootFilter(browser, base, { width: 1440, height: 900, file: "flt-before.png", before: true }),
      fltAfter: await shootFilter(browser, base, { width: 1440, height: 900, file: "flt-after.png", before: false }),
      fltPhone: await shootFilter(browser, base, { width: 390, height: 844, file: "flt-phone.png", before: false }),
    };
    await composite(browser, s);
    console.log(`Skrevet: ${resolve(OUT, "before-after.png")}`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
