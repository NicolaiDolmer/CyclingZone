// #7982: annoteret billede af 'Koert'-tilstanden i traeningsgitteret (Fable-dom 16/11, #7801).
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun *.spec.*). Samme moenster
// som 7982-race-session-settled.shots.mjs: scriptet starter og draeber sin EGEN statiske server.
// Opdigtede navne (Ada Pedersen, Bo Lund); intet prod-kald.
//
// HVAD BILLEDET VISER. Den hyppigste tilstand er ikke "etapen er afgjort", men "efter et Traen nu-tryk":
// alle trænede felter i dag har en kvittering og staar som 'Koert' og laast, mens en holdkammerat
// stadig venter paa sit loeb. Tre udsnit af samme gitter (kontakten on):
//   1. Ada foer Traen nu          - sessionernes navne staar i felterne
//   2. Ada efter Traen nu         - alle felter 'Koert', navnene er vaek
//   3. Bo, venter paa sit loeb    - to felter 'Koert', loebets felt 'Etape' (laast af loebet)
//
// Byg frontend foerst (ellers serveres en gammel dist):
//   npm --prefix frontend run build
//   node frontend/tests/e2e/7982-ran-state.shots.mjs [outDir] [port]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "../..");
const { installNetworkMocks, TEST_USER, TEST_TEAM, RIDERS, json, corsHeaders } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const HOST = "127.0.0.1";
const PORT = Number(process.argv[3] || 4797);
const BASE = `http://${HOST}:${PORT}`;
const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../pr-screens/7982"));

