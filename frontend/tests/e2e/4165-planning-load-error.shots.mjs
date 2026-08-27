// Skaermbilleder af planlaegnings-hubbens NYE fejl-flade (#4165), saa ejeren kan
// se den spiller-vendte aendring foer merge. Foer fixet tegnede den samme
// tilstand INTET: sidehoved, fire faner og en tom flade.
//
// Koerer mod en dev-server med preview-mocken slaaet til (npm run dev:preview),
// saa auth og data kommer fra appens egen mock. Selve /api/races/distribution
// route'es til 500 her i scriptet, saa fejl-grenen rammes uden at roere mocken.
//
// Brug:
//   npm run dev:preview --prefix frontend
//   node tests/e2e/4165-planning-load-error.shots.mjs http://localhost:5173 <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5173";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

// EN foerst (primaersproget), DA som kontrol paa at den laengere danske streng
// ikke braekker kortet. Mobil fordi #4165 blev rapporteret fra en telefon.
const SHOTS = [
  { name: "desktop-en", width: 1440, height: 900, lang: "en" },
  { name: "desktop-da", width: 1440, height: 900, lang: "da" },
  { name: "mobile-en", width: 393, height: 852, lang: "en" },
  { name: "mobile-da", width: 393, height: 852, lang: "da" },
];

const browser = await chromium.launch();
for (const vp of SHOTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
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

  // Preview-mocken intercepter window.fetch i selve appen, saa Playwrights
  // page.route aldrig ser board-kaldet. Vi wrapper derfor mockens fetch bagefter
  // og lader netop /api/races/distribution fejle. Navigationen til hubben skal
  // vaere KLIENT-side (pushState + popstate) — en goto ville genindlaese
  // dokumentet og kaste wrapperen vaek.
  await page.evaluate(() => {
    const orig = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("/api/races/distribution")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "shot" }), {
          status: 500, headers: { "content-type": "application/json" },
        }));
      }
      return orig(input, init);
    };
  });
  await page.evaluate(() => {
    window.history.pushState({}, "", "/planning");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("alert").waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `4165-planning-error-${vp.name}.png`) });
  await ctx.close();
  console.log(`[4165] ${vp.name} ok`);
}
await browser.close();
console.log(`[4165] Skrevet til ${OUT}`);
