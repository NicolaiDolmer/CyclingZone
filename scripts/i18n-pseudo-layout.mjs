#!/usr/bin/env node
// #6800 — layout-sweep i pseudo-locale en-XA (+30 % tegn) paa desktop 1440x900
// og mobil 375x812.
//
//   node scripts/i18n-pseudo-layout.mjs --out <mappe> [--label before|after]
//        [--pad 30] [--pages dashboard,team] [--viewports desktop,mobile]
//        [--no-baseline] [--no-shots] [--build]
//
// Hvad den goer: starter frontendens statiske e2e-server (frontend/dist, bygget
// med VITE_E2E=1 og de e2e-mock-nøgler playwright.config.js bruger), logger ind
// mod Playwright-mocks (INGEN rigtig backend, ingen prod-kald) og aabner hver
// central side to gange pr. viewport:
//   1. baseline = almindeligt engelsk
//   2. pseudo   = ?pseudo=1&pad=30 (hver streng +30 % af sin egen laengde)
// og maaler klip/overloeb i begge. Et fund der KUN findes i pseudo er nyt og
// skyldes laengden; et der ogsaa findes i baseline er eksisterende.
//
// Maalingen (scripts/i18n-pseudo-layout.lib.mjs `measureLayout`) leder efter:
//   · siden kan scrolles vandret            · element uden for viewporten
//   · tekst klippet haardt / ellipse / clamp · element skaaret af en beholder
//   · knapper, faner og badges der ombrydes  · soeskende der overlapper
//   · bundnavigationens headroom pr. fane
//
// Output (i --out/<label>/): findings.json, report.md (maaletabeller) og — med
// skaermbilleder — <side>-<viewport>-<tilstand>.png.
//
// Tungt (build + browser): koer under verifikations-semaforen i en boelge:
//   pwsh -File scripts/verify-lock.ps1 -Max 2 -- node scripts/i18n-pseudo-layout.mjs ...
//
// Scriptet starter SELV serveren og lukker den og browseren igen. Ingen
// efterladt proces. Playwright hentes fra frontend/node_modules.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  diffFindings,
  measureLayout,
  navHeadroom,
  renderFindingsTable,
  sortFindings,
  summarize,
} from "./i18n-pseudo-layout.lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(REPO_ROOT, "frontend");
const E2E = join(FRONTEND, "tests", "e2e");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

const RACE_ID = "00000000-0000-4000-8000-000000006800";