const server = spawn(
  process.execPath,
  [resolve(frontendRoot, "scripts/e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: frontendRoot, stdio: ["ignore", "pipe", "pipe"] },
);
server.stderr.on("data", (b) => process.stderr.write(`[static] ${b}`));

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/app.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`statisk server kom aldrig op paa ${BASE}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function stabilize(page, theme) {
  await page.addInitScript((mode) => {
    window.localStorage.setItem("cz_lang", "da");
    window.localStorage.setItem("cz_theme", mode);
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
  }, theme);
}

async function login(page) {
  await page.goto("/login");
  await page.getByPlaceholder("din@email.dk").waitFor();
  await page.getByPlaceholder("din@email.dk").fill(TEST_USER.email);
  await page.locator("#auth-password").fill("playwright-password");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.waitForURL(/\/dashboard$/);
}

const base = RIDERS.find((r) => r.team_id === TEST_TEAM.id) || RIDERS[0];
const mk = (id, firstname, lastname) => ({
  ...base, id, firstname, lastname, primary_type: "climber",
  team_id: TEST_TEAM.id, team: { id: TEST_TEAM.id, name: TEST_TEAM.name }, is_academy: false,
});
const ada = mk("rider-shot-7982-ada", "Ada", "Pedersen");
const bo = mk("rider-shot-7982-bo", "Bo", "Lund");
const TEAM = [ada, bo];

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SESSION = { mon: "vo2max", tue: "endurance", wed: "recovery", thu: "threshold", fri: "vo2max", sat: "endurance", sun: "rest" };
const INTENSITY = { vo2max: "hard", endurance: "normal", recovery: "easy", threshold: "hard", rest: "rest" };
const weekDays = Object.fromEntries(WEEKDAYS.map((w) => [w, { session: SESSION[w], intensity: INTENSITY[SESSION[w]] }]));

function trainingMe() {
  return {
    enabled: true, betaTester: true, mobileTable: true, teamId: TEST_TEAM.id,
    slots: { total: null, used: 2, remaining: null },
    focuses: ["vo2max", "threshold", "endurance"], intensities: ["easy", "normal", "hard", "rest"],
    plans: Object.fromEntries(TEAM.map((r) => [r.id, { focus: "vo2max", intensity: "normal" }])),
    condition: Object.fromEntries(TEAM.map((r) => [r.id, { form: 61, fatigue: 58, injured_until: null, risk: 0 }])),
    progress: {}, capped: {}, trainability: {}, smartDefaultFocus: {},
    weekPlan: null, riderWeekPlans: Object.fromEntries(TEAM.map((r) => [r.id, weekDays])), todayRun: null,
    dayClose: { open: false, reason: "awaiting_finalization", gameDays: [41, 42, 43, 44, 45], opensAtHour: 20 },
  };
}

// Kontakten on, datoen aaben. Ada traenede alle tre felter (ingen loeb); Bo traenede to og venter paa
// sit loeb i felt 3 (slot 2), saa kun hans loebsfelt er laast af loebet endnu.
const FORECAST_BEFORE = {
  available: true, settled: false, raceSessionSettle: { fatigueNow: true },
  riders: {
    [ada.id]: { fatigue: 58, band: "ok", raceSlots: [], ranSlots: [] },
    [bo.id]: { fatigue: 58, band: "ok", raceSlots: [2], ranSlots: [] },
  },
};
const FORECAST_AFTER = {
  available: true, settled: false, raceSessionSettle: { fatigueNow: true },
  riders: {
    [ada.id]: { fatigue: 64, band: "ok", raceSlots: [], ranSlots: [0, 1, 2] },
    [bo.id]: { fatigue: 64, band: "ok", raceSlots: [2], ranSlots: [0, 1] },
  },
};

const PANELS = [
  { rider: ada, forecast: FORECAST_BEFORE, key: "ada-foer" },
  { rider: ada, forecast: FORECAST_AFTER, key: "ada-efter" },
  { rider: bo, forecast: FORECAST_AFTER, key: "bo-venter" },
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

const preflight = (route) => {
  const request = route.request();
  if (request.method() !== "OPTIONS") return false;
  route.fulfill({ status: 204, headers: corsHeaders(request) });
  return true;
};

async function capturePanel(browser, viewport, panel) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, locale: "en-US",
    colorScheme: "light",
  });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.route("**/rest/v1/riders**", (route) => {
    if (preflight(route)) return undefined;
    const url = route.request().url();
    if (route.request().method() !== "GET") return json(route, {});
    if (url.includes("pending_team_id=eq.")) return json(route, []);
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) return json(route, TEAM);
    return json(route, RIDERS);
  });
  await page.route("**/rest/v1/training_day_runs**", (route) => (preflight(route) ? undefined : json(route, [])));
  await page.route("**/api/training/me**", (route) => (preflight(route) ? undefined : json(route, trainingMe())));
  await page.route("**/api/training/train-now**", (route) => (preflight(route) ? undefined : json(route, { enabled: false })));
  await page.route("**/api/training/programs/forecast**", (route) => (preflight(route) ? undefined : json(route, panel.forecast)));
  await page.route("**/api/training/programs", (route) => (preflight(route) ? undefined : json(route, {
    enabled: false, cellsEnabled: true, seeds: {}, catalog: [], assigned: {},
  })));
  await stabilize(page, "light");
  await login(page);
  await page.goto("/training?tab=weekplan");
  await page.getByTestId("training-plan-for").waitFor();
  await page.getByTestId("training-plan-for").selectOption(panel.rider.id);
  const grid = page.getByTestId("training-program-grid");
  await grid.waitFor();
  if (panel.key === "ada-foer") {
    // Foer: ingen kvitteringer endnu, saa ingen felter er laast.
    await page.waitForTimeout(500);
  } else {
    await page.getByTestId("training-program-cell-locked").first().waitFor();
    await page.waitForTimeout(300);
  }
  await grid.scrollIntoViewIfNeeded();
  const gridBox = await grid.boundingBox();
  const locked = page.getByTestId("training-program-cell-locked");
  const lockedCount = await locked.count();
  let todayBox = null;
  if (lockedCount > 0) {
    const boxes = [];
    for (let i = 0; i < lockedCount; i += 1) boxes.push(await locked.nth(i).boundingBox());
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width));
    const y1 = Math.max(...boxes.map((b) => b.y + b.height));
    todayBox = { x: x0 - gridBox.x, y: y0 - gridBox.y, width: x1 - x0, height: y1 - y0 };
  } else {
    // Foer: markér dagens raekke ud fra de to vaerdier, der er aabne; ingen kvittering = ingen ramme.
    todayBox = null;
  }
  const png = await grid.screenshot();
  const info = { png: png.toString("base64"), width: Math.round(gridBox.width), height: Math.round(gridBox.height), todayBox, lockedCount };
  await context.close();
  return info;
}

function composite(viewport, shots) {
  const mobile = viewport.width < 600;
  const panelW = mobile ? viewport.width - 32 : 1000;
  const labels = [
    { n: 1, title: "Ada, før Træn nu", note: "Sessionens navn står i hvert felt." },
    { n: 2, title: "Ada, efter Træn nu", note: "Alle trænede felter står «Kørt» og er låst. Sessionens navn er væk." },
    { n: 3, title: "Bo, venter på sit løb", note: "To felter er «Kørt», løbets felt står «Etape» og er låst af løbet." },
  ];
  const cards = shots.map((s, i) => {
    const scale = panelW / s.width;
    const frame = s.todayBox
      ? `<div class="frame" style="left:${s.todayBox.x * scale - 3}px;top:${s.todayBox.y * scale - 3}px;width:${s.todayBox.width * scale + 6}px;height:${s.todayBox.height * scale + 6}px"></div>`
      : "";
    return `<section class="card"><h2><span class="badge">${labels[i].n}</span>${labels[i].title}</h2>
      <div class="shot" style="width:${panelW}px;height:${Math.round(s.height * scale)}px"><img src="data:image/png;base64,${s.png}" style="width:${panelW}px">${frame}</div>
      <p>${labels[i].note}</p></section>`;
  }).join("");
  const head = `<header><h1>Efter Træn nu: felterne står «Kørt» i stedet for sessionens navn</h1>
    <p>Dagens felter i træningsplanen, kontakten tændt. Den røde ramme er dagens felter. Spørgsmål til ejeren: skal sessionens navn blive stående i et kørt felt (fx «Kørt · VO2max»), eller er «Kørt» nok?</p></header>`;
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px 32px 32px; background: #f6f4ee; color: #1b1b1b; font: 14px/1.4 system-ui, sans-serif; width: ${viewport.width}px; }
    header h1 { font-size: ${mobile ? 17 : 22}px; margin: 0 0 6px; }
    header p { margin: 0 0 16px; color: #444; }
    .row { display: flex; gap: 24px; flex-direction: column; }
    .card h2 { font-size: 15px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
    .badge { display: inline-flex; width: 22px; height: 22px; border-radius: 50%; background: #b3261e; color: #fff; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
    .shot { position: relative; border: 1px solid #d8d4c8; background: #fff; }
    .shot img { display: block; }
    .frame { position: absolute; border: 2px solid #b3261e; border-radius: 4px; pointer-events: none; }
    .card p { margin: 8px 0 0; color: #333; font-size: 13px; }
  </style></head><body>${head}<div class="row">${cards}</div></body></html>`;
}

mkdirSync(OUT, { recursive: true });
let browser;
try {
  await waitForServer();
  // CZ_CHROMIUM_PATH: peg paa en eksisterende Chromium/Chrome, naar Playwrights egen build mangler.
  browser = await chromium.launch(process.env.CZ_CHROMIUM_PATH ? { executablePath: process.env.CZ_CHROMIUM_PATH } : {});
  for (const viewport of VIEWPORTS) {
    const shots = [];
    for (const panel of PANELS) shots.push(await capturePanel(browser, viewport, panel));
    const html = composite(viewport, shots);
    const compCtx = await browser.newContext({ viewport: { width: viewport.width, height: 600 }, deviceScaleFactor: 1 });
    const compPage = await compCtx.newPage();
    await compPage.setContent(html);
    await compPage.waitForTimeout(200);
    await compPage.screenshot({ path: resolve(OUT, `7982-koert-tilstand-${viewport.name}.png`), fullPage: true });
    await compCtx.close();
    console.log(`7982-koert-tilstand-${viewport.name}.png: lockedCount ${shots.map((s) => s.lockedCount).join("/")}`);
  }
  console.log(`Billeder -> ${OUT}`);
} finally {
  await browser?.close();
  server.kill();
}
