#!/usr/bin/env node
// #5565 · Billedstationen: aegte-data-billeder af en PR's Vercel-preview med
// EEN fast Playwright-profil, som ejeren logger ind i een gang pr. preview-origin.
//
//   node scripts/pr-shots.mjs --pr 5589 --routes /dashboard,/academy --viewports 1440,390
//   node scripts/pr-shots.mjs --pr 5589 --login          # foerste gang pr. preview-origin
//   node scripts/pr-shots.mjs --pr 5589 --dry-run        # planen, ingen browser
//
// Output: pr-screens/live/<pr>-<route>-<viewport>.png (aegte spillerdata: commit dem ikke;
// pr-screens/live/ er gitignoreret).
//
// Sikkerhedskontrakt (laeringen 2026-09-24-pr-shots-fake-clock-logout.md):
//   - Scriptet laeser, skriver eller logger ALDRIG tokens/cookies. Login-status
//     maales kun som "landede /dashboard paa /login?".
//   - Browser-uret roeres aldrig (--shot-at m.fl. afvises i parseArgs).
//   - Skrive-vagt: alle ikke-laesende kald besvares lokalt med 204, undtagen
//     Supabase' token-refresh. Et signOut-kald besvares 204 OG taelles i rapporten.
//   - Mesterprofilen aabnes kun af --login. Hver billedserie koerer i en KOPI af
//     profilen, som slettes bagefter, saa et signOut aldrig kan ramme mesteren.
//
// De rene dele (argumenter, URL-opslag, filnavne, vagt-regler) ligger i
// scripts/lib/prShots.mjs og testes med `node --test scripts/lib/prShots.test.mjs`.
// Browseren er Playwright fra frontend/node_modules (ingen ny afhaengighed).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_TEXT,
  PROFILE_DIR_REL,
  buildPlan,
  formatPlan,
  isLoginPath,
  isSignOutRequest,
  isWriteRequest,
  lookupPreviewUrl,
  parseArgs,
} from "./lib/prShots.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const NAV_TIMEOUT_MS = 60 * 1000;
const SETTLE_MS = 750;

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
}

function loadPlaywright() {
  const req = createRequire(join(REPO_ROOT, "frontend", "package.json"));
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try { return req(name); } catch { /* proev naeste */ }
  }
  throw new Error("Playwright ikke fundet i frontend/node_modules. Koer `npm ci` i frontend/ foerst.");
}

function log(line) { process.stdout.write(`${line}\n`); }

