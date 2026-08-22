// Skaermbilleder af taktik-kortet (#4093) EFTER design-system-rettelsen.
// Koerer mod den koerende dev-server paa 5315 (VITE_PREVIEW_MOCK=1), saa appens
// egen preview-mock leverer baade auth og data. Brug:
//   node shot-4093.mjs <base> <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5315";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

// EN foerst (primaersproget), DA som kontrol at kortet ikke braekker paa
// laengere strenge ("FORSOEG UDBRUD" er bredere end "TRY THE BREAK").
const SHOTS = [
  { name: "desktop-en", width: 1440, height: 900, lang: "en" },
  { name: "desktop-da", width: 1440, height: 900, lang: "da" },
  { name: "mobile-en", width: 393, height: 852, lang: "en" },
];

const browser = await chromium.launch();
for (const vp of SHOTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // Samtykke + DA-locale saettes foer first paint (samme noegler som
  // tests/e2e/fixtures.js), saa cookie-banneret aldrig daekker kortet og
  // login-formularens danske placeholders matcher.
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

  await page.goto("/races/race-up-1");
  const card = page.locator('[data-testid="tactics-card"]');
  await card.waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await card.screenshot({ path: resolve(OUT, `4093-tactics-after-${vp.name}.png`) });

  // Kontekst-skud: kortet i sin omgivelse (lineup-kortet ovenover).
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, `4093-tactics-after-${vp.name}-context.png`) });
  await ctx.close();
  console.log(`[4093] ${vp.name} ok`);
}
await browser.close();
console.log(`[4093] Skrevet til ${OUT}`);
