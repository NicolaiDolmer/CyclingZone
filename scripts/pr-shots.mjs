#!/usr/bin/env node
// #5565 · Billedstationen: aegte-data-billeder af enhver PR fra EEN fast lokal
// origin (http://localhost:5173) mod prod-API'et, med EET login for alle PR'er.
//
//   node scripts/pr-shots.mjs login                                  # een gang (ejeren taster selv)
//   node scripts/pr-shots.mjs shoot main C:\Dev\CyclingZone /dashboard /team
//   node scripts/pr-shots.mjs shoot feat-5589 C:\Dev\CyclingZone-worktrees\feat-5589 /dashboard /team --pr=5589
//   node scripts/pr-shots.mjs compose feat-5589                      # foer/efter mod "main"
//
// Hvorfor en fast lokal origin: Supabase-sessionen ligger pr. origin. Et
// Vercel-preview har sin egen origin pr. PR, saa hvert preview kraevede et nyt
// login (ejeren loggede ind tre gange 24/9). Her bygges hver PR's frontend i sin
// egen worktree og serveres paa SAMME origin, saa eet login i profilen gaelder alle.
// localhost:5173 staar allerede i backendens CORS-liste (backend/server.js).
//
// Sikkerhedskontrakt (bindende, .claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md):
//   - Scriptet laeser, skriver eller logger ALDRIG tokens, cookies eller storage.
//     Login-status maales kun som "landede /dashboard paa /login, eller svarede
//     API'et 401?".
//   - Browser-uret roeres aldrig (--shot-at m.fl. afvises i parseArgs). Andre
//     tilstande fremkaldes med mocks af datasvar: --mock (GET) og --mock-rpc
//     (supabase-js' .rpc() er ALTID POST, ogsaa for laesende funktioner).
//   - Skrive-vagt: alle ikke-laesende kald besvares lokalt med 204, undtagen
//     Supabase' token-endpoint (login + refresh). Et signOut besvares 204 OG taelles.
//     Service workers blokeres, saa intet kald kan gaa uden om vagten.
//   - Mesterprofilen (%LOCALAPPDATA%\cz-pr-shots-profile) aabnes kun af `login`.
//     Hver billedserie koerer i en KOPI, som slettes bagefter, saa et signOut
//     aldrig kan ramme mesteren.
//   - Build-miljoeet renses for VITE_*/SENTRY_*, saa worktreets egne .env-filer
//     afgoer API'et, og et PR-build aldrig uploader source maps til Sentry.
//
// Tungt (build + browser): koer under verifikations-semaforen i en boelge:
//   pwsh -File scripts/verify-lock.ps1 -Max 2 -- node scripts/pr-shots.mjs shoot ...
//
// De rene dele (argumenter, plan, stier, statisk opslag, vagt-regler, compose-HTML)
// ligger i scripts/lib/prShots.mjs og testes med `node --test scripts/lib/prShots.test.mjs`.
// Browseren er Playwright fra frontend/node_modules (ingen ny afhaengighed).

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPOSE_FILE,
  FIXED_ORIGIN,
  FIXED_PORT,
  BIND_HOSTS,
  BUILD_COMMAND,
  HELP_TEXT,
  ID_PATH,
  PROFILE_COPY_PREFIX,
  REPORT_FILE,
  composeHtml,
  contentTypeFor,
  defaultOutRoot,
  describeRequest,
  formatPlan,
  isAuthFailure,
  isInside,
  isLoginPath,
  isSignOutRequest,
  isStaleProfileCopy,
  isWriteRequest,
  lookupPreviewUrl,
  masterProfileDir,
  mockFor,
  mockLabel,
  pairShots,
  parseArgs,
  planShoot,
  probeVerdict,
  resolveStaticFile,
} from "./lib/prShots.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const NAV_TIMEOUT_MS = 60 * 1000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const SETTLE_MS = 750;
/** Chromiums laase- og cache-filer kopieres ikke med til koerslens profil. */
const PROFILE_COPY_SKIP = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache"]);

const cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }
async function runCleanups() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { await fn(); } catch (err) { process.stderr.write(`  [oprydning] ${err.message}\n`); }
  }
}
process.on("SIGINT", () => { runCleanups().finally(() => process.exit(130)); });

function log(line) { process.stdout.write(`${line}\n`); }

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function outRootFor(opts) {
  if (opts.out) return { dir: resolve(opts.out), private: !isInside(REPO_ROOT, resolve(opts.out)) };
  return defaultOutRoot({ env: process.env, homedir: homedir(), repoRoot: REPO_ROOT, exists: existsSync });
}

function profileDir() {
  return masterProfileDir({ env: process.env, homedir: homedir() });
}

function loadPlaywright(frontendDirs) {
  for (const dir of frontendDirs) {
    if (!existsSync(join(dir, "node_modules"))) continue;
    const req = createRequire(join(dir, "package.json"));
    for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
      try { return req(name); } catch { /* proev naeste pakke/mappe */ }
    }
  }
  throw new Error("Playwright ikke fundet i frontend/node_modules. Koer `npm ci` i frontend/ foerst.");
}

// ── Build + statisk server paa den faste origin ────────────────────────────

function buildFrontend(buildCwd) {
  if (!existsSync(join(buildCwd, "package.json"))) throw new Error(`Ingen frontend i ${buildCwd}.`);
  if (!existsSync(join(buildCwd, "node_modules"))) throw new Error(`${buildCwd}\\node_modules mangler (worktreet er ikke installeret).`);
  if (!existsSync(join(buildCwd, ".env.production")) && !existsSync(join(buildCwd, ".env"))) {
    log(`  [advarsel] ingen .env-fil i ${buildCwd}; buildet peger maaske ikke paa prod-API'et.`);
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(VITE_|SENTRY_)/i.test(key) || key === "CZ_SENTRY_TRANSFORM") delete env[key];
  }
  log(`Bygger ${buildCwd} (${BUILD_COMMAND}, typisk 1-2 min) ...`);
  const res = spawnSync(BUILD_COMMAND, { cwd: buildCwd, shell: true, stdio: "inherit", env, timeout: BUILD_TIMEOUT_MS });
  if (res.error) throw new Error(`Build fejlede: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`Build fejlede (exit ${res.status}) i ${buildCwd}.`);
}

function listenOn(server, host) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (err) => { server.off("listening", onListening); rejectListen(err); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port: FIXED_PORT, host, exclusive: true });
  });
}

/**
 * Serverer dist paa BEGGE loopback-adresser (127.0.0.1 og ::1). Er porten optaget
 * paa en af dem, stopper vi: browseren kunne ellers ramme en fremmed server
 * (fx en anden worktrees vite) og fotografere den forkerte kode. Aldrig en anden port.
 */
async function startStaticServer(distDir, nonce) {
  const handler = (req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Cache-Control", "no-store");
    if (url.split("?")[0] === ID_PATH) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(nonce);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const file = resolveStaticFile(distDir, url, isFile);
    if (!file) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", contentTypeFor(file));
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  };
  const servers = [];
  const closeAll = () => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
  for (const host of BIND_HOSTS) {
    const server = createServer(handler);
    server.keepAliveTimeout = 0;
    try {
      await listenOn(server, host);
      servers.push(server);
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        await closeAll();
        throw new Error(
          `Port ${FIXED_PORT} er optaget paa ${host}. Origin'en ${FIXED_ORIGIN} er kontrakten, saa der bruges aldrig en anden port. ` +
          "Luk den anden server (typisk en vite dev/preview) og proev igen.",
        );
      }
      if (host.includes(":") && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(err.code)) continue; // best-effort: maskinen har ikke IPv6-loopback
      await closeAll();
      throw err;
    }
  }
  if (!servers.length) throw new Error(`Kunne ikke binde port ${FIXED_PORT}.`);
  return { close: closeAll };
}