function parseArgs(argv) {
  const opts = { label: "run", pad: 30, baseline: true, shots: true, build: false, pages: null, viewports: ["desktop", "mobile"], out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--out") opts.out = next();
    else if (a === "--label") opts.label = next();
    else if (a === "--pad") opts.pad = Number.parseInt(next(), 10);
    else if (a === "--pages") opts.pages = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--viewports") opts.viewports = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--no-baseline") opts.baseline = false;
    else if (a === "--no-shots") opts.shots = false;
    else if (a === "--build") opts.build = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (!opts.out) throw new Error("--out <mappe> mangler");
  if (!Number.isFinite(opts.pad) || opts.pad < 0) throw new Error("--pad skal vaere et tal >= 0");
  for (const v of opts.viewports) if (!VIEWPORTS[v]) throw new Error(`Ukendt viewport: ${v}`);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const OUT = resolve(opts.out, opts.label);
mkdirSync(OUT, { recursive: true });

const fixtures = await import(pathToFileURL(join(E2E, "fixtures.js")).href);
const { installNetworkMocks, installMessagesMocks, TEST_USER, json, corsHeaders } = fixtures;
const { resolveRuntimePort } = await import(pathToFileURL(join(FRONTEND, "playwright.ports.js")).href);

const PORT = resolveRuntimePort(FRONTEND);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const req = createRequire(join(FRONTEND, "package.json"));
const { chromium } = req("@playwright/test");

// ── Sider ────────────────────────────────────────────────────────────────────
// `setup` er valgfri: ekstra mocks til netop den side. Hver side faar sin egen
// Page (delt context = delt login), saa et mock aldrig laekker til naeste side.

const STAGE_RACE = {
  id: RACE_ID,
  name: "E2E Tour",
  race_type: "stage_race",
  race_class: "ProSeries",
  stages: 3,
  stages_completed: 0,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};
const STAGE_PROFILES = [
  { race_id: RACE_ID, stage_number: 1, profile_type: "flat", finale_type: "flat_sprint", demand_vector: null, distance_km: 180, elevation_gain_m: 900, climbs: null, sprints: null, sectors: null },
  { race_id: RACE_ID, stage_number: 2, profile_type: "mountain", finale_type: "summit_finish", demand_vector: null, distance_km: 165, elevation_gain_m: 3800, climbs: null, sprints: null, sectors: null },
  { race_id: RACE_ID, stage_number: 3, profile_type: "hilly", finale_type: "flat_sprint", demand_vector: null, distance_km: 190, elevation_gain_m: 1800, climbs: null, sprints: null, sectors: null },
];
const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`, name: `Rider ${i}`, suitability: 70 - i, form: 55, fatigue: 10, injured: i === 8,
}));

async function setupRace(page) {
  await page.route("**/rest/v1/races**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? STAGE_RACE : [STAGE_RACE]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, STAGE_PROFILES));
  await page.route(`**/api/races/${RACE_ID}/selection`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, {
      enabled: true, race: STAGE_RACE, size: { min: 6, max: 8 }, selection: null,
      riders: SELECTION_RIDERS, availableCount: 8, bound_riders: [],
    });
  });
}

async function setupMessages(page) {
  installMessagesMocks(page, { seedConversation: true, seedOffer: true });
}

const PAGES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "team", path: "/team" },
  { name: "riders", path: "/riders" },
  { name: "rider-profile", path: "/riders/rider-1" },
  { name: "planning", path: "/planning" },
  { name: "planning-form", path: "/planning?tab=form" },
  { name: "training", path: "/training" },
  { name: "auctions", path: "/auctions" },
  { name: "transfers", path: "/transfers" },
  { name: "inbox", path: "/notifications" },
  { name: "messages", path: "/notifications?tab=messages&c=dm-conv-1", setup: setupMessages },
  { name: "standings", path: "/standings" },
  { name: "race", path: `/races/${RACE_ID}`, setup: setupRace },
  { name: "finance", path: "/finance" },
  { name: "board", path: "/board" },
];

// ── Hjaelpere ────────────────────────────────────────────────────────────────

const log = (line) => process.stdout.write(`${line}\n`);

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* ikke oppe endnu */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`static server kom aldrig op paa ${url}`);
}

function buildFrontend() {
  const env = {
    ...process.env,
    VITE_E2E: "1",
    VITE_API_URL: BASE,
    VITE_SUPABASE_URL: "https://cycling-zone-e2e.supabase.co",
    VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
    VITE_PUBLIC_APP_URL: BASE,
  };
  log("Bygger frontend med VITE_E2E=1 ...");
  const res = spawnSync("npm", ["run", "build"], { cwd: FRONTEND, env, stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error("npm run build fejlede");
}

async function newContext(browser, vpName) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: VIEWPORTS[vpName],
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "light",
    ...(vpName === "mobile" ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("cz_lang", "en");
    window.localStorage.setItem("cz-theme", "light");
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
  return context;
}

async function login(context) {
  const page = await context.newPage();
  await installNetworkMocks(page);
  await page.goto("/login");
  const email = page.getByPlaceholder(/e-?mail/i);
  await email.waitFor();
  await email.fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.close();
}

async function measurePage(context, target, mode, vpName) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  try {
    await installNetworkMocks(page);
    if (target.setup) await target.setup(page);
    const sep = target.path.includes("?") ? "&" : "?";
    const url = mode === "pseudo" ? `${target.path}${sep}pseudo=1&pad=${opts.pad}` : target.path;
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.locator("main").first().waitFor({ timeout: 15_000 });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await page.waitForTimeout(900);

    const lang = await page.evaluate(() => window.__i18n?.language ?? null);
    const decorated = await page.evaluate(() => document.body.innerText.includes("·••"));
    if (mode === "pseudo" && (lang !== "en-XA" || !decorated)) {
      throw new Error(`pseudo-locale ikke aktiv (sprog=${lang}, pynt=${decorated})`);
    }
    if (mode === "baseline" && decorated) throw new Error("baseline indeholder pseudo-pynt");

    const result = await page.evaluate(measureLayout, { maxFindings: 400 });
    if (opts.shots && mode === "pseudo" && vpName === "mobile") {
      // Viewport-billedet viser den faste bundnavigation paa sin rigtige plads
      // (fullPage-billedet lægger den midt i siden).
      await page.screenshot({ path: join(OUT, `${target.name}-${vpName}-${mode}-viewport.png`) });
    }
    if (opts.shots && (mode === "pseudo" || process.env.I18N_PSEUDO_ALL_SHOTS === "1")) {
      await page.screenshot({ path: join(OUT, `${target.name}-${vpName}-${mode}.png`), fullPage: true });
    }
    return { ...result, errors, ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err), findings: [], bottomNav: [], errors };
  } finally {
    await page.close();
  }
}

// ── Koersel ──────────────────────────────────────────────────────────────────

if (opts.build || !existsSync(join(FRONTEND, "dist", "index.html"))) buildFrontend();

const server = spawn(
  process.execPath,
  [join(FRONTEND, "scripts", "e2e-static-server.mjs"), "--host", HOST, "--port", String(PORT)],
  { cwd: FRONTEND, stdio: "inherit" },
);

let browser;
const results = [];
try {
  await waitForServer(`${BASE}/app.html`);
  browser = await chromium.launch();
  const targets = opts.pages ? PAGES.filter((p) => opts.pages.includes(p.name)) : PAGES;
  if (targets.length === 0) throw new Error("ingen sider matcher --pages");

  for (const vpName of opts.viewports) {
    const context = await newContext(browser, vpName);
    await login(context);
    for (const target of targets) {
      const base = opts.baseline ? await measurePage(context, target, "baseline", vpName) : { ok: true, findings: [], bottomNav: [] };
      const pseudo = await measurePage(context, target, "pseudo", vpName);
      const diff = diffFindings(base.findings, pseudo.findings);
      results.push({ page: target.name, path: target.path, viewport: vpName, baseline: base, pseudo, new: diff.isNew, existing: diff.existing });
      const hi = diff.isNew.filter((f) => f.severity === "high").length;
      log(`${vpName.padEnd(7)} ${target.name.padEnd(14)} ${pseudo.ok ? `nye=${diff.isNew.length} (høj ${hi}) eksisterende=${diff.existing.length}` : `FEJL: ${pseudo.error}`}`);
    }
    await context.close();
  }
} finally {
  try { await browser?.close(); } finally { server.kill(); }
}

// ── Rapport ──────────────────────────────────────────────────────────────────

writeFileSync(
  join(OUT, "findings.json"),
  JSON.stringify(
    results.map((r) => ({
      page: r.page, path: r.path, viewport: r.viewport,
      ok: r.pseudo.ok, error: r.pseudo.error ?? null,
      new: sortFindings(r.new), existing: sortFindings(r.existing),
      bottomNav: r.pseudo.bottomNav, bottomNavBaseline: r.baseline.bottomNav,
    })),
    null, 2,
  ),
);

const md = [`# Layout-sweep en-XA pad=${opts.pad} (${opts.label})`, ""];
const total = summarize(results.flatMap((r) => r.new));
md.push(`Nye fund i alt: ${total.total} (${Object.entries(total.bySeverity).map(([k, v]) => `${k} ${v}`).join(", ") || "ingen"})`, "");
for (const r of results) {
  md.push(`## ${r.page} · ${r.viewport}`, "");
  if (!r.pseudo.ok) { md.push(`Fejl: ${r.pseudo.error}`, ""); continue; }
  md.push(renderFindingsTable(r.new));
  if (r.pseudo.bottomNav.length > 0) {
    md.push("Bundnavigation (pseudo):", "");
    md.push("| Fane | Fanebredde | Tekstbredde | Indre bredde | Headroom | Linjer | Klippet |", "|---|---|---|---|---|---|---|");
    for (const n of r.pseudo.bottomNav) {
      md.push(`| ${n.label} | ${n.tabWidth} | ${n.textWidth} | ${n.labelBox} | ${navHeadroom(n)} | ${n.lines} | ${n.clipped ? "ja" : "nej"} |`);
    }
    md.push("");
  }
}
writeFileSync(join(OUT, "report.md"), `${md.join("\n")}\n`);
log(`\nResultat → ${OUT}`);
