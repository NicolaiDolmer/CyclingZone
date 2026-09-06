// Skaermbilleder af taktik-kortet EFTER at ordre-kaeden er lukket (#4246).
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js) — samme moenster som 4093-tactics-card.shots.mjs.
//
// Koerer mod en dev-server med VITE_PREVIEW_MOCK=1, saa appens egen preview-mock
// leverer baade auth og data (SEED_TEAM_ORDERS i src/preview/seedData.js). Det er
// den flade ejeren skal kunne se FOER v4-flippet.
//
//   npm run dev:preview --prefix frontend -- --port 5316 --strictPort
//   node tests/e2e/4246-order-chain.shots.mjs http://localhost:5316 <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5316";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

// 1280 (desktop) + 390 (mobil) er de to bredder ejeren gennemgaar paa.
// EN foerst (primaersproget), DA som kontrol paa at de laengere danske strenge
// ("Standard: udbrudsjaeger. I dag: bliver i feltet") ikke braekker raekken.
const SHOTS = [
  { name: "desktop-en", width: 1280, height: 900, lang: "en" },
  { name: "desktop-da", width: 1280, height: 900, lang: "da" },
  { name: "mobile-en", width: 390, height: 844, lang: "en" },
  { name: "mobile-da", width: 390, height: 844, lang: "da" },
];

const browser = await chromium.launch();
for (const vp of SHOTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // Samtykke + locale saettes foer first paint (samme noegler som
  // tests/e2e/fixtures.js), saa cookie-banneret aldrig daekker kortet.
  await page.addInitScript((LANG) => {
    window.localStorage.setItem("cz_lang", LANG);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, vp.lang);
  await page.goto("/login");
  await page.getByPlaceholder(vp.lang === "da" ? "din@email.dk" : "you@email.com").fill("manager@cyclingzone.test");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: vp.lang === "da" ? /^Log ind$/ : /^Log in$/ }).click();
  await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 20000 });

  // Etape 3 er den aabne etape i seedet, og den der HAR en gemt ordre — saa
  // baade "koerer sin rolle" og "I dag: <afvigelse>" er synlige i samme skud.
  await page.goto("/races/race-up-1?stage=3");
  const card = page.locator('[data-testid="tactics-card"]');
  await card.waitFor({ timeout: 20000 });
  await page.waitForTimeout(500); // navne-opslag + paint settle
  await card.screenshot({ path: resolve(OUT, `orders-${vp.name}.png`) });

  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `orders-${vp.name}-context.png`) });
  await ctx.close();
  console.log(`[4246] ${vp.name} ok`);
}
await browser.close();
console.log(`[4246] Skrevet til ${OUT}`);
