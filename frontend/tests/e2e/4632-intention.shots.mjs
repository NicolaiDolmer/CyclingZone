// Skaermbilleder af loebsdagens intention (#4632, variant B) til ejer-review.
// Koerer mod en koerende dev-server med VITE_PREVIEW_MOCK=1, saa appens egen
// preview-mock leverer baade auth og data (samme moenster som
// 4093-tactics-card.shots.mjs). Brug:
//   node tests/e2e/4632-intention.shots.mjs http://localhost:5316 <outdir>
//
// Fire tilstande, praecis dem ejeren skal doemme paa:
//   a) etapeloeb, etape 3 aaben, to ryttere sat        (race-live-1)
//   b) den udfoldede vaelger                            (race-live-1)
//   c) endagsloeb, ingen etape-vaelger                  (race-oneday-preview)
//   d) flaget off -> TRE trin                           (race-up-1)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] || "http://localhost:5316";
const OUT = resolve(process.argv[3] || ".");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 390, height: 900 },
];

const PANEL = '[data-testid="race-intention-panel"]';

async function loginPreview(page, lang) {
  await page.addInitScript((LANG) => {
    window.localStorage.setItem("cz_lang", LANG);
    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1, necessary: true, analytics: false, marketing: false,
      email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
    }));
  }, lang);
  await page.goto("/login");
  await page.getByPlaceholder(lang === "da" ? "din@email.dk" : "you@email.com").fill("manager@cyclingzone.test");
  await page.getByPlaceholder("••••••••").fill("preview-mock");
  await page.getByRole("button", { name: lang === "da" ? /^Log ind$/ : /^Log in$/ }).click();
  await page.waitForURL(/\/(dashboard|races|$)/, { timeout: 30000 });
}

const LANG = process.env.SHOT_LANG || "en";
const FOLD_TITLE = LANG === "da" ? "Løbsdagens intention" : "Race day intention";

// Er loebet i gang, ligger fladen i en default-lukket <details>. No-op ellers.
async function openFold(page) {
  const summary = page.locator("summary", { hasText: FOLD_TITLE });
  if (await summary.count()) await summary.first().click();
}

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await loginPreview(page, LANG);

  // (a) etapeloeb: etape 1-2 koert, etape 3 aaben, to ryttere allerede sat.
  // Loebet er i gang, saa fladen ligger i en default-lukket CollapsibleSection.
  await page.goto("/races/race-live-1");
  const panel = page.locator(PANEL);
  await panel.waitFor({ state: "attached", timeout: 30000 });
  await openFold(page);
  await panel.waitFor({ state: "visible", timeout: 30000 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await panel.screenshot({ path: resolve(OUT, `impl-stage-race-${vp.name}.png`) });

  // (b) den udfoldede vaelger paa den foerste rytter uden intention.
  const setBtn = panel.getByRole("button", { name: LANG === "da" ? "Sæt intention" : "Set intention" }).first();
  await setBtn.click();
  await page.waitForTimeout(300);
  await panel.screenshot({ path: resolve(OUT, `impl-picker-open-${vp.name}.png`) });

  // (c) endagsloeb: ingen etape-vaelger, kolonnen hedder loebsdag.
  await page.goto("/races/race-oneday-preview");
  await panel.waitFor({ timeout: 30000 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await panel.screenshot({ path: resolve(OUT, `impl-one-day-${vp.name}.png`) });

  // (d) flaget off: serveren sender tre vaerdier, fladen viser tre trin.
  await page.goto("/races/race-up-1");
  await panel.waitFor({ timeout: 30000 });
  await panel.scrollIntoViewIfNeeded();
  await panel.getByRole("button", { name: LANG === "da" ? "Sæt intention" : "Set intention" }).first().click();
  await page.waitForTimeout(300);
  await panel.screenshot({ path: resolve(OUT, `impl-flag-off-three-steps-${vp.name}.png`) });

  await ctx.close();
  console.log(`[4632] ${vp.name} ok`);
}

await browser.close();
console.log(`[4632] Skrevet til ${OUT}`);
