// scripts/shots/owner-session.mjs: vedvarende browserprofil til produktbilleder fra
// ejerens rigtige konto (#1369, ejer 15/10: "Hvorfor forbliver du ikke bare logget ind").
//
// Profilen ligger LOKALT på maskinen (uden for repoet) og husker login som en
// almindelig browser. Ejeren logger ind ÉN gang; alle senere optagelser genbruger
// sessionen uden at spørge. Scriptet ser aldrig adgangskoden og skriver ingen
// tokens til repoet. Slet mappen for at logge ud: %LOCALAPPDATA%\CyclingZone\owner-shots-profile
//
// Brug (fra repo-roden):
//   node scripts/shots/owner-session.mjs login        -> åbner et vindue, venter på login
//   node scripts/shots/owner-session.mjs check        -> "logged-in" / "logged-out"
// I andre scripts: import { withOwnerContext } from "./owner-session.mjs".
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

export const PROFILE_DIR = join(process.env.LOCALAPPDATA || process.env.HOME || ".", "CyclingZone", "owner-shots-profile");
const APP = "https://cyclingzone.org";

async function isLoggedIn(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(2500);
  const ok = !new URL(p.url()).pathname.startsWith("/login");
  await p.close();
  return ok;
}

/** Åbn profilen (headless når login findes) og kør fn(ctx). Kaster hvis ikke logget ind. */
export async function withOwnerContext(opts, fn) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, ...opts });
  try {
    if (!(await isLoggedIn(ctx))) throw new Error("Ikke logget ind: kør `node scripts/shots/owner-session.mjs login` (ejeren logger ind én gang).");
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

// CLI kun når filen køres direkte (ikke ved import fra et andet script).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const cmd = isMain ? process.argv[2] : undefined;
if (cmd === "login") {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1280, height: 860 } });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.goto(`${APP}/login`);
  console.log("Log ind i vinduet. Venter op til 5 min ...");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300_000 });
  await p.waitForTimeout(3000);
  await ctx.close();
  console.log("Logget ind. Profilen er gemt lokalt:", PROFILE_DIR);
} else if (cmd === "check") {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  console.log((await isLoggedIn(ctx)) ? "logged-in" : "logged-out");
  await ctx.close();
}