function assertDist(distDir) {
  if (!isFile(join(distDir, "app.html")) && !isFile(join(distDir, "index.html"))) {
    throw new Error(`${distDir} har hverken app.html eller index.html. Byg foerst (udelad --no-build).`);
  }
}

// ── Browser ────────────────────────────────────────────────────────────────

async function launch(playwright, profile, { channel, headless }) {
  return playwright.chromium.launchPersistentContext(profile, {
    channel,
    headless,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

/** Rydder profil-kopier fra koersler der blev draebt uden oprydning (de er stadig logget ind). */
function sweepStaleProfileCopies() {
  const now = Date.now();
  for (const name of readdirSync(tmpdir())) {
    const dir = join(tmpdir(), name);
    try {
      if (statSync(dir).isDirectory() && isStaleProfileCopy(name, statSync(dir).mtimeMs, now)) {
        rmSync(dir, { recursive: true, force: true });
        log(`  [oprydning] gammel profil-kopi slettet: ${dir}`);
      }
    } catch (err) {
      log(`  [oprydning] kunne ikke slette ${dir}: ${err.message}`);
    }
  }
}

/** Kopi af mesterprofilen til denne koersel. */
function copyProfileForRun(master) {
  sweepStaleProfileCopies();
  const tmp = mkdtempSync(join(tmpdir(), PROFILE_COPY_PREFIX));
  cpSync(master, tmp, { recursive: true, filter: (src) => !PROFILE_COPY_SKIP.has(basename(src)) });
  return tmp;
}

/** Skrive-vagten: 204 til alt skrivende, signOut taelles saerskilt. Aldrig inspektion af body/headers. */
async function installWriteGuard(context, state) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (isSignOutRequest(url)) {
      state.signOut += 1;
      log(`  [vagt] signOut forsoegt af appen (besvaret 204, mesterprofilen er uroert): ${describeRequest(method, url)}`);
      return route.fulfill({ status: 204, body: "" });
    }
    if (isWriteRequest(method, url)) {
      const key = describeRequest(method, url);
      state.blocked.set(key, (state.blocked.get(key) ?? 0) + 1);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });
}

/**
 * Mocks registreres EFTER proben og EFTER skrive-vagten (senest registrerede
 * route vinder i Playwright). Det er ogsaa det der lader en --mock-rpc svare paa
 * POST /rest/v1/rpc/<fn> foer vagten ville have givet den et tomt 204.
 */
async function installMocks(context, mocks) {
  if (!mocks.length) return;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const mock = mockFor(mocks, request.method(), request.url());
    if (!mock) return route.fallback();
    return route.fulfill({
      status: mock.status,
      contentType: "application/json",
      body: mock.body ?? "",
    });
  });
}

