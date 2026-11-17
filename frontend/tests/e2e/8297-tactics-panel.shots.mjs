// Rå skud af løbssidens Taktik-fane under v6 (#8297: det fælles taktikpanel efter
// wireframe v6c) til ejerens FØR | EFTER | WIREFRAME-montage.
//
// Kører mod en kørende dev-server med VITE_PREVIEW_MOCK=1 (appens egen preview-mock
// leverer auth og data) og slår v6 til med ?racePageV6=on. Samme løb før og efter.
//   node tests/e2e/8297-tactics-panel.shots.mjs app http://localhost:5188 <outdir>
// Wireframets taktikdel (wireframe v6c, Tactics-fanen):
//   node tests/e2e/8297-tactics-panel.shots.mjs wireframe <sti/til/wireframe-v6c.html> <outdir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [mode = "app", target = "http://localhost:5188", outArg = "."] = process.argv.slice(2);
const OUT = resolve(outArg);
mkdirSync(OUT, { recursive: true });
const RACE = process.env.SHOT_RACE || "race-live-1";
const LANG = process.env.SHOT_LANG || "en";

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "390", width: 390, height: 900, mobile: true },
];

async function loginPreview(page) {
  await page.addInitScript((lang) => {
    window.localStorage.setItem("cz_lang", lang);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, LANG);
  await page.goto("/login");
  // Preview-mocken logger selv ind og sender videre fra /login: så er vi færdige.
  const email = page.getByPlaceholder(LANG === "da" ? "din@email.dk" : "you@email.com");
  const needsLogin = await email.waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (!needsLogin) return;
  await page.getByPlaceholder(LANG === "da" ? "din@email.dk" : "you@email.com").fill("manager@cyclingzone.test");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: LANG === "da" ? /^Log ind$/ : /^Log in$/ }).click();
  await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 30000 });
}

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    baseURL: mode === "app" ? target : undefined,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: Boolean(vp.mobile),
    hasTouch: Boolean(vp.mobile),
  });
  const page = await ctx.newPage();
  if (mode === "wireframe") {
    await page.goto(pathToFileURL(resolve(target)).href);
    await page.getByRole("tab", { name: /^Tactics$/ }).or(page.getByRole("button", { name: /^Tactics$/ })).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, `wireframe-v6c-taktik-${vp.name}.png`), fullPage: true });
  } else {
    await loginPreview(page);
    // #8298: SHOT_QUERY="&stagePlan=1" slår etapeplanen til i mocken; SHOT_ALL=1 vælger "All orders",
    // SHOT_OPEN=1 åbner første rytters kort på telefon.
    await page.goto(`/races/${RACE}?tab=tactics&racePageV6=on${process.env.SHOT_QUERY || ""}`);
    await page.locator('[data-race-page-version="v6"]').waitFor({ timeout: 30000 });
    await page.getByTestId("race-tactics-tab").first().waitFor({ timeout: 30000 });
    // En kommende etape (redigerbar), så indsats-linjen og guldknappen er med.
    const stage = process.env.SHOT_STAGE || "4";
    await page.locator(`[data-race-strip] [data-stage="${stage}"]`).first().click();
    await page.waitForTimeout(900);
    if (process.env.SHOT_PLAN) {
      await page.getByTestId(`team-plan-${process.env.SHOT_PLAN}`).first().click();
      await page.waitForTimeout(400);
    }
    // Fanebjælken klæber ellers hen over ruten i et element-skud (billedfejl 35).
    await page.addStyleTag({ content: "[data-race-page] .sticky{position:static !important}" });
    if (process.env.SHOT_ALL === "1" && !vp.mobile) {
      await page.getByRole("button", { name: /^(All orders|Alle ordrer)$/ }).first().click();
      await page.waitForTimeout(400);
    }
    if (process.env.SHOT_OPEN === "1" && vp.mobile) {
      await page.locator("[data-tactics-timeline] li > button").first().click();
      await page.waitForTimeout(400);
    }
    const tag = process.env.SHOT_TAG ? `-${process.env.SHOT_TAG}` : "";
    // Kun selve fanen (fanebjælken klæber ellers hen over ruten i et fuldside-skud, billedfejl 35).
    const panel = page.locator("[data-tactics-panel]").first();
    if (await panel.count()) await panel.screenshot({ path: resolve(OUT, `taktik-${RACE}-${vp.name}${tag}.png`) });
    else await page.screenshot({ path: resolve(OUT, `taktik-${RACE}-${vp.name}${tag}.png`), fullPage: true });
  }
  console.log(`[8297] ${mode} ${vp.name} ok`);
  await ctx.close();
}
await browser.close();
