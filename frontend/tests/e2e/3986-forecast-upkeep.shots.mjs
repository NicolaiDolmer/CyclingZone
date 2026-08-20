// #3986 — PR-screenshots af prognose-kortet efter at divisions-upkeep fik sin
// egen linje. Formålet er at vise ejeren præcis den opdeling @arongreve
// efterspurgte: 140.000 upkeep og 24.910 stab/faciliteter som to rækker i
// stedet for ét sammenlagt tal på 164.910.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev/preview-server med e2e-netværksmocks.
//
//   node tests/e2e/3986-forecast-upkeep.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

function stabilize(page, lang) {
  return page.addInitScript((lng) => {
    window.localStorage.setItem("cz_lang", lng);
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
  }, lang);
}

async function login(page, lang) {
  await page.goto("/login");
  await page.getByPlaceholder(lang === "da" ? /email/i : /email/i).waitFor();
  await page.getByPlaceholder(/email/i).fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: lang === "da" ? /log ind/i : /log in/i }).click();
  await page.waitForURL(/\/dashboard$/);
}

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const lang of ["da", "en"]) {
  for (const vp of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 393, height: 852 }]) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: lang === "da" ? "da-DK" : "en-US",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    await stabilize(page, lang);
    await login(page, lang);
    await page.goto("/finance");
    // Prognose-kortet er det eneste sted "Forecast-horisont"/"Forecast horizon"
    // findes — vent på selve select'en så kortet er fuldt hydreret.
    await page.getByRole("combobox").first().waitFor({ state: "visible" });
    await page.waitForTimeout(700);
    // Kortet har ingen stabil rolle/testid; find select'ens naermeste
    // kort-container ved at gaa op i DOM'en indtil vi rammer et element der er
    // markant bredere end select'en selv.
    // Kortet har hverken rolle eller testid. Find overskriften "prognose" /
    // "forecast" og klip det kort den staar i (foerste forfaeder med en ramme).
    const box = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("main h2, main h3")];
      const head = heads.find((h) => /prognose|forecast/i.test(h.textContent || ""));
      if (!head) return null;
      let node = head;
      while (node.parentElement) {
        const st = getComputedStyle(node);
        if (st.borderTopWidth !== "0px" || st.boxShadow !== "none") break;
        node = node.parentElement;
      }
      node.scrollIntoView({ block: "start" });
      const r = node.getBoundingClientRect();
      return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: Math.min(r.width + 12, window.innerWidth - Math.max(0, r.x - 6)), height: Math.min(r.height + 12, window.innerHeight - Math.max(0, r.y - 6)) };
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: resolve(OUT, `3986-forecast-upkeep-${vp.name}-${lang}.png`),
      ...(box && box.height > 100 ? { clip: box } : { fullPage: false }),
    });
    console.log("skrev", `3986-forecast-upkeep-${vp.name}-${lang}.png`);
    await context.close();
  }
}

await browser.close();