function loadMockBodies(mocks) {
  return mocks.map((m) => {
    if (!m.file) return { ...m, body: "" };
    const file = resolve(m.file);
    if (!isFile(file)) throw new Error(`--mock-filen findes ikke: ${file}`);
    const body = readFileSync(file, "utf8");
    try { JSON.parse(body); } catch { throw new Error(`--mock-filen er ikke gyldig JSON: ${file}`); }
    return { ...m, file, body };
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => { /* best-effort: lange polls maa ikke stoppe billedet */ });
  await page.waitForTimeout(SETTLE_MS);
}

/** Bevis for at localhost:5173 i BROWSEREN er denne koersels server (ikke en fremmed paa ::1). */
async function verifyOrigin(page, nonce) {
  const res = await page.goto(`${FIXED_ORIGIN}${ID_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const text = res ? (await res.text()).trim() : "";
  if (text !== nonce) {
    throw new Error(`${FIXED_ORIGIN} i browseren er ikke denne koersels server (en anden proces svarer). Stop den og proev igen.`);
  }
}

/** Login-probe: aabn /dashboard; logget ind = ikke paa /login og intet 401 fra API/auth. */
async function probe(page, apiHosts) {
  const authFailures = [];
  const onResponse = (res) => {
    const url = res.url();
    if (isAuthFailure(res.status(), url)) authFailures.push(describeRequest(res.request().method(), url));
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/api/") && u.origin !== FIXED_ORIGIN) apiHosts.add(u.origin);
    } catch { /* best-effort: kun til rapportens API-host-liste */ }
  };
  page.on("response", onResponse);
  try {
    await page.goto(`${FIXED_ORIGIN}/dashboard`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await settle(page);
    return probeVerdict({ finalUrl: page.url(), authFailures });
  } finally {
    page.off("response", onResponse);
  }
}

function gitInfo(worktree) {
  const run = (args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { sha: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: run(["status", "--porcelain"]).length > 0 };
  } catch {
    return { sha: null, branch: null, dirty: null };
  }
}

// ── Kommandoer ─────────────────────────────────────────────────────────────

async function runLogin(opts) {
  const worktree = resolve(opts.worktree ?? REPO_ROOT);
  const buildCwd = join(worktree, "frontend");
  const distDir = join(buildCwd, "dist");
  const master = profileDir();
  if (opts.dryRun) {
    log(`[dry-run] login: ${opts.build ? `${BUILD_COMMAND} i ${buildCwd}` : `serverer ${distDir}`} paa ${FIXED_ORIGIN}`);
    log(`[dry-run] mesterprofil: ${master}  kanal: ${opts.channel} (headed)`);
    log("[dry-run] ingen browser startet, ingen build, ingen filer skrevet.");
    return 0;
  }
  if (opts.build) buildFrontend(buildCwd);
  assertDist(distDir);
  const playwright = loadPlaywright([join(REPO_ROOT, "frontend"), buildCwd]);
  const nonce = randomUUID();
  const server = await startStaticServer(distDir, nonce);
  onCleanup(() => server.close());
  mkdirSync(master, { recursive: true });
  log(`Aabner ${FIXED_ORIGIN}/login i ${master} (headed). Log ind selv; vinduet lukker, naar login er gemt.`);
  const context = await launch(playwright, master, { channel: opts.channel, headless: false });
  onCleanup(() => context.close());
  const state = { blocked: new Map(), signOut: 0 };
  await installWriteGuard(context, state);
  const page = context.pages()[0] ?? (await context.newPage());
  await verifyOrigin(page, nonce);
  await page.goto(`${FIXED_ORIGIN}/login`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("Vinduet blev lukket foer login var gemt.");
    await page.waitForTimeout(2000);
    if (isLoginPath(page.url())) continue;
    await settle(page);
    const verdict = await probe(page, new Set());
    if (verdict.ok) {
      log(`Login gemt i ${master}. Det gaelder alle PR'er paa ${FIXED_ORIGIN}; naeste skridt er shoot.`);
      return 0;
    }
    log(`  Endnu ikke logget ind (${verdict.reason}); venter.`);
    await page.goto(`${FIXED_ORIGIN}/login`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  }
  throw new Error("Login ikke gemt inden for 10 minutter.");
}

async function runShoot(opts) {
  const out = outRootFor(opts);
  const plan = planShoot(opts, { outRoot: out.dir });
  const master = profileDir();
  if (!existsSync(plan.buildCwd)) throw new Error(`Ingen frontend-mappe i worktreet: ${plan.buildCwd}`);
  const mocks = loadMockBodies(opts.mocks);
  if (opts.dryRun) {
    log(formatPlan(opts, plan, { profileDir: master, outPrivate: out.private }));
    log("[dry-run] ingen browser startet, ingen build, ingen filer skrevet.");
    return 0;
  }
  if (!out.private) log(`  [advarsel] OneDrive-context ikke fundet; billederne lander i ${plan.outDir} (gitignoreret, aldrig commit).`);
  if (!existsSync(master)) throw new Error("Ingen login-profil endnu. Koer foerst: node scripts/pr-shots.mjs login");

  let preview = null;
  if (opts.pr) {
    try {
      preview = lookupPreviewUrl({
        repo: opts.repo,
        pr: opts.pr,
        runGh: (args) => execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }),
      });
      log(`Vercel-preview til go-kortet: ${preview.url} (${preview.source})`);
      if (preview.warning) log(`  [advarsel] ${preview.warning}`);
    } catch (err) {
      log(`  [advarsel] preview-link ikke fundet: ${err.message.split("\n")[0]}`);
    }
  }

  if (plan.buildCommand) buildFrontend(plan.buildCwd);
  assertDist(plan.distDir);
  const git = gitInfo(plan.worktree);
  const playwright = loadPlaywright([join(REPO_ROOT, "frontend"), plan.buildCwd]);
  const nonce = randomUUID();
  const server = await startStaticServer(plan.distDir, nonce);
  onCleanup(() => server.close());

  const runProfile = copyProfileForRun(master);
  onCleanup(() => rmSync(runProfile, { recursive: true, force: true }));
  const context = await launch(playwright, runProfile, { channel: opts.channel, headless: !opts.headed });
  onCleanup(() => context.close());
  const state = { blocked: new Map(), signOut: 0 };
  await installWriteGuard(context, state);
  const page = context.pages()[0] ?? (await context.newPage());
  await verifyOrigin(page, nonce);

  const apiHosts = new Set();
  const verdict = await probe(page, apiHosts);
  if (!verdict.ok) {
    log(`Ikke logget ind paa ${FIXED_ORIGIN} (${verdict.reason}). Koer foerst: node scripts/pr-shots.mjs login`);
    return 2;
  }
  await installMocks(context, mocks);

  mkdirSync(plan.outDir, { recursive: true });
  const shots = [];
  const clickLog = [];
  const waitLog = [];
  let stoppedAt = null;
  for (const shot of plan.shots) {
    await page.setViewportSize({ width: shot.width, height: shot.width < 800 ? 844 : 900 });
    await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await settle(page);
    if (isLoginPath(page.url())) {
      stoppedAt = `${shot.route} @ ${shot.width}`;
      log(`  [stop] ${stoppedAt} landede paa login-siden; sessionen holdt ikke. Koer login igen.`);
      break;
    }
    for (const click of opts.clicks) {
      const locator = click.kind === "css" ? page.locator(click.value).first() : page.getByText(click.value).first();
      const entry = { route: shot.route, width: shot.width, click: click.kind === "css" ? `css:${click.value}` : click.value };
      try {
        entry.element = (await locator.innerText({ timeout: 15_000 })).trim().replace(/\s+/g, " ").slice(0, 80);
        await locator.click({ timeout: 15_000 });
        await settle(page);
        entry.urlAfter = page.url();
        log(`  klik '${entry.click}' ramte '${entry.element}' -> ${entry.urlAfter}`);
      } catch (err) {
        entry.error = err.message.split("\n")[0];
        log(`  [klik fejlede] '${entry.click}' paa ${shot.route} @ ${shot.width}: ${entry.error}`);
      }
      clickLog.push(entry);
    }
    for (const selector of opts.waitFor) {
      try {
        await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
      } catch (err) {
        waitLog.push({ route: shot.route, width: shot.width, selector, error: err.message.split("\n")[0] });
        log(`  [vent fejlede] ${selector} paa ${shot.route} @ ${shot.width}`);
      }
    }
    await page.screenshot({ path: shot.file, fullPage: true });
    shots.push({ route: shot.route, width: shot.width, file: shot.file, finalUrl: page.url() });
    log(`  ${shot.file}  (${page.url()})`);
  }

  const blockedWrites = [...state.blocked.entries()].map(([request, count]) => ({ request, count }));
  const report = {
    tool: "scripts/pr-shots.mjs",
    issue: 5565,
    label: plan.label,
    createdAt: new Date().toISOString(),
    origin: FIXED_ORIGIN,
    worktree: plan.worktree,
    git,
    built: Boolean(plan.buildCommand),
    channel: opts.channel,
    preview: preview ? { url: preview.url, source: preview.source } : null,
    apiHosts: [...apiHosts],
    loginProbe: verdict.reason,
    shots,
    stoppedAt,
    clicks: clickLog,
    waits: waitLog,
    mocks: mocks.map((m) => ({ path: m.path, rpc: m.rpc ?? null, status: m.status, file: m.file })),
    blockedWrites,
    blockedWriteCount: blockedWrites.reduce((sum, b) => sum + b.count, 0),
    signOutAttempts: state.signOut,
    note: "Tokens, cookies og storage er aldrig laest. Browser-uret er ikke roert. Billederne har aegte spillerdata: aldrig i repoet.",
  };
  writeFileSync(plan.reportFile, `${JSON.stringify(report, null, 2)}\n`);
  log(
    `Faerdig: ${shots.length}/${plan.shots.length} billeder i ${plan.outDir}. Blokerede skrivninger: ${report.blockedWriteCount}. ` +
    `signOut-forsoeg: ${state.signOut}. API: ${report.apiHosts.join(", ") || "(ingen set under proben)"}.`,
  );
  if (git.dirty) log("  [bemaerk] worktreet har ucommittede aendringer; billederne viser dem.");
  if (mocks.length) log(`  [MOCK] ${mocks.map(mockLabel).join(", ")}: billederne viser en mocket tilstand, ikke prod. Sig det i go-kortet.`);
  if (stoppedAt) return 2;
  if (clickLog.some((c) => c.error) || waitLog.length) return 3;
  return 0;
}

