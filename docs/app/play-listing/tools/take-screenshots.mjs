// #6584 · Telefon-skærmbilleder til Google Play fra den rigtige app.
//
// Play kræver (support.google.com/googleplay/android-developer/answer/9866151, læst 12/11/2026):
// mindst 2 telefon-skærmbilleder, JPEG eller 24-bit PNG uden alfa, hver side 320 til 3840 px,
// og den længste side højst 2 gange den korteste. Derfor 412 x 824 CSS-px ved skala 2,62
// = 1080 x 2160 (præcis 2:1). Et 412 x 915-vindue giver 2,22:1 og afvises af Play.
//
// To tilstande:
//   fixtures  Mod en lokal build med projektets egne test-fixtures (ingen login, ingen prod, ingen
//             hemmeligheder). Bevis for at mål, format og rutetjek er rigtige. Dataene er syntetiske
//             ("E2E Racing"), så billederne er IKKE til butikken.
//   live      Mod https://cyclingzone.org med ejerens egen, allerede indloggede browserprofil
//             (scripts/shots/owner-session.mjs). Det er billederne til butikken. De gemmes uden for
//             repoet, og managernavne maskeres. Se docs/app/GOOGLE_PLAY.md for gennemlæsningen.
//
//   node docs/app/play-listing/tools/take-screenshots.mjs --mode=fixtures [--base=http://127.0.0.1:4173] [--out=<mappe>]
//   node docs/app/play-listing/tools/take-screenshots.mjs --mode=live [--lang=en|da] [--out=<mappe>] [--no-mask]
//     live skriver intet til kontoen: sproget er kontoens eget (--lang er kun en kontrol), og
//     billederne lægges i <mappe>/<sprog>/.
//   node docs/app/play-listing/tools/take-screenshots.mjs --dry-run      (viser planen, åbner ingen browser)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const require = createRequire(resolve(repo, "frontend/package.json"));

export const VIEWPORT = Object.freeze({ width: 412, height: 824 });
export const SCALE = 1080 / 412;
export const TARGET = Object.freeze({ width: 1080, height: 2160 });

/** Skærmene og rækkefølgen i butikken. Første billede er det Play viser først. */
export const SCREENS = Object.freeze([
  { file: "01-dashboard", route: "/dashboard", caption: "Your team at a glance" },
  { file: "02-auctions", route: "/auctions", caption: "Live rider auctions" },
  { file: "03-team", route: "/team", caption: "Your squad" },
  { file: "04-race-centre", route: "/race-centre", caption: "Today's stages" },
  { file: "05-training", route: "/training", caption: "Training and development" },
  { file: "06-academy", route: "/academy", caption: "Youth academy" },
]);

/** Links til andre managere og hold. Maskeres, så ingen spillernavne kommer i butikken. */
export const MASK_SELECTOR = [
  'a[href^="/managers/"]',
  'a[href^="/teams/"]',
  'a[href^="/team/"]',
  '[data-manager-name]',
].join(", ");

export function parseArgs(argv) {
  const flags = { mode: "fixtures", lang: "en", langGiven: false, base: "http://127.0.0.1:4173", mask: true, dryRun: false, out: null };
  for (const raw of argv) {
    if (raw === "--dry-run") flags.dryRun = true;
    else if (raw === "--no-mask") flags.mask = false;
    else if (raw.startsWith("--mode=")) flags.mode = raw.slice(7);
    else if (raw.startsWith("--lang=")) { flags.lang = raw.slice(7); flags.langGiven = true; }
    else if (raw.startsWith("--base=")) flags.base = raw.slice(7);
    else if (raw.startsWith("--out=")) flags.out = raw.slice(6);
    else throw new Error(`Ukendt flag: ${raw}`);
  }
  if (!["fixtures", "live"].includes(flags.mode)) throw new Error("--mode skal være fixtures eller live");
  if (!["en", "da"].includes(flags.lang)) throw new Error("--lang skal være en eller da");
  return flags;
}

function defaultOut(mode, lang) {
  const root = process.env.LOCALAPPDATA || process.env.HOME || ".";
  return join(root, "CyclingZone", "play-listing-shots", mode === "live" ? "live" : `${mode}-${lang}`);
}

/** Afviser alt Play ville afvise: forkerte mål, mere end 2:1, eller alfa-kanal. */
export function validateShot({ width, height, hasAlpha }) {
  const problems = [];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < 320 || long > 3840) problems.push(`mål ${width}x${height} uden for 320 til 3840`);
  if (long > short * 2) problems.push(`format ${(long / short).toFixed(2)}:1 er over 2:1`);
  if (hasAlpha) problems.push("har alfa-kanal (Play kræver 24-bit uden alfa)");
  return problems;
}

async function finalize(sharp, pngBuffer) {
  const flat = await sharp(pngBuffer).removeAlpha().png().toBuffer();
  const meta = await sharp(flat).metadata();
  return { flat, meta: { width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha) } };
}