function masterProfileDir() {
  const dir = join(REPO_ROOT, ...PROFILE_DIR_REL.split("/"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Kopi af profilen til denne koersel. Chromiums laasefiler kopieres ikke med. */
function copyProfileForRun(master) {
  const tmp = mkdtempSync(join(tmpdir(), "cz-pr-shots-"));
  cpSync(master, tmp, { recursive: true, filter: (src) => !basename(src).startsWith("Singleton") });
  return tmp;
}

async function launch(playwright, profileDir, { channel, headless }) {
  return playwright.chromium.launchPersistentContext(profileDir, {
    channel,
    headless,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

/** Skrive-vagten: 204 til alt skrivende, taeller signOut saerskilt. Aldrig inspektion af body/headers. */
async function installWriteGuard(context, counters) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (isSignOutRequest(url)) {
      counters.signOut += 1;
      log(`  [vagt] signOut forsoegt af appen (besvaret 204, mesterprofilen er uroert): ${new URL(url).pathname}`);
      return route.fulfill({ status: 204, body: "" });
    }
    if (isWriteRequest(request.method(), url)) {
      counters.blockedWrites += 1;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.continue();
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/** Login-probe: aabn /dashboard og se om vi lander paa login-siden. Ingen storage laeses. */
async function isLoggedIn(page, origin) {
  await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await settle(page);
  return !isLoginPath(page.url());
}

async function runLogin(playwright, opts, origin) {
  const master = masterProfileDir();
  log(`Aabner ${origin}/login i profilen ${PROFILE_DIR_REL} (headed). Log ind selv; vinduet lukker, naar login er gemt.`);
  const context = await launch(playwright, master, { channel: opts.channel, headless: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (page.isClosed()) throw new Error("Vinduet blev lukket foer login var gemt.");
      if (!isLoginPath(page.url())) {
        await settle(page);
        if (await isLoggedIn(page, origin)) {
          log(`Login gemt i ${PROFILE_DIR_REL} for ${origin}. Koer nu uden --login.`);
          return 0;
        }
      }
    }
    throw new Error("Login ikke gemt inden for 10 minutter.");
  } finally {
    await context.close();
  }
}

async function runShoot(playwright, opts, origin, shots) {
  const master = masterProfileDir();
  const runProfile = copyProfileForRun(master);
  const counters = { blockedWrites: 0, signOut: 0 };
  const context = await launch(playwright, runProfile, { channel: opts.channel, headless: !opts.headed });
  try {
    await installWriteGuard(context, counters);
    const page = context.pages()[0] ?? (await context.newPage());
    if (!(await isLoggedIn(page, origin))) {
      log(`Ikke logget ind paa ${origin}. Koer foerst: node scripts/pr-shots.mjs --pr ${opts.pr} --login`);
      return 2;
    }
    mkdirSync(resolve(REPO_ROOT, opts.out), { recursive: true });
    for (const shot of shots) {
      await page.setViewportSize({ width: shot.viewport, height: shot.viewport < 800 ? 844 : 900 });
      await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await settle(page);
      if (isLoginPath(page.url())) {
        log(`  [stop] ${shot.route} @ ${shot.viewport} landede paa login-siden; sessionen holdt ikke. Koer --login igen.`);
        return 2;
      }
      const file = resolve(REPO_ROOT, shot.file);
      await page.screenshot({ path: file, fullPage: true });
      log(`  ${shot.file}  (${page.url()})`);
    }
    log(`Faerdig: ${shots.length} billeder. Blokerede skrivninger: ${counters.blockedWrites}. signOut-forsoeg: ${counters.signOut}.`);
    return 0;
  } finally {
    await context.close();
    rmSync(runProfile, { recursive: true, force: true });
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP_TEXT}\n`);
    return 1;
  }
  if (opts.help) { log(HELP_TEXT); return 0; }

  let origin = opts.url;
  let source = "--url";
  let warning;
  if (!origin) {
    if (opts.dryRun) {
      log(`[dry-run] preview slaas op med: gh pr view ${opts.pr} --repo ${opts.repo} --json headRefOid,statusCheckRollup,comments`);
      log(`[dry-run]                       gh api repos/${opts.repo}/deployments?sha=<head> (+ statuses pr. Preview-deployment)`);
      try {
        ({ url: origin, source, warning } = lookupPreviewUrl({ repo: opts.repo, pr: opts.pr, runGh }));
      } catch (err) {
        log(`[dry-run] opslag sprang over: ${err.message.split("\n")[0]}`);
      }
    } else {
      ({ url: origin, source, warning } = lookupPreviewUrl({ repo: opts.repo, pr: opts.pr, runGh }));
    }
  }
  if (origin) log(`Preview: ${origin} (kilde: ${source})`);
  if (warning) log(`  [advarsel] ${warning}`);

  const shots = buildPlan(opts, origin);
  if (opts.dryRun) {
    log(formatPlan(opts, origin, shots));
    log("[dry-run] ingen browser startet, ingen filer skrevet.");
    return 0;
  }
  if (!existsSync(join(REPO_ROOT, "frontend", "node_modules"))) {
    throw new Error("frontend/node_modules mangler. Koer `npm ci` i frontend/ foerst.");
  }
  const playwright = loadPlaywright();
  if (opts.login) return runLogin(playwright, opts, origin);
  return runShoot(playwright, opts, origin, shots);
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => { process.stderr.write(`pr-shots: ${err.message}\n`); process.exitCode = 1; },
);