function readReport(dir, label) {
  const file = join(dir, label, REPORT_FILE);
  if (!isFile(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function dataUri(file) {
  if (!file || !isFile(file)) return null;
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

async function runCompose(opts) {
  const out = outRootFor(opts);
  const target = join(out.dir, opts.label, COMPOSE_FILE);
  if (opts.dryRun) {
    log(`[dry-run] compose: foer = ${join(out.dir, opts.before, REPORT_FILE)}`);
    log(`[dry-run]          efter = ${join(out.dir, opts.label, REPORT_FILE)}`);
    log(`[dry-run]          -> ${target}`);
    return 0;
  }
  const after = readReport(out.dir, opts.label);
  if (!after) throw new Error(`Ingen rapport for '${opts.label}' i ${out.dir}. Koer shoot ${opts.label} ... foerst.`);
  const before = readReport(out.dir, opts.before);
  if (!before) {
    throw new Error(`Ingen 'foer'-rapport for '${opts.before}'. Koer foerst: node scripts/pr-shots.mjs shoot ${opts.before} <main-checkout> ${after.shots.map((s) => s.route).filter((r, i, a) => a.indexOf(r) === i).join(" ")}`);
  }
  const rows = pairShots(before, after).map((r) => ({ ...r, beforeSrc: dataUri(r.before), afterSrc: dataUri(r.after) }));
  const mocks = [
    ...(before.mocks ?? []).map((m) => `${opts.before}: ${mockLabel(m)}`),
    ...(after.mocks ?? []).map((m) => `${opts.label}: ${mockLabel(m)}`),
  ];
  const html = composeHtml({ before: opts.before, after: opts.label, rows, mocks });
  const playwright = loadPlaywright([join(REPO_ROOT, "frontend")]);
  const browser = await playwright.chromium.launch({ channel: opts.channel, headless: true });
  onCleanup(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1528, height: 900 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: target, fullPage: true });
  log(`Foer/efter: ${target} (${rows.length} raekker)`);
  return 0;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP_TEXT}\n`);
    return 1;
  }
  for (const w of opts.warnings ?? []) log(`  [advarsel] ${w}`);
  if (opts.help) { log(HELP_TEXT); return 0; }
  if (opts.command === "login") return runLogin(opts);
  if (opts.command === "shoot") return runShoot(opts);
  return runCompose(opts);
}

main()
  .then(
    (code) => { process.exitCode = code; },
    (err) => { process.stderr.write(`pr-shots: ${err.message}\n`); process.exitCode = 1; },
  )
  .finally(runCleanups);