/**
 * Skriver ét billede. Mappen oprettes rekursivt her, ikke kun i main(): live-tilstanden giver
 * shoot() en sprogmappe (<out>/en), der ikke findes første gang (Codex P2, #8059).
 */
export function writeShot(outDir, file, data) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${file}.png`);
  writeFileSync(path, data);
  return path;
}

async function shoot(page, sharp, flags, outDir) {
  const results = [];
  for (const screen of SCREENS) {
    await page.goto(new URL(screen.route, flags.base).href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1200);
    const mask = flags.mask ? [page.locator(MASK_SELECTOR)] : [];
    const raw = await page.screenshot({ type: "png", mask, maskColor: "#2b2d36", animations: "disabled" });
    const { flat, meta } = await finalize(sharp, raw);
    const problems = validateShot(meta);
    writeShot(outDir, screen.file, flat);
    results.push({ ...screen, ...meta, problems, landedOn: new URL(page.url()).pathname });
  }
  return results;
}

function report(results, outDir, mode) {
  console.log(`\n${results.length} billeder i ${outDir} (tilstand: ${mode})`);
  let bad = 0;
  for (const r of results) {
    const redirected = r.landedOn !== r.route && !r.landedOn.startsWith(r.route);
    const flag = r.problems.length || redirected ? "FEJL" : "ok";
    if (flag === "FEJL") bad += 1;
    const notes = [...r.problems, ...(redirected ? [`endte på ${r.landedOn}, ikke ${r.route}`] : [])];
    console.log(`  ${flag.padEnd(4)} ${r.file}.png ${r.width}x${r.height}${notes.length ? `  (${notes.join("; ")})` : ""}`);
  }
  if (mode === "live") {
    console.log("\nFør upload: åbn hvert billede og tjek at INGEN managernavn, holdnavn eller e-mail fra andre spillere er synligt.");
  } else {
    console.log("\nFixtures-billederne er kun en formatprøve. Brug --mode=live til butiksbillederne.");
  }
  return bad;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const outDir = resolve(flags.out ?? defaultOut(flags.mode, flags.lang));
  if (flags.dryRun) {
    console.log(JSON.stringify({ mode: flags.mode, lang: flags.lang, base: flags.mode === "live" ? "https://cyclingzone.org" : flags.base, outDir, viewport: VIEWPORT, scale: SCALE, target: TARGET, mask: flags.mask, screens: SCREENS.map((s) => s.route) }, null, 2));
    return 0;
  }
  mkdirSync(outDir, { recursive: true });
  const sharp = require("sharp");
  const { chromium } = require("@playwright/test");
  const context = { viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: flags.lang === "da" ? "da-DK" : "en-GB" };
  const stabilize = (lang) => {
    window.localStorage.setItem("cz_lang", lang);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-01-01T00:00:00.000Z" }));
  };

  if (flags.mode === "fixtures") {
    const { installNetworkMocks, TEST_USER } = await import(pathToFileURL(resolve(repo, "frontend/tests/e2e/fixtures.js")).href);
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ ...context, baseURL: flags.base });
      await ctx.addInitScript(stabilize, flags.lang);
      const page = await ctx.newPage();
      await installNetworkMocks(page);
      await page.goto(new URL("/login", flags.base).href);
      await page.getByPlaceholder(flags.lang === "da" ? "din@email.dk" : /email/i).fill(TEST_USER.email);
      await page.getByPlaceholder("••••••••").fill("playwright-password");
      await page.getByRole("button", { name: /log ind|log in/i }).click();
      await page.waitForURL(/\/dashboard$/);
      return report(await shoot(page, sharp, flags, outDir), outDir, "fixtures") ? 1 : 0;
    } finally {
      await browser.close();
    }
  }

  // Live: intet skrives til ejerens konto. Hverken samtykke eller sprog sættes af scriptet, for
  // appen synkroniserer begge med kontoen, og en syntetisk værdi ville blive gemt i produktion
  // (Codex-review 12/11). Billederne tages på kontoens eget sprog; skift sprog i appen selv for
  // at få det andet, og kør scriptet igen.
  const { withOwnerContext } = await import(pathToFileURL(resolve(repo, "scripts/shots/owner-session.mjs")).href);
  flags.base = "https://cyclingzone.org";
  return withOwnerContext({ ...context, locale: undefined }, async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(new URL("/dashboard", flags.base).href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const rendered = (await page.evaluate(() => document.documentElement.lang || "")).slice(0, 2).toLowerCase();
    console.log(`Appen vises på sprog: ${rendered || "ukendt"}`);
    if (flags.langGiven && rendered !== flags.lang) {
      console.error(`--lang=${flags.lang} ønskes, men kontoen vises på "${rendered}". Skift sprog i appen først (scriptet ændrer aldrig kontoen).`);
      return 1;
    }
    return report(await shoot(page, sharp, flags, join(outDir, rendered || "unknown")), outDir, "live") ? 1 : 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
}
